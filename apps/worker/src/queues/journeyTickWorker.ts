import "dotenv/config";
import { Worker, Job } from "bullmq";
import {
  JOURNEY_TICK_QUEUE,
  redisConnection,
  journeyTickQueue,
  JourneyTickJobData,
  processJourneyStep,
} from "@nextcrm/core";

export { journeyTickQueue, JourneyTickJobData };

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
