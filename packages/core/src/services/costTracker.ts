import { prisma } from "@nextcrm/db";
import { forWorkspace } from "@nextcrm/core";

export interface RecordMessageCostParams {
  workspaceId: string;
  messageId: string;
  category: string;
  country?: string;
}

/**
 * Records the cost of an outbound message against the active RateCard.
 *
 * Guarantees:
 * 1. Missing rate cards or database exceptions will NEVER throw or break message
 *    delivery (message sending has already succeeded by the time this is called).
 * 2. Queries RateCard unscoped via raw prisma client (RateCard is global/system-wide).
 * 3. Writes MessageCost tenant-scoped via forWorkspace(workspaceId).
 */
export async function recordMessageCost(params: {
  workspaceId: string;
  messageId: string;
  category: string;
  country?: string;
}): Promise<void> {
  try {
    const country = params.country || "IN";
    const now = new Date();

    // 1. Query active RateCard unscoped using raw prisma client
    const rateCard = await prisma.rateCard.findFirst({
      where: {
        country,
        category: params.category,
        effectiveFrom: {
          lte: now,
        },
      },
      orderBy: {
        effectiveFrom: "desc",
      },
    });

    if (!rateCard) {
      console.warn(
        `[costTracker] No active RateCard found for country '${country}' and category '${params.category}'. Skipping cost record for message ${params.messageId}.`
      );
      return;
    }

    // 2. Write MessageCost tenant-scoped for the workspace
    await forWorkspace(params.workspaceId).messageCost.create({
      data: {
        workspaceId: params.workspaceId,
        messageId: params.messageId,
        category: params.category,
        rateAtSend: rateCard.rate,
        billedAmount: rateCard.rate,
        currency: rateCard.currency,
      },
    });
  } catch (error) {
    // Catch ANY error (Prisma errors, network drops, etc.) and log without rethrowing
    console.error(
      `[costTracker] Failed to record message cost for message ${params.messageId}:`,
      error
    );
  }
}
