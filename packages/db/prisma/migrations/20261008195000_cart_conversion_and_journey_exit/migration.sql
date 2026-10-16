-- AlterTable: carts
ALTER TABLE "carts" ADD COLUMN "checkout_token" TEXT,
ADD COLUMN "cart_token" TEXT,
ADD COLUMN "converted_at" TIMESTAMP(3),
ADD COLUMN "order_id" TEXT;

-- AlterTable: orders
ALTER TABLE "orders" ADD COLUMN "checkout_token" TEXT,
ADD COLUMN "cart_token" TEXT;

-- AlterTable: journey_runs
ALTER TABLE "journey_runs" ADD COLUMN "exit_reason" TEXT;

-- Backfill carts: checkout_token = shopify_cart_id for existing rows
UPDATE "carts" SET "checkout_token" = "shopify_cart_id" WHERE "checkout_token" IS NULL;

-- CreateIndex
CREATE INDEX "carts_workspace_id_checkout_token_idx" ON "carts"("workspace_id", "checkout_token");
CREATE INDEX "carts_workspace_id_cart_token_idx" ON "carts"("workspace_id", "cart_token");
CREATE INDEX "orders_workspace_id_checkout_token_idx" ON "orders"("workspace_id", "checkout_token");
CREATE INDEX "orders_workspace_id_cart_token_idx" ON "orders"("workspace_id", "cart_token");
