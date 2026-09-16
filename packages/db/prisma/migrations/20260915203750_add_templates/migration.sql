-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "provider_template_id" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en_US',
    "category" TEXT NOT NULL,
    "body_preview" TEXT NOT NULL,
    "variable_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "templates_workspace_id_idx" ON "templates"("workspace_id");

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
