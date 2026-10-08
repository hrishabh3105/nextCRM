-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('OPTED_IN', 'OPTED_OUT', 'UNKNOWN');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "marketing_consent_at" TIMESTAMP(3),
ADD COLUMN     "marketing_consent_source" TEXT,
ADD COLUMN     "marketing_consent_status" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "marketing_opted_out_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "store_connections" ADD COLUMN     "consent_attested_at" TIMESTAMP(3),
ADD COLUMN     "consent_attested_by_user_id" TEXT,
ADD COLUMN     "treat_shopify_sms_as_whatsapp_consent" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "consent_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "previous_status" "ConsentStatus",
    "source" TEXT NOT NULL,
    "evidence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_events_workspace_id_contact_id_created_at_idx" ON "consent_events"("workspace_id", "contact_id", "created_at");

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill existing contacts
-- Contacts with opted_in_at IS NOT NULL -> OPTED_IN, source 'LEGACY', consentAt = COALESCE(opted_in_at, created_at)
-- Contacts with opted_in_at IS NULL retain default 'UNKNOWN'
UPDATE "contacts"
SET "marketing_consent_status" = 'OPTED_IN',
    "marketing_consent_source" = 'LEGACY',
    "marketing_consent_at" = COALESCE("opted_in_at", "created_at")
WHERE "opted_in_at" IS NOT NULL;
