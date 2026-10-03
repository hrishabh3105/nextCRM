import { forWorkspace, startMatchingJourneys } from "@nextcrm/core";
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

  /**
   * Cash on Delivery (COD) detection and journey trigger:
   * Note: The exact field and matching logic is based on Shopify's typical
   * payment_gateway_names values (e.g. "Cash on Delivery (COD)", "manual", etc.)
   * and should be verified against a real COD test order's actual payload once
   * available (verify against real data when possible).
   */
  const paymentMethods: string[] = Array.isArray(payload.payment_gateway_names)
    ? payload.payment_gateway_names
    : [];
  const isCOD = paymentMethods.some((name: string) =>
    name.toLowerCase().includes("cash on delivery") ||
    name.toLowerCase().includes("cod")
  );

  if (isCOD && contactId) {
    await startMatchingJourneys({
      workspaceId,
      triggerEvent: "order_placed_cod",
      contactId,
      triggerContextId: String(payload.id),
    });
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

  let cart: any = null;
  try {
    cart = await db.cart.upsert({
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
      cart = await db.cart.findFirst({
        where: { shopifyCartId },
      });
    } else {
      console.error(
        `[shopify-webhook] Error upserting cart ${shopifyCartId}:`,
        err
      );
    }
  }

  if (contactId && cart?.id) {
    /**
     * Note on cart abandonment trigger timing:
     * For THIS pass, we trigger on checkouts/create OR checkouts/update firing at all —
     * we are NOT yet distinguishing "just started checkout" from "genuinely abandoned
     * after N minutes of inactivity" at the webhook level. That distinction is exactly
     * what the journey's own `wait` step (45 minutes) plus `condition` step
     * (order exists?) already handles — the trigger just needs to start the clock,
     * the journey itself determines whether it was truly abandoned.
     */
    await startMatchingJourneys({
      workspaceId,
      triggerEvent: "cart_abandoned",
      contactId,
      triggerContextId: cart.id,
    });
  }
}

/**
 * Processes Shopify orders/updated webhook events and upserts the Order record.
 * Fires order_status_changed or order_delivered journeys if conditions are met.
 */
export async function handleShopifyOrderUpdate(
  payload: any,
  workspaceId: string
): Promise<void> {
  if (!payload || !payload.id) {
    console.warn(`[shopify-webhook] Received order update payload without id, skipping`);
    return;
  }

  const shopifyOrderId = String(payload.id);
  const db = forWorkspace(workspaceId);
  const contactId = await resolveOrCreateContact(db, payload);

  const existing = await db.order.findFirst({
    where: { shopifyOrderId },
  });

  const newStatus = payload.financial_status ?? "unknown";
  const newFulfillment = payload.fulfillment_status ?? null;
  const totalPrice = payload.total_price != null ? String(payload.total_price) : "0.00";
  const currency = payload.currency || "USD";

  try {
    await db.order.upsert({
      where: {
        workspaceId_shopifyOrderId: {
          workspaceId,
          shopifyOrderId,
        },
      },
      update: {
        status: newStatus,
        fulfillmentStatus: newFulfillment,
        totalPrice,
        currency,
        contactId: contactId ?? undefined,
      },
      create: {
        shopifyOrderId,
        status: newStatus,
        fulfillmentStatus: newFulfillment,
        totalPrice,
        currency,
        contactId: contactId ?? undefined,
      } as any,
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      console.warn(
        `[shopify-webhook] Concurrent race condition on order update upsert (P2002): shopifyOrderId=${shopifyOrderId}`
      );
    } else {
      console.error(
        `[shopify-webhook] Error upserting order update ${shopifyOrderId}:`,
        err
      );
    }
  }

  // AFTER the upsert, if existing is not null (this order was already known to us)
  if (existing) {
    const targetContactId = contactId || existing.contactId;

    if (targetContactId) {
      if (existing.status !== newStatus) {
        try {
          await startMatchingJourneys({
            workspaceId,
            triggerEvent: "order_status_changed",
            contactId: targetContactId,
            triggerContextId: shopifyOrderId,
          });
        } catch (err) {
          console.error(
            `[shopify-webhook] Error starting order_status_changed journey for order ${shopifyOrderId}:`,
            err
          );
        }
      }

      // "fulfilled" is used as a practical proxy for "delivered" since true
      // delivery confirmation requires carrier tracking webhooks, a separate integration not built here.
      if (existing.fulfillmentStatus !== "fulfilled" && newFulfillment === "fulfilled") {
        try {
          await startMatchingJourneys({
            workspaceId,
            triggerEvent: "order_delivered",
            contactId: targetContactId,
            triggerContextId: shopifyOrderId,
          });
        } catch (err) {
          console.error(
            `[shopify-webhook] Error starting order_delivered journey for order ${shopifyOrderId}:`,
            err
          );
        }
      }
    }
  }
}

