import { forWorkspace } from "../tenantScope";
import { processJourneyStep } from "./journeyStepProcessor";

export interface StartMatchingJourneysParams {
  workspaceId: string;
  triggerEvent: string;
  contactId: string;
  triggerContextId?: string;
  cartId?: string | null;
  orderId?: string | null;
}

/**
 * Finds all active journeys matching the trigger event and starts a new run
 * for the provided contact and context if an active run does not already exist.
 */
export async function startMatchingJourneys(
  params: StartMatchingJourneysParams,
  dbOverride?: any
): Promise<void> {
  const db = dbOverride || forWorkspace(params.workspaceId);

  let cartId = params.cartId ?? null;
  let orderId = params.orderId ?? null;

  if (params.triggerEvent === "cart_abandoned") {
    if (!cartId && params.triggerContextId) {
      cartId = params.triggerContextId;
    }
    if (cartId) {
      const cart = await db.cart.findUnique({
        where: { id: cartId },
      });
      if (cart && (cart.status === "converted" || cart.convertedAt != null)) {
        console.log(
          `[journey-trigger] Skipping cart_abandoned journey trigger: cart ${cart.id} is already converted.`
        );
        return;
      }
    }
  } else if (params.triggerEvent.startsWith("order_")) {
    if (!orderId && params.triggerContextId) {
      const foundOrder = await db.order.findFirst({
        where: {
          OR: [
            { id: params.triggerContextId },
            { shopifyOrderId: params.triggerContextId },
          ],
        },
        select: { id: true },
      });
      if (foundOrder) {
        orderId = foundOrder.id;
      }
    }
  }

  const matchingJourneys = await db.journey.findMany({
    where: {
      triggerEvent: params.triggerEvent,
      status: "active",
      currentVersionId: { not: null },
    },
  });

  for (const journey of matchingJourneys) {
    if (!journey.currentVersionId) {
      continue;
    }

    try {
      const triggerContextId = params.triggerContextId ?? null;

      // Duplicate Run Prevention:
      // 1. Cart-abandonment journeys: A cart should only ever enter a given cart-abandonment
      //    journey once, regardless of run status (running, waiting, completed, exited, failed).
      //    This prevents customers receiving duplicate messages if subsequent checkout webhooks
      //    arrive after a previous run finishes.
      if (params.triggerEvent === "cart_abandoned" && (cartId || triggerContextId)) {
        const targetCartId = cartId || triggerContextId;
        let existingCartRun = null;
        if (cartId) {
          existingCartRun = await db.journeyRun.findFirst({
            where: {
              journeyId: journey.id,
              workspaceId: params.workspaceId,
              cartId,
            },
          });
        }
        if (!existingCartRun && triggerContextId) {
          existingCartRun = await db.journeyRun.findFirst({
            where: {
              journeyId: journey.id,
              workspaceId: params.workspaceId,
              triggerContextId,
            },
          });
        }

        if (existingCartRun) {
          console.log(
            `[journey-trigger] Skipping duplicate cart run for journey ${journey.id}, cart ${targetCartId}. Run ${existingCartRun.id} already exists with status '${existingCartRun.status}'.`
          );
          continue;
        }
      } else {
        // 2. Non-cart journeys (e.g. order-based triggers): each order has its own triggerContextId,
        //    so check if a non-terminal run already exists for this exact combination.
        const existingRun = await db.journeyRun.findFirst({
          where: {
            journeyId: journey.id,
            contactId: params.contactId,
            triggerContextId,
            status: {
              notIn: ["completed", "exited", "failed"],
            },
          },
        });

        if (existingRun) {
          console.log(
            `[journey-trigger] Skipping duplicate run for journey ${journey.id}, contact ${params.contactId}, triggerContextId ${triggerContextId}. Active run ${existingRun.id} already exists with status '${existingRun.status}'.`
          );
          continue;
        }
      }

      // Create a JourneyRun pinned to the journey's currentVersionId
      let run;
      try {
        run = await db.journeyRun.create({
          data: {
            workspaceId: params.workspaceId,
            journeyId: journey.id,
            journeyVersionId: journey.currentVersionId,
            contactId: params.contactId,
            triggerContextId,
            cartId,
            orderId,
            status: "running",
            currentStepIndex: 0,
          },
        });
      } catch (createErr: any) {
        // P2002: unique constraint violation (journey_runs_active_unique partial index)
        // Another concurrent call already won the race and created the non-terminal run.
        if (createErr?.code === "P2002") {
          console.warn(
            `[journey-trigger] Concurrent race resolved (P2002) for journey ${journey.id}, contact ${params.contactId}, triggerContextId ${triggerContextId}. Another run already started.`
          );
          continue;
        }
        throw createErr;
      }

      // Synchronously process the initial step of the journey
      await processJourneyStep(run.id, params.workspaceId, 0, dbOverride);
    } catch (err) {
      console.error(
        `[journey-trigger] Error starting journey ${journey.id} for contact ${params.contactId}:`,
        err
      );
    }
  }
}
