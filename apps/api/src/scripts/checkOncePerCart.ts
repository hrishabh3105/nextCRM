// Set safety net hard timeout before anything else runs
const safetyTimeout = setTimeout(() => {
  console.error("TIMEOUT: Test script exceeded 30-second hard limit");
  process.exit(2);
}, 30000);
safetyTimeout.unref?.();

import { startMatchingJourneys } from "@nextcrm/core";

interface MockDbOptions {
  journeys?: any[];
  journeyVersions?: any[];
  journeyRuns?: any[];
  carts?: any[];
  orders?: any[];
  contacts?: any[];
}

function matchesWhere(item: any, where: any): boolean {
  if (!where) return true;
  for (const key of Object.keys(where)) {
    if (key === "OR") {
      const orClauses = where.OR;
      const matchedAny = orClauses.some((clause: any) => matchesWhere(item, clause));
      if (!matchedAny) return false;
      continue;
    }
    const val = where[key];
    if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      if ("not" in val) {
        if (item[key] === val.not) return false;
      }
      if ("in" in val) {
        if (!val.in.includes(item[key])) return false;
      }
      if ("notIn" in val) {
        if (val.notIn.includes(item[key])) return false;
      }
    } else {
      if (item[key] !== val) return false;
    }
  }
  return true;
}

function createMockDb(initial: MockDbOptions = {}) {
  const journeys: any[] = (initial.journeys || []).map((j) => ({ ...j }));
  const journeyVersions: any[] = (initial.journeyVersions || []).map((v) => ({ ...v }));
  const journeyRuns: any[] = (initial.journeyRuns || []).map((r) => ({ ...r }));
  const carts: any[] = (initial.carts || []).map((c) => ({ ...c }));
  const orders: any[] = (initial.orders || []).map((o) => ({ ...o }));
  const contacts: any[] = (initial.contacts || []).map((c) => ({ ...c }));

  let p2002OnCreate = false;

  const db: any = {
    _setP2002OnCreate: (val: boolean) => {
      p2002OnCreate = val;
    },
    _getJourneyRuns: () => journeyRuns,
    cart: {
      findUnique: async ({ where }: any = {}) => {
        const found = carts.find((c) => matchesWhere(c, where));
        return found ? { ...found } : null;
      },
    },
    order: {
      findFirst: async ({ where }: any = {}) => {
        const found = orders.find((o) => matchesWhere(o, where));
        return found ? { ...found } : null;
      },
    },
    journey: {
      findMany: async ({ where }: any = {}) => {
        return journeys.filter((j) => matchesWhere(j, where)).map((j) => ({ ...j }));
      },
      findUnique: async ({ where }: any = {}) => {
        const found = journeys.find((j) => matchesWhere(j, where));
        return found ? { ...found } : null;
      },
    },
    journeyVersion: {
      findUnique: async ({ where }: any = {}) => {
        const found = journeyVersions.find((v) => matchesWhere(v, where));
        return found ? { ...found } : null;
      },
    },
    journeyRun: {
      findMany: async ({ where }: any = {}) => {
        return journeyRuns.filter((r) => matchesWhere(r, where)).map((r) => ({ ...r }));
      },
      findFirst: async ({ where }: any = {}) => {
        const found = journeyRuns.find((r) => matchesWhere(r, where));
        return found ? { ...found } : null;
      },
      create: async ({ data }: any) => {
        if (p2002OnCreate) {
          const err: any = new Error("Unique constraint failed on the fields: (`journey_id`,`contact_id`,`trigger_context_id`)");
          err.code = "P2002";
          throw err;
        }
        const newRun = {
          id: `run_${journeyRuns.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        journeyRuns.push(newRun);
        return { ...newRun };
      },
      update: async ({ where, data }: any) => {
        const found = journeyRuns.find((r) => matchesWhere(r, where));
        if (!found) throw new Error("JourneyRun not found");
        Object.assign(found, data);
        return { ...found };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of journeyRuns) {
          if (matchesWhere(r, where)) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      },
    },
    contact: {
      findUnique: async ({ where }: any = {}) => {
        const found = contacts.find((c) => matchesWhere(c, where));
        return found ? { ...found } : null;
      },
      findFirst: async ({ where }: any = {}) => {
        const found = contacts.find((c) => matchesWhere(c, where));
        return found ? { ...found } : null;
      },
    },
  };

  return db;
}

export async function runOncePerCartTests() {
  console.log("=== Running Once-Per-Cart Journey Trigger Verification Suite ===\n");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} ${details ? "- " + details : ""}`);
      failed++;
    }
  }

  const baseJourney = {
    id: "j_abandoned_1",
    workspaceId: "ws_main",
    triggerEvent: "cart_abandoned",
    status: "active",
    currentVersionId: "ver_1",
  };

  const baseVersion = {
    id: "ver_1",
    journeyId: "j_abandoned_1",
    versionNumber: 1,
    steps: [{ type: "wait", durationMinutes: 45 }],
  };

  // =========================================================================
  // 1. Cart with COMPLETED Run Does NOT Start Another Run
  // =========================================================================
  console.log("--- 1. Cart with Completed Run ---");
  {
    const db = createMockDb({
      journeys: [baseJourney],
      journeyVersions: [baseVersion],
      carts: [{ id: "cart_completed_1", workspaceId: "ws_main", status: "active" }],
      journeyRuns: [
        {
          id: "run_past_completed",
          workspaceId: "ws_main",
          journeyId: "j_abandoned_1",
          journeyVersionId: "ver_1",
          contactId: "c_1",
          triggerContextId: "cart_completed_1",
          cartId: "cart_completed_1",
          status: "completed",
        },
      ],
    });

    await startMatchingJourneys(
      {
        workspaceId: "ws_main",
        triggerEvent: "cart_abandoned",
        contactId: "c_1",
        triggerContextId: "cart_completed_1",
        cartId: "cart_completed_1",
      },
      db
    );

    const runs = db._getJourneyRuns();
    assert(
      runs.length === 1 && runs[0].id === "run_past_completed",
      "Cart with a completed run does NOT start another run on subsequent webhook",
      `Expected 1 run, got: ${runs.length}`
    );
  }

  // =========================================================================
  // 2. Cart with WAITING Run Does NOT Start Another Run
  // =========================================================================
  console.log("\n--- 2. Cart with Waiting Run ---");
  {
    const db = createMockDb({
      journeys: [baseJourney],
      journeyVersions: [baseVersion],
      carts: [{ id: "cart_waiting_2", workspaceId: "ws_main", status: "active" }],
      journeyRuns: [
        {
          id: "run_waiting",
          workspaceId: "ws_main",
          journeyId: "j_abandoned_1",
          journeyVersionId: "ver_1",
          contactId: "c_1",
          triggerContextId: "cart_waiting_2",
          cartId: "cart_waiting_2",
          status: "waiting",
        },
      ],
    });

    await startMatchingJourneys(
      {
        workspaceId: "ws_main",
        triggerEvent: "cart_abandoned",
        contactId: "c_1",
        triggerContextId: "cart_waiting_2",
        cartId: "cart_waiting_2",
      },
      db
    );

    const runs = db._getJourneyRuns();
    assert(
      runs.length === 1 && runs[0].id === "run_waiting",
      "Cart with a waiting run does NOT start another run",
      `Expected 1 run, got: ${runs.length}`
    );
  }

  // =========================================================================
  // 3. Cart with EXITED Run Does NOT Start Another Run
  // =========================================================================
  console.log("\n--- 3. Cart with Exited Run ---");
  {
    const db = createMockDb({
      journeys: [baseJourney],
      journeyVersions: [baseVersion],
      carts: [{ id: "cart_exited_3", workspaceId: "ws_main", status: "active" }],
      journeyRuns: [
        {
          id: "run_exited",
          workspaceId: "ws_main",
          journeyId: "j_abandoned_1",
          journeyVersionId: "ver_1",
          contactId: "c_1",
          triggerContextId: "cart_exited_3",
          cartId: "cart_exited_3",
          status: "exited",
          exitReason: "CART_CONVERTED",
        },
      ],
    });

    await startMatchingJourneys(
      {
        workspaceId: "ws_main",
        triggerEvent: "cart_abandoned",
        contactId: "c_1",
        triggerContextId: "cart_exited_3",
        cartId: "cart_exited_3",
      },
      db
    );

    const runs = db._getJourneyRuns();
    assert(
      runs.length === 1 && runs[0].id === "run_exited",
      "Cart with an exited run does NOT start another run",
      `Expected 1 run, got: ${runs.length}`
    );
  }

  // =========================================================================
  // 4. Cart with FAILED Run Does NOT Start Another Run
  // =========================================================================
  console.log("\n--- 4. Cart with Failed Run ---");
  {
    const db = createMockDb({
      journeys: [baseJourney],
      journeyVersions: [baseVersion],
      carts: [{ id: "cart_failed_4", workspaceId: "ws_main", status: "active" }],
      journeyRuns: [
        {
          id: "run_failed",
          workspaceId: "ws_main",
          journeyId: "j_abandoned_1",
          journeyVersionId: "ver_1",
          contactId: "c_1",
          triggerContextId: "cart_failed_4",
          cartId: "cart_failed_4",
          status: "failed",
        },
      ],
    });

    await startMatchingJourneys(
      {
        workspaceId: "ws_main",
        triggerEvent: "cart_abandoned",
        contactId: "c_1",
        triggerContextId: "cart_failed_4",
        cartId: "cart_failed_4",
      },
      db
    );

    const runs = db._getJourneyRuns();
    assert(
      runs.length === 1 && runs[0].id === "run_failed",
      "Cart with a failed run does NOT start another run",
      `Expected 1 run, got: ${runs.length}`
    );
  }

  // =========================================================================
  // 5. A Different Cart STILL Starts a Run
  // =========================================================================
  console.log("\n--- 5. Different Cart Starts Run ---");
  {
    const db = createMockDb({
      journeys: [baseJourney],
      journeyVersions: [baseVersion],
      carts: [
        { id: "cart_old_5", workspaceId: "ws_main", status: "active" },
        { id: "cart_new_5", workspaceId: "ws_main", status: "active" },
      ],
      journeyRuns: [
        {
          id: "run_cart_old",
          workspaceId: "ws_main",
          journeyId: "j_abandoned_1",
          journeyVersionId: "ver_1",
          contactId: "c_1",
          triggerContextId: "cart_old_5",
          cartId: "cart_old_5",
          status: "completed",
        },
      ],
    });

    await startMatchingJourneys(
      {
        workspaceId: "ws_main",
        triggerEvent: "cart_abandoned",
        contactId: "c_1",
        triggerContextId: "cart_new_5",
        cartId: "cart_new_5",
      },
      db
    );

    const runs = db._getJourneyRuns();
    assert(
      runs.length === 2 && runs.some((r: any) => r.cartId === "cart_new_5"),
      "A different cart for the same contact STILL starts a new run",
      `Expected 2 runs, got: ${runs.length}`
    );
  }

  // =========================================================================
  // 6. A Different Journey on the Same Cart STILL Starts Its Own Run
  // =========================================================================
  console.log("\n--- 6. Different Journey on Same Cart Starts Run ---");
  {
    const secondJourney = {
      id: "j_abandoned_special_offer",
      workspaceId: "ws_main",
      triggerEvent: "cart_abandoned",
      status: "active",
      currentVersionId: "ver_2",
    };
    const secondVersion = {
      id: "ver_2",
      journeyId: "j_abandoned_special_offer",
      versionNumber: 1,
      steps: [{ type: "wait", durationMinutes: 60 }],
    };

    const db = createMockDb({
      journeys: [baseJourney, secondJourney],
      journeyVersions: [baseVersion, secondVersion],
      carts: [{ id: "cart_shared_6", workspaceId: "ws_main", status: "active" }],
      journeyRuns: [
        // Existing run for journey 1 on this cart
        {
          id: "run_j1",
          workspaceId: "ws_main",
          journeyId: "j_abandoned_1",
          journeyVersionId: "ver_1",
          contactId: "c_1",
          triggerContextId: "cart_shared_6",
          cartId: "cart_shared_6",
          status: "completed",
        },
      ],
    });

    await startMatchingJourneys(
      {
        workspaceId: "ws_main",
        triggerEvent: "cart_abandoned",
        contactId: "c_1",
        triggerContextId: "cart_shared_6",
        cartId: "cart_shared_6",
      },
      db
    );

    const runs = db._getJourneyRuns();
    const runsForJ2 = runs.filter((r: any) => r.journeyId === "j_abandoned_special_offer");
    const runsForJ1 = runs.filter((r: any) => r.journeyId === "j_abandoned_1");

    assert(
      runsForJ1.length === 1 && runsForJ2.length === 1,
      "A different journey matching the same cart starts its own run, while the existing journey is skipped",
      `J1 runs: ${runsForJ1.length}, J2 runs: ${runsForJ2.length}`
    );
  }

  // =========================================================================
  // 7. Order-Based Triggers Unaffected
  // =========================================================================
  console.log("\n--- 7. Order-Based Triggers Unaffected ---");
  {
    const orderJourney = {
      id: "j_order_1",
      workspaceId: "ws_main",
      triggerEvent: "order_placed_cod",
      status: "active",
      currentVersionId: "ver_order_1",
    };
    const orderVersion = {
      id: "ver_order_1",
      journeyId: "j_order_1",
      versionNumber: 1,
      steps: [{ type: "wait", durationMinutes: 10 }],
    };

    const db = createMockDb({
      journeys: [orderJourney],
      journeyVersions: [orderVersion],
      orders: [
        { id: "ord_1", shopifyOrderId: "1001", workspaceId: "ws_main" },
        { id: "ord_2", shopifyOrderId: "1002", workspaceId: "ws_main" },
      ],
      journeyRuns: [
        // Completed run for Order 1
        {
          id: "run_order_1",
          workspaceId: "ws_main",
          journeyId: "j_order_1",
          journeyVersionId: "ver_order_1",
          contactId: "c_order_customer",
          triggerContextId: "1001",
          orderId: "ord_1",
          status: "completed",
        },
      ],
    });

    // Submitting a new order for the same contact/journey starts a new run
    await startMatchingJourneys(
      {
        workspaceId: "ws_main",
        triggerEvent: "order_placed_cod",
        contactId: "c_order_customer",
        triggerContextId: "1002",
        orderId: "ord_2",
      },
      db
    );

    const runs = db._getJourneyRuns();
    const runsForOrder2 = runs.filter((r: any) => r.triggerContextId === "1002");
    assert(
      runsForOrder2.length === 1,
      "Order triggers are unaffected: new order for same contact starts its own run",
      `Runs for order 2: ${runsForOrder2.length}`
    );

    // Submitting a duplicate while active run is still non-terminal:
    const activeOrderDb = createMockDb({
      journeys: [orderJourney],
      journeyVersions: [orderVersion],
      orders: [{ id: "ord_active", shopifyOrderId: "1003", workspaceId: "ws_main" }],
      journeyRuns: [
        {
          id: "run_order_active",
          workspaceId: "ws_main",
          journeyId: "j_order_1",
          journeyVersionId: "ver_order_1",
          contactId: "c_order_customer",
          triggerContextId: "1003",
          orderId: "ord_active",
          status: "waiting",
        },
      ],
    });

    await startMatchingJourneys(
      {
        workspaceId: "ws_main",
        triggerEvent: "order_placed_cod",
        contactId: "c_order_customer",
        triggerContextId: "1003",
        orderId: "ord_active",
      },
      activeOrderDb
    );

    const activeRuns = activeOrderDb._getJourneyRuns();
    assert(
      activeRuns.length === 1,
      "Order triggers still block duplicate webhook for the SAME order while a run is active",
      `Active runs count: ${activeRuns.length}`
    );
  }

  // =========================================================================
  // 8. Workspace Scoping
  // =========================================================================
  console.log("\n--- 8. Workspace Scoping ---");
  {
    const journeyWs1 = {
      id: "j_abandoned_shared_id",
      workspaceId: "workspace_alpha",
      triggerEvent: "cart_abandoned",
      status: "active",
      currentVersionId: "ver_alpha",
    };
    const journeyWs2 = {
      id: "j_abandoned_shared_id",
      workspaceId: "workspace_beta",
      triggerEvent: "cart_abandoned",
      status: "active",
      currentVersionId: "ver_beta",
    };

    const db = createMockDb({
      journeys: [journeyWs1, journeyWs2],
      journeyVersions: [
        { id: "ver_alpha", journeyId: "j_abandoned_shared_id", versionNumber: 1, steps: [{ type: "wait", durationMinutes: 45 }] },
        { id: "ver_beta", journeyId: "j_abandoned_shared_id", versionNumber: 1, steps: [{ type: "wait", durationMinutes: 45 }] },
      ],
      carts: [
        { id: "cart_shared_scope", workspaceId: "workspace_alpha", status: "active" },
        { id: "cart_shared_scope", workspaceId: "workspace_beta", status: "active" },
      ],
      journeyRuns: [
        // Workspace Alpha has a completed run for this cart
        {
          id: "run_alpha",
          workspaceId: "workspace_alpha",
          journeyId: "j_abandoned_shared_id",
          journeyVersionId: "ver_alpha",
          contactId: "c_alpha",
          triggerContextId: "cart_shared_scope",
          cartId: "cart_shared_scope",
          status: "completed",
        },
      ],
    });

    // Triggering cart in Workspace Beta must NOT be blocked by Workspace Alpha's run
    await startMatchingJourneys(
      {
        workspaceId: "workspace_beta",
        triggerEvent: "cart_abandoned",
        contactId: "c_beta",
        triggerContextId: "cart_shared_scope",
        cartId: "cart_shared_scope",
      },
      db
    );

    const runs = db._getJourneyRuns();
    const betaRuns = runs.filter((r: any) => r.workspaceId === "workspace_beta");
    assert(
      betaRuns.length === 1 && betaRuns[0].cartId === "cart_shared_scope",
      "Workspace scoping: A completed cart run in Workspace Alpha does not block Workspace Beta",
      `Beta runs: ${betaRuns.length}`
    );
  }

  // =========================================================================
  // 9. Concurrent Race Handling (P2002)
  // =========================================================================
  console.log("\n--- 9. Concurrent Race Handling (P2002) ---");
  {
    const db = createMockDb({
      journeys: [baseJourney],
      journeyVersions: [baseVersion],
      carts: [{ id: "cart_race_9", workspaceId: "ws_main", status: "active" }],
      journeyRuns: [], // No existing runs before race
    });

    // Simulate database unique constraint violation (P2002) on concurrent insert
    db._setP2002OnCreate(true);

    let threwError = false;
    try {
      await startMatchingJourneys(
        {
          workspaceId: "ws_main",
          triggerEvent: "cart_abandoned",
          contactId: "c_race",
          triggerContextId: "cart_race_9",
          cartId: "cart_race_9",
        },
        db
      );
    } catch {
      threwError = true;
    }

    assert(
      !threwError,
      "Concurrent race condition throwing P2002 is caught and handled gracefully without throwing"
    );
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log(`\n=== Verification Complete: ${passed} passed, ${failed} failed ===\n`);

  try {
    const { prisma } = await import("@nextcrm/db");
    await prisma.$disconnect().catch(() => {});
  } catch {}

  clearTimeout(safetyTimeout);
  process.exit(failed > 0 ? 1 : 0);
}

// Direct execution
if (require.main === module || process.argv[1]?.includes("checkOncePerCart")) {
  runOncePerCartTests().catch((err) => {
    console.error("Unhandled test runner error:", err);
    process.exit(1);
  });
}
