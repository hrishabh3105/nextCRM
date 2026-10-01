-- CreateIndex
-- Partial unique index to ensure at most one active (non-terminal) JourneyRun
-- per journey, contact, and trigger context (e.g. cart).
CREATE UNIQUE INDEX "journey_runs_active_unique"
ON "journey_runs" ("journey_id", "contact_id", "trigger_context_id")
WHERE "status" NOT IN ('completed', 'exited', 'failed');
