-- CreateTable
CREATE TABLE "rate_card" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_costs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rate_at_send" DECIMAL(10,4) NOT NULL,
    "billed_amount" DECIMAL(10,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_card_country_category_effective_from_idx" ON "rate_card"("country", "category", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "message_costs_message_id_key" ON "message_costs"("message_id");

-- CreateIndex
CREATE INDEX "message_costs_workspace_id_idx" ON "message_costs"("workspace_id");
