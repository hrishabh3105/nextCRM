-- AlterTable
ALTER TABLE "store_connections" ADD COLUMN     "api_secret_enc" TEXT;

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "shopify_order_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total_price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "shopify_cart_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "total_price" DECIMAL(10,2) NOT NULL,
    "last_activity_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_workspace_id_idx" ON "orders"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_workspace_id_shopify_order_id_key" ON "orders"("workspace_id", "shopify_order_id");

-- CreateIndex
CREATE INDEX "carts_workspace_id_idx" ON "carts"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_workspace_id_shopify_cart_id_key" ON "carts"("workspace_id", "shopify_cart_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
