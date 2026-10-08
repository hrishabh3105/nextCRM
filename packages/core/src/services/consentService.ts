export type ConsentStatus = "OPTED_IN" | "OPTED_OUT" | "UNKNOWN";

export type ConsentSource =
  | "SHOPIFY_SMS"
  | "INBOUND_START"
  | "IMPORT_ATTESTED"
  | "MANUAL"
  | "INBOUND_STOP"
  | "LEGACY"
  | string;

export interface SetMarketingConsentParams {
  contactId: string;
  status: ConsentStatus;
  source: ConsentSource;
  at?: Date;
  evidence?: any;
}

export interface SetMarketingConsentResult {
  updated: boolean;
  contact: any;
}

/**
 * Standard STOP and START keyword lists for inbound SMS / WhatsApp consent management.
 * Kept as exported constants in one place so they can be easily extended.
 */
export const STOP_KEYWORDS = [
  "stop",
  "stop all",
  "unsubscribe",
  "cancel",
  "opt out",
  "optout",
  "end",
] as const;

export const START_KEYWORDS = [
  "start",
  "subscribe",
  "opt in",
  "optin",
] as const;

/**
 * Normalizes inbound message text for keyword matching:
 * trims, lowercases, removes all punctuation, and collapses multiple spaces.
 */
export function normalizeKeywordText(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks whether the text exactly matches any recognized STOP keyword.
 */
export function isStopKeyword(text: string): boolean {
  const normalized = normalizeKeywordText(text);
  return (STOP_KEYWORDS as readonly string[]).includes(normalized);
}

/**
 * Checks whether the text exactly matches any recognized START keyword.
 */
export function isStartKeyword(text: string): boolean {
  const normalized = normalizeKeywordText(text);
  return (START_KEYWORDS as readonly string[]).includes(normalized);
}

/**
 * Single write path for all marketing consent changes.
 *
 * Requirements:
 * - Runs in one transaction: reads current state, computes change, updates contact, inserts ConsentEvent.
 * - Idempotency: Does NOTHING (no update, no event) if status and source are unchanged (webhook retries must not duplicate events).
 * - Enforces precedence: OPTED_OUT is only overridden by an explicit customer or merchant action (INBOUND_START or MANUAL).
 *   Shopify (SHOPIFY_SMS) can NEVER change OPTED_OUT back to OPTED_IN.
 * - Never downgrades OPTED_IN to UNKNOWN because Shopify says "not subscribed" (absence of a tick is not a withdrawal).
 *   Shopify state "unsubscribed" DOES move the contact to OPTED_OUT (source SHOPIFY_SMS).
 */
export async function setMarketingConsent(
  db: any,
  params: SetMarketingConsentParams
): Promise<SetMarketingConsentResult> {
  const { contactId, status, source, at, evidence } = params;

  // Use $transaction if available on the provided client, else fallback to direct operations
  const runInTransaction = db.$transaction
    ? (fn: (tx: any) => Promise<any>) => db.$transaction(fn)
    : (fn: (tx: any) => Promise<any>) => fn(db);

  return await runInTransaction(async (tx: any) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new Error(`Contact ${contactId} not found`);
    }

    const previousStatus: ConsentStatus = (contact.marketingConsentStatus as ConsentStatus) || "UNKNOWN";
    const previousSource: string | null = contact.marketingConsentSource || null;

    // 1. Idempotency check: if status and source are unchanged, do nothing
    if (previousStatus === status && previousSource === source) {
      return { updated: false, contact };
    }

    // 2. Precedence rule: OPTED_OUT is only overridden by explicit customer or merchant action
    // (INBOUND_START or MANUAL). Shopify (SHOPIFY_SMS) can NEVER change OPTED_OUT back to OPTED_IN.
    if (previousStatus === "OPTED_OUT" && status === "OPTED_IN") {
      if (source !== "INBOUND_START" && source !== "MANUAL") {
        return { updated: false, contact };
      }
    }

    // 3. Downgrade rule: Never downgrade OPTED_IN to UNKNOWN because Shopify says "not subscribed"
    if (previousStatus === "OPTED_IN" && status === "UNKNOWN") {
      return { updated: false, contact };
    }

    const effectiveAt = at || new Date();
    const updateData: any = {
      marketingConsentStatus: status,
      marketingConsentSource: source,
    };

    if (status === "OPTED_IN") {
      updateData.marketingConsentAt = effectiveAt;
    } else if (status === "OPTED_OUT") {
      updateData.marketingOptedOutAt = effectiveAt;
    }

    const updatedContact = await tx.contact.update({
      where: { id: contactId },
      data: updateData,
    });

    await tx.consentEvent.create({
      data: {
        workspaceId: contact.workspaceId,
        contactId,
        status,
        previousStatus: previousStatus ?? null,
        source,
        evidence: evidence ?? undefined,
        createdAt: effectiveAt,
      },
    });

    return { updated: true, contact: updatedContact };
  });
}

export type SendContext =
  | "campaign"
  | "journey"
  | "journey_abandoned_cart"
  | "manual_reply";

export interface EvaluateSendPermissionParams {
  contact: {
    marketingConsentStatus?: string | null;
    [key: string]: any;
  };
  template?: {
    category?: string | null;
    [key: string]: any;
  } | null;
  context: SendContext;
}

export interface EvaluateSendPermissionResult {
  allowed: boolean;
  reason?: "OPTED_OUT" | "NO_MARKETING_CONSENT";
}

/**
 * Evaluates whether a WhatsApp template message is permitted to be sent to a contact.
 *
 * Rules:
 * - Template category UTILITY or AUTHENTICATION -> allowed.
 * - Template category MARKETING:
 *   - context "journey_abandoned_cart" -> allowed unless status is OPTED_OUT.
 *   - every other context ("campaign", "journey", etc.) -> allowed only if status is OPTED_IN.
 */
export function evaluateSendPermission(
  params: EvaluateSendPermissionParams
): EvaluateSendPermissionResult {
  const { contact, template, context } = params;

  const rawCategory = template?.category
    ? String(template.category).toLowerCase().trim()
    : "";

  // Template category UTILITY or AUTHENTICATION -> allowed
  if (rawCategory === "utility" || rawCategory === "authentication") {
    return { allowed: true };
  }

  // Template category MARKETING (or default when category is not utility/authentication)
  const consentStatus = contact?.marketingConsentStatus || "UNKNOWN";

  if (context === "journey_abandoned_cart") {
    if (consentStatus === "OPTED_OUT") {
      return { allowed: false, reason: "OPTED_OUT" };
    }
    return { allowed: true };
  }

  // Every other context ("campaign", "journey", etc.)
  if (consentStatus === "OPTED_IN") {
    return { allowed: true };
  }

  if (consentStatus === "OPTED_OUT") {
    return { allowed: false, reason: "OPTED_OUT" };
  }

  return { allowed: false, reason: "NO_MARKETING_CONSENT" };
}
