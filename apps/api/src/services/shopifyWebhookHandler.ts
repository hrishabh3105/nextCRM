import { forWorkspace } from "@nextcrm/core";
import { normalizePhoneE164 } from "../utils/phone";

/**
 * Resolves an existing contact by normalized phone or creates a new one.
 * Follows the same find-or-create pattern as inboundMessageHandler.ts.
 */
async function resolveOrCreateContact(
  db: any,
  payload: any
): Promise<string | null> {
  const rawPhone =
    payload.customer?.phone ||
    payload.phone ||
    payload.billing_address?.phone ||
    payload.shipping_address?.phone ||
    null;

  if (!rawPhone) {
    return null;
  }

  const normalizedPhone = normalizePhoneE164(String(rawPhone));
  if (!normalizedPhone) {
    return null;
  }

  let contact = await db.contact.findFirst({
    where: { phone: normalizedPhone },
  });

  if (!contact) {
    const firstName = payload.customer?.first_name || "";
    const lastName = payload.customer?.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim() || payload.customer?.name || null;
    const email = payload.customer?.email || payload.email || null;

    /**
     * Note on Contact creation and optedInAt:
     * This is a real customer interacting with the merchant's Shopify store (placing an order
     * or initiating a checkout). This provides legitimate business context for storing the contact.
     * We set optedInAt on create to indicate when the contact record was established.
     *
     * CRITICAL DISTINCTION: This does NOT imply WhatsApp opt-in consent specifically, just that
     * we have a legitimate business reason to store the contact. Do not conflate "we know about
     * this customer" with "they consented to outbound WhatsApp marketing messages".
     */
    try {
      contact = await db.contact.create({
        data: {
          phone: normalizedPhone,
          name: fullName,
          email,
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
        console.error(
          `[shopify-webhook] Error creating contact for phone ${normalizedPhone}:`,
          err
        );
        return null;
      }
    }
  }

  return contact?.id ?? null;
}

/**
 * Processes Shopify orders/create webhook events and upserts the Order record.
 */
export async function handleShopifyOrder(
  payload: any,
  workspaceId: string
): Promise<void> {
  if (!payload || !payload.id) {
    console.warn(`[shopify-webhook] Received order payload without id, skipping`);
    return;
  }

  const shopifyOrderId = String(payload.id);
  const totalPrice = payload.total_price != null ? String(payload.total_price) : "0.00";
  const currency = payload.currency || "USD";
  const status = payload.financial_status ?? "unknown";

  const db = forWorkspace(workspaceId);
  const contactId = await resolveOrCreateContact(db, payload);

  try {
    await db.order.upsert({
      where: {
        workspaceId_shopifyOrderId: {
          workspaceId,
          shopifyOrderId,
        },
      },
      update: {
        status,
        totalPrice,
        currency,
        contactId: contactId ?? undefined,
      },
      create: {
        shopifyOrderId,
        status,
        totalPrice,
        currency,
        contactId: contactId ?? undefined,
      } as any,
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      console.warn(
        `[shopify-webhook] Concurrent race condition on order upsert (P2002): shopifyOrderId=${shopifyOrderId}`
      );
    } else {
      console.error(
        `[shopify-webhook] Error upserting order ${shopifyOrderId}:`,
        err
      );
    }
  }
}

/**
 * Processes Shopify checkouts/create and checkouts/update webhook events and upserts the Cart record.
 */
export async function handleShopifyCheckout(
  payload: any,
  workspaceId: string,
  status: "active" | "abandoned"
): Promise<void> {
  if (!payload || !payload.token) {
    console.warn(`[shopify-webhook] Received checkout payload without token, skipping`);
    return;
  }

  const shopifyCartId = String(payload.token);
  const totalPrice = payload.total_price != null ? String(payload.total_price) : "0.00";
  const lastActivityAt = new Date();

  const db = forWorkspace(workspaceId);
  const contactId = await resolveOrCreateContact(db, payload);

  try {
    await db.cart.upsert({
      where: {
        workspaceId_shopifyCartId: {
          workspaceId,
          shopifyCartId,
        },
      },
      update: {
        status,
        totalPrice,
        lastActivityAt,
        contactId: contactId ?? undefined,
      },
      create: {
        shopifyCartId,
        status,
        totalPrice,
        lastActivityAt,
        contactId: contactId ?? undefined,
      } as any,
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      console.warn(
        `[shopify-webhook] Concurrent race condition on cart upsert (P2002): shopifyCartId=${shopifyCartId}`
      );
    } else {
      console.error(
        `[shopify-webhook] Error upserting cart ${shopifyCartId}:`,
        err
      );
    }
  }
}
