import { z } from "zod";

/**
 * Validation schema for creating a new Campaign.
 */
export const createCampaignSchema = z.object({
  name: z.string().min(1, "name is required").max(255, "name must be 255 characters or fewer"),
  templateId: z.string().min(1, "templateId is required"),
  channelId: z.string().min(1, "channelId is required"),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
