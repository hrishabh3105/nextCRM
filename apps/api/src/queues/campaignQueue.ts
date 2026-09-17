import { Queue } from "bullmq";
import { CAMPAIGN_DISPATCH_QUEUE, redisConnection } from "@nextcrm/core";

export interface CampaignDispatchJobData {
  campaignId: string;
  workspaceId: string;
}

/**
 * BullMQ Queue for CAMPAIGN_DISPATCH_QUEUE.
 * Used by apps/api to enqueue campaign dispatch jobs.
 */
export const campaignDispatchQueue = new Queue<CampaignDispatchJobData>(
  CAMPAIGN_DISPATCH_QUEUE,
  {
    connection: redisConnection,
  }
);
