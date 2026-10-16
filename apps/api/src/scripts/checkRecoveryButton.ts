import {
  extractRecoveryPath,
  validateButtonValue,
  getTemplateDynamicButton,
  resolveButtonVariable,
  buildTemplateMessagePayload,
  CART_TRIGGER_FIELDS,
  ALL_TRIGGER_FIELDS,
} from "@nextcrm/core";
import { validateJourneyStepsForActivation } from "../validation/journeySchema";
import { runJourneyVariableTests } from "./checkJourneyVariables";

const { reconcileVariableMapping } = require("../../../web/src/lib/journeyStepBuilder");

function createMockDb(templates: Record<string, any>) {
  return {
    template: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return templates[where.id] || null;
      },
    },
  };
}

export async function runRecoveryButtonTests() {
  console.log("=== Running WhatsApp Recovery Button Verification Test Suite ===\n");
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
  // TEST GROUP 1: Suffix extraction when the host matches the base
  // =========================================================================
  console.log("--- 1. Suffix Extraction (Host Matches Base) ---");

  const baseWithSubpath = "https://shop.example.com/checkout/{{1}}";
  const recoverySameHost = "https://shop.example.com/checkout/c/12345?key=abc";
  const extractedSameHost = extractRecoveryPath(baseWithSubpath, recoverySameHost);
  assert(
    extractedSameHost === "c/12345?key=abc",
    "Suffix extraction when host matches base returns remainder after base",
    `Expected 'c/12345?key=abc', got '${extractedSameHost}'`
  );

  const baseOriginSlash = "https://shop.example.com/{{1}}";
  const recoveryOriginSlash = "https://shop.example.com/12345/checkouts/c1?key=xyz";
  const extractedOriginSlash = extractRecoveryPath(baseOriginSlash, recoveryOriginSlash);
  assert(
    extractedOriginSlash === "12345/checkouts/c1?key=xyz",
    "Suffix extraction with origin base (trailing slash) returns remainder",
    `Expected '12345/checkouts/c1?key=xyz', got '${extractedOriginSlash}'`
  );

  // =========================================================================
  // TEST GROUP 2: Different host with an origin-only base
  // =========================================================================
  console.log("\n--- 2. Different Host with Origin-Only Base ---");

  const buttonOriginBase = "https://shop.example.com/{{1}}";
  const recoveryShopifyDomain = "https://checkout.shopify.com/12345/checkouts/c1-abc?key=xyz";
  const extractedDiffHost = extractRecoveryPath(buttonOriginBase, recoveryShopifyDomain);
  assert(
    extractedDiffHost === "12345/checkouts/c1-abc?key=xyz",
    "Different host with origin-only base (trailing slash) returns path + query without double slash",
    `Expected '12345/checkouts/c1-abc?key=xyz', got '${extractedDiffHost}'`
  );

  const buttonOriginNoSlash = "https://shop.example.com{{1}}";
  const extractedDiffHostNoSlash = extractRecoveryPath(buttonOriginNoSlash, recoveryShopifyDomain);
  assert(
    extractedDiffHostNoSlash === "/12345/checkouts/c1-abc?key=xyz",
    "Different host with origin-only base (no trailing slash) preserves leading slash",
    `Expected '/12345/checkouts/c1-abc?key=xyz', got '${extractedDiffHostNoSlash}'`
  );

  // =========================================================================
  // TEST GROUP 3: Mismatched base with a path counts as missing
  // =========================================================================
  console.log("\n--- 3. Mismatched Base with a Path ---");

  const buttonPathBase = "https://shop.example.com/cart/{{1}}";
  const recoveryMismatchedHost = "https://checkout.shopify.com/12345/checkouts/c1-abc?key=xyz";
  const extractedMismatch = extractRecoveryPath(buttonPathBase, recoveryMismatchedHost);
  assert(
    extractedMismatch === undefined,
    "Mismatched base with path (/cart/) returns undefined (treated as missing)",
    `Expected undefined, got '${extractedMismatch}'`
  );

  const recoveryDifferentPath = "https://shop.example.com/orders/999";
  const extractedDiffPath = extractRecoveryPath(buttonPathBase, recoveryDifferentPath);
  assert(
    extractedDiffPath === undefined,
    "Same host but different path prefix returns undefined",
    `Expected undefined, got '${extractedDiffPath}'`
  );

  // =========================================================================
  // TEST GROUP 4: Fallback used when the value is missing
  // =========================================================================
  console.log("\n--- 4. Fallback Handling ---");

  // Fallback used when extractRecoveryPath returns undefined
  const resolveWithFallback = resolveButtonVariable({
    buttonUrl: "https://shop.example.com/cart/{{1}}",
    buttonIndex: 0,
    buttonText: "Checkout",
    mappingEntry: {
      source: "trigger_field",
      field: "cart.recovery_path",
      fallback: "cart-recovery",
    },
    cart: {
      recoveryUrl: "https://checkout.shopify.com/12345/mismatch",
    },
  });
  assert(
    "value" in resolveWithFallback && resolveWithFallback.value === "cart-recovery",
    "Fallback used when cart.recovery_path value is missing",
    `Expected fallback 'cart-recovery', got: ${JSON.stringify(resolveWithFallback)}`
  );

  // Fails with clear error naming the button when no fallback is provided
  const resolveNoFallback = resolveButtonVariable({
    buttonUrl: "https://shop.example.com/cart/{{1}}",
    buttonIndex: 0,
    buttonText: "Complete Order",
    mappingEntry: {
      source: "trigger_field",
      field: "cart.recovery_path",
    },
    cart: {
      recoveryUrl: "https://checkout.shopify.com/12345/mismatch",
    },
  });
  assert(
    "error" in resolveNoFallback &&
      resolveNoFallback.error.includes("Complete Order") &&
      resolveNoFallback.error.includes("cart.recovery_path"),
    "Missing value with no fallback fails and names button 'Complete Order'",
    `Expected error naming button, got: ${JSON.stringify(resolveNoFallback)}`
  );

  // =========================================================================
  // TEST GROUP 5: Rejection of whitespace and over-long values
  // =========================================================================
  console.log("\n--- 5. Rejection of Whitespace & Over-Long Values ---");

  // Whitespace rejected
  const resSpace = extractRecoveryPath(
    "https://shop.example.com/checkout/{{1}}",
    "https://shop.example.com/checkout/c/123 45"
  );
  assert(resSpace === undefined, "Recovery path with space is rejected (returns undefined)");

  const resTab = extractRecoveryPath(
    "https://shop.example.com/checkout/{{1}}",
    "https://shop.example.com/checkout/c/123\t45"
  );
  assert(resTab === undefined, "Recovery path with tab is rejected (returns undefined)");

  const resNewline = extractRecoveryPath(
    "https://shop.example.com/checkout/{{1}}",
    "https://shop.example.com/checkout/c/123\n45"
  );
  assert(resNewline === undefined, "Recovery path with newline is rejected (returns undefined)");

  // Control characters rejected
  const resNullByte = extractRecoveryPath(
    "https://shop.example.com/checkout/{{1}}",
    "https://shop.example.com/checkout/c/123\x00"
  );
  assert(resNullByte === undefined, "Recovery path with null byte is rejected (returns undefined)");

  // Length > 2000 rejected
  const longSuffix2001 = "a".repeat(2001);
  const resTooLong = extractRecoveryPath(
    "https://shop.example.com/checkout/{{1}}",
    `https://shop.example.com/checkout/${longSuffix2001}`
  );
  assert(resTooLong === undefined, "Recovery path over 2000 chars is rejected (returns undefined)");

  // Valid long value (1500 chars) is preserved WITHOUT truncation (body sanitizer would truncate to 1000)
  const longSuffix1500 = "b".repeat(1500);
  const resValidLong = extractRecoveryPath(
    "https://shop.example.com/checkout/{{1}}",
    `https://shop.example.com/checkout/${longSuffix1500}`
  );
  assert(
    resValidLong === longSuffix1500 && resValidLong.length === 1500,
    "Valid 1500-char path is preserved exactly without truncation (no '…')",
    `Length: ${resValidLong?.length}`
  );

  // =========================================================================
  // TEST GROUP 6: Correct index for template with two buttons (dynamic is second)
  // =========================================================================
  console.log("\n--- 6. Correct Button Index Detection ---");

  const tplTwoButtonsSecondDynamic = {
    id: "tpl_two_btn",
    providerName: "cart_reminder_buttons",
    buttons: [
      { type: "QUICK_REPLY", text: "Not Interested" },
      { type: "URL", text: "Checkout", url: "https://shop.example.com/checkout/{{1}}" },
    ],
  };

  const dynamicBtnSecond = getTemplateDynamicButton(tplTwoButtonsSecondDynamic);
  assert(
    dynamicBtnSecond !== null && dynamicBtnSecond.index === 1,
    "Template with 2 buttons where dynamic is second returns index 1",
    `Expected index 1, got ${dynamicBtnSecond?.index}`
  );

  const tplDynamicFirst = {
    id: "tpl_dyn_first",
    providerName: "dyn_first",
    buttons: [
      { type: "URL", text: "Recover Cart", url: "https://shop.example.com/cart/{{1}}" },
      { type: "QUICK_REPLY", text: "Opt Out" },
    ],
  };
  const dynamicBtnFirst = getTemplateDynamicButton(tplDynamicFirst);
  assert(
    dynamicBtnFirst !== null && dynamicBtnFirst.index === 0,
    "Template where dynamic URL is first button returns index 0",
    `Expected index 0, got ${dynamicBtnFirst?.index}`
  );

  // Send payload button component has exact 0-based string index: "1"
  const payloadSecondBtn = buildTemplateMessagePayload({
    to: "+919876543210",
    templateName: "cart_reminder_buttons",
    language: "en_US",
    variables: ["Alice"],
    buttonComponent: {
      type: "button",
      sub_type: "url",
      index: String(dynamicBtnSecond?.index),
      parameters: [{ type: "text", text: "c/12345" }],
    },
  });

  const btnComp = payloadSecondBtn.template.components.find((c: any) => c.type === "button") as any;
  assert(
    btnComp !== undefined && btnComp.index === "1" && btnComp.sub_type === "url" && btnComp.parameters[0].text === "c/12345",
    "Button component in send payload has string index '1' matching button position",
    JSON.stringify(btnComp)
  );

  // =========================================================================
  // TEST GROUP 7: Activation Validation
  // =========================================================================
  console.log("\n--- 7. Activation Validation ---");

  const mockDb = createMockDb({
    tpl_with_btn: {
      id: "tpl_with_btn",
      providerName: "tpl_with_btn",
      positionalPlaceholders: ["name"],
      placeholders: ["name"],
      buttons: [
        { type: "URL", text: "Shop Now", url: "https://shop.example.com/checkout/{{1}}" },
      ],
    },
  });

  // 7a. Reject journey step whose template has a dynamic URL button but NO button mapping
  const resMissingBtnMap = await validateJourneyStepsForActivation(
    mockDb as any,
    [
      {
        type: "send_message",
        templateId: "tpl_with_btn",
        channelId: "chn_1",
        variableMapping: {
          name: { source: "contact_field", field: "name" },
        },
      },
    ],
    "cart_abandoned"
  );
  assert(
    !resMissingBtnMap.valid &&
      resMissingBtnMap.errors.some((e) => e.includes("Shop Now") && e.includes("missing a button variable mapping")),
    "Step with dynamic URL button but no button mapping is rejected at activation",
    resMissingBtnMap.errors.join("; ")
  );

  // 7b. cart.recovery_path rejected on non-cart triggers (e.g. order_placed_cod)
  const resCartFieldOnOrder = await validateJourneyStepsForActivation(
    mockDb as any,
    [
      {
        type: "send_message",
        templateId: "tpl_with_btn",
        channelId: "chn_1",
        variableMapping: {
          name: { source: "contact_field", field: "name" },
          "button:url": { source: "trigger_field", field: "cart.recovery_path" },
        },
      },
    ],
    "order_placed_cod"
  );
  assert(
    !resCartFieldOnOrder.valid &&
      resCartFieldOnOrder.errors.some((e) => e.includes("cart.recovery_path") && e.includes("only allowed for cart abandonment journeys")),
    "cart.recovery_path button mapping rejected on order journey trigger",
    resCartFieldOnOrder.errors.join("; ")
  );

  // 7c. cart.recovery_path accepted on cart_abandoned triggers
  const resValidCartActivation = await validateJourneyStepsForActivation(
    mockDb as any,
    [
      {
        type: "send_message",
        templateId: "tpl_with_btn",
        channelId: "chn_1",
        variableMapping: {
          name: { source: "contact_field", field: "name" },
          "button:url": { source: "trigger_field", field: "cart.recovery_path" },
        },
      },
    ],
    "cart_abandoned"
  );
  assert(
    resValidCartActivation.valid,
    "Dynamic button with cart.recovery_path mapping passes activation on cart_abandoned journey",
    resValidCartActivation.errors.join("; ")
  );

  // =========================================================================
  // TEST GROUP 8: The no-button payload stays unchanged (Regression)
  // =========================================================================
  console.log("\n--- 8. No-Button Payload Regression Test ---");

  const legacyPayload = buildTemplateMessagePayload({
    to: "+1234567890",
    templateName: "order_confirmation",
    language: "en_US",
    variables: ["Alice", "$49.99"],
  });

  const expectedLegacyPayload = {
    messaging_product: "whatsapp",
    to: "+1234567890",
    type: "template",
    template: {
      name: "order_confirmation",
      language: {
        code: "en_US",
      },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", variable: undefined, text: "Alice" },
            { type: "text", variable: undefined, text: "$49.99" },
          ],
        },
      ],
    },
  };

  assert(
    JSON.stringify(legacyPayload) === JSON.stringify(expectedLegacyPayload),
    "Templates without dynamic buttons produce exact identical payload as today",
    `Payload: ${JSON.stringify(legacyPayload)}`
  );

  // reconcileVariableMapping test for button preservation
  const reconciledKeep = reconcileVariableMapping(
    {
      name: { source: "contact_field", field: "name" },
      old_field: { source: "fixed", value: "old" },
      "button:url": { source: "trigger_field", field: "cart.recovery_path" },
    },
    ["name"],
    true
  );
  assert(
    reconciledKeep["button:url"] !== undefined &&
      reconciledKeep["name"] !== undefined &&
      reconciledKeep["old_field"] === undefined,
    "reconcileVariableMapping preserves button:url and valid placeholders while dropping stale ones"
  );

  const reconciledDrop = reconcileVariableMapping(
    {
      name: { source: "contact_field", field: "name" },
      "button:url": { source: "trigger_field", field: "cart.recovery_path" },
    },
    ["name"],
    false
  );
  assert(
    reconciledDrop["button:url"] === undefined && reconciledDrop["name"] !== undefined,
    "reconcileVariableMapping drops button:url when template explicitly has no dynamic button"
  );

  // =========================================================================
  // TEST GROUP 9: All existing suites still pass
  // =========================================================================
  console.log("\n--- 9. Existing Suites Regression Verification ---");
  const journeySuiteRes = await runJourneyVariableTests();
  assert(
    journeySuiteRes.failed === 0,
    "Existing checkJourneyVariables suite passes completely (16/16)",
    `${journeySuiteRes.passed} passed, ${journeySuiteRes.failed} failed`
  );

  // Summary
  console.log(`\n========================================`);
  console.log(`Recovery Button Verification Complete: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  return { passed, failed };
}

if (require.main === module || process.argv[1]?.includes("checkRecoveryButton")) {
  runRecoveryButtonTests()
    .then((res) => {
      process.exit(res.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error("Test execution failed:", err);
      process.exit(1);
    });
}
