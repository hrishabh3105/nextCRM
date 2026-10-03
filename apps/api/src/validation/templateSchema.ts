import { z } from "zod";

/**
 * Extracts named placeholders like {{name}}, {{order_id}} — in
 * ORDER OF FIRST APPEARANCE (this order is the single source of truth
 * for positional mapping later, critical for correctness).
 *
 * Note this deliberately does NOT match old-style {{1}} numeric placeholders —
 * this is a breaking change from the old countVariables, intentional, since
 * we're moving to named placeholders exclusively going forward.
 */
export function extractPlaceholders(body: string): string[] {
  const matches = body.match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g) ?? [];
  const seen: string[] = [];
  for (const m of matches) {
    const name = m.slice(2, -2);
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

/**
 * Extracts named placeholders in exact OCCURRENCE order WITH repeats (not deduped).
 * e.g. "Hi {{name}}, order {{order_id}}, thanks {{name}}" -> ["name", "order_id", "name"].
 *
 * NOTE ON DEDUPED VS POSITIONAL:
 * - extractPlaceholders (deduped): returns unique placeholder names, used for validation
 *   (requiring examples and campaign variableMapping — a user only defines one mapping per unique name).
 * - extractPositionalPlaceholders (positional with repeats): returns every occurrence in order,
 *   used as the single source of truth for Meta submission numbering ({{1}}, {{2}}, {{3}})
 *   and send-time variable value resolution.
 */
export function extractPositionalPlaceholders(body: string): string[] {
  const matches = body.match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g) ?? [];
  return matches.map((m) => m.slice(2, -2));
}

/**
 * Button schemas for WhatsApp Templates.
 * Note: Meta's real button limits are more nuanced — up to 10 quick
 * replies OR up to 3 if mixed with CTA buttons, roughly; capping at 3
 * total is a deliberately conservative, safe default for this version,
 * not a hard Meta rule we've independently verified.
 */
export const templateButtonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("QUICK_REPLY"), text: z.string().min(1).max(25) }),
  z.object({ type: z.literal("URL"), text: z.string().min(1).max(25), url: z.string().url() }),
  z.object({ type: z.literal("PHONE_NUMBER"), text: z.string().min(1).max(25), phoneNumber: z.string().min(1) }),
]);

export type TemplateButtonInput = z.infer<typeof templateButtonSchema>;

/**
 * Validation schema for creating a new Template.
 * Validates against Meta's template naming rules and required fields.
 * If the body contains named placeholders, examples are required and every
 * placeholder must have a corresponding example value.
 */
export const createTemplateSchema = z
  .object({
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
    headerType: z.enum(["TEXT", "IMAGE"]).default("TEXT"),
    // Documented limitation: Meta allows at most one variable in header text, but for this first pass
    // we keep header text-only with NO variables allowed at all (simplest safe scope).
    headerText: z
      .string()
      .max(60, "header must be 60 characters or fewer")
      .refine((text) => !/\{\{.*\}\}/.test(text), "header cannot contain variables in this version")
      .optional(),
    headerMediaHandle: z.string().optional(),
    body: z
      .string()
      .min(1, "body is required")
      .max(1024, "body must be 1024 characters or fewer"),
    footerText: z
      .string()
      .max(60, "footer must be 60 characters or fewer")
      .refine((text) => !/\{\{.*\}\}/.test(text), "footer cannot contain variables")
      .optional(),
    buttons: z
      .array(templateButtonSchema)
      .max(3, "a maximum of 3 buttons is supported in this version")
      .optional(),
    examples: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((data, ctx) => {
    // If headerMediaHandle is present, headerText must be absent (and vice versa) — a template can't have both.
    if (data.headerMediaHandle && data.headerText && data.headerText.trim().length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A template cannot have both a text header and a media header",
        path: ["headerMediaHandle"],
      });
    }
    if (data.headerType === "IMAGE" && data.headerText && data.headerText.trim().length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "headerText must be absent when headerType is IMAGE",
        path: ["headerText"],
      });
    }
    if (data.headerType === "TEXT" && data.headerMediaHandle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "headerMediaHandle must be absent when headerType is TEXT",
        path: ["headerMediaHandle"],
      });
    }

    const placeholders = extractPlaceholders(data.body);
    if (placeholders.length === 0) return;

    if (!data.examples) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `examples is required when body contains placeholders (${placeholders.map((p) => `{{${p}}}`).join(", ")})`,
        path: ["examples"],
      });
      return;
    }

    for (const placeholder of placeholders) {
      const val = data.examples[placeholder];
      if (typeof val !== "string" || val.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing example value for placeholder: ${placeholder}`,
          path: ["examples", placeholder],
        });
      }
    }
  });

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
