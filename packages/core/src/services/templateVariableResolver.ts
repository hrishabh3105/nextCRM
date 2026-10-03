export interface VariableMappingEntry {
  source: "contact_field" | "contact_attribute" | "fixed";
  field?: "name" | "email" | "phone";
  key?: string;
  value?: string;
}

export type VariableMapping = Record<string, VariableMappingEntry>;

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
 */
export function resolveTemplateVariables(params: {
  placeholders: string[];
  mapping: VariableMapping;
  contact: {
    name: string | null;
    email: string | null;
    phone: string;
    attributes: any;
  };
}): { resolved: string[] } | { error: string } {
  const { placeholders, mapping, contact } = params;
  const resolved: string[] = [];

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
        value = contact[entry.field];
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
      return {
        error: `Missing value for placeholder '{{${placeholder}}}' (source: ${entry.source}) for contact ${contact.phone}`,
      };
    }

    resolved.push(String(value));
  }

  return { resolved };
}
