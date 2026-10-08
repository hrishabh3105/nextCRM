import "dotenv/config";
import { Worker, Job, Queue } from "bullmq";
import {
  CAMPAIGN_DISPATCH_QUEUE,
  SEND_MESSAGE_QUEUE,
  redisConnection,
  forWorkspace,
  evaluateSendPermission,
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
      include: { template: true },
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

    // 2. Fetch contacts matching campaign segmentation
    // Backward-compatibility guarantee:
    // Every campaign created before this feature has segment: null, which
    // resolves identically to { type: "all" }.
    const segment = campaign.segment as
      | { type: "all" }
      | { type: "contact_ids"; contactIds: string[] }
      | {
          type: "filter";
          conditions: Array<{
            key: string;
            operator: "equals";
            value: string | number | boolean;
          }>;
        }
      | null;

    let contactWhere: any = {};

    if (segment && typeof segment === "object" && "type" in segment) {
      if (segment.type === "contact_ids" && Array.isArray(segment.contactIds)) {
        contactWhere = {
          id: {
            in: segment.contactIds,
          },
        };
      } else if (segment.type === "filter" && Array.isArray(segment.conditions)) {
        contactWhere = {
          AND: segment.conditions.map((c) => ({
            attributes: {
              path: [c.key],
              equals: c.value,
            },
          })),
        };
      }
    }

    const matchingContacts = await db.contact.findMany({
      where: contactWhere,
    });

    const eligibleContacts: typeof matchingContacts = [];
    let skippedNoConsent = 0;
    let skippedOptedOut = 0;

    for (const contact of matchingContacts) {
      const permission = evaluateSendPermission({
        contact,
        template: campaign.template,
        context: "campaign",
      });

      if (permission.allowed) {
        eligibleContacts.push(contact);
      } else if (permission.reason === "OPTED_OUT") {
        skippedOptedOut++;
      } else {
        skippedNoConsent++;
      }
    }

    console.log(
      `[campaign-dispatch] Campaign ${campaignId} audience resolution: ${eligibleContacts.length} eligible, ${skippedNoConsent} skipped (no consent), ${skippedOptedOut} skipped (opted out), total matching: ${matchingContacts.length}`
    );

    // If no eligible contacts found, mark completed immediately
    if (eligibleContacts.length === 0) {
      console.log(
        `[campaign-dispatch] Campaign ${campaignId} has 0 eligible contacts. Marking as completed.`
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
      data: eligibleContacts.map((contact) => ({
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
        totalRecipients: eligibleContacts.length,
        status: "sending",
      },
    });

    // 5. Fetch recipient records to retrieve their campaignRecipientId
    const recipients = await db.campaignRecipient.findMany({
      where: {
        campaignId: campaign.id,
        contactId: {
          in: eligibleContacts.map((c) => c.id),
        },
      },
    });

    const recipientMap = new Map<string, string>();
    for (const r of recipients) {
      recipientMap.set(r.contactId, r.id);
    }

    // 6. Enqueue one "send-message" job PER eligible contact
    const jobs = eligibleContacts
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
