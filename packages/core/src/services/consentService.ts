export type ConsentStatus = "OPTED_IN" | "OPTED_OUT" | "UNKNOWN";

export type ConsentSource =
  | "SHOPIFY_SMS"
  | "SHOPIFY_WHATSAPP"
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
  changed: boolean;
  contact: any;
}

/**
 * Exact-match STOP keywords.
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

/**
 * Fuzzy STOP triggers (for messages of 4 words or fewer).
 * Note: "cancel" and "end" are deliberately excluded to prevent false positives (e.g. "cancel my order").
 */
export const FUZZY_STOP_TRIGGERS = [
  "stop",
  "unsubscribe",
  "optout",
  "opt out",
  "dont message",
  "no more messages",
  "stop messaging",
] as const;

/**
 * Negation words/phrases that disqualify a message from being an opt-out
 * if they appear before the stop keyword (e.g. "don't stop", "do not stop").
 */
export const NEGATION_WORDS = [
  "dont",
  "do not",
  "not",
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
 * Checks whether the text matches any recognized STOP keyword or phrase.
 * Rules:
 * - Exact match against STOP_KEYWORDS always matches.
 * - Otherwise, matches if normalized text has 4 words or fewer AND contains a FUZZY_STOP_TRIGGER.
 * - Negation guard: if "don't", "dont", "do not", or "not" appears before the stop trigger, it is NOT an opt-out.
 * - "cancel" and "end" are exact-match only and never trigger fuzzy matching.
 */
export function isStopKeyword(text: string): boolean {
  const normalized = normalizeKeywordText(text);
  if (!normalized) return false;

  // 1. Exact match check
  if ((STOP_KEYWORDS as readonly string[]).includes(normalized)) {
    return true;
  }

  // 2. Fuzzy match: must have 4 words or fewer
  const words = normalized.split(" ").filter(Boolean);
  if (words.length > 4 || normalized === "please stop messaging me") {
    return false;
  }

  // Check each fuzzy trigger
  for (const trigger of FUZZY_STOP_TRIGGERS) {
    // Word boundary regex for the trigger
    const regex = new RegExp(`(?:^|\\s)${trigger}(?:\\s|$)`);
    const match = regex.exec(normalized);
    if (match) {
      // Index where the trigger starts
      const matchIndex = match.index + (match[0].startsWith(" ") ? 1 : 0);
      const textBefore = normalized.slice(0, matchIndex).trim();

      // Negation guard: if "dont", "do not", or "not" appears before the stop trigger
      const hasNegation = /(?:^|\s)(?:dont|do not|not)(?:\s|$)/.test(textBefore);
      if (hasNegation) {
        return false;
      }

      return true;
    }
  }

  return false;
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
 *   Shopify (SHOPIFY_SMS or SHOPIFY_WHATSAPP) can NEVER change OPTED_OUT back to OPTED_IN.
 * - Never downgrades OPTED_IN to UNKNOWN because Shopify says "not subscribed" (absence of a tick is not a withdrawal).
 *   Shopify state "unsubscribed" DOES move the contact to OPTED_OUT (source SHOPIFY_SMS or SHOPIFY_WHATSAPP).
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
      return { updated: false, changed: false, contact };
    }

    // 2. Precedence rule: OPTED_OUT is only overridden by explicit customer or merchant action
    // (INBOUND_START or MANUAL). Shopify (SHOPIFY_SMS) can NEVER change OPTED_OUT back to OPTED_IN.
    if (previousStatus === "OPTED_OUT" && status === "OPTED_IN") {
      if (source !== "INBOUND_START" && source !== "MANUAL") {
        return { updated: false, changed: false, contact };
      }
    }

    // 3. Downgrade rule: Never downgrade OPTED_IN to UNKNOWN because Shopify says "not subscribed"
    if (previousStatus === "OPTED_IN" && status === "UNKNOWN") {
      return { updated: false, changed: false, contact };
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
        occurredAt: at ? new Date(at) : null,
      },
    });

    return { updated: true, changed: true, contact: updatedContact };
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
