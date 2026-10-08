import { resolveTemplateVariables } from "@nextcrm/core";
import { validateJourneyStepsForActivation } from "../validation/journeySchema";

// Note: journeyStepBuilder is located in apps/web (the web translation layer).
// Because apps/api has rootDir: "src", static TypeScript import from apps/web triggers TS6059.
// We dynamically require the real functions so we test the actual production implementation.
const {
  flattenToEngineSteps,
  reconcileVariableMapping,
} = require("../../../web/src/lib/journeyStepBuilder");

function createMockDb(templates: Record<string, any>) {
  return {
    template: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return templates[where.id] || null;
      },
    },
  };
}

async function runTests() {
  console.log("=== Running Journey Template Variable Mapping Verification Tests ===\n");
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

  // Sample templates in mock database
  const mockDb = createMockDb({
    tpl_welcome: {
      id: "tpl_welcome",
      providerName: "welcome_customer",
      positionalPlaceholders: ["name"],
      placeholders: ["name"],
    },
    tpl_order: {
      id: "tpl_order",
      providerName: "order_confirmation",
      positionalPlaceholders: ["customer_name", "order_id", "total"],
      placeholders: ["customer_name", "order_id", "total"],
    },
    tpl_static: {
      id: "tpl_static",
      providerName: "simple_notice",
      positionalPlaceholders: [],
      placeholders: [],
    },
  });

  // =========================================================================
  // TEST GROUP 1: validateJourneyStepsForActivation
  // =========================================================================
  console.log("--- Group 1: Activation Validation ---");

  // 1. All placeholders mapped -> validation passes
  const validSteps = [
    {
      type: "send_message",
      templateId: "tpl_welcome",
      channelId: "chn_1",
      variableMapping: {
        name: { source: "contact_field", field: "name", fallback: "there" },
      },
    },
  ];
  const resValid = await validateJourneyStepsForActivation(mockDb, validSteps);
  assert(resValid.valid === true && resValid.errors.length === 0, "All placeholders mapped -> validation passes");

  // 2. One missing placeholder -> validation fails and names it
  const missingOneStep = [
    {
      type: "send_message",
      templateId: "tpl_order",
      channelId: "chn_1",
      variableMapping: {
        customer_name: { source: "contact_field", field: "name" },
        order_id: { source: "fixed", value: "ORD-1234" },
        // 'total' is missing!
      },
    },
  ];
  const resMissingOne = await validateJourneyStepsForActivation(mockDb, missingOneStep);
  assert(
    resMissingOne.valid === false &&
      resMissingOne.errors.some((e) => e.includes("total") && e.includes("order_confirmation")),
    "One missing placeholder -> activation validation fails and names 'total'",
    resMissingOne.errors.join("; ")
  );

  // 3. No variableMapping defined at all -> validation fails and lists all required placeholders
  const missingAllStep = [
    {
      type: "send_message",
      templateId: "tpl_order",
      channelId: "chn_1",
    },
  ];
  const resMissingAll = await validateJourneyStepsForActivation(mockDb, missingAllStep);
  assert(
    resMissingAll.valid === false &&
      resMissingAll.errors.some((e) => e.includes("customer_name") && e.includes("total")),
    "No mapping defined -> validation fails listing missing placeholders",
    resMissingAll.errors.join("; ")
  );

  // 4. Invalid mapping entry (e.g. contact_attribute with missing key) -> validation fails
  const invalidEntryStep = [
    {
      type: "send_message",
      templateId: "tpl_welcome",
      channelId: "chn_1",
      variableMapping: {
        name: { source: "contact_attribute" }, // missing required key
      },
    },
  ];
  const resInvalidEntry = await validateJourneyStepsForActivation(mockDb, invalidEntryStep);
  assert(
    resInvalidEntry.valid === false &&
      resInvalidEntry.errors.some((e) => e.includes("Invalid mapping") && e.includes("name")),
    "Invalid mapping entry (missing key) -> validation fails with descriptive error",
    resInvalidEntry.errors.join("; ")
  );

  // 5. Template with zero placeholders -> validation passes even with empty mapping
  const zeroPlaceholderSteps = [
    {
      type: "send_message",
      templateId: "tpl_static",
      channelId: "chn_1",
      variableMapping: {},
    },
  ];
  const resZero = await validateJourneyStepsForActivation(mockDb, zeroPlaceholderSteps);
  assert(resZero.valid === true, "Template with zero placeholders -> validation passes");

  // =========================================================================
  // TEST GROUP 2: reconcileVariableMapping (Template Change / Diffing)
  // =========================================================================
  console.log("\n--- Group 2: Template Change Reconcile Function ---");

  const existingMapping = {
    name: { source: "contact_field" as const, field: "name" as const, fallback: "there" },
    old_code: { source: "fixed" as const, value: "DISCOUNT10" },
  };

  // Changing template to one with placeholders: ["name", "new_link"]
  const reconciled = reconcileVariableMapping(existingMapping, ["name", "new_link"]);

  // Stale placeholder 'old_code' should be dropped
  assert(
    !("old_code" in reconciled),
    "Template change drops stale mapping rows ('old_code' removed)"
  );

  // Existing placeholder 'name' should be preserved with exact configuration
  assert(
    reconciled.name?.source === "contact_field" &&
      reconciled.name?.fallback === "there",
    "Template change keeps matching mapping rows ('name' preserved)"
  );

  // Newly introduced placeholder 'new_link' is unmapped in reconciled result so user can configure it
  assert(
    !("new_link" in reconciled),
    "Template change leaves newly introduced placeholders unmapped (triggering inline mapping warnings)"
  );

  // =========================================================================
  // TEST GROUP 3: Fallback resolution via resolveTemplateVariables
  // =========================================================================
  console.log("\n--- Group 3: Variable Resolution with Fallbacks ---");

  // 1. Contact name is null, mapping has fallback -> uses fallback
  const resFallback = resolveTemplateVariables({
    placeholders: ["name"],
    mapping: {
      name: { source: "contact_field", field: "name", fallback: "Valued Customer" },
    },
    contact: {
      name: null,
      phone: "+1234567890",
      email: null,
      attributes: {},
    },
  });
  assert(
    "resolved" in resFallback && resFallback.resolved[0] === "Valued Customer",
    "Fallback used when contact name is null ('Valued Customer')"
  );

  // 2. Contact name is empty string / whitespace, mapping has fallback -> uses fallback
  const resEmptyFallback = resolveTemplateVariables({
    placeholders: ["name"],
    mapping: {
      name: { source: "contact_field", field: "name", fallback: "Valued Customer" },
    },
    contact: {
      name: "   ",
      phone: "+1234567890",
      email: null,
      attributes: {},
    },
  });
  assert(
    "resolved" in resEmptyFallback && resEmptyFallback.resolved[0] === "Valued Customer",
    "Fallback used when contact name is whitespace ('Valued Customer')"
  );

  // 3. Contact name is present -> uses contact name (ignores fallback)
  const resAlice = resolveTemplateVariables({
    placeholders: ["name"],
    mapping: {
      name: { source: "contact_field", field: "name", fallback: "Valued Customer" },
    },
    contact: {
      name: "Alice Johnson",
      phone: "+1234567890",
      email: null,
      attributes: {},
    },
  });
  assert(
    "resolved" in resAlice && resAlice.resolved[0] === "Alice Johnson",
    "Contact name used when present ('Alice Johnson'), fallback ignored"
  );

  // 4. Contact attribute is missing, mapping has fallback -> uses fallback
  const resAttrFallback = resolveTemplateVariables({
    placeholders: ["city"],
    mapping: {
      city: { source: "contact_attribute", key: "city", fallback: "your city" },
    },
    contact: {
      name: "Alice Johnson",
      phone: "+1234567890",
      email: null,
      attributes: {},
    },
  });
  assert(
    "resolved" in resAttrFallback && resAttrFallback.resolved[0] === "your city",
    "Fallback used when custom attribute is missing ('your city')"
  );

  // 5. Contact name is null and NO fallback is provided -> returns error
  const resNoFallback = resolveTemplateVariables({
    placeholders: ["name"],
    mapping: {
      name: { source: "contact_field", field: "name" },
    },
    contact: {
      name: null,
      phone: "+1234567890",
      email: null,
      attributes: {},
    },
  });
  assert(
    "error" in resNoFallback && resNoFallback.error.includes("Missing value for placeholder"),
    "Missing contact value without fallback returns error as expected"
  );

  // =========================================================================
  // TEST GROUP 4: flattenToEngineSteps Preserves Mapping
  // =========================================================================
  console.log("\n--- Group 4: flattenToEngineSteps Mapping Pass-Through ---");

  const friendlySteps: any[] = [
    {
      kind: "wait",
      amount: 1,
      unit: "hours",
    },
    {
      kind: "send_message",
      templateId: "tpl_order",
      channelId: "chn_1",
      variableMapping: {
        customer_name: { source: "contact_field", field: "name", fallback: "Customer" },
        order_id: { source: "contact_attribute", key: "last_order_id" },
        total: { source: "fixed", value: "$49.99" },
      },
    },
    {
      kind: "check_order_placed",
      ifYes: [
        {
          kind: "send_message",
          templateId: "tpl_welcome",
          channelId: "chn_1",
          variableMapping: {
            name: { source: "contact_field", field: "name" },
          },
        },
      ],
      ifNo: [],
    },
  ];

  const engineSteps = flattenToEngineSteps(friendlySteps);

  // Verify the send_message engine step at index 1
  const sendStep = engineSteps.find((s: any) => s.type === "send_message" && s.templateId === "tpl_order") as any;
  assert(
    sendStep !== undefined && sendStep.variableMapping !== undefined,
    "flattenToEngineSteps preserves variableMapping on engine step"
  );

  assert(
    sendStep?.variableMapping?.customer_name?.source === "contact_field" &&
      sendStep?.variableMapping?.customer_name?.fallback === "Customer" &&
      sendStep?.variableMapping?.order_id?.key === "last_order_id" &&
      sendStep?.variableMapping?.total?.value === "$49.99",
    "flattenToEngineSteps preserves exact variable mapping keys, values, and fallback"
  );

  // Verify the nested send_message engine step inside the branch
  const nestedSendStep = engineSteps.find((s: any) => s.type === "send_message" && s.templateId === "tpl_welcome") as any;
  assert(
    nestedSendStep !== undefined &&
      nestedSendStep.variableMapping?.name?.source === "contact_field",
    "flattenToEngineSteps preserves variableMapping on nested conditional branch steps"
  );

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log(`\n========================================`);
  console.log(`Verification Complete: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
