-- AlterTable: carts
ALTER TABLE "carts" ADD COLUMN "currency" TEXT DEFAULT 'USD',
ADD COLUMN "recovery_url" TEXT,
ADD COLUMN "line_items" JSONB;

-- AlterTable: orders
ALTER TABLE "orders" ADD COLUMN "order_number" TEXT,
ADD COLUMN "line_items" JSONB;

-- AlterTable: journey_runs
ALTER TABLE "journey_runs" ADD COLUMN "cart_id" TEXT,
ADD COLUMN "order_id" TEXT;

-- CreateIndex
CREATE INDEX "journey_runs_workspace_id_cart_id_idx" ON "journey_runs"("workspace_id", "cart_id");
CREATE INDEX "journey_runs_workspace_id_order_id_idx" ON "journey_runs"("workspace_id", "order_id");

-- AddForeignKey
ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
