import "dotenv/config";
import { Worker, Job } from "bullmq";
import {
  SEND_MESSAGE_QUEUE,
  redisConnection,
  forWorkspace,
  sendTemplateMessage,
  decryptToken,
  recordMessageCost,
} from "@nextcrm/core";
import { SendMessageJobData } from "./campaignDispatchWorker";

/**
 * BullMQ Worker for SEND_MESSAGE_QUEUE.
 * Processes individual contact message delivery using Meta Cloud API.
 */
export const sendMessageWorker = new Worker<SendMessageJobData>(
  SEND_MESSAGE_QUEUE,
  async (job: Job<SendMessageJobData>) => {
    const { campaignId, workspaceId, contactId, campaignRecipientId } = job.data;
    console.log(
      `[send-message] processing job for recipient ${campaignRecipientId} in campaign ${campaignId}`
    );

    const db = forWorkspace(workspaceId);

    // 1. Atomic claim using updateMany (idempotency check)
    const claimed = await db.campaignRecipient.updateMany({
      where: { id: campaignRecipientId, status: "pending" },
      data: { status: "sending" },
    });
    if (claimed.count === 0) {
      console.log(
        `[send-message] Recipient ${campaignRecipientId} already claimed or processed. Skipping.`
      );
      return;
    }

    // Helper to record failure and update campaign completion status
    const recordFailure = async (reason: string, err?: unknown) => {
      if (err) {
        console.error(
          `[send-message] Error for recipient ${campaignRecipientId} (contact ${contactId}): ${reason}`,
          err
        );
      } else {
        console.warn(
          `[send-message] Failure for recipient ${campaignRecipientId} (contact ${contactId}): ${reason}`
        );
      }

      await db.campaignRecipient.update({
        where: { id: campaignRecipientId },
        data: { status: "failed" },
      });

      const updated = await db.campaign.update({
        where: { id: campaignId },
        data: { failedCount: { increment: 1 } },
      });

      if (updated.sentCount + updated.failedCount >= updated.totalRecipients) {
        await db.campaign.update({
          where: { id: campaignId },
          data: { status: "completed" },
        });
        console.log(
          `[send-message] Campaign ${campaignId} marked completed (sent: ${updated.sentCount}, failed: ${updated.failedCount}, total: ${updated.totalRecipients})`
        );
      }
    };

    // 2. Fetch Campaign, Template, and Channel
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      include: {
        template: true,
        channel: true,
      },
    });

    if (!campaign) {
      console.warn(
        `[send-message] Campaign ${campaignId} not found in workspace ${workspaceId}. Skipping.`
      );
      return;
    }

    // 3. Verify Template approval status
    if (!campaign.template || campaign.template.status !== "approved") {
      const currentStatus = campaign.template ? campaign.template.status : "missing";
      await recordFailure(
        `Template is not approved (current status: '${currentStatus}'). Must be 'approved' to send.`
      );
      return;
    }

    // 4. Fetch Contact
    const contact = await db.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      await recordFailure(`Contact ${contactId} not found`);
      return;
    }

    // 5. Verify Channel credentials
    if (!campaign.channel || !campaign.channel.accessTokenEnc || !campaign.channel.phoneNumberId) {
      await recordFailure(
        `Channel ${campaign.channelId} is missing required Meta credentials (accessTokenEnc or phoneNumberId)`
      );
      return;
    }

    // 6. Decrypt token and call Meta API
    let accessToken: string;
    try {
      accessToken = decryptToken(campaign.channel.accessTokenEnc);
    } catch (decryptErr) {
      await recordFailure("Failed to decrypt channel access token", decryptErr);
      return;
    }

    try {
      const result = await sendTemplateMessage({
        accessToken,
        phoneNumberId: campaign.channel.phoneNumberId,
        to: contact.phone,
        templateName: campaign.template.providerName,
        language: campaign.template.language,
        variables: [],
      });

      // 7. On success: update recipient and increment sentCount
      await db.campaignRecipient.update({
        where: { id: campaignRecipientId },
        data: {
          status: "sent",
          messageId: result.providerMessageId,
        },
      });

      const updated = await db.campaign.update({
        where: { id: campaignId },
        data: { sentCount: { increment: 1 } },
      });

      await recordMessageCost({
        workspaceId,
        messageId: result.providerMessageId,
        category: campaign.template.category,
      });

      // Check if campaign finished
      if (updated.sentCount + updated.failedCount >= updated.totalRecipients) {
        await db.campaign.update({
          where: { id: campaignId },
          data: { status: "completed" },
        });
        console.log(
          `[send-message] Campaign ${campaignId} marked completed (sent: ${updated.sentCount}, failed: ${updated.failedCount}, total: ${updated.totalRecipients})`
        );
      }
    } catch (metaErr) {
      // Catch Meta errors here — one contact's failure must not crash the job queue or retry indefinitely
      await recordFailure("Meta API error while sending template message", metaErr);
    }
  },
  {
    connection: redisConnection,
    limiter: {
      max: 20,
      duration: 1000,
    },
  }
);

sendMessageWorker.on("error", (err) => {
  console.error("[send-message] worker error:", err);
});
