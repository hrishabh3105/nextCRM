-- AlterTable: store_connections
ALTER TABLE "store_connections" ADD COLUMN "last_webhook_at" TIMESTAMP(3);

-- CreateTable: journey_step_logs
CREATE TABLE "journey_step_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "journey_run_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_id" TEXT,
    "contact_id" TEXT,
    "step_type" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason_code" TEXT,
    "detail" VARCHAR(500),
    "message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_step_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journey_step_logs_workspace_id_journey_id_created_at_idx" ON "journey_step_logs"("workspace_id", "journey_id", "created_at");
CREATE INDEX "journey_step_logs_workspace_id_journey_run_id_idx" ON "journey_step_logs"("workspace_id", "journey_run_id");

-- AddForeignKey
ALTER TABLE "journey_step_logs" ADD CONSTRAINT "journey_step_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journey_step_logs" ADD CONSTRAINT "journey_step_logs_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journey_step_logs" ADD CONSTRAINT "journey_step_logs_journey_run_id_fkey" FOREIGN KEY ("journey_run_id") REFERENCES "journey_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journey_step_logs" ADD CONSTRAINT "journey_step_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journey_step_logs" ADD CONSTRAINT "journey_step_logs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
