-- CreateTable
CREATE TABLE "store_connections" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_connections_shop_domain_key" ON "store_connections"("shop_domain");

-- CreateIndex
CREATE INDEX "store_connections_workspace_id_idx" ON "store_connections"("workspace_id");

-- AddForeignKey
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
