import "dotenv/config";
import { Worker, Job, Queue } from "bullmq";
import { JOURNEY_TICK_QUEUE, redisConnection } from "@nextcrm/core";
import { processJourneyStep } from "../services/journeyStepProcessor";

export interface JourneyTickJobData {
  runId: string;
  workspaceId: string;
}

/**
 * BullMQ Queue for JOURNEY_TICK_QUEUE.
 * Used to schedule delayed tick jobs for journey 'wait' steps.
 */
export const journeyTickQueue = new Queue<JourneyTickJobData>(JOURNEY_TICK_QUEUE, {
  connection: redisConnection,
});

/**
 * BullMQ Worker for JOURNEY_TICK_QUEUE.
 * Resumes execution of a waiting JourneyRun when a delayed tick fires.
 */
export const journeyTickWorker = new Worker<JourneyTickJobData>(
  JOURNEY_TICK_QUEUE,
  async (job: Job<JourneyTickJobData>) => {
    const { runId, workspaceId } = job.data;
    console.log(`[journey-tick] Processing tick for run ${runId} in workspace ${workspaceId}`);
    await processJourneyStep(runId, workspaceId);
  },
  {
    connection: redisConnection,
  }
);

journeyTickWorker.on("error", (err) => {
  console.error("[journey-tick] worker error:", err);
});
