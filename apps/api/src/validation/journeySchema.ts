import { z } from "zod";
import { variableMappingSchema, variableMappingEntrySchema } from "./campaignSchema";
import {
  ALL_TRIGGER_FIELDS,
  CART_TRIGGER_FIELDS,
  ORDER_TRIGGER_FIELDS,
  getTemplateDynamicButton,
  isButtonVariableKey,
} from "@nextcrm/core";

export const journeyStatusSchema = z.enum(["active", "paused", "draft"]);

/**
 * Zod schema for creating a new Journey.
 */
export const createJourneySchema = z.object({
  name: z.string().min(1, "Journey name is required").max(255, "name must be 255 characters or fewer"),
  triggerEvent: z.string().min(1, "triggerEvent is required"),
  status: journeyStatusSchema.optional().default("active"),
  steps: z.array(z.record(z.string(), z.any())).min(1, "steps array must have at least one step"),
});

export type CreateJourneyInput = z.infer<typeof createJourneySchema>;

/**
 * Zod schema for updating an existing Journey.
 */
export const updateJourneySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  triggerEvent: z.string().min(1).optional(),
  status: journeyStatusSchema.optional(),
  steps: z.array(z.record(z.string(), z.any())).optional(),
});

export type UpdateJourneyInput = z.infer<typeof updateJourneySchema>;

export interface StepValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates that every placeholder of selected templates has a mapping before
 * a journey can be ACTIVATED.
 *
 * Checks all send_message steps against the database templates.
 * Enforces that trigger_field sources match the journey's triggerEvent.
 */
export async function validateJourneyStepsForActivation(
  db: any,
  steps: any[],
  triggerEvent?: string
): Promise<StepValidationResult> {
  const errors: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNum = i + 1;

    // Check both flat engine format (type: "send_message") and friendly format (kind: "send_message")
    const isSendMessage = step?.type === "send_message" || step?.kind === "send_message";
    if (!isSendMessage) {
      continue;
    }

    if (!step.templateId) {
      errors.push(`Step ${stepNum} (Send WhatsApp Message) requires a template to be selected`);
      continue;
    }

    const template = await db.template.findUnique({
      where: { id: step.templateId },
    });

    if (!template) {
      errors.push(`Step ${stepNum}: Template '${step.templateId}' not found`);
      continue;
    }

    // Extract placeholders from template (prefer positionalPlaceholders, fallback to placeholders)
    const rawPlaceholders: string[] = Array.isArray(template.positionalPlaceholders)
      ? (template.positionalPlaceholders as string[])
      : Array.isArray(template.placeholders)
      ? (template.placeholders as string[])
      : [];

    const uniquePlaceholders = Array.from(new Set(rawPlaceholders));

    if (uniquePlaceholders.length > 0) {
      const mapping = step.variableMapping;
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
        errors.push(
          `Template '${template.providerName}' in Step ${stepNum} requires variable mapping for placeholder(s): ${uniquePlaceholders
            .map((p) => `'{{${p}}}'`)
            .join(", ")}`
        );
      } else {
        const missing: string[] = [];
        for (const placeholder of uniquePlaceholders) {
          const entry = mapping[placeholder];
          if (!entry) {
            missing.push(placeholder);
            continue;
          }

          const parseResult = variableMappingEntrySchema.safeParse(entry);
          if (!parseResult.success) {
            errors.push(
              `Invalid mapping for '{{${placeholder}}}' in Step ${stepNum}: ${parseResult.error.issues
                .map((iss) => iss.message)
                .join(", ")}`
            );
            continue;
          }

          // Additional validation for trigger_field entries
          if (entry.source === "trigger_field") {
            const field = entry.field;
            if (!field || !(ALL_TRIGGER_FIELDS as readonly string[]).includes(field)) {
              errors.push(
                `Unknown trigger_field '${field}' for '{{${placeholder}}}' in Step ${stepNum}. Allowed fields: ${ALL_TRIGGER_FIELDS.join(", ")}`
              );
            } else if (triggerEvent) {
              const isCartTrigger = triggerEvent === "cart_abandoned";
              const isOrderTrigger = [
                "order_placed_cod",
                "order_status_changed",
                "order_delivered",
              ].includes(triggerEvent);

              if (field.startsWith("cart.") && !isCartTrigger) {
                errors.push(
                  `Trigger field '${field}' for placeholder '{{${placeholder}}}' in Step ${stepNum} is only allowed for cart abandonment journeys, but journey trigger is '${triggerEvent}'`
                );
              } else if (field.startsWith("order.") && !isOrderTrigger) {
                errors.push(
                  `Trigger field '${field}' for placeholder '{{${placeholder}}}' in Step ${stepNum} is only allowed for order journeys, but journey trigger is '${triggerEvent}'`
                );
              }
            }
          }
        }

        if (missing.length > 0) {
          errors.push(
            `Template '${template.providerName}' in Step ${stepNum} is missing variable mapping for placeholder(s): ${missing
              .map((p) => `'{{${p}}}'`)
              .join(", ")}`
          );
        }
      }
    }

    // Dynamic URL button validation
    const dynamicButton = getTemplateDynamicButton(template);
    if (dynamicButton) {
      const mapping = step.variableMapping;
      let buttonEntry = null;
      if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
        buttonEntry =
          mapping["button:url"] ||
          mapping[`button:${dynamicButton.index}`] ||
          mapping["button_url"];
        if (!buttonEntry) {
          for (const [k, v] of Object.entries(mapping)) {
            if (isButtonVariableKey(k) && v) {
              buttonEntry = v;
              break;
            }
          }
        }
      }

      if (!buttonEntry) {
        errors.push(
          `Template '${template.providerName}' in Step ${stepNum} has a dynamic URL button ('${dynamicButton.text}') but is missing a button variable mapping.`
        );
      } else {
        const parseResult = variableMappingEntrySchema.safeParse(buttonEntry);
        if (!parseResult.success) {
          errors.push(
            `Invalid button variable mapping in Step ${stepNum}: ${parseResult.error.issues
              .map((iss) => iss.message)
              .join(", ")}`
          );
        } else if (buttonEntry.source === "trigger_field") {
          const field = buttonEntry.field;
          if (!field || !(ALL_TRIGGER_FIELDS as readonly string[]).includes(field)) {
            errors.push(
              `Unknown trigger_field '${field}' for button in Step ${stepNum}. Allowed fields: ${ALL_TRIGGER_FIELDS.join(", ")}`
            );
          } else if (triggerEvent) {
            const isCartTrigger = triggerEvent === "cart_abandoned";
            const isOrderTrigger = [
              "order_placed_cod",
              "order_status_changed",
              "order_delivered",
            ].includes(triggerEvent);

            if (field.startsWith("cart.") && !isCartTrigger) {
              errors.push(
                `Trigger field '${field}' for button in Step ${stepNum} is only allowed for cart abandonment journeys, but journey trigger is '${triggerEvent}'`
              );
            } else if (field.startsWith("order.") && !isOrderTrigger) {
              errors.push(
                `Trigger field '${field}' for button in Step ${stepNum} is only allowed for order journeys, but journey trigger is '${triggerEvent}'`
              );
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
