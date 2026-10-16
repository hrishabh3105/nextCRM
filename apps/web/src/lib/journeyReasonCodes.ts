/**
 * Shared mapping from journey step & run reason codes to human-readable plain English.
 */
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
 * Returns plain-English description for a reason code.
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
