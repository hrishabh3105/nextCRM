-- CreateIndex
CREATE UNIQUE INDEX "journeys_active_trigger_unique"
ON "journeys" ("workspace_id", "trigger_event")
WHERE "status" = 'active';
