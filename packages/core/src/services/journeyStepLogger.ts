import { forWorkspace } from "../tenantScope";

export const JOURNEY_STEP_OUTCOMES = {
  SENT: "SENT",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
  EXITED: "EXITED",
} as const;

export type JourneyStepOutcome =
  (typeof JOURNEY_STEP_OUTCOMES)[keyof typeof JOURNEY_STEP_OUTCOMES];

export const JOURNEY_STEP_REASON_CODES = {
  NO_CONSENT: "NO_CONSENT",
  OPTED_OUT: "OPTED_OUT",
  MISSING_VARIABLE: "MISSING_VARIABLE",
  MISSING_BUTTON_VARIABLE: "MISSING_BUTTON_VARIABLE",
  TEMPLATE_NOT_APPROVED: "TEMPLATE_NOT_APPROVED",
  NO_PHONE: "NO_PHONE",
  CART_CONVERTED: "CART_CONVERTED",
  META_ERROR: "META_ERROR",
  FREQUENCY_CAP: "FREQUENCY_CAP",
  CHANNEL_NOT_CONFIGURED: "CHANNEL_NOT_CONFIGURED",
  CONDITION_EXIT: "CONDITION_EXIT",
  STEP_EXIT: "STEP_EXIT",
  RECURSION_DEPTH_EXCEEDED: "RECURSION_DEPTH_EXCEEDED",
  UNKNOWN_STEP_TYPE: "UNKNOWN_STEP_TYPE",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type JourneyStepReasonCode =
  (typeof JOURNEY_STEP_REASON_CODES)[keyof typeof JOURNEY_STEP_REASON_CODES] | string;

export const REASON_CODE_LABELS: Record<string, string> = {
  NO_CONSENT: "No marketing consent",
  OPTED_OUT: "Contact opted out",
  MISSING_VARIABLE: "Missing template variable value",
  MISSING_BUTTON_VARIABLE: "Missing dynamic button link/variable",
  TEMPLATE_NOT_APPROVED: "Template not approved yet",
  NO_PHONE: "No resolvable phone number",
  CART_CONVERTED: "Cart converted before send",
  META_ERROR: "WhatsApp Cloud API error",
  FREQUENCY_CAP: "Daily frequency cap reached",
  CHANNEL_NOT_CONFIGURED: "WhatsApp channel not configured",
  CONDITION_EXIT: "Condition branch led to exit",
  STEP_EXIT: "Step explicitly exited journey",
  RECURSION_DEPTH_EXCEEDED: "Journey depth limit exceeded",
  UNKNOWN_STEP_TYPE: "Unknown step type in flow",
  UNKNOWN_ERROR: "Unexpected execution error",
};

/**
 * Formats a reason code and optional detail into a plain-English message.
 */
export function formatReasonCode(code?: string | null, detail?: string | null): string {
  if (!code && !detail) return "Completed normally";
  if (code && REASON_CODE_LABELS[code]) {
    return REASON_CODE_LABELS[code];
  }
  if (code) {
    return code
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }
  return detail || "—";
}

/**
 * Sanitizes step log detail:
 * - Truncates to max 500 characters
 * - Strips sensitive tokens (Bearer, access_token, secrets, Shopify & Meta tokens)
 * - If given a Meta error object or raw response, extracts only code and message
 */
export function sanitizeStepDetail(raw: any): string | null {
  if (raw == null) return null;

  let text = "";

  if (typeof raw === "string") {
    text = raw;
  } else if (raw instanceof Error || (typeof raw === "object" && raw !== null)) {
    const metaErrorObj =
      raw.response?.data?.error ||
      raw.error ||
      (raw.code !== undefined && raw.message ? raw : null);

    if (
      metaErrorObj &&
      (metaErrorObj.code !== undefined ||
        metaErrorObj.fbtrace_id !== undefined ||
        metaErrorObj.type === "OAuthException")
    ) {
      const code = metaErrorObj.code ?? "unknown";
      const subcode = metaErrorObj.error_subcode ? `/${metaErrorObj.error_subcode}` : "";
      const msg = metaErrorObj.message || raw.message || "Meta API error";
      text = `Meta error [${code}${subcode}]: ${msg}`;
    } else if (raw.message) {
      text = String(raw.message);
    } else {
      try {
        text = JSON.stringify(raw);
      } catch {
        text = String(raw);
      }
    }
  } else {
    text = String(raw);
  }

  // Strip secrets & tokens
  text = text
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /(?:access_token|client_secret|api_secret|secret|password)\s*[:=]\s*["']?[^"',\s&]+["']?/gi,
      "$1=[REDACTED]"
    )
    .replace(/EAA[A-Za-z0-9]+/g, "[REDACTED_META_TOKEN]")
    .replace(/shp(?:ua|at|ca|pa)_[A-Za-z0-9]+/g, "[REDACTED_SHOPIFY_TOKEN]");

  if (text.length > 500) {
    text = text.slice(0, 497) + "...";
  }

  return text;
}

export interface LogJourneyStepParams {
  workspaceId: string;
  journeyId: string;
  journeyRunId: string;
  stepIndex: number;
  stepId?: string | null;
  contactId?: string | null;
  stepType: string;
  outcome: JourneyStepOutcome;
  reasonCode?: JourneyStepReasonCode | null;
  detail?: any;
  messageId?: string | null;
  dbOverride?: any;
}

/**
 * Best-effort helper to log the execution outcome of a journey step.
 * Guaranteed never to throw or delay journey execution.
 */
export async function logJourneyStep(params: LogJourneyStepParams): Promise<void> {
  try {
    const db = params.dbOverride || forWorkspace(params.workspaceId);
    const sanitizedDetail = sanitizeStepDetail(params.detail);

    await db.journeyStepLog.create({
      data: {
        workspaceId: params.workspaceId,
        journeyId: params.journeyId,
        journeyRunId: params.journeyRunId,
        stepIndex: params.stepIndex,
        stepId: params.stepId ?? null,
        contactId: params.contactId ?? null,
        stepType: params.stepType,
        outcome: params.outcome,
        reasonCode: params.reasonCode ?? null,
        detail: sanitizedDetail,
        messageId: params.messageId ?? null,
      },
    });
  } catch (err) {
    // Best effort: log and continue. Never throw!
    console.error(`[journeyStepLogger] Failed to write journey step log:`, err);
  }
}
