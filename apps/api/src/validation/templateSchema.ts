import { z } from "zod";

/**
 * Validation schema for creating a new Template.
 * Validates against Meta's template naming rules and required fields.
 */
export const createTemplateSchema = z.object({
  channelId: z.string().min(1, "channelId is required"),
  name: z
    .string()
    .min(1, "template name is required")
    .max(512, "template name must be 512 characters or fewer")
    .regex(
      /^[a-z0-9_]+$/,
      "template name must be lowercase letters, numbers, and underscores only"
    ),
  language: z.string().default("en_US"),
  category: z.enum(["marketing", "utility", "authentication"]),
  body: z
    .string()
    .min(1, "body is required")
    .max(1024, "body must be 1024 characters or fewer"),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

/**
 * Counts how many {{1}}, {{2}}, etc. placeholders appear in the body string.
 * Used when saving, to populate variableCount.
 */
export function countVariables(body: string): number {
  const matches = body.match(/{{\d+}}/g);
  return matches ? new Set(matches).size : 0;
}
