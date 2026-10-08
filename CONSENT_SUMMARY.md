# Marketing Consent Implementation Summary

## 1. Migration Name and SQL
**Migration Name:** `20261006210355_marketing_consent`  
**Migration Path:** `packages/db/prisma/migrations/20261006210355_marketing_consent/migration.sql`

```sql
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

-- Backfill marketing consent for existing contacts
UPDATE "contacts"
SET "marketing_consent_status" = 'OPTED_IN',
    "marketing_consent_source" = 'LEGACY',
    "marketing_consent_at" = COALESCE("opted_in_at", "created_at")
WHERE "opted_in_at" IS NOT NULL;
```

---

## 2. What Was Mapped in the Backfill
- In the PostgreSQL database, contacts previously only had `opted_in_at` (a timestamp column); there was no existing separate boolean column or explicit "opted_out" column.
- Contacts with `opted_in_at IS NOT NULL` were mapped to:
  - `marketing_consent_status = 'OPTED_IN'`
  - `marketing_consent_source = 'LEGACY'`
  - `marketing_consent_at = COALESCE(opted_in_at, created_at)`
- Contacts with `opted_in_at IS NULL` default to `marketing_consent_status = 'UNKNOWN'`.

---

## 3. Old-Column Decision
- **Decision:** Kept `optedInAt DateTime? @map("opted_in_at")` in `schema.prisma` and marked it `@deprecated` with a comment:
  `// @deprecated Use marketingConsentStatus, marketingConsentAt, marketingOptedOutAt instead`
- Stopped writing to `optedInAt` across all backend code (Shopify webhook handler, inbound webhook handler, contact API endpoints, CSV import, and template test send).
- **Rationale:** Prevents breaking any external consumers or existing frontend views while completely shifting all active writes and reads in the backend to the new marketing consent fields and `setMarketingConsent` service.

---

## 4. Shopify Payload Fields Found (Orders vs Checkouts)
- **Orders (`orders/create`, `orders/updated`)**:
  - `payload.customer.sms_marketing_consent.state`: Values `"subscribed"`, `"not_subscribed"`, `"pending"`, `"unsubscribed"`, `"redacted"`.
  - `payload.customer.sms_marketing_consent.opt_in_level`
  - `payload.customer.sms_marketing_consent.consent_updated_at`
  - `payload.customer.sms_marketing_consent.consent_collected_from`
  - Consent phone candidates: `payload.customer.sms_marketing_phone` and `payload.customer.sms_marketing_consent.phone`.
  - *Explicitly ignored email fields*: `accepts_marketing` and `buyer_accepts_marketing`.
- **Checkouts (`checkouts/create`, `checkouts/update`)**:
  - `payload.buyer_accepts_sms_marketing`: Boolean (`true` -> `"subscribed"`, `false` -> `"not_subscribed"`).
  - `payload.customer.sms_marketing_consent.state`: Used if present.
  - Consent phone candidates: `payload.sms_marketing_phone`, `payload.customer.sms_marketing_phone`, and `payload.customer.sms_marketing_consent.phone`.

---

## 5. Changed Files (One Line Each)
- [`packages/db/prisma/schema.prisma`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/packages/db/prisma/schema.prisma): Added `ConsentStatus` enum, `ConsentEvent` model, consent fields on `Contact` and `StoreConnection`, and deprecated `optedInAt`.
- [`packages/db/prisma/migrations/20261006210355_marketing_consent/migration.sql`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/packages/db/prisma/migrations/20261006210355_marketing_consent/migration.sql): Generated migration with DDL and SQL backfill mapping legacy `opted_in_at` contacts to `OPTED_IN`.
- [`packages/core/src/services/consentService.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/packages/core/src/services/consentService.ts): Created unified `setMarketingConsent` write path, `evaluateSendPermission`, and keyword normalization utilities.
- [`packages/core/src/index.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/packages/core/src/index.ts): Exported consent service types and functions from `@nextcrm/core`.
- [`packages/core/src/services/journeyStepProcessor.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/packages/core/src/services/journeyStepProcessor.ts): Added send-time consent permission guard on `send_message` journey step (exempting `cart_abandoned` unless opted out).
- [`apps/api/src/services/shopifyWebhookHandler.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/services/shopifyWebhookHandler.ts): Removed auto-opt-in placeholder and added `processShopifyConsent` handling SMS marketing consent, store setting check, and phone match safety.
- [`apps/api/src/routes/shopifyWebhooks.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/routes/shopifyWebhooks.ts): Passed store connection into order and checkout handlers for consent settings resolution.
- [`apps/api/src/validation/storeConnectionSchema.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/validation/storeConnectionSchema.ts): Added zod validation schema `updateStoreConsentSettingsSchema`.
- [`apps/api/src/routes/stores.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/routes/stores.ts): Added `PATCH /:id/consent-settings` endpoint with attestation check and included safe consent settings in store responses.
- [`apps/api/src/services/inboundMessageHandler.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/services/inboundMessageHandler.ts): Replaced inbound auto-opt-in with `UNKNOWN` default, implemented STOP/START consent handling and confirmation free-form message sending.
- [`apps/api/src/validation/contactSchema.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/validation/contactSchema.ts): Added `consentAttested` boolean to create and update contact schemas.
- [`apps/api/src/routes/contacts.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/routes/contacts.ts): Updated manual contact creation, patch, and CSV import to route through `setMarketingConsent` with `UNKNOWN` default.
- [`apps/api/src/routes/templates.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/routes/templates.ts): Updated test-send contact creation to set marketing consent fields (`OPTED_IN`, source `MANUAL`).
- [`apps/api/src/routes/campaigns.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/routes/campaigns.ts): Added `POST /audience-count` endpoint returning `{ totalMatching, eligible, skippedNoConsent, skippedOptedOut }`.
- [`apps/worker/src/queues/campaignDispatchWorker.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/worker/src/queues/campaignDispatchWorker.ts): Removed `optedInAt` query filter, added audience evaluation with `evaluateSendPermission`, and logged consent skip counts.
- [`apps/worker/src/queues/sendMessageWorker.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/worker/src/queues/sendMessageWorker.ts): Added pre-send consent guard marking recipient as `skipped_opted_out` or `skipped_no_consent` before calling Meta or checking frequency caps.
- [`apps/api/src/scripts/checkConsent.ts`](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/scripts/checkConsent.ts): Added verification script covering pure-function cases, store settings, precedence rules, phone mismatch, and send permissions.

---

## 6. Verification Test Script Output
Executed via: `npx tsx apps/api/src/scripts/checkConsent.ts`

```text
=== Running Marketing Consent Verification Tests ===

[PASS] Shopify order subscribed + setting true -> OPTED_IN
[PASS] Shopify order subscribed + setting false -> no change
[PASS] not_subscribed on an OPTED_IN contact -> stays OPTED_IN
[PASS] unsubscribed -> OPTED_OUT even with setting false
[PASS] Shopify subscribed after OPTED_OUT -> stays OPTED_OUT
[shopify-consent] Phone mismatch: consent phone +15559998888 does not match contact phone +15551234567. Skipping consent change.
[PASS] consent phone differs from resolved phone -> no grant
[PASS] evaluateSendPermission: MARKETING + campaign + UNKNOWN blocked
[PASS] evaluateSendPermission: MARKETING + campaign + OPTED_IN allowed
[PASS] evaluateSendPermission: MARKETING + abandoned_cart + UNKNOWN allowed
[PASS] evaluateSendPermission: MARKETING + abandoned_cart + OPTED_OUT blocked
[PASS] evaluateSendPermission: UTILITY + OPTED_OUT allowed
[PASS] evaluateSendPermission: AUTHENTICATION + OPTED_OUT allowed
[PASS] isStopKeyword("Stop.") is true
[PASS] isStopKeyword(" STOP ") is true
[PASS] isStopKeyword("unsubscribe") is true
[PASS] isStopKeyword("stop please") is false
[PASS] isStopKeyword("opt out") is true
[PASS] isStopKeyword("optout") is true
[PASS] isStopKeyword("opt-out") is true
[PASS] isStartKeyword("start") is true
[PASS] isStartKeyword(" START! ") is true
[PASS] isStartKeyword("subscribe") is true
[PASS] isStartKeyword("opt in") is true
[PASS] isStartKeyword("optin") is true
[PASS] isStartKeyword("opt-in") is true
[PASS] isStartKeyword("yes") is false (not included)
[PASS] isStartKeyword("start now please") is false
[PASS] repeated identical setMarketingConsent call creates no second ConsentEvent

=== Verification Complete: 28 passed, 0 failed ===
```

### TypeScript Validation Results
- `packages/core`: `npx tsc --noEmit` -> Clean (exit code 0)
- `apps/api`: `npx tsc --noEmit` -> Clean (exit code 0)
- `apps/worker`: `npx tsc --noEmit` -> Clean (exit code 0)
- `packages/db`: No `tsconfig.json` present

---

## 7. Deviations & Notes
- **Neon Postgres Cold Start**: Inactive Neon endpoints go to sleep. A 2-second TCP connection script was executed to wake the compute endpoint prior to running `prisma migrate deploy`.
- **Pre-existing DB Fields**: In the pre-existing schema, contacts only possessed `opted_in_at` (no separate boolean `opted_in` column existed in Postgres). The backfill SQL appropriately conditioned on `"opted_in_at" IS NOT NULL`.
- **Confirmation Message Handling**: Free-form confirmation messages for STOP and START are sent via `sendFreeformMessage` inside the 24-hour window and wrapped in try/catch blocks to ensure that in test or offline modes with mock Meta credentials, incoming webhook processing remains non-blocking and robust.
