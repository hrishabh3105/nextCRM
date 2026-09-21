-- CreateTable
CREATE TABLE "journeys" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger_event" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "current_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_versions" (
    "id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "journey_version_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "trigger_context_id" TEXT,
    "current_step_index" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "next_step_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journey_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journeys_workspace_id_idx" ON "journeys"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "journey_versions_journey_id_version_number_key" ON "journey_versions"("journey_id", "version_number");

-- CreateIndex
CREATE INDEX "journey_runs_workspace_id_idx" ON "journey_runs"("workspace_id");

-- CreateIndex
CREATE INDEX "journey_runs_status_next_step_at_idx" ON "journey_runs"("status", "next_step_at");

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_versions" ADD CONSTRAINT "journey_versions_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_journey_version_id_fkey" FOREIGN KEY ("journey_version_id") REFERENCES "journey_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
