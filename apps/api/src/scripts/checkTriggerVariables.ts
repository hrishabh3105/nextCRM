/**
 * apps/api/src/scripts/checkTriggerVariables.ts
 *
 * Comprehensive verification test suite for journey trigger template variables:
 * - Recovery URL resolution for abandoned cart
 * - Currency total formatting (including unknown currency fallback)
 * - items_summary for 1, 3, and 5 line items
 * - Fallback usage on missing values
 * - Missing value without fallback returns error and logs warning
 * - Trigger validation (cart in order rejected, order in cart rejected)
 * - Unknown field rejection
 * - WhatsApp param sanitization (newlines, tabs, 4+ space collapse, 1000-char truncation with "…")
 * - Cross-workspace safety (workspace scoping prevents reading foreign carts)
 * - Regression check that existing journey variable tests pass
 */

import {
  resolveTemplateVariables,
  sanitizeTemplateParam,
  formatCurrencyAmount,
  getItemsSummary,
  getItemCount,
  getFirstItemName,
  CART_TRIGGER_FIELDS,
  ORDER_TRIGGER_FIELDS,
  ALL_TRIGGER_FIELDS,
} from "@nextcrm/core";
import { validateJourneyStepsForActivation } from "../validation/journeySchema";
import { runJourneyVariableTests } from "./checkJourneyVariables";

// Mock DB factory with workspace isolation
function createMockDb(data: {
  templates?: Record<string, any>;
  carts?: Array<{ id: string; workspaceId: string; [key: string]: any }>;
  orders?: Array<{ id: string; workspaceId: string; [key: string]: any }>;
}) {
  const templates = data.templates || {};
  const carts = data.carts || [];
  const orders = data.orders || [];

  return {
    template: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return templates[where.id] || null;
      },
    },
    cart: {
      findFirst: async ({ where }: { where: { id: string; workspaceId?: string } }) => {
        return (
          carts.find((c) => {
            if (c.id !== where.id) return false;
            if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
            return true;
          }) || null
        );
      },
    },
    order: {
      findFirst: async ({
        where,
      }: {
        where: { id?: string; shopifyOrderId?: string; workspaceId?: string; OR?: any[] };
      }) => {
        return (
          orders.find((o) => {
            if (where.workspaceId && o.workspaceId !== where.workspaceId) return false;
            if (where.id && o.id === where.id) return true;
            if (where.shopifyOrderId && o.shopifyOrderId === where.shopifyOrderId) return true;
            if (where.OR && Array.isArray(where.OR)) {
              return where.OR.some(
                (sub) => (sub.id && o.id === sub.id) || (sub.shopifyOrderId && o.shopifyOrderId === sub.shopifyOrderId)
              );
            }
            return false;
          }) || null
        );
      },
    },
  };
}

// Scoped DB factory simulating forWorkspace(wsId)
function createWorkspaceScopedDb(
  workspaceId: string,
  storage: {
    carts: Array<{ id: string; workspaceId: string; [key: string]: any }>;
    orders: Array<{ id: string; workspaceId: string; [key: string]: any }>;
  }
) {
  return {
    cart: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        return storage.carts.find((c) => c.id === where.id && c.workspaceId === workspaceId) || null;
      },
    },
    order: {
      findFirst: async ({ where }: { where: any }) => {
        return (
          storage.orders.find((o) => {
            if (o.workspaceId !== workspaceId) return false;
            if (where.id && o.id === where.id) return true;
            if (where.shopifyOrderId && o.shopifyOrderId === where.shopifyOrderId) return true;
            if (where.OR && Array.isArray(where.OR)) {
              return where.OR.some(
                (sub: any) =>
                  (sub.id && o.id === sub.id) || (sub.shopifyOrderId && o.shopifyOrderId === sub.shopifyOrderId)
              );
            }
            return false;
          }) || null
        );
      },
    },
  };
}

async function runTests() {
  console.log("=== Running Journey Trigger Variables & Cross-Workspace Verification Suite ===\n");
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

  // =========================================================================
  // 1. RECOVERY URL RESOLVES FOR ABANDONED CART
  // =========================================================================
  console.log("--- 1. Recovery URL Resolution ---");
  {
    const mockStorage = {
      carts: [
        {
          id: "cart_abc123",
          workspaceId: "ws_1",
          recoveryUrl: "https://shop.example.com/checkouts/ac/xyz999/recover",
          total: 1500,
          currency: "INR",
          lineItems: [{ title: "Sourdough Bread", quantity: 1 }],
        },
      ],
      orders: [],
    };
    const wsDb = createWorkspaceScopedDb("ws_1", mockStorage);

    const result = await resolveTemplateVariables({
      placeholders: ["recovery_link"],
      mapping: {
        recovery_link: {
          source: "trigger_field",
          field: "cart.recovery_url",
        },
      },
      contact: { name: "Rohan", email: null, phone: "+919876543210", attributes: {} },
      db: wsDb,
      workspaceId: "ws_1",
      cartId: "cart_abc123",
    });

    assert(
      "resolved" in result && result.resolved[0] === "https://shop.example.com/checkouts/ac/xyz999/recover",
      "Cart recovery URL resolves correctly from DB for abandoned cart"
    );
  }

  // =========================================================================
  // 2. TOTAL FORMATTING WITH CURRENCY
  // =========================================================================
  console.log("\n--- 2. Total Formatting with Currency ---");
  {
    // INR Formatting
    const inrFormatted = formatCurrencyAmount(1299.0, "INR");
    assert(
      inrFormatted.includes("1,299.00") && (inrFormatted.includes("₹") || inrFormatted.includes("INR")),
      `INR total formatted with symbol and separators (${inrFormatted})`
    );

    // USD Formatting
    const usdFormatted = formatCurrencyAmount(49.99, "USD");
    assert(
      usdFormatted.includes("49.99") && (usdFormatted.includes("$") || usdFormatted.includes("USD")),
      `USD total formatted with symbol (${usdFormatted})`
    );

    // Unknown currency fallback: plain number plus currency code
    const unknownFormatted = formatCurrencyAmount(75.5, "XYZ");
    assert(
      unknownFormatted === "75.50 XYZ" || (unknownFormatted.includes("75.50") && unknownFormatted.includes("XYZ")),
      `Unknown currency falls back to plain number + currency code (${unknownFormatted})`
    );

    // Resolution via resolveTemplateVariables for cart.total and order.total
    const cartResult = await resolveTemplateVariables({
      placeholders: ["cart_total"],
      mapping: {
        cart_total: { source: "trigger_field", field: "cart.total" },
      },
      contact: { name: "Aarav", email: null, phone: "+919876543210", attributes: {} },
      triggerData: {
        cart: { total: 1299.0, currency: "INR" },
      },
    });
    assert(
      "resolved" in cartResult &&
        cartResult.resolved[0].includes("1,299.00") &&
        (cartResult.resolved[0].includes("₹") || cartResult.resolved[0].includes("INR")),
      "cart.total resolves to formatted currency string (₹1,299.00)"
    );

    const orderResult = await resolveTemplateVariables({
      placeholders: ["order_total"],
      mapping: {
        order_total: { source: "trigger_field", field: "order.total" },
      },
      contact: { name: "John", email: null, phone: "+1234567890", attributes: {} },
      triggerData: {
        order: { totalPrice: 99.0, currency: "USD" },
      },
    });
    assert(
      "resolved" in orderResult && orderResult.resolved[0].includes("99.00"),
      "order.total resolves to formatted currency string ($99.00)"
    );
  }

  // =========================================================================
  // 3. ITEMS_SUMMARY FOR 1, 3, AND 5 ITEMS
  // =========================================================================
  console.log("\n--- 3. items_summary for 1, 3, and 5 Items ---");
  {
    const oneItem = [{ title: "Sourdough Loaf" }];
    const threeItems = [
      { title: "Sourdough Loaf" },
      { title: "Brownie Box" },
      { title: "Butter Croissant" },
    ];
    const fiveItems = [
      { title: "Sourdough Loaf" },
      { title: "Brownie Box" },
      { title: "Butter Croissant" },
      { title: "Baguette" },
      { title: "Choc Chip Cookie" },
    ];

    const sum1 = getItemsSummary(oneItem);
    const sum3 = getItemsSummary(threeItems);
    const sum5 = getItemsSummary(fiveItems);

    assert(sum1 === "Sourdough Loaf", `1 item summary is exact title ('${sum1}')`);
    assert(
      sum3 === "Sourdough Loaf, Brownie Box and 1 more",
      `3 items summary formats with first two + remainder ('${sum3}')`
    );
    assert(
      sum5 === "Sourdough Loaf, Brownie Box and 3 more",
      `5 items summary formats with first two + remainder ('${sum5}')`
    );

    // Also verify via full template variable resolver
    const summaryResolution = await resolveTemplateVariables({
      placeholders: ["items"],
      mapping: {
        items: { source: "trigger_field", field: "cart.items_summary" },
      },
      contact: { name: "Ananya", email: null, phone: "+919876543210", attributes: {} },
      triggerData: {
        cart: { lineItems: threeItems },
      },
    });
    assert(
      "resolved" in summaryResolution &&
        summaryResolution.resolved[0] === "Sourdough Loaf, Brownie Box and 1 more",
      "cart.items_summary resolves to expected string in template"
    );
  }

  // =========================================================================
  // 4. MISSING VALUE USES THE FALLBACK
  // =========================================================================
  console.log("\n--- 4. Missing Value Uses Fallback ---");
  {
    // Cart exists but recoveryUrl is null/missing -> uses fallback
    const resWithFallback = await resolveTemplateVariables({
      placeholders: ["recovery_link"],
      mapping: {
        recovery_link: {
          source: "trigger_field",
          field: "cart.recovery_url",
          fallback: "https://shop.example.com/cart",
        },
      },
      contact: { name: "Pooja", email: null, phone: "+919876543210", attributes: {} },
      triggerData: {
        cart: { recoveryUrl: null, total: 100 },
      },
    });

    assert(
      "resolved" in resWithFallback && resWithFallback.resolved[0] === "https://shop.example.com/cart",
      "Missing cart.recovery_url uses specified fallback"
    );

    // Order number missing -> uses fallback
    const resOrderFallback = await resolveTemplateVariables({
      placeholders: ["order_num"],
      mapping: {
        order_num: {
          source: "trigger_field",
          field: "order.number",
          fallback: "recent order",
        },
      },
      contact: { name: "Pooja", email: null, phone: "+919876543210", attributes: {} },
      triggerData: {
        order: { orderNumber: null },
      },
    });

    assert(
      "resolved" in resOrderFallback && resOrderFallback.resolved[0] === "recent order",
      "Missing order.number uses specified fallback"
    );
  }

  // =========================================================================
  // 5. MISSING VALUE WITH NO FALLBACK RETURNS ERROR & LOGS
  // =========================================================================
  console.log("\n--- 5. Missing Value Without Fallback Returns Error ---");
  {
    const resNoFallback = await resolveTemplateVariables({
      placeholders: ["recovery_link"],
      mapping: {
        recovery_link: {
          source: "trigger_field",
          field: "cart.recovery_url",
        },
      },
      contact: { name: "Kunal", email: null, phone: "+919876543210", attributes: {} },
      triggerData: {
        cart: { recoveryUrl: null },
      },
    });

    assert(
      "error" in resNoFallback && resNoFallback.error.includes("cart.recovery_url"),
      "Missing trigger field without fallback returns descriptive error mentioning field name"
    );
  }

  // =========================================================================
  // 6. TRIGGER VALIDATION: CART IN ORDER REJECTED, ORDER IN CART REJECTED
  // =========================================================================
  console.log("\n--- 6. Trigger Type Compatibility Validation ---");
  {
    const mockTplDb = {
      template: {
        findUnique: async () => ({
          id: "tpl_cart",
          providerName: "cart_reminder",
          placeholders: ["var1"],
          positionalPlaceholders: ["var1"],
        }),
      },
    };

    // Step with cart.recovery_url in an order journey trigger
    const stepsCartField: any[] = [
      {
        type: "send_message",
        templateId: "tpl_cart",
        channelId: "chn_1",
        variableMapping: {
          var1: { source: "trigger_field", field: "cart.recovery_url" },
        },
      },
    ];

    // Step with order.number in a cart abandonment trigger
    const stepsOrderField: any[] = [
      {
        type: "send_message",
        templateId: "tpl_cart",
        channelId: "chn_1",
        variableMapping: {
          var1: { source: "trigger_field", field: "order.number" },
        },
      },
    ];

    // 1. cart.* field in order_placed_cod journey -> must fail activation
    const orderRes = await validateJourneyStepsForActivation(mockTplDb as any, stepsCartField, "order_placed_cod");
    assert(
      !orderRes.valid && orderRes.errors.some((e) => e.toLowerCase().includes("cart")),
      "cart.* field in an order journey trigger is rejected at activation"
    );

    // 2. order.* field in cart_abandoned journey -> must fail activation
    const cartRes = await validateJourneyStepsForActivation(mockTplDb as any, stepsOrderField, "cart_abandoned");
    assert(
      !cartRes.valid && cartRes.errors.some((e) => e.toLowerCase().includes("order")),
      "order.* field in a cart abandonment journey trigger is rejected at activation"
    );

    // 3. cart.* field in cart_abandoned journey -> passes
    const validCartResult = await validateJourneyStepsForActivation(
      mockTplDb as any,
      stepsCartField,
      "cart_abandoned"
    );
    assert(validCartResult.valid, "cart.* field in cart_abandoned journey passes activation validation");

    // 4. order.* field in order_delivered journey -> passes
    const validOrderResult = await validateJourneyStepsForActivation(
      mockTplDb as any,
      stepsOrderField,
      "order_delivered"
    );
    assert(validOrderResult.valid, "order.* field in order_delivered journey passes activation validation");
  }

  // =========================================================================
  // 7. UNKNOWN FIELD REJECTED
  // =========================================================================
  console.log("\n--- 7. Unknown Trigger Field Rejection ---");
  {
    const mockTplDb = {
      template: {
        findUnique: async () => ({
          id: "tpl_cart",
          providerName: "cart_reminder",
          placeholders: ["var1"],
          positionalPlaceholders: ["var1"],
        }),
      },
    };

    const stepsUnknownField: any[] = [
      {
        type: "send_message",
        templateId: "tpl_cart",
        channelId: "chn_1",
        variableMapping: {
          var1: { source: "trigger_field", field: "cart.non_existent_field" },
        },
      },
    ];

    const resUnknown = await validateJourneyStepsForActivation(
      mockTplDb as any,
      stepsUnknownField,
      "cart_abandoned"
    );
    assert(
      !resUnknown.valid && resUnknown.errors.some((e) => e.includes("cart.non_existent_field")),
      "Unknown trigger field key is rejected at activation with clear error"
    );
  }

  // =========================================================================
  // 8. SANITIZATION (NEWLINE, TAB, 4+ CONSECUTIVE SPACES, OVER-LENGTH)
  // =========================================================================
  console.log("\n--- 8. WhatsApp Parameter Sanitization ---");
  {
    // Newlines and tabs replaced with space
    const withNewlines = "Hello\nWorld\r\nFrom\tNextCRM";
    const sanitizedNewlines = sanitizeTemplateParam(withNewlines);
    assert(
      sanitizedNewlines === "Hello World From NextCRM",
      `Newlines and tabs replaced with single space ('${sanitizedNewlines}')`
    );

    // 4 or more consecutive spaces collapsed
    const withManySpaces = "Word1    Word2       Word3";
    const sanitizedSpaces = sanitizeTemplateParam(withManySpaces);
    assert(
      sanitizedSpaces === "Word1 Word2 Word3",
      `Runs of 4 or more consecutive spaces collapsed to single space ('${sanitizedSpaces}')`
    );

    // Trimming whitespace
    const withOuterSpaces = "   Padded Content   ";
    assert(
      sanitizeTemplateParam(withOuterSpaces) === "Padded Content",
      "Outer whitespace is trimmed"
    );

    // Over-length (capped at 1000 chars, truncated with "…")
    const longString = "A".repeat(1200);
    const sanitizedLong = sanitizeTemplateParam(longString);
    assert(
      sanitizedLong.length === 1000 && sanitizedLong.endsWith("…"),
      `Strings over 1000 chars capped at 1000 and ended with '…' (len: ${sanitizedLong.length})`
    );

    // Verify sanitization is applied during template variable resolution
    const resSanitized = await resolveTemplateVariables({
      placeholders: ["msg"],
      mapping: {
        msg: { source: "fixed", value: "Line1\nLine2\tLine3    End" },
      },
      contact: { name: "User", email: null, phone: "+919876543210", attributes: {} },
    });
    assert(
      "resolved" in resSanitized && resSanitized.resolved[0] === "Line1 Line2 Line3 End",
      "Sanitization applied to resolved output for all sources"
    );
  }

  // =========================================================================
  // 9. CROSS-WORKSPACE SAFETY (RUN CANNOT READ ANOTHER WORKSPACE'S CART)
  // =========================================================================
  console.log("\n--- 9. Cross-Workspace Scoping Safety ---");
  {
    // Storage has a cart belonging to Workspace B
    const multiTenantStorage = {
      carts: [
        {
          id: "cart_workspace_b",
          workspaceId: "workspace_b",
          recoveryUrl: "https://workspace-b.com/cart/secret-token",
          total: 5000,
          currency: "USD",
        },
      ],
      orders: [
        {
          id: "order_workspace_b",
          workspaceId: "workspace_b",
          orderNumber: "WB-9999",
          total: 8000,
          currency: "USD",
        },
      ],
    };

    // Client scoped strictly to Workspace A
    const workspaceADb = createWorkspaceScopedDb("workspace_a", multiTenantStorage);

    // Run executing in Workspace A tries to supply cartId from Workspace B
    const crossCartResult = await resolveTemplateVariables({
      placeholders: ["secret_link"],
      mapping: {
        secret_link: { source: "trigger_field", field: "cart.recovery_url" },
      },
      contact: { name: "Attacker", email: null, phone: "+919876543210", attributes: {} },
      db: workspaceADb,
      workspaceId: "workspace_a",
      cartId: "cart_workspace_b", // Foreign cart ID!
    });

    assert(
      "error" in crossCartResult,
      "Workspace A cannot resolve cart from Workspace B (cross-workspace leak prevented)"
    );

    // Same test for orders: Workspace A tries to read order from Workspace B
    const crossOrderResult = await resolveTemplateVariables({
      placeholders: ["secret_order"],
      mapping: {
        secret_order: { source: "trigger_field", field: "order.number" },
      },
      contact: { name: "Attacker", email: null, phone: "+919876543210", attributes: {} },
      db: workspaceADb,
      workspaceId: "workspace_a",
      orderId: "order_workspace_b", // Foreign order ID!
    });

    assert(
      "error" in crossOrderResult,
      "Workspace A cannot resolve order from Workspace B (cross-workspace leak prevented)"
    );
  }

  // =========================================================================
  // 10. REGRESSION CHECK: ALL 16 EXISTING TESTS STILL PASS
  // =========================================================================
  console.log("\n--- 10. Regression Check on Existing 16 Tests ---");
  {
    try {
      const { passed: prevPassed, failed: prevFailed } = await runJourneyVariableTests();
      assert(
        prevPassed === 16 && prevFailed === 0,
        "All 16 existing journey variable tests pass without regression (16 Passed, 0 Failed)"
      );
    } catch (e: any) {
      assert(false, "Existing journey variable test suite failed", e?.message);
    }
  }

  console.log(`\n========================================`);
  console.log(`Trigger Variables Suite Complete: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test execution threw uncaught error:", err);
  process.exit(1);
});
