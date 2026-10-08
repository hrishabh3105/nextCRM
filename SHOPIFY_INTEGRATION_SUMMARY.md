# Shopify Client Credentials Migration & Integration Summary

## 1. Overview of Changes

NextCRM's Shopify integration has been transitioned from the legacy admin-created custom app model (which relied on pasted Admin API tokens and per-store secrets) to the modern Shopify Dev Dashboard custom distribution model using **Client Credentials Grant** for development stores.

### Key Architecture Improvements
- **Client Credentials Grant**: Automatically exchanges `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` for 24-hour Admin API access tokens on stores within the same Shopify organization (`POST https://{shop}/admin/oauth/access_token`).
- **In-Memory Caching & Single-Flight**: Tokens are cached in-memory and proactively refreshed 5 minutes before expiration. Concurrent calls to the same shop domain share a single in-flight promise to avoid duplicate auth requests.
- **GraphQL Admin API**: Replaced legacy REST calls with Shopify GraphQL Admin API (`/admin/api/{SHOPIFY_API_VERSION}/graphql.json`). Handled automatic cache clearing and retry on HTTP 401.
- **Automated Webhook Registration**: Webhook subscriptions (`ORDERS_CREATE`, `ORDERS_UPDATED`, `CHECKOUTS_CREATE`, `CHECKOUTS_UPDATE`, `APP_UNINSTALLED`) are registered via GraphQL mutation `webhookSubscriptionCreate` with format `JSON`. Handled idempotency when webhooks are already registered.
- **Global HMAC Verification**: Webhooks are verified using the organization-level `SHOPIFY_CLIENT_SECRET` before store resolution, rejecting old app signatures with HTTP 401. Handled `app/uninstalled` topic to transition store status to `disconnected`.
- **Purchase-Accurate Phone Selection**: Normalized phone extraction from order/checkout payloads now prioritizes details typed during the specific purchase over saved customer account numbers.

---

## 2. Phone Selection Report (Step 6)

### Previous Phone Selection Order & Analysis
In the original implementation of `resolveOrCreateContact` (`apps/api/src/services/shopifyWebhookHandler.ts`), the extraction order was:
1. `payload.customer?.phone`
2. `payload.phone`
3. `payload.billing_address?.phone`
4. `payload.shipping_address?.phone`

**Which one won:**
Because evaluated via short-circuiting `||`, **`payload.customer?.phone` won whenever present**. If a customer previously created an account or saved an old phone number, that stale number overwrote the active number they typed into shipping/billing for their latest order.

### New Priority Order (`extractPhoneCandidates`)
Details explicitly entered for the current purchase must supersede saved account details:
1. `payload.shipping_address?.phone` (highest priority: typed explicitly for delivery)
2. `payload.billing_address?.phone`
3. `payload.phone`
4. `payload.customer?.phone`
5. `payload.customer?.default_address?.phone`

`resolveOrCreateContact` iterates through candidates in order and selects the first candidate that successfully normalizes to a valid E.164 phone (`isValidE164`). If none normalize, it safely returns `null`.

### Verification Test Results (`checkPhoneOrder.ts`)
```
=== Running Phone Order Verification Tests ===

[PASS] Case 1: shipping +919999999993, billing same, customer.phone null, default_address +919131782360
  Candidates: actual=["+919999999993","+919999999993","+919131782360"] expected=["+919999999993","+919999999993","+919131782360"]
  Resolved:   actual=+919999999993 expected=+919999999993

[PASS] Case 2: only default_address +919131782360
  Candidates: actual=["+919131782360"] expected=["+919131782360"]
  Resolved:   actual=+919131782360 expected=+919131782360

[PASS] Case 3: nothing (empty payload)
  Candidates: actual=[] expected=[]
  Resolved:   actual=null expected=null

[PASS] Case 4: shipping phone is invalid, billing is valid
  Candidates: actual=["invalid_not_a_phone","+919876543210"] expected=["invalid_not_a_phone","+919876543210"]
  Resolved:   actual=+919876543210 expected=+919876543210

[PASS] Case 5: order top-level phone beats saved customer account phone
  Candidates: actual=["+918888888888","+917777777777"] expected=["+918888888888","+917777777777"]
  Resolved:   actual=+918888888888 expected=+918888888888

All 5 cases passed successfully!
```

---

## 3. Database Migration Output

- **Migration**: `20261006181739_shopify_client_credentials`
- **Path**: `packages/db/prisma/migrations/20261006181739_shopify_client_credentials/migration.sql`

### Migration SQL
```sql
-- AlterTable
ALTER TABLE "store_connections" ADD COLUMN     "auth_mode" TEXT NOT NULL DEFAULT 'client_credentials',
ADD COLUMN     "granted_scopes" TEXT,
ALTER COLUMN "access_token_enc" DROP NOT NULL;
```

### CLI Output
```
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.
Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-shiny-lake-azi693bp.c-3.ap-southeast-1.aws.neon.tech"

Applying migration `20261006181739_shopify_client_credentials`

The following migration(s) have been applied:

migrations/
  └─ 20261006181739_shopify_client_credentials/
    └─ migration.sql

All migrations have been successfully applied.
✔ Generated Prisma Client (v7.10.0) to .\..\..\node_modules\@prisma\client in 382ms
```

---

## 4. All New & Changed Files

| File | Status | Description |
| --- | --- | --- |
| `packages/db/prisma/schema.prisma` | Modified | Made `accessTokenEnc` nullable (`String?`), added `authMode` (`default("client_credentials")`), added `grantedScopes` (`String?`), commented `apiSecretEnc` as legacy. |
| `packages/db/prisma/migrations/20261006181739_shopify_client_credentials/migration.sql` | New | Migration script applying the schema alteration to `store_connections`. |
| `packages/core/src/services/shopifyClient.ts` | Modified | Rewritten to support `isValidShopDomain`, `getShopifyAccessToken` (client credentials grant with in-memory caching and single-flight), `shopifyGraphQL` (with 401 retry), `verifyStoreConnection` (GraphQL `{ shop { name } }`), and `registerWebhooks` (`webhookSubscriptionCreate`). Preserved `verifyShopifyWebhook`. |
| `apps/api/src/config/env.ts` | Modified | Added required `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, and `SHOPIFY_API_VERSION` (default `2026-07`). |
| `apps/api/.env.example` | Modified | Added documentation for `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, and `SHOPIFY_API_VERSION`. |
| `apps/api/.env` | Modified | Configured environment variables with development values. |
| `apps/api/src/validation/storeConnectionSchema.ts` | Modified | Simplified `createStoreConnectionSchema` to only `{ shopDomain }` validated with `isValidShopDomain`. `reconnectStoreConnectionSchema` no longer requires body credentials. |
| `apps/api/src/routes/stores.ts` | Modified | `POST /` uses client credentials token check, connection verification, creates `StoreConnection` (`authMode: "client_credentials"`, `grantedScopes`), registers webhooks, returns safe store + `webhooks` array. Added DEV-ONLY comment. `PATCH /:id/reconnect` re-verifies and registers webhooks without body parameters. |
| `apps/api/src/routes/shopifyWebhooks.ts` | Modified | Verifies HMAC first with `env.SHOPIFY_CLIENT_SECRET` (returns 401 if invalid). Unscoped lookup by `X-Shopify-Shop-Domain`. Added `app/uninstalled` topic handler to set status `disconnected` and clear `accessTokenEnc`. |
| `apps/api/src/services/shopifyWebhookHandler.ts` | Modified | Exported `extractPhoneCandidates` and `resolveNormalizedPhone`. Updated `resolveOrCreateContact` to prioritize purchase details over stale account numbers. |

---

## 5. Typecheck Validation

Both `packages/core` and `apps/api` pass TypeScript verification cleanly:

```bash
cd packages/core && npx tsc --noEmit   # Exit code 0
cd apps/api && npx tsc --noEmit        # Exit code 0
```
