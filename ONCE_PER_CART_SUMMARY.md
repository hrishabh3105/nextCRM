# Once-Per-Cart Journey Run Execution Summary

## Problem Overview
In `packages/core/src/services/journeyTrigger.ts` (`startMatchingJourneys`), the existing duplicate guard only checked for active (non-terminal) runs. As soon as an initial abandoned-cart journey run completed (status: `completed`), exited (`exited`), or failed (`failed`), any subsequent Shopify `checkouts/update` or `checkouts/create` webhook for the same cart started a brand new run. Consequently, customers received duplicate abandoned-cart recovery messages for the same cart.

---

## Investigation: Current Guard and P2002 Race Handling

### 1. The Unique Index: `journey_runs_active_unique`
The database has a partial unique index created in migration `20260926181500_add_journey_runs_active_unique_index/migration.sql`:
```sql
CREATE UNIQUE INDEX "journey_runs_active_unique"
ON "journey_runs" ("journey_id", "contact_id", "trigger_context_id")
WHERE "status" NOT IN ('completed', 'exited', 'failed');
```

### 2. How the Prior Guard Operated and Why Duplicates Occurred
- **Application Pre-Check:** Before creating a run, `startMatchingJourneys` ran:
  ```ts
  const existingRun = await db.journeyRun.findFirst({
    where: {
      journeyId: journey.id,
      contactId: params.contactId,
      triggerContextId,
      status: {
        notIn: ["completed", "exited", "failed"],
      },
    },
  });
  ```
- **The Gap:** Once a run reached `'completed'` (or `'exited'` / `'failed'`), it fell out of the partial index `WHERE "status" NOT IN (...)` and was ignored by the `findFirst` query.
- **Result:** When Shopify sent a late `checkouts/update` webhook for the same cart, `existingRun` was `null`, and the partial index allowed the insert. A duplicate run was inserted and immediately dispatched another recovery message to the customer.

### 3. The P2002 Race Handling
- When two webhooks for the same contact/cart arrived simultaneously (sub-millisecond concurrent race), both could pass the initial `findFirst` query before either committed.
- One insert succeeded, and the second hit PostgreSQL's `journey_runs_active_unique` constraint, raising Prisma error `P2002`.
- The `try / catch` caught `P2002` and logged `[journey-trigger] Concurrent race resolved (P2002) ... Another run already started.` This prevented uncaught server errors during concurrent webhook bursts.

---

## Implementation Details

### 1. Application-Level Once-Per-Cart Guard
In [journeyTrigger.ts](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/packages/core/src/services/journeyTrigger.ts):
- For `cart_abandoned` triggers, we now check whether **any run** (any status: `running`, `waiting`, `completed`, `exited`, `failed`) already exists for this `(journeyId, cartId)` or `(journeyId, triggerContextId)` within the same workspace.
- The check queries both `cartId` and `triggerContextId` so that historical runs created before the dedicated `cartId` column was introduced are also honored.
- Clear console log emitted on skip:
  ```ts
  console.log(
    `[journey-trigger] Skipping duplicate cart run for journey ${journey.id}, cart ${targetCartId}. Run ${existingCartRun.id} already exists with status '${existingCartRun.status}'.`
  );
  ```

### 2. Non-Cart (Order) Triggers Unaffected
- Order-based triggers (`order_placed_cod`, `order_status_changed`, `order_delivered`) retain the non-terminal check (`status: { notIn: ["completed", "exited", "failed"] }`).
- Because each order generates its own unique `triggerContextId` (the order ID), completed orders never block new or subsequent orders placed by the same contact.

### 3. Preserved Concurrent Race Handling
- The `P2002` catch block remains fully intact. If two webhook events for a brand new cart arrive concurrently, the partial unique index `journey_runs_active_unique` rejects the duplicate insert and the catch block absorbs the `P2002` error without throwing.

---

## Why An Application-Level Check Was Used (Constraint Safety)

1. **Existing Duplicate Rows in Production:** As confirmed in the problem statement, multiple completed `journey_runs` rows for the same `(journey_id, cart_id)` already exist in the database from historical checkout webhooks.
2. **Database Migration Failure Risk:** Adding a database-level `UNIQUE CONSTRAINT` or `UNIQUE INDEX` on `(workspace_id, journey_id, cart_id)` right now would fail migration execution with:
   `ERROR: could not create unique index "..." Key (workspace_id, journey_id, cart_id)=(...) is duplicated.`
3. **Zero Risk to Existing Data:** The application-level check prevents all future duplicate runs from starting without requiring destructive data deletion or complex historical disambiguation migrations.
4. **Future Constraint Path:** If a strict database constraint is desired in the future, it would require a two-phase rollout: (1) an idempotent migration or script to clean up / deduplicate historical rows, followed by (2) adding the unique index.

---

## Verification & Test Results

### 1. New Dedicated Test Suite (`apps/api/src/scripts/checkOncePerCart.ts`)
- Script is fully offline, protected by a 30-second safety timeout, and exits cleanly via `process.exit(failed > 0 ? 1 : 0)`.
- **Results: 10 / 10 passed (100% pass rate in ~2.0s):**
  1. `[PASS]` Cart with a completed run does NOT start another run on subsequent webhook
  2. `[PASS]` Cart with a waiting run does NOT start another run
  3. `[PASS]` Cart with an exited run does NOT start another run
  4. `[PASS]` Cart with a failed run does NOT start another run
  5. `[PASS]` A different cart for the same contact STILL starts a new run
  6. `[PASS]` A different journey matching the same cart starts its own run, while the existing journey is skipped
  7. `[PASS]` Order triggers are unaffected: new order for same contact starts its own run
  8. `[PASS]` Order triggers still block duplicate webhook for the SAME order while a run is active
  9. `[PASS]` Workspace scoping: A completed cart run in Workspace Alpha does not block Workspace Beta
  10. `[PASS]` Concurrent race condition throwing P2002 is caught and handled gracefully without throwing

### 2. Full Regression Test Suites
All existing suites pass with 100% success:
- `checkOncePerCart.ts`: 10 passed, 0 failed
- `checkJourneyStepLogsAndHealth.ts`: 37 passed, 0 failed
- `checkConsent.ts`: 49 passed, 0 failed
- `checkJourneyVariables.ts`: 16 passed, 0 failed
- `checkTriggerVariables.ts`: 26 passed, 0 failed
- `checkCartConversion.ts`: 13 passed, 0 failed
- `checkRecoveryButton.ts`: 24 passed, 0 failed
- `checkUrlButtonSample.ts`: 16 passed, 0 failed
- **Overall Total: 191 passed, 0 failed (100% pass rate)**

### 3. TypeScript Type-Checking (`npx tsc --noEmit`)
- `packages/core`: **Clean (0 errors)**
- `apps/api`: **Clean (0 errors)**
- `apps/worker`: **Clean (0 errors)**
- `apps/web`: **Clean (0 errors)**
