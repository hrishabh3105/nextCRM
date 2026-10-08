import { z } from "zod";
import { variableMappingSchema, variableMappingEntrySchema } from "./campaignSchema";

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
 */
export async function validateJourneyStepsForActivation(
  db: any,
  steps: any[]
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
        continue;
      }

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

  return {
    valid: errors.length === 0,
    errors,
  };
}
