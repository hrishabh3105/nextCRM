import { prisma } from "@nextcrm/db";
import { forWorkspace } from "@nextcrm/core";
import { normalizePhoneE164 } from "../utils/phone";

/**
 * Handles incoming Meta WhatsApp webhook payloads.
 *
 * Architecture note on multi-tenant database scoping:
 * Incoming Meta webhook events arrive globally at a single shared webhook endpoint
 * without tenant context in the request headers or URL path.
 *
 * 1. The initial Channel lookup uses the RAW, unscoped `prisma` client directly
 *    from `@nextcrm/db`. This is the ONLY legitimate unscoped query in the entire codebase:
 *    determining which workspace owns the receiving WABA ID / Channel IS the entire point
 *    of this lookup.
 * 2. Once `channel.workspaceId` is resolved, EVERY subsequent database operation
 *    (Contact, Conversation, Message) is strictly scoped using `forWorkspace(channel.workspaceId)`.
 */
export async function handleInboundWebhookPayload(payload: any): Promise<void> {
  const entries = payload?.entry ?? [];

  for (const entry of entries) {
    const wabaId = entry.id;
    if (!wabaId) {
      continue;
    }

    const changes = entry.changes ?? [];

    for (const change of changes) {
      // Skip changes that are not messages events
      if (change.field !== "messages") {
        continue;
      }

      const messages = change.value?.messages;
      // Skip if messages is not a non-empty array.
      // This covers status-update-only payloads (e.g. sent, delivered, read),
      // which share the same field name "messages" but do not contain inbound message objects.
      if (!Array.isArray(messages) || messages.length === 0) {
        continue;
      }

      // -----------------------------------------------------------------------
      // RAW UNSCOPED QUERY:
      // Look up Channel via raw prisma client to determine workspace ownership.
      // This is the one legitimate unscoped query in this codebase because
      // finding which workspace an event belongs to is the sole purpose here.
      // -----------------------------------------------------------------------
      const channel = await prisma.channel.findFirst({
        where: { wabaId },
      });

      if (!channel) {
        console.warn(`[webhook] No channel found for wabaId: ${wabaId}`);
        // Skip this entry since we cannot route it to any workspace
        break;
      }

      // -----------------------------------------------------------------------
      // TENANT-SCOPED CLIENT:
      // Now that workspaceId is known, ALL subsequent queries MUST use forWorkspace()
      // to maintain strict tenant isolation.
      // -----------------------------------------------------------------------
      const db = forWorkspace(channel.workspaceId);

      for (const message of messages) {
        // Normalize message.from into E.164
        const normalizedPhone = normalizePhoneE164(message.from);
        if (!normalizedPhone) {
          console.warn(`[webhook] Could not normalize sender phone number: ${message.from}`);
          continue;
        }

        // Resolve Contact (required for foreign key on Message and Conversation)
        let contact = await db.contact.findFirst({
          where: { phone: normalizedPhone },
        });

        if (!contact) {
          const profileName =
            change.value.contacts?.find((c: any) => c.wa_id === message.from)?.profile?.name ??
            change.value.contacts?.[0]?.profile?.name ??
            null;

          try {
            contact = await db.contact.create({
              data: {
                phone: normalizedPhone,
                name: profileName,
                // Inbound message from a user is a direct consent signal, auto-opt-in immediately
                optedInAt: new Date(),
              } as any,
            });
          } catch (err: any) {
            // Concurrent creation fallback
            if (err?.code === "P2002") {
              contact = await db.contact.findFirst({
                where: { phone: normalizedPhone },
              });
            } else {
              throw err;
            }
          }
        }

        if (!contact) {
          console.error(`[webhook] Failed to resolve or create contact for ${normalizedPhone}`);
          continue;
        }

        // Resolve Conversation record shell (required for conversationId foreign key on Message)
        // Note: We intentionally do NOT update timestamps here yet.
        let conversation = await db.conversation.findFirst({
          where: {
            contactId: contact.id,
            channelId: channel.id,
          },
        });

        if (!conversation) {
          try {
            conversation = await db.conversation.create({
              data: {
                contactId: contact.id,
                channelId: channel.id,
                status: "open",
              } as any,
            });
          } catch (err: any) {
            // Concurrent creation fallback
            if (err?.code === "P2002") {
              conversation = await db.conversation.findFirst({
                where: {
                  contactId: contact.id,
                  channelId: channel.id,
                },
              });
            } else {
              throw err;
            }
          }
        }

        if (!conversation) {
          console.error(
            `[webhook] Failed to resolve or create conversation for contact ${contact.id} and channel ${channel.id}`
          );
          continue;
        }

        // 1 & 2. ATTEMPT the Message insert first (guarded by P2002 on @@unique([workspaceId, providerMessageId]))
        // to determine whether this is a genuine new message or a webhook redelivery.
        let wasNewMessage = false;
        try {
          await db.message.create({
            data: {
              conversationId: conversation.id,
              contactId: contact.id,
              direction: "inbound",
              providerMessageId: message.id,
              body: message.text?.body ?? null,
              status: "received",
            } as any,
          });
          wasNewMessage = true;
        } catch (err: any) {
          if (err?.code === "P2002") {
            console.log(
              `[webhook] Duplicate message ignored (P2002 redelivery): providerMessageId=${message.id}`
            );
            wasNewMessage = false;
          } else {
            throw err;
          }
        }

        // 4. If wasNewMessage is false (duplicate), skip Conversation timestamp update entirely
        if (!wasNewMessage) {
          continue;
        }

        // 3. ONLY IF wasNewMessage is true: update Conversation's lastInboundAt and windowExpiresAt
        const now = new Date();
        const windowExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        await db.conversation.update({
          where: { id: conversation.id },
          data: {
            lastInboundAt: now,
            windowExpiresAt,
          },
        });
      }
    }
  }
}
