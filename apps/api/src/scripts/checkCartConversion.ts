import {
  convertCartsForOrder,
  CART_CONVERTED_EXIT_REASON,
  processJourneyStep,
  startMatchingJourneys,
} from "@nextcrm/core";
import {
  handleShopifyOrder,
  handleShopifyCheckout,
  handleShopifyOrderUpdate,
} from "../services/shopifyWebhookHandler";

interface MockDbOptions {
  carts?: any[];
  orders?: any[];
  journeyRuns?: any[];
  journeys?: any[];
  journeyVersions?: any[];
  contacts?: any[];
  channels?: any[];
  templates?: any[];
}

function matchesWhere(item: any, where: any): boolean {
  if (!where) return true;
  for (const key of Object.keys(where)) {
    if (key === "OR" && Array.isArray(where.OR)) {
      const orMatched = where.OR.some((subWhere: any) => matchesWhere(item, subWhere));
      if (!orMatched) return false;
      continue;
    }
    if (key === "AND" && Array.isArray(where.AND)) {
      const andMatched = where.AND.every((subWhere: any) => matchesWhere(item, subWhere));
      if (!andMatched) return false;
      continue;
    }
    if (key === "workspaceId_shopifyCartId") {
      const { workspaceId, shopifyCartId } = where.workspaceId_shopifyCartId;
      if (item.workspaceId !== workspaceId || item.shopifyCartId !== shopifyCartId) return false;
      continue;
    }
    if (key === "workspaceId_shopifyOrderId") {
      const { workspaceId, shopifyOrderId } = where.workspaceId_shopifyOrderId;
      if (item.workspaceId !== workspaceId || item.shopifyOrderId !== shopifyOrderId) return false;
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
      if ("gte" in val) {
        if (!(item[key] >= val.gte)) return false;
      }
    } else {
      if (item[key] !== val) return false;
    }
  }
  return true;
}

function createMockDb(initial: MockDbOptions = {}) {
  const carts: any[] = (initial.carts || []).map((c) => ({ ...c }));
  const orders: any[] = (initial.orders || []).map((o) => ({ ...o }));
  const journeyRuns: any[] = (initial.journeyRuns || []).map((r) => ({ ...r }));
  const journeys: any[] = (initial.journeys || []).map((j) => ({ ...j }));
  const journeyVersions: any[] = (initial.journeyVersions || []).map((v) => ({ ...v }));
  const contacts: any[] = (initial.contacts || []).map((c) => ({ ...c }));
  const channels: any[] = (initial.channels || []).map((c) => ({ ...c }));
  const templates: any[] = (initial.templates || []).map((t) => ({ ...t }));
  const messages: any[] = [];
  const messageCosts: any[] = [];

  const db: any = {
    cart: {
      findMany: async ({ where }: any = {}) => {
        return carts.filter((c) => matchesWhere(c, where)).map((c) => ({ ...c }));
      },
      findFirst: async ({ where }: any = {}) => {
        const found = carts.find((c) => matchesWhere(c, where));
        return found ? { ...found } : null;
      },
      findUnique: async ({ where }: any = {}) => {
        const found = carts.find((c) => matchesWhere(c, where));
        return found ? { ...found } : null;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const c of carts) {
          if (matchesWhere(c, where)) {
            Object.assign(c, data);
            count++;
          }
        }
        return { count };
      },
      upsert: async ({ where, update, create }: any) => {
        let found = carts.find((c) => matchesWhere(c, where));
        if (found) {
          Object.assign(found, update);
          return { ...found };
        } else {
          const newRow = {
            id: `cart_${carts.length + 1}`,
            status: "active",
            totalPrice: "0.00",
            createdAt: new Date(),
            ...create,
          };
          carts.push(newRow);
          return { ...newRow };
        }
      },
      update: async ({ where, data }: any) => {
        const found = carts.find((c) => matchesWhere(c, where));
        if (!found) throw new Error("Cart not found");
        Object.assign(found, data);
        return { ...found };
      },
    },
    order: {
      findMany: async ({ where }: any = {}) => {
        return orders.filter((o) => matchesWhere(o, where)).map((o) => ({ ...o }));
      },
      findFirst: async ({ where }: any = {}) => {
        const found = orders.find((o) => matchesWhere(o, where));
        return found ? { ...found } : null;
      },
      findUnique: async ({ where }: any = {}) => {
        const found = orders.find((o) => matchesWhere(o, where));
        return found ? { ...found } : null;
      },
      upsert: async ({ where, update, create }: any) => {
        let found = orders.find((o) => matchesWhere(o, where));
        if (found) {
          Object.assign(found, update);
          return { ...found };
        } else {
          const newRow = {
            id: `ord_${orders.length + 1}`,
            createdAt: new Date(),
            ...create,
          };
          orders.push(newRow);
          return { ...newRow };
        }
      },
    },
    journeyRun: {
      findMany: async ({ where }: any = {}) => {
        return journeyRuns.filter((r) => matchesWhere(r, where)).map((r) => ({ ...r }));
      },
      findFirst: async ({ where, include }: any = {}) => {
        const found = journeyRuns.find((r) => matchesWhere(r, where));
        if (!found) return null;
        const res = { ...found };
        if (include?.journey) {
          res.journey = journeys.find((j) => j.id === found.journeyId) || null;
        }
        return res;
      },
      findUnique: async ({ where, include }: any = {}) => {
        const found = journeyRuns.find((r) => matchesWhere(r, where));
        if (!found) return null;
        const res = { ...found };
        if (include?.journey) {
          res.journey = journeys.find((j) => j.id === found.journeyId) || null;
        }
        return res;
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
      update: async ({ where, data }: any) => {
        const found = journeyRuns.find((r) => matchesWhere(r, where));
        if (!found) throw new Error("JourneyRun not found");
        Object.assign(found, data);
        return { ...found };
      },
      create: async ({ data }: any) => {
        const newRun = {
          id: `run_${journeyRuns.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        journeyRuns.push(newRun);
        return { ...newRun };
      },
    },
    journey: {
      findMany: async ({ where }: any = {}) => {
        return journeys.filter((j) => matchesWhere(j, where)).map((j) => ({ ...j }));
      },
      findFirst: async ({ where }: any = {}) => {
        const found = journeys.find((j) => matchesWhere(j, where));
        return found ? { ...found } : null;
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
    contact: {
      findFirst: async ({ where }: any = {}) => {
        const found = contacts.find((c) => matchesWhere(c, where));
        return found ? { ...found } : null;
      },
      findUnique: async ({ where }: any = {}) => {
        const found = contacts.find((c) => matchesWhere(c, where));
        return found ? { ...found } : null;
      },
      create: async ({ data }: any) => {
        const newContact = {
          id: `contact_${contacts.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        contacts.push(newContact);
        return { ...newContact };
      },
      update: async ({ where, data }: any) => {
        const found = contacts.find((c) => matchesWhere(c, where));
        if (!found) throw new Error("Contact not found");
        Object.assign(found, data);
        return { ...found };
      },
    },
    channel: {
      findUnique: async ({ where }: any = {}) => {
        const found = channels.find((c) => matchesWhere(c, where));
        return found ? { ...found } : null;
      },
    },
    template: {
      findUnique: async ({ where }: any = {}) => {
        const found = templates.find((t) => matchesWhere(t, where));
        return found ? { ...found } : null;
      },
    },
    storeConnection: {
      findFirst: async () => null,
      findUnique: async () => null,
    },
    consentEvent: {
      create: async ({ data }: any) => ({ id: "ce_1", ...data }),
    },
    message: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        const newMsg = { id: `msg_${messages.length + 1}`, ...data };
        messages.push(newMsg);
        return newMsg;
      },
    },
    rateCard: {
      findFirst: async () => ({ rate: 0.05, currency: "USD" }),
    },
    messageCost: {
      create: async ({ data }: any) => {
        const newCost = { id: `cost_${messageCosts.length + 1}`, ...data };
        messageCosts.push(newCost);
        return newCost;
      },
    },
    $transaction: async (fn: any) => fn(db),
    _getCarts: (): any[] => carts,
    _getOrders: (): any[] => orders,
    _getRuns: (): any[] => journeyRuns,
  };

  return db;
}

async function runTests() {
  console.log("=== Running Abandoned Cart Conversion Verification Tests ===\n");
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

  // 1. Order with matching checkout_token marks the cart converted
  {
    const db = createMockDb({
      carts: [
        {
          id: "cart_1",
          workspaceId: "ws_1",
          shopifyCartId: "tok_chk_1",
          checkoutToken: "tok_chk_1",
          cartToken: null,
          status: "active",
          convertedAt: null,
          orderId: null,
        },
      ],
    });

    const result = await convertCartsForOrder({
      db,
      workspaceId: "ws_1",
      checkoutToken: "tok_chk_1",
      cartToken: null,
      orderId: "shopify_order_101",
    });

    const carts = db._getCarts();
    assert(
      result.convertedCartCount === 1 &&
        carts[0].status === "converted" &&
        carts[0].orderId === "shopify_order_101" &&
        carts[0].convertedAt != null,
      "Order with matching checkout_token marks the cart converted",
      `Count: ${result.convertedCartCount}, status: ${carts[0].status}`
    );
  }

  // 2. Matching cart_token only also works
  {
    const db = createMockDb({
      carts: [
        {
          id: "cart_2",
          workspaceId: "ws_1",
          shopifyCartId: "chk_other",
          checkoutToken: "chk_other",
          cartToken: "cart_tok_22",
          status: "active",
          convertedAt: null,
          orderId: null,
        },
      ],
    });

    const result = await convertCartsForOrder({
      db,
      workspaceId: "ws_1",
      checkoutToken: null,
      cartToken: "cart_tok_22",
      orderId: "shopify_order_102",
    });

    const carts = db._getCarts();
    assert(
      result.convertedCartCount === 1 &&
        carts[0].status === "converted" &&
        carts[0].orderId === "shopify_order_102" &&
        carts[0].convertedAt != null,
      "Matching cart_token only also works",
      `Count: ${result.convertedCartCount}, status: ${carts[0].status}`
    );
  }

  // 3. Non-matching tokens change nothing
  {
    const db = createMockDb({
      carts: [
        {
          id: "cart_3",
          workspaceId: "ws_1",
          shopifyCartId: "tok_real_3",
          checkoutToken: "tok_real_3",
          cartToken: "cart_real_3",
          status: "active",
          convertedAt: null,
          orderId: null,
        },
      ],
    });

    const result = await convertCartsForOrder({
      db,
      workspaceId: "ws_1",
      checkoutToken: "tok_unrelated",
      cartToken: "cart_unrelated",
      orderId: "shopify_order_999",
    });

    const carts = db._getCarts();
    assert(
      result.convertedCartCount === 0 &&
        carts[0].status === "active" &&
        carts[0].convertedAt == null &&
        carts[0].orderId == null,
      "Non-matching tokens change nothing",
      `Count: ${result.convertedCartCount}, status: ${carts[0].status}`
    );
  }

  // 4. Running the handler twice is a no-op the second time (idempotent)
  {
    const db = createMockDb({
      carts: [
        {
          id: "cart_4",
          workspaceId: "ws_1",
          shopifyCartId: "tok_idempotent_4",
          checkoutToken: "tok_idempotent_4",
          cartToken: null,
          status: "active",
          convertedAt: null,
          orderId: null,
        },
      ],
    });

    const orderPayload = {
      id: 2004,
      checkout_token: "tok_idempotent_4",
      total_price: "49.99",
      created_at: "2026-10-08T18:00:00Z",
      customer: { id: 999, phone: "+15551234567" },
    };

    // First execution
    await handleShopifyOrder(orderPayload, "ws_1", null, db);
    const cartsAfterFirst = db._getCarts();
    const convertedAtFirst = cartsAfterFirst[0].convertedAt;

    // Second execution (webhook retry)
    await handleShopifyOrder(orderPayload, "ws_1", null, db);
    const cartsAfterSecond = db._getCarts();

    assert(
      cartsAfterSecond[0].status === "converted" &&
        cartsAfterSecond[0].orderId === "2004" &&
        cartsAfterSecond[0].convertedAt?.getTime() === convertedAtFirst?.getTime(),
      "Running the handler twice is a no-op the second time (idempotent)",
      `Status: ${cartsAfterSecond[0].status}, orderId: ${cartsAfterSecond[0].orderId}`
    );
  }

  // 5. A non-terminal run for that cart becomes exited with CART_CONVERTED
  {
    const db = createMockDb({
      carts: [
        {
          id: "cart_5",
          workspaceId: "ws_1",
          shopifyCartId: "tok_run_5",
          checkoutToken: "tok_run_5",
          status: "active",
        },
      ],
      journeyRuns: [
        {
          id: "run_waiting_5",
          workspaceId: "ws_1",
          triggerContextId: "cart_5",
          status: "waiting",
          exitReason: null,
          nextStepAt: new Date(Date.now() + 60000),
        },
        {
          id: "run_running_5",
          workspaceId: "ws_1",
          triggerContextId: "cart_5",
          status: "running",
          exitReason: null,
          nextStepAt: null,
        },
      ],
    });

    const result = await convertCartsForOrder({
      db,
      workspaceId: "ws_1",
      checkoutToken: "tok_run_5",
      orderId: "ord_5",
    });

    const runs = db._getRuns();
    const run1 = runs.find((r: any) => r.id === "run_waiting_5");
    const run2 = runs.find((r: any) => r.id === "run_running_5");

    assert(
      result.exitedRunCount === 2 &&
        run1?.status === "exited" &&
        run1?.exitReason === CART_CONVERTED_EXIT_REASON &&
        run1?.nextStepAt == null &&
        run2?.status === "exited" &&
        run2?.exitReason === CART_CONVERTED_EXIT_REASON,
      "A non-terminal run for that cart becomes exited with CART_CONVERTED",
      `Exited count: ${result.exitedRunCount}, run1 status: ${run1?.status}, reason: ${run1?.exitReason}`
    );
  }

  // 6. An already-terminal run is untouched
  {
    const db = createMockDb({
      carts: [
        {
          id: "cart_6",
          workspaceId: "ws_1",
          shopifyCartId: "tok_run_6",
          checkoutToken: "tok_run_6",
          status: "active",
        },
      ],
      journeyRuns: [
        {
          id: "run_completed_6",
          workspaceId: "ws_1",
          triggerContextId: "cart_6",
          status: "completed",
          exitReason: null,
        },
        {
          id: "run_failed_6",
          workspaceId: "ws_1",
          triggerContextId: "cart_6",
          status: "failed",
          exitReason: "network_timeout",
        },
        {
          id: "run_exited_other",
          workspaceId: "ws_1",
          triggerContextId: "cart_6",
          status: "exited",
          exitReason: "USER_UNSUBSCRIBED",
        },
      ],
    });

    const result = await convertCartsForOrder({
      db,
      workspaceId: "ws_1",
      checkoutToken: "tok_run_6",
      orderId: "ord_6",
    });

    const runs = db._getRuns();
    const runCompleted = runs.find((r: any) => r.id === "run_completed_6");
    const runFailed = runs.find((r: any) => r.id === "run_failed_6");
    const runExitedOther = runs.find((r: any) => r.id === "run_exited_other");

    assert(
      result.exitedRunCount === 0 &&
        runCompleted?.status === "completed" &&
        runCompleted?.exitReason == null &&
        runFailed?.status === "failed" &&
        runFailed?.exitReason === "network_timeout" &&
        runExitedOther?.status === "exited" &&
        runExitedOther?.exitReason === "USER_UNSUBSCRIBED",
      "An already-terminal run is untouched",
      `Exited count: ${result.exitedRunCount}, runCompleted status: ${runCompleted?.status}`
    );
  }

  // 7. The send-time guard skips a converted cart
  {
    const db = createMockDb({
      carts: [
        {
          id: "cart_7",
          workspaceId: "ws_1",
          status: "converted",
          convertedAt: new Date(),
        },
      ],
      journeys: [
        {
          id: "journey_cart_7",
          workspaceId: "ws_1",
          triggerEvent: "cart_abandoned",
          status: "active",
          currentVersionId: "ver_7",
        },
      ],
      journeyVersions: [
        {
          id: "ver_7",
          journeyId: "journey_cart_7",
          versionNumber: 1,
          steps: [
            {
              type: "send_message",
              templateId: "tpl_cart_recovery",
              channelId: "chan_7",
            },
          ],
        },
      ],
      journeyRuns: [
        {
          id: "run_7",
          workspaceId: "ws_1",
          journeyId: "journey_cart_7",
          journeyVersionId: "ver_7",
          contactId: "cont_7",
          triggerContextId: "cart_7",
          currentStepIndex: 0,
          status: "running",
          exitReason: null,
        },
      ],
      contacts: [
        {
          id: "cont_7",
          workspaceId: "ws_1",
          phone: "+15550007777",
          marketingConsentStatus: "OPTED_IN",
        },
      ],
      channels: [
        {
          id: "chan_7",
          workspaceId: "ws_1",
          phoneNumberId: "phone_id_7",
          accessTokenEnc: "dummy",
        },
      ],
      templates: [
        {
          id: "tpl_cart_recovery",
          workspaceId: "ws_1",
          providerName: "cart_recovery_tmpl",
          language: "en",
          category: "MARKETING",
          channelId: "chan_7",
        },
      ],
    });

    await processJourneyStep("run_7", "ws_1", 0, db);

    const run = (db._getRuns()).find((r: any) => r.id === "run_7");
    assert(
      run?.status === "exited" && run?.exitReason === CART_CONVERTED_EXIT_REASON,
      "The send-time guard skips a converted cart and exits run with CART_CONVERTED",
      `Run status: ${run?.status}, exitReason: ${run?.exitReason}`
    );
  }

  // 8. Checkout payload with completed_at marks converted
  {
    const db = createMockDb();

    const checkoutPayload = {
      token: "tok_completed_8",
      cart_token: "cart_completed_8",
      total_price: "99.00",
      completed_at: "2026-10-08T18:30:00Z",
      order_id: 8888,
      customer: { id: 808, phone: "+15558888888" },
    };

    await handleShopifyCheckout(checkoutPayload, "ws_1", "active", null, db);

    const carts = db._getCarts();
    const runs = db._getRuns();
    assert(
      carts.length === 1 &&
        carts[0].status === "converted" &&
        carts[0].orderId === "8888" &&
        carts[0].checkoutToken === "tok_completed_8" &&
        carts[0].cartToken === "cart_completed_8" &&
        carts[0].convertedAt != null &&
        runs.length === 0,
      "Checkout payload with completed_at marks converted without starting a run",
      `Status: ${carts[0]?.status}, orderId: ${carts[0]?.orderId}, runs count: ${runs.length}`
    );
  }

  // 9. Order arriving before the cart exists does not later start a run
  {
    const db = createMockDb({
      journeys: [
        {
          id: "j_abandoned_9",
          workspaceId: "ws_1",
          triggerEvent: "cart_abandoned",
          status: "active",
          currentVersionId: "ver_9",
        },
      ],
      journeyVersions: [
        {
          id: "ver_9",
          journeyId: "j_abandoned_9",
          versionNumber: 1,
          steps: [{ type: "wait", durationMs: 1000 }],
        },
      ],
    });

    // Step A: Order arrives FIRST
    const orderPayload = {
      id: 9901,
      checkout_token: "tok_race_first",
      cart_token: "cart_race_first",
      total_price: "150.00",
      created_at: "2026-10-08T17:00:00Z",
      customer: { id: 901, phone: "+15559019010" },
    };
    await handleShopifyOrder(orderPayload, "ws_1", null, db);

    const orders = db._getOrders();
    assert(
      orders.length === 1 &&
        orders[0].shopifyOrderId === "9901" &&
        orders[0].checkoutToken === "tok_race_first" &&
        orders[0].cartToken === "cart_race_first",
      "Order arrived first and recorded checkout/cart tokens",
      `Orders: ${orders.length}`
    );

    // Step B: Later, checkouts/update arrives for that checkout token
    const checkoutPayload = {
      token: "tok_race_first",
      cart_token: "cart_race_first",
      total_price: "150.00",
      customer: { id: 901, phone: "+15559019010" },
    };
    await handleShopifyCheckout(checkoutPayload, "ws_1", "active", null, db);

    const carts = db._getCarts();
    const runs = db._getRuns();

    assert(
      carts.length === 1 &&
        carts[0].status === "converted" &&
        carts[0].orderId === "9901" &&
        runs.length === 0,
      "Order arriving before cart exists marks late cart converted and does not start a run",
      `Cart status: ${carts[0]?.status}, orderId: ${carts[0]?.orderId}, runs count: ${runs.length}`
    );
  }

  // 10. Delayed tick fires for an exited run -> sees terminal status and skips execution
  {
    const db = createMockDb({
      journeyRuns: [
        {
          id: "run_exited_10",
          workspaceId: "ws_1",
          status: "exited",
          exitReason: CART_CONVERTED_EXIT_REASON,
          currentStepIndex: 1,
        },
      ],
    });

    await processJourneyStep("run_exited_10", "ws_1", 0, db);
    const run = (db._getRuns()).find((r: any) => r.id === "run_exited_10");
    assert(
      run?.status === "exited" && run?.currentStepIndex === 1,
      "Delayed tick sees terminal 'exited' status and does nothing",
      `Status: ${run?.status}, step: ${run?.currentStepIndex}`
    );
  }

  // 11. startMatchingJourneys skips cart_abandoned if cart is already converted
  {
    const db = createMockDb({
      carts: [
        {
          id: "cart_conv_11",
          workspaceId: "ws_1",
          status: "converted",
          convertedAt: new Date(),
        },
      ],
      journeys: [
        {
          id: "j_11",
          workspaceId: "ws_1",
          triggerEvent: "cart_abandoned",
          status: "active",
          currentVersionId: "v_11",
        },
      ],
      journeyVersions: [
        {
          id: "v_11",
          journeyId: "j_11",
          versionNumber: 1,
          steps: [],
        },
      ],
    });

    await startMatchingJourneys(
      {
        workspaceId: "ws_1",
        triggerEvent: "cart_abandoned",
        contactId: "c_11",
        triggerContextId: "cart_conv_11",
      },
      db
    );

    const runs = db._getRuns();
    assert(
      runs.length === 0,
      "startMatchingJourneys skips creating run when cart is already converted",
      `Runs count: ${runs.length}`
    );
  }

  // 12. handleShopifyOrderUpdate also marks cart converted (orders/updated as first sight)
  {
    const db = createMockDb({
      carts: [
        {
          id: "cart_12",
          workspaceId: "ws_1",
          shopifyCartId: "tok_update_12",
          checkoutToken: "tok_update_12",
          cartToken: null,
          status: "active",
          convertedAt: null,
          orderId: null,
        },
      ],
    });

    const updatePayload = {
      id: 12001,
      checkout_token: "tok_update_12",
      financial_status: "paid",
      total_price: "85.00",
      customer: { id: 12, phone: "+15551212121" },
    };

    await handleShopifyOrderUpdate(updatePayload, "ws_1", null, db);

    const carts = db._getCarts();
    assert(
      carts[0].status === "converted" && carts[0].orderId === "12001",
      "handleShopifyOrderUpdate marks cart converted when first seeing order",
      `Status: ${carts[0].status}, orderId: ${carts[0].orderId}`
    );
  }

  console.log(`\n=== Verification Complete: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
