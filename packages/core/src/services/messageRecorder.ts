import { forWorkspace } from "../tenantScope";

export interface RecordOutboundMessageParams {
  workspaceId: string;
  contactId: string;
  channelId: string;
  providerMessageId?: string | null;
  body?: string | null;
  campaignId?: string;
}

/**
 * Finds an existing conversation for (contactId, channelId) or creates a new one.
 * Outbound-initiated conversations do NOT open a 24h messaging window:
 * lastInboundAt and windowExpiresAt remain null until a customer inbound reply arrives.
 */
export async function findOrCreateConversation(
  db: any,
  contactId: string,
  channelId: string
): Promise<string> {
  let conversation = await db.conversation.findFirst({
    where: {
      contactId,
      channelId,
    },
  });

  if (!conversation) {
    try {
      conversation = await db.conversation.create({
        data: {
          contactId,
          channelId,
          status: "open",
          lastInboundAt: null,
          windowExpiresAt: null,
        } as any,
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        conversation = await db.conversation.findFirst({
          where: {
            contactId,
            channelId,
          },
        });
      } else {
        throw err;
      }
    }
  }

  if (!conversation) {
    throw new Error(
      `Failed to find or create conversation for contact ${contactId} and channel ${channelId}`
    );
  }

  return conversation.id;
}

/**
 * Records an outbound message in the Message table associated with its conversation.
 * Safe against redelivery / duplicate calls via P2002 handling.
 * Guaranteed never to throw or break message delivery that already succeeded.
 */
export async function recordOutboundMessage(
  params: RecordOutboundMessageParams
): Promise<void> {
  try {
    const db = forWorkspace(params.workspaceId);
    const conversationId = await findOrCreateConversation(
      db,
      params.contactId,
      params.channelId
    );

    try {
      await db.message.create({
        data: {
          conversationId,
          contactId: params.contactId,
          direction: "outbound",
          status: "sent",
          providerMessageId: params.providerMessageId ?? null,
          body: params.body ?? null,
        } as any,
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        console.log(
          `[messageRecorder] Duplicate outbound message ignored (P2002 redelivery): providerMessageId=${params.providerMessageId}`
        );
        return;
      }
      throw err;
    }
  } catch (error) {
    console.error(
      `[messageRecorder] Failed to record outbound message for providerMessageId=${params.providerMessageId}:`,
      error
    );
  }
}

/**
 * Checks whether the contact is under the outbound message frequency cap.
 * Counts outbound messages sent to this contact within the trailing 24 hours.
 * Returns true if strictly UNDER the cap (safe to send), false if AT or OVER the limit.
 */
export async function checkFrequencyCap(
  db: any,
  contactId: string,
  limit = 3
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await db.message.count({
    where: {
      contactId,
      direction: "outbound",
      createdAt: {
        gte: since,
      },
    },
  });
  return count < limit;
}
