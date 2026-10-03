import { z } from "zod";

/**
 * Validation schema for individual variable mapping entries.
 */
export const variableMappingEntrySchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("contact_field"),
    field: z.enum(["name", "email", "phone"]),
  }),
  z.object({
    source: z.literal("contact_attribute"),
    key: z.string().min(1, "attribute key is required"),
  }),
  z.object({
    source: z.literal("fixed"),
    value: z.string().min(1, "fixed value is required"),
  }),
]);

export type VariableMappingEntryInput = z.infer<typeof variableMappingEntrySchema>;

export const variableMappingSchema = z.record(z.string(), variableMappingEntrySchema);
export type VariableMappingInput = z.infer<typeof variableMappingSchema>;

/**
 * Validation schema for campaign audience segmentation.
 */
export const segmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({
    type: z.literal("contact_ids"),
    contactIds: z.array(z.string().min(1)).min(1, "at least one contact id is required"),
  }),
  z.object({
    type: z.literal("filter"),
    conditions: z.array(z.object({
      key: z.string().min(1),
      operator: z.literal("equals"),
      value: z.union([z.string(), z.number(), z.boolean()]),
    })).min(1, "at least one condition is required"),
  }),
]);

export type SegmentInput = z.infer<typeof segmentSchema>;

/**
 * Validation schema for creating a new Campaign.
 */
export const createCampaignSchema = z.object({
  name: z.string().min(1, "name is required").max(255, "name must be 255 characters or fewer"),
  templateId: z.string().min(1, "templateId is required"),
  channelId: z.string().min(1, "channelId is required"),
  variableMapping: variableMappingSchema.optional(),
  segment: segmentSchema.optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

/**
 * Validation schema for partially updating a Campaign.
 * Reuses the same rules as createCampaignSchema, with all fields optional.
 */
export const updateCampaignSchema = createCampaignSchema.partial();
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;


