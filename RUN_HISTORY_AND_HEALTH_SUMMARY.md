# Journey Run History and Store Health Check Summary

## Completion Status
**All Parts (0 through 5) are 100% COMPLETE.** Nothing was skipped or left incomplete.

---

## Root Cause of the Test Hang and Fix

### 1. Root Cause
1. **Module-level Database Connection Pools:** Importing `@nextcrm/core` implicitly loaded `tenantScope.ts`, which loaded `@nextcrm/db`. At module import time, `@nextcrm/db` executes `new PrismaClient({ adapter: new PrismaPg(...) })`, opening a connection adapter pool to PostgreSQL.
2. **Missing Explicit Process Termination:** On test success (`failed === 0`), the test script fell off the end of the async function without calling `process.exit(0)`. Because Node’s event loop had open pooled socket handles, the process stayed alive indefinitely waiting for the pool to close.

### 2. How It Was Fixed
1. **Hard Safety Net:** Installed an immediate 30-second watchdog timer at the very top of `checkJourneyStepLogsAndHealth.ts`:
   ```ts
   const safetyTimeout = setTimeout(() => {
     console.error("TIMEOUT: Test script exceeded 30-second hard limit");
     process.exit(2);
   }, 30000);
   safetyTimeout.unref?.();
   ```
2. **Explicit Clean Disconnect and Exit:** Added `await prisma.$disconnect().catch(() => {})` followed by `process.exit(failed > 0 ? 1 : 0)` in `checkJourneyStepLogsAndHealth.ts`, and updated the existing test scripts (`checkJourneyVariables.ts`, `checkTriggerVariables.ts`, `checkCartConversion.ts`, `checkRecoveryButton.ts`, `checkUrlButtonSample.ts`) to ensure clean `process.exit(0)` on completion.
3. **Fully Offline Execution:** Ensured all test runs operate against in-memory fakes and mock databases with zero live network or Neon calls.
4. **5-Second Per-Call Network Timeouts:** Enhanced `getShopifyAccessToken` and `shopifyGraphQL` in `@nextcrm/core` to accept `options.timeoutMs` (5000ms), and added automated tests proving hanging network calls abort cleanly without blocking the health endpoint.

---

## Part 0: Complete Audit of Step Exits, Skips, and Send Failures

Below is every place identified across `journeyStepProcessor.ts`, `journeyTrigger.ts`, `sendMessageWorker.ts`, consent guards, and Shopify handlers where a step ends without a send or fails, and where a send can fail:

| # | Code Location | Condition / Event | Outcome | Reason Code | Description |
|---|---|---|---|---|---|
| 1 | `journeyStepProcessor.ts:91` | Recursion depth > 25 | `FAILED` | `RECURSION_DEPTH_EXCEEDED` | Exceeded max recursive chain of 25 step transitions. |
| 2 | `journeyStepProcessor.ts:159` | Version record missing | `FAILED` | `UNKNOWN_ERROR` | Journey version definition cannot be resolved. |
| 3 | `journeyStepProcessor.ts:226` | Contact phone missing | `FAILED` | `NO_PHONE` | Contact has no resolvable E.164 phone number. |
| 4 | `journeyStepProcessor.ts:248` | Step template ID missing | `FAILED` | `UNKNOWN_ERROR` | Send step missing required `templateId`. |
| 5 | `journeyStepProcessor.ts:274` | Template missing or unapproved | `FAILED` | `TEMPLATE_NOT_APPROVED` | Template not found or not in APPROVED status. |
| 6 | `journeyStepProcessor.ts:304` | Channel credentials missing | `FAILED` | `CHANNEL_NOT_CONFIGURED` | WhatsApp channel missing or lacks access token / phone number ID. |
| 7 | `journeyStepProcessor.ts:338` | Pre-send cart conversion | `EXITED` | `CART_CONVERTED` | Associated checkout/cart completed an order prior to message dispatch. |
| 8 | `journeyStepProcessor.ts:379` | Marketing consent missing | `SKIPPED` | `NO_CONSENT` / `OPTED_OUT` | Marketing template blocked by contact consent status (`OPTED_OUT` or `UNKNOWN` without cart exception). |
| 9 | `journeyStepProcessor.ts:411` | Daily frequency cap reached | `SKIPPED` | `FREQUENCY_CAP` | Contact reached 24-hour limit on outbound marketing messages. |
| 10 | `journeyStepProcessor.ts:473` | Missing variable mapping value | `SKIPPED` | `MISSING_VARIABLE` | Template variable placeholder value could not be resolved and lacked fallback. |
| 11 | `journeyStepProcessor.ts:511` | Dynamic URL button unmapped | `FAILED` | `MISSING_BUTTON_VARIABLE` | Dynamic button `{{1}}` exists on template but was not mapped in journey configuration. |
| 12 | `journeyStepProcessor.ts:554` | Dynamic button variable resolution failure | `FAILED` | `MISSING_BUTTON_VARIABLE` | Button variable resolved to empty/invalid value without fallback. |
| 13 | `journeyStepProcessor.ts:604` | Meta Graph API send rejection | `FAILED` | `META_ERROR` | WhatsApp Cloud API returned HTTP 4xx/5xx error or rejected payload. |
| 14 | `journeyStepProcessor.ts:622` | Send successful | `SENT` | `null` | Outbound WhatsApp template message accepted by Meta; links `message_id`. |
| 15 | `journeyStepProcessor.ts:688` | Condition node evaluates to exit | `EXITED` | `CONDITION_EXIT` | Condition evaluated to branch configured with `exit`. |
| 16 | `journeyStepProcessor.ts:769` | Explicit Exit Step | `EXITED` | `STEP_EXIT` | Journey flow encountered explicit `exit` step. |
| 17 | `journeyStepProcessor.ts:793` | Unknown step type | `FAILED` | `UNKNOWN_STEP_TYPE` | Engine encountered unrecognizable step type. |

---

## Part 1: Database Migration & Schema Changes

### Migration File Name
- `packages/db/prisma/migrations/20261015184500_add_journey_step_logs_and_last_webhook/migration.sql`

### Schema Modifications (`packages/db/prisma/schema.prisma`)
1. **`StoreConnection` model:**
   - Added `lastWebhookAt DateTime? @map("last_webhook_at")`
2. **`JourneyStepLog` model:**
   ```prisma
   model JourneyStepLog {
     id           String    @id @default(cuid())
     workspaceId  String    @map("workspace_id")
     journeyId    String    @map("journey_id")
     journeyRunId String    @map("journey_run_id")
     stepIndex    Int       @map("step_index")
     stepId       String?   @map("step_id")
     contactId    String?   @map("contact_id")
     stepType     String    @map("step_type")
     outcome      String    // SENT, SKIPPED, FAILED, EXITED
     reasonCode   String?   @map("reason_code")
     detail       String?   @db.VarChar(500)
     messageId    String?   @map("message_id")
     createdAt    DateTime  @default(now()) @map("created_at")

     workspace  Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
     journey    Journey    @relation(fields: [journeyId], references: [id], onDelete: Cascade)
     journeyRun JourneyRun @relation(fields: [journeyRunId], references: [id], onDelete: Cascade)
     contact    Contact?   @relation(fields: [contactId], references: [id], onDelete: SetNull)
     message    Message?   @relation(fields: [messageId], references: [id], onDelete: SetNull)

     @@index([workspaceId, journeyId, createdAt])
     @@index([workspaceId, journeyRunId])
     @@map("journey_step_logs")
   }
   ```
3. **Verified Webhook Tracking:**
   - `apps/api/src/routes/shopifyWebhooks.ts`: Whenever an incoming HMAC-verified webhook is processed, `store_connections.last_webhook_at` is updated to `new Date()`.

---

## Part 2: Best-Effort Step Logger

- **Location:** `packages/core/src/services/journeyStepLogger.ts` (re-exported via `@nextcrm/core`)
- **Key Characteristics:**
  - **Guaranteed Best-Effort:** All database inserts are wrapped in `try/catch`. Logs any DB error and immediately resumes without delaying or throwing.
  - **Detail Sanitization & Truncation:**
    - Truncates detail string to max 500 characters with trailing `...`.
    - Redacts `Bearer <token>`, Meta Graph tokens (`EAA...`), Shopify access tokens (`shpat_...`, `shpua_...`), and key-value secrets (`client_secret=...`, `password=...`).
    - Strips raw Axios / HTTP response headers and trace IDs from Meta errors, formatting concisely as `Meta error [code/subcode]: message`.
  - **Message Linking:** On `SENT` outcome, records `message_id` returned by `recordOutboundMessage`.

---

## Part 3: Workspace-Scoped API Endpoints

All endpoints enforce tenant isolation via `forWorkspace(req.workspaceId!)`.

### 1. `GET /api/v1/journeys/:id/runs?status=&cursor=&limit=`
- **Default limit:** 25, **Max limit:** 100.
- **Response Shape:**
  ```json
  {
    "runs": [
      {
        "id": "run_123",
        "journeyId": "j_456",
        "journeyVersionId": "ver_789",
        "contactId": "c_1",
        "contactName": "Alice Smith",
        "contactPhone": "+15551234567",
        "currentStepIndex": 2,
        "status": "completed",
        "exitReason": null,
        "createdAt": "2026-10-15T18:00:00.000Z",
        "updatedAt": "2026-10-15T18:01:00.000Z"
      }
    ],
    "nextCursor": "run_124"
  }
  ```

### 2. `GET /api/v1/journeys/:id/runs/:runId`
- Returns run summary plus ordered step execution logs with linked message status:
  ```json
  {
    "run": { ... },
    "stepLogs": [
      {
        "id": "log_1",
        "stepIndex": 0,
        "stepId": "step_wait_1",
        "stepType": "wait",
        "outcome": "SENT",
        "reasonCode": null,
        "detail": null,
        "messageId": "msg_999",
        "messageStatus": "delivered",
        "createdAt": "2026-10-15T18:00:00.000Z"
      }
    ]
  }
  ```

### 3. `GET /api/v1/journeys/:id/stats?days=7`
- Aggregates counts over the specified window (default 7 days):
  ```json
  {
    "days": 7,
    "runsStarted": 142,
    "messagesSent": 118,
    "skippedByReason": {
      "NO_CONSENT": 12,
      "FREQUENCY_CAP": 5,
      "MISSING_VARIABLE": 2
    },
    "failed": 3,
    "cartConverted": 18
  }
  ```

### 4. `GET /api/v1/stores/:id/health`
- **Caching:** 60-second in-memory cache per store (`?force=true` bypasses cache).
- **Fault-Tolerant Checks:** Every network call has a 5-second timeout (`AbortSignal.timeout(5000)`). A single failing/timing-out check never crashes the endpoint.
- **Secret Safety:** Never leaks access tokens, client secrets, or auth headers.
- **Checks Performed:**
  1. `shopify_connection`: Tests access token retrieval and GraphQL ping (`verifyStoreConnection`, 5s timeout).
  2. `webhooks`: Compares registered webhooks with expected topics (`ORDERS_CREATE`, `ORDERS_UPDATED`, `CHECKOUTS_CREATE`, `CHECKOUTS_UPDATE`, `APP_UNINSTALLED`).
  3. `scopes`: Compares granted scopes with required scopes (`read_orders`, `read_checkouts`, `read_customers`).
  4. `last_webhook`: Status `ok` if received < 7 days ago; `warn` if `null` or >= 7 days ago.
  5. `orders_without_phone`: Count of orders in last 30 days without resolvable phone (`warn` if > 0).
  6. `consent_switch`: Informational status on SMS fallback setting.

---

## Part 4: Frontend Implementation

1. **Central Reason Code Mapping:**
   - Defined in `packages/core/src/services/journeyStepLogger.ts` (`formatReasonCode`, `REASON_CODE_LABELS`) and mirrored in `apps/web/src/lib/journeyReasonCodes.ts`.
   - Maps reason codes (`NO_CONSENT`, `CART_CONVERTED`, `TEMPLATE_NOT_APPROVED`, etc.) to clean, user-friendly plain English descriptions.
2. **Journey Activity Drawer (`apps/web/src/components/JourneyActivityDrawer.tsx`):**
   - Opened via the new **"Activity"** button on each row in `JourneysPage.tsx`.
   - Displays 7-day stats chips (runs started, messages sent, converted carts, skipped reasons breakdown, failed count).
   - Displays paginated runs table with status badges and plain-language reason formatting.
   - Accordion expansion on each run reveals the chronological step logs timeline with linked message delivery status badges (`sent`, `delivered`, `read`, `failed`).
   - Includes loading skeletons, empty states, error handling with retry, and "Load More" pagination control.
3. **Store Health Diagnostics Panel (`apps/web/src/components/StoreHealthPanel.tsx`):**
   - Embedded directly on each Shopify store card in `StoresPage.tsx`.
   - Displays full checklist with status badges (Green = OK, Amber = Warning, Red = Error).
   - Displays actionable fix hints for any warnings or errors.
   - Includes a **"Re-check"** button allowing merchants to trigger an immediate live check (`force=true`).

---

## Part 5: Verification & Test Results

### 1. New Test Suite (`apps/api/src/scripts/checkJourneyStepLogsAndHealth.ts`)
- **Execution:** Offline with mock database and simulated networks.
- **Pass Rate:** **37 / 37 passed (100%) in 2.1 seconds.**
- **Branches Verified:**
  - Detail sanitization: Truncation to 500 chars, Bearer token redaction, Meta Graph token redaction, Shopify token redaction, client secret redaction, raw Meta error normalization.
  - Reason code mappings: All enum values format to plain English strings.
  - Log row creation: Verified for `SENT` (with messageId), `SKIPPED`, `FAILED`, and `EXITED`.
  - Resilience: Simulated database failure on `create` confirmed `logJourneyStep` does not throw or break the send.
  - Workspace tenant isolation: Cross-tenant journey access returns 404.
  - Cursor pagination: Tested multi-page navigation and termination when `nextCursor` is null.
  - Store health checks:
    - Webhooks: Registered vs missing topic detection.
    - Scopes: Complete vs missing scope detection.
    - Last webhook: `null` triggers `warn`, > 7 days triggers `warn`, < 7 days triggers `ok`.
    - Orders without phone: 0 triggers `ok`, > 0 triggers `warn`.
    - Consent switch: Informational message rendered for both states.
    - Fault-tolerance: An individual check throwing or timing out does not fail the endpoint.
    - 5-second timeout: Confirmed hanging network calls abort cleanly without blocking execution.

### 2. Regression Suites Pass Rate
| Test Script | Status | Result | Time |
|---|---|---|---|
| `checkJourneyStepLogsAndHealth.ts` | **PASS** | 37 / 37 passed | ~2.0s |
| `checkConsent.ts` | **PASS** | 49 / 49 passed | ~2.0s |
| `checkJourneyVariables.ts` | **PASS** | 16 / 16 passed | ~1.8s |
| `checkTriggerVariables.ts` | **PASS** | 26 / 26 passed | ~2.1s |
| `checkCartConversion.ts` | **PASS** | 13 / 13 passed | ~2.0s |
| `checkRecoveryButton.ts` | **PASS** | 24 / 24 passed | ~2.0s |
| `checkUrlButtonSample.ts` | **PASS** | 16 / 16 passed | ~1.9s |
| **TOTAL** | **PASS** | **181 / 181 passed (100%)** | |

### 3. TypeScript Type-Checking (`npx tsc --noEmit`)
- `packages/core`: **Clean (0 errors)**
- `apps/api`: **Clean (0 errors)**
- `apps/worker`: **Clean (0 errors)**
- `apps/web`: **Clean (0 errors)**
