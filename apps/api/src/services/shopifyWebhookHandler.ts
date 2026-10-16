import {
  forWorkspace,
  startMatchingJourneys,
  setMarketingConsent,
  getCustomerWhatsAppConsent,
  CustomerWhatsAppConsentResult,
  convertCartsForOrder,
} from "@nextcrm/core";
import { normalizePhoneE164, isValidE164 } from "../utils/phone";

/**
 * Extracts raw phone number candidates from a Shopify order or checkout payload
 * in order of priority, skipping empty values:
 *   1. payload.shipping_address?.phone
 *   2. payload.billing_address?.phone
 *   3. payload.phone
 *   4. payload.customer?.phone
 *   5. payload.customer?.default_address?.phone
 */
export function extractPhoneCandidates(payload: any): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const sources = [
    payload.shipping_address?.phone,
    payload.billing_address?.phone,
    payload.phone,
    payload.customer?.phone,
    payload.customer?.default_address?.phone,
  ];

  const candidates: string[] = [];
  for (const src of sources) {
    if (src != null) {
      const str = String(src).trim();
      if (str.length > 0) {
        candidates.push(str);
      }
    }
  }

  return candidates;
}

/**
 * Resolves normalized E.164 phone from payload candidates.
 * Tries each candidate in order with normalizePhoneE164, returning the first that normalizes to a valid phone.
 */
export function resolveNormalizedPhone(payload: any): string | null {
  const candidates = extractPhoneCandidates(payload);
  for (const candidate of candidates) {
    const normalized = normalizePhoneE164(candidate);
    if (normalized && isValidE164(normalized)) {
      return normalized;
    }
  }
  return null;
}

/**
 * Resolves an existing contact by normalized phone or creates a new one.
 * Follows the same find-or-create pattern as inboundMessageHandler.ts.
 * Note: New contacts default to UNKNOWN consent status (no automatic opt-in).
 */
async function resolveOrCreateContact(
  db: any,
  payload: any
): Promise<any | null> {
  // Details typed for this purchase must beat saved account details, which can
  // be stale (a real test order carried a typed number and an older saved number).
  const normalizedPhone = resolveNormalizedPhone(payload);

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

    try {
      contact = await db.contact.create({
        data: {
          phone: normalizedPhone,
          name: fullName,
          email,
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

  return contact ?? null;
}

export function maskPhoneLast4(phone?: string | null): string {
  if (!phone) return "****";
  const cleaned = String(phone).trim();
  if (cleaned.length <= 4) return "****";
  return `...${cleaned.slice(-4)}`;
}

export interface ProcessShopifyConsentParams {
  db: any;
  contactId: string;
  contactPhone: string;
  payload: any;
  isCheckout?: boolean;
  storeConnection?: {
    treatShopifySmsAsWhatsappConsent?: boolean;
    shopDomain?: string;
  } | null;
  workspaceId?: string;
  getWhatsAppConsent?: (
    shopDomain: string,
    customerId: string | number
  ) => Promise<CustomerWhatsAppConsentResult | null>;
}

/**
 * Processes Shopify marketing consent for orders and checkouts.
 * - Primary: Reads explicit WhatsApp marketing consent via getCustomerWhatsAppConsent (Shopify GraphQL).
 *   Applies regardless of treatShopifySmsAsWhatsappConsent setting.
 * - Fallback: Shopify SMS marketing consent fields (controlled by store setting treatShopifySmsAsWhatsappConsent).
 * - Precedence:
 *   1. Explicit WhatsApp consent: SUBSCRIBED -> OPTED_IN, UNSUBSCRIBED -> OPTED_OUT (with phone-match check).
 *   2. If WhatsApp consent is null, NOT_SUBSCRIBED, PENDING, REDACTED, or unknown: falls through to SMS consent.
 *   3. SMS consent: treatShopifySmsAsWhatsappConsent setting controls whether SMS "subscribed" grants WhatsApp OPTED_IN.
 *      SMS "unsubscribed" moves contact to OPTED_OUT regardless of setting.
 *   4. Existing OPTED_OUT via INBOUND_STOP is never overridden; lookup is skipped.
 *
 * In 2026-10 SMS consent moves to CustomerPhoneNumber.smsMarketingConsent; the flat marketingState fields are deprecated. Revisit when bumping the API version.
 */
export async function processShopifyConsent(
  params: ProcessShopifyConsentParams
): Promise<void> {
  const { db, contactId, contactPhone, payload, isCheckout, workspaceId } = params;

  let storeConnection = params.storeConnection;
  if (!storeConnection && workspaceId) {
    storeConnection = await db.storeConnection.findFirst({
      where: { workspaceId },
    });
  }

  const shopDomain = storeConnection?.shopDomain;
  const treatAsConsent = storeConnection?.treatShopifySmsAsWhatsappConsent ?? true;

  // 1. PRIMARY: Check explicit WhatsApp consent from Shopify if customer ID and shop domain are available
  const rawCustomerId = payload?.customer?.id ?? payload?.customer_id;
  if (rawCustomerId && shopDomain) {
    const currentContact = await db.contact.findUnique({
      where: { id: contactId },
    });

    const isOptedOutViaStop =
      currentContact?.marketingConsentStatus === "OPTED_OUT" &&
      currentContact?.marketingConsentSource === "INBOUND_STOP";

    if (!isOptedOutViaStop) {
      const getConsentFn = params.getWhatsAppConsent ?? getCustomerWhatsAppConsent;
      let waResult: CustomerWhatsAppConsentResult | null = null;
      try {
        waResult = await getConsentFn(shopDomain, rawCustomerId);
      } catch (err: any) {
        console.warn(
          `[shopify-consent] Error fetching customer WhatsApp consent for customer ${rawCustomerId}:`,
          err?.message || err
        );
        waResult = null;
      }

      if (waResult) {
        const waRawState = waResult.state ? String(waResult.state).toUpperCase().trim() : "";
        const waPhone = waResult.phoneNumber;
        const normalizedWaPhone = waPhone ? normalizePhoneE164(String(waPhone)) : null;
        const normalizedContactPhone = contactPhone ? normalizePhoneE164(String(contactPhone)) : null;
        const isPhoneMatch = Boolean(
          normalizedWaPhone &&
          normalizedContactPhone &&
          normalizedWaPhone === normalizedContactPhone
        );

        if (waRawState === "SUBSCRIBED") {
          if (isPhoneMatch) {
            const consentUpdatedAt = waResult.updatedAt
              ? new Date(waResult.updatedAt)
              : undefined;
            await setMarketingConsent(db, {
              contactId,
              status: "OPTED_IN",
              source: "SHOPIFY_WHATSAPP",
              at: consentUpdatedAt,
              evidence: {
                shop: shopDomain || null,
                customerGid: waResult.customerGid,
                state: waResult.state,
                optInLevel: waResult.optInLevel ?? null,
                updatedAt: waResult.updatedAt ?? null,
                collectedFrom: waResult.collectedFrom ?? null,
                phone: normalizedWaPhone,
              },
            });
            return;
          } else {
            console.warn(
              `[shopify-consent] WhatsApp phone mismatch: customer phone ${maskPhoneLast4(waPhone)} does not match contact phone ${maskPhoneLast4(contactPhone)}. Skipping consent change.`
            );
            return;
          }
        } else if (waRawState === "UNSUBSCRIBED") {
          if (isPhoneMatch) {
            const consentUpdatedAt = waResult.updatedAt
              ? new Date(waResult.updatedAt)
              : undefined;
            await setMarketingConsent(db, {
              contactId,
              status: "OPTED_OUT",
              source: "SHOPIFY_WHATSAPP",
              at: consentUpdatedAt,
              evidence: {
                shop: shopDomain || null,
                customerGid: waResult.customerGid,
                state: waResult.state,
                optInLevel: waResult.optInLevel ?? null,
                updatedAt: waResult.updatedAt ?? null,
                collectedFrom: waResult.collectedFrom ?? null,
                phone: normalizedWaPhone,
              },
            });
            return;
          } else {
            console.warn(
              `[shopify-consent] WhatsApp phone mismatch: customer phone ${maskPhoneLast4(waPhone)} does not match contact phone ${maskPhoneLast4(contactPhone)}. Skipping consent change.`
            );
            return;
          }
        }
        // NOT_SUBSCRIBED, PENDING, REDACTED, unknown: fall through to SMS fallback
      }
    }
  }

  // 2. FALLBACK: Run existing SMS consent logic unchanged
  let rawState: string | undefined;
  let smsMarketingPhone: string | undefined;

  const smsConsent = payload?.customer?.sms_marketing_consent;

  if (isCheckout) {
    if (smsConsent?.state) {
      rawState = smsConsent.state;
    } else if (payload?.buyer_accepts_sms_marketing === true) {
      rawState = "subscribed";
    } else if (payload?.buyer_accepts_sms_marketing === false) {
      rawState = "not_subscribed";
    }

    smsMarketingPhone =
      payload?.sms_marketing_phone ||
      payload?.customer?.sms_marketing_phone ||
      smsConsent?.phone;
  } else {
    rawState = smsConsent?.state;
    smsMarketingPhone = payload?.customer?.sms_marketing_phone || smsConsent?.phone;
  }

  if (!rawState) {
    return;
  }

  const state = String(rawState).toLowerCase().trim();
  const optInLevel = smsConsent?.opt_in_level;
  const consentUpdatedAt = smsConsent?.consent_updated_at
    ? new Date(smsConsent.consent_updated_at)
    : undefined;
  const collectedFrom = smsConsent?.consent_collected_from;

  const evidence = {
    state,
    optInLevel,
    consentUpdatedAt: consentUpdatedAt?.toISOString(),
    collectedFrom,
    smsMarketingPhone: smsMarketingPhone || null,
    shop: shopDomain || null,
  };

  // Phone match safety: if a consent phone is known and differs from contact phone after normalization,
  // do NOT grant consent; record evidence only and log a warning.
  if (smsMarketingPhone) {
    const normalizedConsentPhone = normalizePhoneE164(String(smsMarketingPhone));
    if (normalizedConsentPhone && normalizedConsentPhone !== contactPhone) {
      console.warn(
        `[shopify-consent] Phone mismatch: consent phone ${normalizedConsentPhone} does not match contact phone ${contactPhone}. Skipping consent change.`
      );
      const currentContact = await db.contact.findUnique({
        where: { id: contactId },
      });
      if (currentContact) {
        await db.consentEvent.create({
          data: {
            workspaceId: currentContact.workspaceId,
            contactId,
            status: currentContact.marketingConsentStatus || "UNKNOWN",
            previousStatus: currentContact.marketingConsentStatus || null,
            source: "SHOPIFY_SMS",
            occurredAt: consentUpdatedAt ?? null,
            evidence: {
              ...evidence,
              phoneMismatch: true,
              consentPhone: normalizedConsentPhone,
              contactPhone,
            },
          },
        });
      }
      return;
    }
  }

  // "unsubscribed" -> OPTED_OUT regardless of the setting
  if (state === "unsubscribed") {
    await setMarketingConsent(db, {
      contactId,
      status: "OPTED_OUT",
      source: "SHOPIFY_SMS",
      at: consentUpdatedAt,
      evidence,
    });
    return;
  }

  // "subscribed"
  if (state === "subscribed") {
    if (treatAsConsent) {
      await setMarketingConsent(db, {
        contactId,
        status: "OPTED_IN",
        source: "SHOPIFY_SMS",
        at: consentUpdatedAt,
        evidence,
      });
    } else {
      // If the setting is FALSE: never grant OPTED_IN from Shopify.
      // Store the raw Shopify state in the ConsentEvent evidence only when we would otherwise have changed something; do not spam events.
      const currentContact = await db.contact.findUnique({
        where: { id: contactId },
      });
      if (currentContact && currentContact.marketingConsentStatus !== "OPTED_IN") {
        await db.consentEvent.create({
          data: {
            workspaceId: currentContact.workspaceId,
            contactId,
            status: currentContact.marketingConsentStatus || "UNKNOWN",
            previousStatus: currentContact.marketingConsentStatus || null,
            source: "SHOPIFY_SMS",
            occurredAt: consentUpdatedAt ?? null,
            evidence: {
              ...evidence,
              ignoredDueToSetting: true,
            },
          },
        });
      }
    }
    return;
  }

  // Other states ("not_subscribed", "pending", "redacted"): do nothing, never downgrade OPTED_IN
}

/**
 * Processes Shopify orders/create webhook events and upserts the Order record.
 */
export async function handleShopifyOrder(
  payload: any,
  workspaceId: string,
  storeConnection?: {
    treatShopifySmsAsWhatsappConsent?: boolean;
    shopDomain?: string;
  } | null,
  dbOverride?: any
): Promise<void> {
  if (!payload || !payload.id) {
    console.warn(`[shopify-webhook] Received order payload without id, skipping`);
    return;
  }

  const shopifyOrderId = String(payload.id);
  const totalPrice = payload.total_price != null ? String(payload.total_price) : "0.00";
  const currency = payload.currency || "USD";
  const status = payload.financial_status ?? "unknown";
  const checkoutToken = payload.checkout_token ? String(payload.checkout_token) : null;
  const cartToken = payload.cart_token ? String(payload.cart_token) : null;

  const db = dbOverride || forWorkspace(workspaceId);
  const contact = await resolveOrCreateContact(db, payload);
  const contactId = contact?.id ?? null;

  if (contact) {
    await processShopifyConsent({
      db,
      contactId: contact.id,
      contactPhone: contact.phone,
      payload,
      isCheckout: false,
      storeConnection,
      workspaceId,
    });
  }

  const orderNumber =
    payload.order_number != null
      ? String(payload.order_number)
      : payload.name != null
      ? String(payload.name)
      : null;
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : null;

  let createdOrder: any = null;
  try {
    createdOrder = await db.order.upsert({
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
        orderNumber: orderNumber ?? undefined,
        lineItems: lineItems ?? undefined,
        contactId: contactId ?? undefined,
        checkoutToken: checkoutToken ?? undefined,
        cartToken: cartToken ?? undefined,
      },
      create: {
        shopifyOrderId,
        orderNumber: orderNumber ?? undefined,
        status,
        totalPrice,
        currency,
        lineItems: lineItems ?? undefined,
        contactId: contactId ?? undefined,
        checkoutToken: checkoutToken ?? undefined,
        cartToken: cartToken ?? undefined,
      } as any,
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      console.warn(
        `[shopify-webhook] Concurrent race condition on order upsert (P2002): shopifyOrderId=${shopifyOrderId}`
      );
      createdOrder = await db.order.findFirst({
        where: { shopifyOrderId },
      });
    } else {
      console.error(
        `[shopify-webhook] Error upserting order ${shopifyOrderId}:`,
        err
      );
    }
  }

  // Convert matching carts and cancel active abandoned-cart journeys
  try {
    await convertCartsForOrder({
      db,
      workspaceId,
      checkoutToken,
      cartToken,
      orderId: shopifyOrderId,
      convertedAt: payload.created_at ? new Date(payload.created_at) : new Date(),
    });
  } catch (cartErr) {
    console.error(
      `[shopify-webhook] Error converting carts for order ${shopifyOrderId}:`,
      cartErr
    );
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
      orderId: createdOrder?.id,
    });
  }
}

/**
 * Processes Shopify checkouts/create and checkouts/update webhook events and upserts the Cart record.
 */
export async function handleShopifyCheckout(
  payload: any,
  workspaceId: string,
  status: "active" | "abandoned",
  storeConnection?: {
    treatShopifySmsAsWhatsappConsent?: boolean;
    shopDomain?: string;
  } | null,
  dbOverride?: any
): Promise<void> {
  if (!payload || !payload.token) {
    console.warn(`[shopify-webhook] Received checkout payload without token, skipping`);
    return;
  }

  const shopifyCartId = String(payload.token);
  const checkoutToken = String(payload.token);
  const cartToken = payload.cart_token ? String(payload.cart_token) : null;
  const totalPrice = payload.total_price != null ? String(payload.total_price) : "0.00";
  const recoveryUrl = payload.abandoned_checkout_url
    ? String(payload.abandoned_checkout_url)
    : null;
  const currency = payload.currency ? String(payload.currency) : "USD";
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : null;
  const lastActivityAt = new Date();

  const db = dbOverride || forWorkspace(workspaceId);
  const contact = await resolveOrCreateContact(db, payload);
  const contactId = contact?.id ?? null;

  if (contact) {
    await processShopifyConsent({
      db,
      contactId: contact.id,
      contactPhone: contact.phone,
      payload,
      isCheckout: true,
      storeConnection,
      workspaceId,
    });
  }

  // Check if checkout is already completed via completed_at
  const isCompletedAt = payload.completed_at != null;
  const completedAtDate = isCompletedAt ? new Date(payload.completed_at) : null;

  // Handle ordering race: check if an Order was already recorded for this checkout/cart token
  const orderFilters: any[] = [];
  if (checkoutToken) orderFilters.push({ checkoutToken });
  if (cartToken) orderFilters.push({ cartToken });

  const existingOrder = orderFilters.length > 0
    ? await db.order.findFirst({
        where: { OR: orderFilters },
      })
    : null;

  const isAlreadyConverted = isCompletedAt || existingOrder != null;
  const targetStatus = isAlreadyConverted ? "converted" : status;
  const convertedAt = completedAtDate ?? (existingOrder ? existingOrder.createdAt : null);
  const linkedOrderId = existingOrder
    ? existingOrder.shopifyOrderId
    : (payload.order_id ? String(payload.order_id) : null);

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
        status: targetStatus,
        totalPrice,
        currency,
        recoveryUrl: recoveryUrl ?? undefined,
        lineItems: lineItems ?? undefined,
        lastActivityAt,
        contactId: contactId ?? undefined,
        checkoutToken,
        cartToken: cartToken ?? undefined,
        convertedAt: isAlreadyConverted ? (convertedAt ?? new Date()) : undefined,
        orderId: linkedOrderId ?? undefined,
      },
      create: {
        shopifyCartId,
        checkoutToken,
        cartToken: cartToken ?? undefined,
        status: targetStatus,
        totalPrice,
        currency,
        recoveryUrl: recoveryUrl ?? undefined,
        lineItems: lineItems ?? undefined,
        lastActivityAt,
        contactId: contactId ?? undefined,
        convertedAt: isAlreadyConverted ? (convertedAt ?? new Date()) : undefined,
        orderId: linkedOrderId ?? undefined,
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

  // If completed_at is non-null, run conversion logic to mark any matching carts & exit runs
  if (isCompletedAt) {
    try {
      await convertCartsForOrder({
        db,
        workspaceId,
        checkoutToken,
        cartToken,
        orderId: linkedOrderId,
        convertedAt: completedAtDate,
      });
    } catch (convErr) {
      console.error(
        `[shopify-webhook] Error converting carts on completed checkout ${shopifyCartId}:`,
        convErr
      );
    }
  }

  if (contactId && cart?.id && !isAlreadyConverted && cart.status !== "converted") {
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
      cartId: cart.id,
    });
  } else if (isAlreadyConverted) {
    console.log(
      `[shopify-webhook] Cart ${shopifyCartId} is already converted (order: ${linkedOrderId ?? "completed"}). Skipping cart_abandoned journey trigger.`
    );
  }
}

/**
 * Processes Shopify orders/updated webhook events and upserts the Order record.
 * Fires order_status_changed or order_delivered journeys if conditions are met.
 */
export async function handleShopifyOrderUpdate(
  payload: any,
  workspaceId: string,
  storeConnection?: {
    treatShopifySmsAsWhatsappConsent?: boolean;
    shopDomain?: string;
  } | null,
  dbOverride?: any
): Promise<void> {
  if (!payload || !payload.id) {
    console.warn(`[shopify-webhook] Received order update payload without id, skipping`);
    return;
  }

  const shopifyOrderId = String(payload.id);
  const db = dbOverride || forWorkspace(workspaceId);
  const contact = await resolveOrCreateContact(db, payload);
  const contactId = contact?.id ?? null;

  if (contact) {
    await processShopifyConsent({
      db,
      contactId: contact.id,
      contactPhone: contact.phone,
      payload,
      isCheckout: false,
      storeConnection,
      workspaceId,
    });
  }

  const existing = await db.order.findFirst({
    where: { shopifyOrderId },
  });

  const newStatus = payload.financial_status ?? "unknown";
  const newFulfillment = payload.fulfillment_status ?? null;
  const totalPrice = payload.total_price != null ? String(payload.total_price) : "0.00";
  const currency = payload.currency || "USD";
  const checkoutToken = payload.checkout_token ? String(payload.checkout_token) : null;
  const cartToken = payload.cart_token ? String(payload.cart_token) : null;
  const orderNumber =
    payload.order_number != null
      ? String(payload.order_number)
      : payload.name != null
      ? String(payload.name)
      : null;
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : null;

  let updatedOrder: any = null;
  try {
    updatedOrder = await db.order.upsert({
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
        orderNumber: orderNumber ?? undefined,
        lineItems: lineItems ?? undefined,
        contactId: contactId ?? undefined,
        checkoutToken: checkoutToken ?? undefined,
        cartToken: cartToken ?? undefined,
      },
      create: {
        shopifyOrderId,
        orderNumber: orderNumber ?? undefined,
        status: newStatus,
        fulfillmentStatus: newFulfillment,
        totalPrice,
        currency,
        lineItems: lineItems ?? undefined,
        contactId: contactId ?? undefined,
        checkoutToken: checkoutToken ?? undefined,
        cartToken: cartToken ?? undefined,
      } as any,
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      console.warn(
        `[shopify-webhook] Concurrent race condition on order update upsert (P2002): shopifyOrderId=${shopifyOrderId}`
      );
      updatedOrder = await db.order.findFirst({
        where: { shopifyOrderId },
      });
    } else {
      console.error(
        `[shopify-webhook] Error upserting order update ${shopifyOrderId}:`,
        err
      );
    }
  }

  // Convert matching carts and cancel active abandoned-cart journeys
  // (orders/updated can be the first sight of the order)
  try {
    await convertCartsForOrder({
      db,
      workspaceId,
      checkoutToken,
      cartToken,
      orderId: shopifyOrderId,
      convertedAt: payload.created_at ? new Date(payload.created_at) : new Date(),
    });
  } catch (cartErr) {
    console.error(
      `[shopify-webhook] Error converting carts for order update ${shopifyOrderId}:`,
      cartErr
    );
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
            orderId: existing.id || updatedOrder?.id,
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
            orderId: existing.id || updatedOrder?.id,
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
