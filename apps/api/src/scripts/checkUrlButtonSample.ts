import {
  templateButtonSchema,
  createTemplateSchema,
  extractPlaceholders,
  extractPositionalPlaceholders,
} from "../validation/templateSchema";
import {
  submitTemplate,
  getTemplateDynamicButton,
  resolveButtonVariable,
} from "@nextcrm/core";

export async function runUrlButtonSampleTests() {
  console.log("=== Running URL Button Sample Verification Test Suite ===\n");
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
  // 1. Schema Validation Tests
  // =========================================================================
  console.log("--- 1. Schema Validation (templateButtonSchema) ---");

  // Valid dynamic URL button with sample
  const validDynamicBtn = templateButtonSchema.safeParse({
    type: "URL",
    text: "Recover Cart",
    url: "https://shop.example.com/checkout/{{1}}",
    sample: "12345/checkouts/abc/recover?key=xyz",
  });
  assert(
    validDynamicBtn.success,
    "Valid dynamic URL button with sample passes schema validation"
  );

  // Missing sample on dynamic URL button (omitted)
  const missingSampleBtn = templateButtonSchema.safeParse({
    type: "URL",
    text: "Recover Cart",
    url: "https://shop.example.com/checkout/{{1}}",
  });
  assert(
    !missingSampleBtn.success &&
      missingSampleBtn.error.issues.some((i) => i.path.includes("sample")),
    "Dynamic URL button missing sample is rejected by schema",
    !missingSampleBtn.success
      ? missingSampleBtn.error.issues[0]?.message
      : "Expected error"
  );

  // Empty string sample on dynamic URL button
  const emptySampleBtn = templateButtonSchema.safeParse({
    type: "URL",
    text: "Recover Cart",
    url: "https://shop.example.com/checkout/{{1}}",
    sample: "   ",
  });
  assert(
    !emptySampleBtn.success &&
      emptySampleBtn.error.issues.some((i) => i.path.includes("sample")),
    "Dynamic URL button with whitespace-only sample is rejected by schema"
  );

  // {{1}} not at the end of the URL
  const notAtEndBtn = templateButtonSchema.safeParse({
    type: "URL",
    text: "Recover Cart",
    url: "https://shop.example.com/checkout/{{1}}/details",
    sample: "12345",
  });
  assert(
    !notAtEndBtn.success &&
      notAtEndBtn.error.issues.some(
        (i) => i.path.includes("url") && i.message.includes("end")
      ),
    "URL with {{1}} not at the end is rejected by schema",
    !notAtEndBtn.success ? notAtEndBtn.error.issues[0]?.message : "Expected error"
  );

  // Two placeholders in URL
  const twoPlaceholdersBtn = templateButtonSchema.safeParse({
    type: "URL",
    text: "Recover Cart",
    url: "https://shop.example.com/checkout/{{1}}?key={{2}}",
    sample: "12345",
  });
  assert(
    !twoPlaceholdersBtn.success &&
      twoPlaceholdersBtn.error.issues.some(
        (i) => i.path.includes("url") && i.message.includes("single placeholder")
      ),
    "URL with two placeholders is rejected by schema"
  );

  // Another placeholder (e.g. {{name}} instead of {{1}})
  const namedPlaceholderBtn = templateButtonSchema.safeParse({
    type: "URL",
    text: "Recover Cart",
    url: "https://shop.example.com/checkout/{{name}}",
    sample: "12345",
  });
  assert(
    !namedPlaceholderBtn.success &&
      namedPlaceholderBtn.error.issues.some(
        (i) => i.path.includes("url") && i.message.includes("{{1}}")
      ),
    "URL with named placeholder {{name}} instead of {{1}} is rejected"
  );

  // Non-HTTPS URL with dynamic placeholder
  const nonHttpsBtn = templateButtonSchema.safeParse({
    type: "URL",
    text: "Recover Cart",
    url: "http://shop.example.com/checkout/{{1}}",
    sample: "12345",
  });
  assert(
    !nonHttpsBtn.success &&
      nonHttpsBtn.error.issues.some(
        (i) => i.path.includes("url") && i.message.includes("https://")
      ),
    "URL with http:// instead of https:// is rejected for dynamic button"
  );

  // Static URL button without placeholder (no sample required)
  const staticBtn = templateButtonSchema.safeParse({
    type: "URL",
    text: "Visit Help",
    url: "https://shop.example.com/help",
  });
  assert(
    staticBtn.success,
    "Static URL button without placeholder passes schema without sample"
  );

  // createTemplateSchema end-to-end check
  console.log("\n--- 2. createTemplateSchema End-to-End ---");
  const validTemplate = createTemplateSchema.safeParse({
    channelId: "chan_123",
    name: "abandoned_cart_recovery",
    language: "en_US",
    category: "utility",
    body: "Hi {{name}}, your cart is waiting!",
    examples: { name: "Alice" },
    buttons: [
      {
        type: "URL",
        text: "Complete Order",
        url: "https://shop.example.com/checkout/{{1}}",
        sample: "12345/recovery",
      },
    ],
  });
  assert(
    validTemplate.success,
    "createTemplateSchema accepts valid dynamic URL button with sample"
  );

  const missingSampleTemplate = createTemplateSchema.safeParse({
    channelId: "chan_123",
    name: "abandoned_cart_recovery",
    language: "en_US",
    category: "utility",
    body: "Hi {{name}}, your cart is waiting!",
    examples: { name: "Alice" },
    buttons: [
      {
        type: "URL",
        text: "Complete Order",
        url: "https://shop.example.com/checkout/{{1}}",
      },
    ],
  });
  assert(
    !missingSampleTemplate.success,
    "createTemplateSchema rejects template when dynamic URL button is missing sample"
  );

  // =========================================================================
  // 2. Payload Sent to Meta (submitTemplate)
  // =========================================================================
  console.log("\n--- 3. Meta Submission Payload Verification ---");

  let submittedPayload: any = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: any, init: any) => {
    submittedPayload = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ id: "meta_tpl_999" }),
    } as any;
  };

  try {
    // Test Dynamic Button Payload
    await submitTemplate({
      accessToken: "mock_token",
      wabaId: "waba_123",
      name: "cart_reminder",
      language: "en_US",
      category: "UTILITY",
      body: "Hi {{name}}, your cart is waiting!",
      positionalPlaceholders: ["name"],
      examples: { name: "John Doe" },
      buttons: [
        {
          type: "URL",
          text: "Recover Cart",
          url: "https://shop.example.com/checkouts/{{1}}",
          sample: "12345/checkouts/abc123/recover?key=xyz",
        },
      ],
    });

    const buttonsComponent = submittedPayload?.components?.find(
      (c: any) => c.type === "BUTTONS"
    );
    const urlButton = buttonsComponent?.buttons?.[0];

    assert(
      Array.isArray(urlButton?.example) &&
        urlButton.example.length === 1 &&
        urlButton.example[0] === "12345/checkouts/abc123/recover?key=xyz",
      "Dynamic URL button includes example array with variable value in Meta payload",
      `Expected example: ['12345/checkouts/abc123/recover?key=xyz'], got: ${JSON.stringify(
        urlButton?.example
      )}`
    );

    // Verify Body Variable Examples Regression Check
    const bodyComponent = submittedPayload?.components?.find(
      (c: any) => c.type === "BODY"
    );
    assert(
      Array.isArray(bodyComponent?.example?.body_text) &&
        bodyComponent.example.body_text[0]?.[0] === "John Doe",
      "Body variable examples are still formatted and sent as before ([[John Doe]])"
    );

    // Test Static Button Payload
    submittedPayload = null;
    await submitTemplate({
      accessToken: "mock_token",
      wabaId: "waba_123",
      name: "static_link_template",
      language: "en_US",
      category: "UTILITY",
      body: "Check out our website below.",
      positionalPlaceholders: [],
      buttons: [
        {
          type: "URL",
          text: "Visit Help",
          url: "https://shop.example.com/help",
        },
      ],
    });

    const staticButtonsComponent = submittedPayload?.components?.find(
      (c: any) => c.type === "BUTTONS"
    );
    const staticUrlButton = staticButtonsComponent?.buttons?.[0];

    assert(
      staticUrlButton && !("example" in staticUrlButton),
      "Static URL button payload has NO example property sent to Meta",
      `Found unexpected example: ${JSON.stringify(staticUrlButton?.example)}`
    );
    assert(
      staticUrlButton?.url === "https://shop.example.com/help",
      "Static URL button preserves URL unchanged in Meta payload"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  // =========================================================================
  // 3. Storage Round-Trip & Journey Runtime Independence
  // =========================================================================
  console.log("\n--- 4. Storage & Journey Runtime Independence ---");

  // Mock template object stored in DB
  const storedTemplate = {
    id: "tpl_cart_recover",
    providerName: "cart_recover_v1",
    buttons: [
      {
        type: "URL",
        text: "Recover Cart",
        url: "https://shop.example.com/checkout/{{1}}",
        sample: "12345/checkouts/abc123/recover?key=xyz",
      },
    ],
  };

  // getTemplateDynamicButton reading
  const dynamicBtn = getTemplateDynamicButton(storedTemplate);
  assert(
    dynamicBtn !== null &&
      dynamicBtn.index === 0 &&
      dynamicBtn.base === "https://shop.example.com/checkout/" &&
      dynamicBtn.url === "https://shop.example.com/checkout/{{1}}",
    "getTemplateDynamicButton still correctly detects dynamic button when sample is present"
  );

  // Ensure journey resolution ignores sample and resolves live value from mapping
  const liveCart = {
    recoveryUrl: "https://shop.example.com/checkout/live999?token=secret",
  };
  const liveContact = {
    id: "contact_1",
    phone: "+1234567890",
  };

  const resolved = resolveButtonVariable({
    buttonUrl: dynamicBtn!.url,
    buttonIndex: dynamicBtn!.index,
    buttonText: dynamicBtn!.text,
    mappingEntry: {
      source: "trigger_field",
      field: "cart.recovery_path",
    },
    cart: liveCart,
    contact: liveContact,
  });

  assert(
    "value" in resolved && resolved.value === "live999?token=secret",
    "Journey resolution resolves live customer recovery path ('live999?token=secret'), NOT sample",
    `Expected 'live999?token=secret', got: ${JSON.stringify(resolved)}`
  );

  // Summary
  console.log(`\n========================================`);
  console.log(`Verification Complete: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  return { passed, failed };
}

if (require.main === module || process.argv[1]?.includes("checkUrlButtonSample")) {
  runUrlButtonSampleTests()
    .then((res) => {
      if (res.failed > 0) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Test execution failed:", err);
      process.exit(1);
    });
}
