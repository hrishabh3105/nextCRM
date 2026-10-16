# URL Button Sample Value & Meta Verification Summary

## 1. Meta Example Format Verified

* **Documentation Source**: [Meta WhatsApp Cloud API Message Templates Components Reference](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/components#url-buttons)
* **Exact Component Shape on URL Button**:
  In the official Meta documentation under **URL buttons**:
  
  **Syntax**:
  ```json
  {
    "type": "URL",
    "text": "<TEXT>",
    "url": "<URL>",

    # Required if <URL> contains a variable
    "example": [
      "<EXAMPLE>"
    ]
  }
  ```

  **Official Code Example**:
  ```json
  {
    "type": "URL",
    "text": "Shop Now",
    "url": "https://www.luckyshrub.com/shop?promo={{1}}",
    "example": [
      "summer2023"
    ]
  }
  ```

* **Variable Value vs. Full URL**:
  - The `example` property on the URL button must be an array of string(s) containing **only the variable value** that replaces `{{1}}` (e.g. `["summer2023"]` or `["12345/checkouts/abc123/recover?key=xyz"]`).
  - While Meta's properties table descriptive column includes an example URL (`https://www.luckyshrub.com/shop?promo=summer2023`), the actual JSON payload specification and example code snippet provided in the documentation explicitly demonstrate that `example` contains the dynamic variable value: `example: ["summer2023"]`.
  - In our implementation, we send `example: [sampleValue]` where `sampleValue` is the variable value provided by the user.

---

## 2. Files Changed

1. **`apps/api/src/validation/templateSchema.ts`**:
   - Updated `templateButtonSchema` to include `sample?: string` on URL buttons.
   - Added validation via `.superRefine`:
     - If `url` contains `{{`, it must start with `https://`.
     - It must contain exactly one placeholder `{{1}}`, positioned at the very end of the URL (`url.endsWith("{{1}}")`).
     - Multiple placeholders or non-`{{1}}` placeholders (e.g., `{{2}}`, `{{name}}`) are rejected with clear error messages.
     - A non-empty `sample` value is required when `{{` is present.
     - Static URL buttons without placeholders continue working without requiring a sample.
   - Automatically applied to `createTemplateSchema` which validates `buttons: z.array(templateButtonSchema)`.

2. **`packages/core/src/services/metaClient.ts`**:
   - Updated `MetaTemplateButtonParam` type to include `sample?: string` and `example?: string | string[]`.
   - In `submitTemplate`: when mapping URL buttons, if a sample is provided for a dynamic URL button, it is formatted as an array `example: [sample.trim()]` matching Meta's specification.
   - Static URL buttons omit the `example` field entirely.
   - Verified that body variable examples (`BODY` component `example: { body_text: [exampleValues] }`) remain untouched and continue to send as before.

3. **`apps/web/src/pages/TemplatesPage.tsx`**:
   - Updated `TemplateButton` and `ButtonEditorRow` interfaces with `sample?: string`.
   - Updated `handleCreateSubmit` form validation to enforce dynamic URL button rules (starts with `https://`, ends with `{{1}}`, single placeholder, required non-empty sample) and block submission with inline error messages if invalid or empty.
   - In the button editor modal UI:
     - Directly below the "Target Web URL" input, dynamically rendered a required "Sample value" input when the URL contains `{{1}}`.
     - Added helper text: *"Example of what replaces {{1}}, such as 12345/checkouts/abc123/recover?key=xyz. Meta uses it to review the template."*
     - Hid the sample input when there is no placeholder in the URL.
     - Displayed inline error messages if `{{` is present but not placed at the end of the URL, if it does not start with `https://`, or if multiple placeholders exist.

4. **`apps/api/src/scripts/checkUrlButtonSample.ts`** *(New)*:
   - Automated test script validating:
     - Valid dynamic URL button with sample passes.
     - Missing sample on dynamic URL button fails.
     - Whitespace-only sample fails.
     - `{{1}}` not at the end of the URL fails.
     - Two placeholders in URL fails.
     - Non-`{{1}}` placeholder in URL fails.
     - `http://` instead of `https://` fails.
     - Static URL button without placeholder passes without sample.
     - `createTemplateSchema` end-to-end template validation passes with valid dynamic button + sample, rejects without sample.
     - `submitTemplate` generates `example: ["..."]` with the variable value for dynamic URL buttons.
     - `submitTemplate` generates static URL button without `example` property.
     - Body variable examples continue to format as `body_text: [["..."]]`.
     - Storage round-trip and `getTemplateDynamicButton` correctly detect dynamic button index and URL without treating `sample` as live value.
     - `resolveButtonVariable` resolves from customer/cart mapping, not the sample.

---

## 3. Test Results

### Suite Executions
* **`apps/api/src/scripts/checkUrlButtonSample.ts`**:
  ```
  === Running URL Button Sample Verification Test Suite ===
  --- 1. Schema Validation (templateButtonSchema) ---
  [PASS] Valid dynamic URL button with sample passes schema validation
  [PASS] Dynamic URL button missing sample is rejected by schema
  [PASS] Dynamic URL button with whitespace-only sample is rejected by schema
  [PASS] URL with {{1}} not at the end is rejected by schema
  [PASS] URL with two placeholders is rejected by schema
  [PASS] URL with named placeholder {{name}} instead of {{1}} is rejected
  [PASS] URL with http:// instead of https:// is rejected for dynamic button
  [PASS] Static URL button without placeholder passes schema without sample
  --- 2. createTemplateSchema End-to-End ---
  [PASS] createTemplateSchema accepts valid dynamic URL button with sample
  [PASS] createTemplateSchema rejects template when dynamic URL button is missing sample
  --- 3. Meta Submission Payload Verification ---
  [PASS] Dynamic URL button includes example array with variable value in Meta payload
  [PASS] Body variable examples are still formatted and sent as before ([[John Doe]])
  [PASS] Static URL button payload has NO example property sent to Meta
  [PASS] Static URL button preserves URL unchanged in Meta payload
  --- 4. Storage & Journey Runtime Independence ---
  [PASS] getTemplateDynamicButton still correctly detects dynamic button when sample is present
  [PASS] Journey resolution resolves live customer recovery path ('live999?token=secret'), NOT sample

  ========================================
  Verification Complete: 16 Passed, 0 Failed
  ========================================
  ```

* **`apps/api/src/scripts/checkRecoveryButton.ts`**:
  - `Recovery Button Verification Complete: 24 Passed, 0 Failed`
  - `checkJourneyVariables Suite: 16 Passed, 0 Failed`

* **`apps/api/src/scripts/checkTriggerVariables.ts`**:
  - `Trigger Variables Suite Complete: 26 Passed, 0 Failed`

* **`apps/api/src/scripts/checkConsent.ts`**:
  - `Verification Complete: 49 Passed, 0 Failed`

* **`apps/api/src/scripts/checkCartConversion.ts`**:
  - `Verification Complete: 13 Passed, 0 Failed`

### TypeScript Compilation (`npx tsc --noEmit`)
* `packages/core`: Passed (0 errors)
* `apps/api`: Passed (0 errors)
* `apps/web`: Passed (0 errors)
* `apps/worker`: Passed (0 errors)

---

## 4. Anything Uncertain / Notes

* **Table vs Example Code in Meta Documentation**:
  Meta's components reference document features a description in its properties table that displays the full URL string (`https://www.luckyshrub.com/shop?promo=summer2023`) in the "Example Value" column, whereas the syntax definition and actual code example under the table explicitly specify the dynamic suffix/variable value only (`"example": ["summer2023"]`). Our implementation adheres strictly to the code example and syntax definition (`example: [sample]`), which correctly injects the variable value replacing `{{1}}`.
* **Zero Disruption to Existing Journeys**:
  Stored templates retain `sample` within `Template.buttons` JSON. `getTemplateDynamicButton` continues to match `b.url.includes("{{1}}")` without interference, and `resolveButtonVariable` resolves live customer data from trigger/contact mappings without ever treating the sample as the runtime value.
