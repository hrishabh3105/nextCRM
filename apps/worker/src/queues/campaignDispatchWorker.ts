import "dotenv/config";
import { Worker, Job, Queue } from "bullmq";
import {
  CAMPAIGN_DISPATCH_QUEUE,
  SEND_MESSAGE_QUEUE,
  redisConnection,
  forWorkspace,
} from "@nextcrm/core";

export interface CampaignDispatchJobData {
  campaignId: string;
  workspaceId: string;
}

export interface SendMessageJobData {
  campaignId: string;
  workspaceId: string;
  contactId: string;
  campaignRecipientId: string;
}

/**
 * BullMQ Queue for SEND_MESSAGE_QUEUE.
 */
export const sendMessageQueue = new Queue<SendMessageJobData>(SEND_MESSAGE_QUEUE, {
  connection: redisConnection,
});

/**
 * BullMQ Worker for CAMPAIGN_DISPATCH_QUEUE.
 * Expands a queued campaign into individual per-contact send jobs.
 */
export const campaignDispatchWorker = new Worker<CampaignDispatchJobData>(
  CAMPAIGN_DISPATCH_QUEUE,
  async (job: Job<CampaignDispatchJobData>) => {
    const { campaignId, workspaceId } = job.data;
    console.log(`[campaign-dispatch] processing job for campaign ${campaignId} in workspace ${workspaceId}`);

    const db = forWorkspace(workspaceId);

    // 1. Fetch Campaign
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      console.warn(`[campaign-dispatch] Campaign ${campaignId} not found in workspace ${workspaceId}. Skipping.`);
      return;
    }

    if (campaign.status !== "queued") {
      console.warn(
        `[campaign-dispatch] Campaign ${campaignId} has status '${campaign.status}', expected 'queued'. Skipping.`
      );
      return;
    }

    // 2. Fetch all opted-in contacts in this workspace
    const contacts = await db.contact.findMany({
      where: {
        optedInAt: {
          not: null,
        },
      },
    });

    // If no opted-in contacts found, mark completed immediately
    if (contacts.length === 0) {
      console.log(
        `[campaign-dispatch] Campaign ${campaignId} has 0 opted-in contacts. Marking as completed.`
      );
      await db.campaign.update({
        where: { id: campaign.id },
        data: {
          totalRecipients: 0,
          status: "completed",
        },
      });
      return;
    }

    // 3. Create CampaignRecipient rows with status "pending", skipping duplicates on retry
    await db.campaignRecipient.createMany({
      data: contacts.map((contact) => ({
        campaignId: campaign.id,
        contactId: contact.id,
        status: "pending",
      })),
      skipDuplicates: true,
    });

    // 4. Update Campaign totalRecipients and status
    await db.campaign.update({
      where: { id: campaign.id },
      data: {
        totalRecipients: contacts.length,
        status: "sending",
      },
    });

    // 5. Fetch recipient records to retrieve their campaignRecipientId
    const recipients = await db.campaignRecipient.findMany({
      where: {
        campaignId: campaign.id,
        contactId: {
          in: contacts.map((c) => c.id),
        },
      },
    });

    const recipientMap = new Map<string, string>();
    for (const r of recipients) {
      recipientMap.set(r.contactId, r.id);
    }

    // 6. Enqueue one "send-message" job PER contact
    const jobs = contacts
      .map((contact) => {
        const campaignRecipientId = recipientMap.get(contact.id);
        if (!campaignRecipientId) {
          console.error(
            `[campaign-dispatch] Missing recipient record for contact ${contact.id} in campaign ${campaign.id}`
          );
          return null;
        }

        return {
          name: "send-message",
          data: {
            campaignId: campaign.id,
            workspaceId,
            contactId: contact.id,
            campaignRecipientId,
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (jobs.length > 0) {
      await sendMessageQueue.addBulk(jobs);
      console.log(`[campaign-dispatch] Enqueued ${jobs.length} send-message jobs for campaign ${campaign.id}`);
    }
  },
  {
    connection: redisConnection,
  }
);

campaignDispatchWorker.on("error", (err) => {
  console.error("[campaign-dispatch] worker error:", err);
});
