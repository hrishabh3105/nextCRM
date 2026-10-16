-- AlterTable
ALTER TABLE "consent_events" ADD COLUMN "occurred_at" TIMESTAMP(3);

-- Backfill existing rows: occurred_at = created_at
UPDATE "consent_events" SET "occurred_at" = "created_at" WHERE "occurred_at" IS NULL;
