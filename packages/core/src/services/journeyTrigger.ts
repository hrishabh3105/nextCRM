import { forWorkspace } from "../tenantScope";
import { processJourneyStep } from "./journeyStepProcessor";

export interface StartMatchingJourneysParams {
  workspaceId: string;
  triggerEvent: string;
  contactId: string;
  triggerContextId?: string;
}

/**
 * Finds all active journeys matching the trigger event and starts a new run
 * for the provided contact and context if an active run does not already exist.
 */
export async function startMatchingJourneys(params: {
  workspaceId: string;
  triggerEvent: string;
  contactId: string;
  triggerContextId?: string;
}): Promise<void> {
  const db = forWorkspace(params.workspaceId);

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

      // CRITICAL: check if a JourneyRun already exists for this exact
      // (journeyId, contactId, triggerContextId) combination that is NOT in a
      // terminal status (not completed/exited/failed). If one exists, skip creating
      // a duplicate to prevent repeatedly starting the journey (e.g. on multiple checkouts/update events).
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
      await processJourneyStep(run.id, params.workspaceId);
    } catch (err) {
      console.error(
        `[journey-trigger] Error starting journey ${journey.id} for contact ${params.contactId}:`,
        err
      );
    }
  }
}
