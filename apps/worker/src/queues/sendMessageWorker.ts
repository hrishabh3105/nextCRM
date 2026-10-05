import "dotenv/config";
import { Worker, Job } from "bullmq";
import {
  SEND_MESSAGE_QUEUE,
  redisConnection,
  forWorkspace,
  sendTemplateMessage,
  decryptToken,
  recordMessageCost,
  checkFrequencyCap,
  recordOutboundMessage,
  resolveTemplateVariables,
} from "@nextcrm/core";
import { SendMessageJobData } from "./campaignDispatchWorker";

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_RATE_LIMIT_PER_SEC = 20;

const parsedConcurrency = process.env.SEND_MESSAGE_CONCURRENCY
  ? parseInt(process.env.SEND_MESSAGE_CONCURRENCY, 10)
  : NaN;
const concurrency =
  !Number.isNaN(parsedConcurrency) && parsedConcurrency > 0
    ? parsedConcurrency
    : DEFAULT_CONCURRENCY;

const parsedRateLimit = process.env.SEND_RATE_LIMIT_PER_SEC
  ? parseInt(process.env.SEND_RATE_LIMIT_PER_SEC, 10)
  : NaN;
const rateLimitMax =
  !Number.isNaN(parsedRateLimit) && parsedRateLimit > 0
    ? parsedRateLimit
    : DEFAULT_RATE_LIMIT_PER_SEC;

console.log(
  `[send-message] Worker startup configuration: concurrency=${concurrency}, rateLimitMax=${rateLimitMax}/s`
);

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

    // Helper to safely transition campaign to 'completed' only if it has not been cancelled
    const checkCampaignCompletion = async (updated: {
      sentCount: number;
      failedCount: number;
      skippedCount: number;
      totalRecipients: number;
      status: string;
    }) => {
      // A cancelled campaign remains cancelled permanently and must never be overwritten to completed
      if (
        updated.status !== "cancelled" &&
        updated.sentCount + updated.failedCount + updated.skippedCount >= updated.totalRecipients
      ) {
        const completedClaim = await db.campaign.updateMany({
          where: { id: campaignId, status: { not: "cancelled" } },
          data: { status: "completed" },
        });
        if (completedClaim.count > 0) {
          console.log(
            `[send-message] Campaign ${campaignId} marked completed (sent: ${updated.sentCount}, failed: ${updated.failedCount}, skipped: ${updated.skippedCount}, total: ${updated.totalRecipients})`
          );
        }
      }
    };

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

      await checkCampaignCompletion(updated);
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

    // Check if campaign was cancelled while job was queued or in progress
    if (campaign.status === "cancelled") {
      console.log(
        `[send-message] Campaign ${campaignId} has been cancelled. Skipping send for recipient ${campaignRecipientId} (contact ${contactId}).`
      );

      await db.campaignRecipient.update({
        where: { id: campaignRecipientId },
        data: { status: "skipped_cancelled" },
      });

      // Decision: Reuse skippedCount rather than introducing a new cancelledCount field to the schema.
      // Reasoning:
      // 1. High-level metric consistency: skippedCount accurately represents all recipients intentionally
      //    skipped (either via frequency capping or operator cancellation), maintaining the invariant:
      //    sentCount + failedCount + skippedCount = totalRecipients across all campaign runs.
      // 2. Granular auditability: The CampaignRecipient table records the exact reason via status
      //    ('skipped_cancelled' vs 'skipped_frequency_cap'), preserving full per-recipient fidelity.
      // 3. Operational safety: Reusing skippedCount avoids running database schema migrations and
      //    regenerating Prisma client code in active runtime environments.
      await db.campaign.update({
        where: { id: campaignId },
        data: { skippedCount: { increment: 1 } },
      });

      // Note: A cancelled campaign must NOT transition to "completed" even if all
      // remaining queued jobs drain through as skipped. Return immediately without
      // checking completion.
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

    const canSend = await checkFrequencyCap(db, contact.id);
    if (!canSend) {
      console.log(
        `[send-message] Contact ${contact.id} (recipient ${campaignRecipientId}) reached frequency cap. Skipping message send.`
      );
      await db.campaignRecipient.update({
        where: { id: campaignRecipientId },
        data: { status: "skipped_frequency_cap" },
      });

      const updated = await db.campaign.update({
        where: { id: campaignId },
        data: { skippedCount: { increment: 1 } },
      });

      await checkCampaignCompletion(updated);
      return;
    }

    const templatePlaceholders = Array.isArray(campaign.template.positionalPlaceholders)
      ? (campaign.template.positionalPlaceholders as string[])
      : Array.isArray(campaign.template.placeholders)
        ? (campaign.template.placeholders as string[])
        : [];

    let variables: string[] = [];

    if (templatePlaceholders.length > 0) {
      const mapping =
        campaign.variableMapping &&
        typeof campaign.variableMapping === "object" &&
        !Array.isArray(campaign.variableMapping)
          ? (campaign.variableMapping as any)
          : {};

      const resolutionResult = resolveTemplateVariables({
        placeholders: templatePlaceholders,
        mapping,
        contact,
      });

      if ("error" in resolutionResult) {
        await recordFailure(resolutionResult.error);
        return;
      }

      variables = resolutionResult.resolved;
    }

    try {
      const result = await sendTemplateMessage({
        accessToken,
        phoneNumberId: campaign.channel.phoneNumberId,
        to: contact.phone,
        templateName: campaign.template.providerName,
        language: campaign.template.language,
        variables,
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

      await recordOutboundMessage({
        workspaceId,
        contactId: contact.id,
        channelId: campaign.channel.id,
        providerMessageId: result.providerMessageId,
        body: campaign.template.bodyPreview,
        campaignId,
      });

      // Check if campaign finished
      await checkCampaignCompletion(updated);
    } catch (metaErr) {
      // Catch Meta errors here — one contact's failure must not crash the job queue or retry indefinitely
      await recordFailure("Meta API error while sending template message", metaErr);
    }
  },
  {
    connection: redisConnection,
    concurrency,
    limiter: {
      max: rateLimitMax,
      duration: 1000,
    },
  }
);

sendMessageWorker.on("error", (err) => {
  console.error("[send-message] worker error:", err);
});
