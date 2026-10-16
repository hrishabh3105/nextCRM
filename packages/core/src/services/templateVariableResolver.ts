import { forWorkspace } from "../tenantScope";

export type VariableMappingSource =
  | "contact_field"
  | "contact_attribute"
  | "fixed"
  | "trigger_field";

export interface VariableMappingEntry {
  source: VariableMappingSource;
  field?: "name" | "email" | "phone" | string;
  key?: string;
  value?: string;
  fallback?: string;
}

export type VariableMapping = Record<string, VariableMappingEntry>;

export const BUTTON_VARIABLE_KEY = "button:url";

export function isButtonVariableKey(key: string): boolean {
  return key === "button:url" || key.startsWith("button:") || key === "button_url";
}

export const CART_TRIGGER_FIELDS = [
  "cart.recovery_url",
  "cart.recovery_path",
  "cart.total",
  "cart.currency",
  "cart.item_count",
  "cart.first_item_name",
  "cart.items_summary",
] as const;

export const ORDER_TRIGGER_FIELDS = [
  "order.number",
  "order.total",
  "order.currency",
  "order.item_count",
  "order.items_summary",
] as const;

export const ALL_TRIGGER_FIELDS = [
  ...CART_TRIGGER_FIELDS,
  ...ORDER_TRIGGER_FIELDS,
] as const;

export type CartTriggerField = (typeof CART_TRIGGER_FIELDS)[number];
export type OrderTriggerField = (typeof ORDER_TRIGGER_FIELDS)[number];
export type TriggerField = (typeof ALL_TRIGGER_FIELDS)[number];

const CURRENCY_LOCALES: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "en-IE",
  GBP: "en-GB",
  CAD: "en-CA",
  AUD: "en-AU",
};

/**
 * Formats a currency amount with its currency code/symbol.
 * Uses Intl.NumberFormat, falling back to `<amount> <currency>` if currency is unknown.
 */
export function formatCurrencyAmount(
  amount: number | string | any,
  currencyCode?: string | null
): string {
  const num = typeof amount === "number" ? amount : parseFloat(String(amount));
  if (isNaN(num)) return "";

  const cleanCurrency = (currencyCode || "USD").trim().toUpperCase();
  const locale = CURRENCY_LOCALES[cleanCurrency] || "en-US";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: cleanCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    // If currency code is unknown/invalid to Intl.NumberFormat, fallback to number + currency code
    return `${num.toFixed(2)} ${cleanCurrency}`;
  }
}

export function parseLineItems(rawItems: unknown): any[] {
  if (!rawItems) return [];
  if (Array.isArray(rawItems)) return rawItems;
  if (typeof rawItems === "string") {
    try {
      const parsed = JSON.parse(rawItems);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function getItemCount(rawItems: unknown): number {
  const items = parseLineItems(rawItems);
  if (items.length === 0) return 0;
  return items.reduce((total, item) => {
    const qty = Number(item.quantity);
    return total + (isNaN(qty) || qty <= 0 ? 1 : qty);
  }, 0);
}

export function getFirstItemName(rawItems: unknown): string {
  const items = parseLineItems(rawItems);
  if (items.length === 0) return "";
  return (items[0].title || items[0].name || "").trim();
}

export function getItemsSummary(rawItems: unknown): string {
  const items = parseLineItems(rawItems);
  const titles = items
    .map((item) => (item.title || item.name || "").trim())
    .filter((title) => title.length > 0);

  if (titles.length === 0) return "";
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `${titles[0]}, ${titles[1]}`;

  const remaining = titles.length - 2;
  return `${titles[0]}, ${titles[1]} and ${remaining} more`;
}

/**
 * Sanitizes template parameters for WhatsApp:
 * - Replace newlines and tabs with a single space.
 * - Collapse 4 or more consecutive spaces.
 * - Trim whitespace.
 * - Cap length at 1000 characters (truncate with "…").
 */
export function sanitizeTemplateParam(val: string): string {
  if (!val) return "";
  let sanitized = String(val).replace(/\r\n|[\r\n\t]/g, " ");
  sanitized = sanitized.replace(/ {4,}/g, " ");
  sanitized = sanitized.trim();
  if (sanitized.length > 1000) {
    sanitized = sanitized.slice(0, 999) + "…";
  }
  return sanitized;
}

export interface ResolveTemplateVariablesParams {
  placeholders: string[];
  mapping: VariableMapping;
  contact: {
    name: string | null;
    email: string | null;
    phone: string;
    attributes: any;
  };
  db?: any;
  workspaceId?: string;
  cartId?: string | null;
  orderId?: string | null;
  triggerData?: {
    cart?: any;
    order?: any;
  };
}

function resolveTemplateVariablesSync(
  params: ResolveTemplateVariablesParams,
  triggerData?: { cart?: any; order?: any }
): { resolved: string[] } | { error: string } {
  const { placeholders, mapping, contact } = params;
  const resolved: string[] = [];
  const cart = triggerData?.cart ?? null;
  const order = triggerData?.order ?? null;

  for (const placeholder of placeholders) {
    const entry = mapping[placeholder];
    if (!entry) {
      return {
        error: `No variable mapping defined for placeholder '{{${placeholder}}}'`,
      };
    }

    let value: unknown;

    switch (entry.source) {
      case "contact_field": {
        if (!entry.field || !["name", "email", "phone"].includes(entry.field)) {
          return {
            error: `Invalid or missing field for contact_field mapping on placeholder '{{${placeholder}}}'`,
          };
        }
        value = contact[entry.field as "name" | "email" | "phone"];
        break;
      }

      case "contact_attribute": {
        if (!entry.key) {
          return {
            error: `Missing attribute key for contact_attribute mapping on placeholder '{{${placeholder}}}'`,
          };
        }
        const attrs = contact.attributes;
        if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
          value = attrs[entry.key];
        } else {
          value = undefined;
        }
        break;
      }

      case "fixed": {
        value = entry.value;
        break;
      }

      case "trigger_field": {
        const fieldKey = entry.field;
        if (!fieldKey || !(ALL_TRIGGER_FIELDS as readonly string[]).includes(fieldKey)) {
          return {
            error: `Invalid or unknown trigger field '${fieldKey}' for placeholder '{{${placeholder}}}'`,
          };
        }

        if (fieldKey.startsWith("cart.")) {
          if (!cart) {
            console.log(
              `[template-variable-resolver] No cart found or linked for placeholder '{{${placeholder}}}' (field: ${fieldKey})`
            );
            value = undefined;
          } else {
            switch (fieldKey) {
              case "cart.recovery_url":
                value = cart.recoveryUrl;
                break;
              case "cart.recovery_path":
                value = cart.recoveryUrl;
                break;
              case "cart.total": {
                const totalAmt = cart.total != null ? cart.total : cart.totalPrice;
                value =
                  totalAmt != null
                    ? formatCurrencyAmount(totalAmt, cart.currency)
                    : undefined;
                break;
              }
              case "cart.currency":
                value = cart.currency;
                break;
              case "cart.item_count": {
                const count = getItemCount(cart.lineItems);
                value = count > 0 ? String(count) : undefined;
                break;
              }
              case "cart.first_item_name":
                value = getFirstItemName(cart.lineItems);
                break;
              case "cart.items_summary":
                value = getItemsSummary(cart.lineItems);
                break;
            }
          }
        } else if (fieldKey.startsWith("order.")) {
          if (!order) {
            console.log(
              `[template-variable-resolver] No order found or linked for placeholder '{{${placeholder}}}' (field: ${fieldKey})`
            );
            value = undefined;
          } else {
            switch (fieldKey) {
              case "order.number":
                value = order.orderNumber || order.shopifyOrderId;
                break;
              case "order.total": {
                const totalAmt = order.totalPrice != null ? order.totalPrice : order.total;
                value =
                  totalAmt != null
                    ? formatCurrencyAmount(totalAmt, order.currency)
                    : undefined;
                break;
              }
              case "order.currency":
                value = order.currency;
                break;
              case "order.item_count": {
                const count = getItemCount(order.lineItems);
                value = count > 0 ? String(count) : undefined;
                break;
              }
              case "order.items_summary":
                value = getItemsSummary(order.lineItems);
                break;
            }
          }
        }
        break;
      }

      default: {
        return {
          error: `Unknown variable mapping source '${(entry as any).source}' for placeholder '{{${placeholder}}}'`,
        };
      }
    }

    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
    ) {
      if (
        entry.fallback !== undefined &&
        entry.fallback !== null &&
        typeof entry.fallback === "string" &&
        entry.fallback.trim() !== ""
      ) {
        value = entry.fallback;
      } else {
        const fieldDesc =
          entry.source === "trigger_field"
            ? `trigger_field '${entry.field}'`
            : entry.source;
        console.warn(
          `[template-variable-resolver] Missing value for placeholder '{{${placeholder}}}' (${fieldDesc}) for contact ${contact.phone}`
        );
        return {
          error: `Missing value for placeholder '{{${placeholder}}}' (source: ${entry.source}${
            entry.field ? `, field: ${entry.field}` : ""
          }) for contact ${contact.phone}`,
        };
      }
    }

    resolved.push(sanitizeTemplateParam(String(value)));
  }

  return { resolved };
}

async function resolveTemplateVariablesAsync(
  params: ResolveTemplateVariablesParams
): Promise<{ resolved: string[] } | { error: string }> {
  const dbClient = params.db || (params.workspaceId ? forWorkspace(params.workspaceId) : null);

  let cart = params.triggerData?.cart ?? null;
  let order = params.triggerData?.order ?? null;

  if (dbClient) {
    if (!cart && params.cartId) {
      cart = await dbClient.cart.findFirst({
        where: { id: params.cartId },
      });
    }
    if (!order && params.orderId) {
      order = await dbClient.order.findFirst({
        where: {
          OR: [{ id: params.orderId }, { shopifyOrderId: params.orderId }],
        },
      });
    }
  }

  return resolveTemplateVariablesSync(params, { cart, order });
}

/**
 * Resolves template variables for a given contact against a campaign/step variable mapping.
 *
 * NOTE ON ORDERING & REPEATS:
 * Placeholders are iterated in the EXACT POSITIONAL OCCURRENCE ORDER (with repeats)
 * passed via params.placeholders (Template.positionalPlaceholders).
 * For each placeholder occurrence (including repeated names), the single mapping entry
 * for that unique name is looked up, and its resolved value is appended to the returned array.
 * This naturally duplicates resolved values for repeated placeholders to match Meta's
 * 1-to-1 positional slot expectations ({{1}}, {{2}}, {{3}}).
 *
 * If any placeholder mapping uses source "trigger_field" and triggerData is not pre-supplied,
 * this function runs asynchronously to load the linked cart or order fresh from the DB
 * through the workspace-scoped client.
 */
export function resolveTemplateVariables(
  params: ResolveTemplateVariablesParams
): ({ resolved: string[] } | { error: string }) | Promise<{ resolved: string[] } | { error: string }> {
  const entries = Object.values(params.mapping || {});
  const hasTriggerField = entries.some((e) => e && e.source === "trigger_field");

  if (hasTriggerField && !params.triggerData) {
    return resolveTemplateVariablesAsync(params);
  }

  return resolveTemplateVariablesSync(params, params.triggerData);
}

/**
 * Validates a value for a WhatsApp dynamic button parameter:
 * - Reject values with whitespace or control characters.
 * - Reject values exceeding 2000 characters.
 * - Unlike body variables, NEVER truncates with '…' because truncating would break the link.
 */
export function validateButtonValue(val: unknown): string | undefined {
  if (val === null || val === undefined) return undefined;
  const s = String(val).trim();
  if (!s) return undefined;
  if (/[\s\x00-\x1F\x7F]/.test(s) || s.length > 2000) {
    return undefined;
  }
  return s;
}

/**
 * Resolves the dynamic URL button parameter:
 * - base is the part of buttonUrl before {{1}}.
 * - If recoveryUrl starts with that base, the value is the remainder.
 * - If base is just an origin and recoveryUrl has a different host,
 *   use recoveryUrl's path plus query (since Shopify redirects between the store's domains).
 * - Otherwise treat the value as missing (undefined).
 * - Rejects values with whitespace, control characters, or over 2000 characters.
 */
export function extractRecoveryPath(
  buttonUrl: string,
  recoveryUrl?: string | null
): string | undefined {
  if (
    !buttonUrl ||
    !recoveryUrl ||
    typeof recoveryUrl !== "string" ||
    !buttonUrl.includes("{{1}}")
  ) {
    return undefined;
  }

  const base = buttonUrl.split("{{1}}")[0];

  // Case 1: Recovery URL starts with the base
  if (recoveryUrl.startsWith(base)) {
    const remainder = recoveryUrl.slice(base.length);
    return validateButtonValue(remainder);
  }

  // Case 2: Different host with an origin-only base
  try {
    const baseObj = new URL(base);
    const recObj = new URL(recoveryUrl);

    const isOriginOnly =
      (baseObj.pathname === "" || baseObj.pathname === "/") &&
      !baseObj.search &&
      !baseObj.hash;

    if (isOriginOnly && recObj.host !== baseObj.host) {
      let pathPlusQuery = recObj.pathname + recObj.search + (recObj.hash || "");
      if (base.endsWith("/") && pathPlusQuery.startsWith("/")) {
        pathPlusQuery = pathPlusQuery.slice(1);
      } else if (!base.endsWith("/") && !pathPlusQuery.startsWith("/")) {
        pathPlusQuery = "/" + pathPlusQuery;
      }
      return validateButtonValue(pathPlusQuery);
    }
  } catch {
    return undefined;
  }

  // Case 3: Mismatched base with a path -> treated as missing
  return undefined;
}

/**
 * Detects if a template has a dynamic URL button (URL containing {{1}}).
 * Returns the button definition, its 0-based index among all buttons, static base URL, text, and full url.
 */
export function getTemplateDynamicButton(template: any): {
  button: any;
  index: number;
  base: string;
  text: string;
  url: string;
} | null {
  if (!template || !template.buttons) return null;
  const rawButtons = template.buttons;
  let buttons: any[] = [];
  if (Array.isArray(rawButtons)) {
    buttons = rawButtons;
  } else if (typeof rawButtons === "string") {
    try {
      buttons = JSON.parse(rawButtons);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(buttons)) return null;

  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    const type = String(b?.type || "").toUpperCase();
    if (type === "URL" && typeof b?.url === "string" && b.url.includes("{{1}}")) {
      return {
        button: b,
        index: i,
        base: b.url.split("{{1}}")[0],
        text: b.text || "Button",
        url: b.url,
      };
    }
  }

  return null;
}

export interface ResolveButtonVariableParams {
  buttonUrl: string;
  buttonIndex: number;
  buttonText: string;
  mappingEntry?: VariableMappingEntry;
  cart?: any;
  contact?: any;
}

/**
 * Resolves a dynamic button's parameter value against its variable mapping.
 * Enforces validation rules:
 * - If value is missing, tries fallback.
 * - Rejects values with whitespace or control characters or over 2000 characters.
 * - If missing and no valid fallback exists, returns error naming the button.
 */
export function resolveButtonVariable(
  params: ResolveButtonVariableParams
): { value: string } | { error: string } {
  const { buttonUrl, buttonText, mappingEntry, cart, contact } = params;

  if (!mappingEntry) {
    return {
      error: `Missing variable mapping for dynamic button '${buttonText}'`,
    };
  }

  let rawValue: string | undefined = undefined;

  switch (mappingEntry.source) {
    case "trigger_field": {
      if (mappingEntry.field === "cart.recovery_path") {
        rawValue = extractRecoveryPath(buttonUrl, cart?.recoveryUrl);
      } else if (mappingEntry.field === "cart.recovery_url") {
        rawValue = validateButtonValue(cart?.recoveryUrl);
      } else if (
        mappingEntry.field &&
        (ALL_TRIGGER_FIELDS as readonly string[]).includes(mappingEntry.field)
      ) {
        rawValue = validateButtonValue(cart?.[mappingEntry.field.replace("cart.", "")]);
      }
      break;
    }

    case "fixed": {
      rawValue = validateButtonValue(mappingEntry.value);
      break;
    }

    case "contact_field": {
      if (contact && mappingEntry.field) {
        rawValue = validateButtonValue(contact[mappingEntry.field]);
      }
      break;
    }

    case "contact_attribute": {
      if (contact?.attributes && mappingEntry.key) {
        rawValue = validateButtonValue(contact.attributes[mappingEntry.key]);
      }
      break;
    }

    default: {
      return {
        error: `Unknown variable mapping source '${(mappingEntry as any).source}' for button '${buttonText}'`,
      };
    }
  }

  if (!rawValue) {
    if (mappingEntry.fallback && validateButtonValue(mappingEntry.fallback)) {
      rawValue = validateButtonValue(mappingEntry.fallback);
    } else {
      return {
        error: `Missing value for dynamic button '${buttonText}' (${mappingEntry.source}${
          mappingEntry.field ? `: ${mappingEntry.field}` : ""
        }) and no valid fallback was provided`,
      };
    }
  }

  return { value: rawValue! };
}
