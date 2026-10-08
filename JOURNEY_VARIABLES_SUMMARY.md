# Journey Template Variable Mapping Summary

## Part 1 — Investigation and Findings

1. **Where campaigns store/edit mappings and the exact shape:**
   - **Storage & Edit:** Campaigns store their variable mappings in the `Campaign.variableMapping` database column (Prisma `Json?`). They are configured in [apps/web/src/pages/CampaignsPage.tsx](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/web/src/pages/CampaignsPage.tsx) under the Campaign creation modal and validated on the backend via `variableMappingSchema` in [apps/api/src/validation/campaignSchema.ts](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/validation/campaignSchema.ts).
   - **Exact Shape:** A dictionary keyed by placeholder name, mapping to `VariableMappingEntry`:
     ```typescript
     Record<string, {
       source: "contact_field" | "contact_attribute" | "fixed";
       field?: "name" | "email" | "phone";
       key?: string;
       value?: string;
       fallback?: string;
     }>
     ```
     Examples:
     - Contact Field: `{ source: "contact_field", field: "name", fallback: "there" }`
     - Custom Attribute: `{ source: "contact_attribute", key: "vip_tier", fallback: "Silver" }`
     - Fixed Text: `{ source: "fixed", value: "Summer Sale 2026" }`

2. **Every variable source the resolver supports today:**
   - [packages/core/src/services/templateVariableResolver.ts](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/packages/core/src/services/templateVariableResolver.ts) resolves template placeholders through:
     - `contact_field`: Resolves `contact.name`, `contact.email`, or `contact.phone`.
     - `contact_attribute`: Resolves `contact.attributes[key]` (or `contact.customAttributes[key]`).
     - `fixed`: Resolves static string literal `entry.value`.
     - `fallback`: Optional fallback string evaluated when the resolved value is `null`, `undefined`, or whitespace.
   - **Order / Cart / Trigger Payload Sources:** The resolver does **NOT** support order or cart fields (e.g., cart recovery URL, order number, order totals) today. The resolver function `resolveTemplateVariables({ placeholders, mapping, contact })` operates exclusively on contact attributes and fixed text. Because abandoned-cart messages often require cart recovery links, supporting trigger context would require refactoring the resolver signature across core workers. As per instructions, this was not added silently and is documented here.

3. **Journey step config field name:**
   - The engine step configuration already expects and reads **`step.variableMapping`** (typed as `VariableMapping?: Record<string, VariableMappingEntry>` in [packages/core/src/services/journeyStepProcessor.ts](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/packages/core/src/services/journeyStepProcessor.ts#L285-L290)).

4. **Impact on currently active journeys:**
   - An inspection of the database revealed **zero** currently active journeys (all journeys in the system are currently in `draft` or `paused` state). Therefore, enforcing the activation validation guard will not disrupt any in-flight runs.

---

## Changed Files Summary (One Line Each)

- [packages/core/src/services/templateVariableResolver.ts](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/packages/core/src/services/templateVariableResolver.ts): Added optional `fallback` support to `VariableMappingEntry` and implemented fallback evaluation when contact field/attribute is empty.
- [packages/core/src/services/journeyStepProcessor.ts](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/packages/core/src/services/journeyStepProcessor.ts): Updated runtime warning log with `(reason: VARIABLE_RESOLUTION_FAILED)` when variable resolution fails and advances to the next step.
- [apps/api/src/validation/campaignSchema.ts](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/validation/campaignSchema.ts): Extended `variableMappingEntrySchema` with optional `fallback: z.string().optional()`.
- [apps/api/src/validation/journeySchema.ts](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/validation/journeySchema.ts): Created journey validation schemas and `validateJourneyStepsForActivation(db, steps)` requiring all placeholders in `send_message` steps to be mapped before activation.
- [apps/api/src/routes/journeys.ts](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/routes/journeys.ts): Added activation validation to `POST /`, `POST /:id/activate`, and added `PATCH /:id` endpoint to allow editing draft/paused journeys.
- [apps/web/src/lib/journeyStepBuilder.ts](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/web/src/lib/journeyStepBuilder.ts): Added `variableMapping` to `FriendlyStep` and `EngineSendMessageStep`, ensured pass-through in `flattenToEngineSteps`, and added `reconcileVariableMapping`.
- [apps/web/src/pages/JourneysPage.tsx](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/web/src/pages/JourneysPage.tsx): Implemented step editor variable mapping UI with inline validation errors, template change reconciliation, and "Needs variable mapping" table warnings.
- [apps/api/src/scripts/checkJourneyVariables.ts](file:///c:/Users/hrish/OneDrive/Desktop/nextCRM/apps/api/src/scripts/checkJourneyVariables.ts): Created comprehensive verification script covering activation validation, placeholder diffing, fallback evaluation, and step flattening.

---

## Verification Script Output (`apps/api/src/scripts/checkJourneyVariables.ts`)

```text
=== Running Journey Template Variable Mapping Verification Tests ===

--- Group 1: Activation Validation ---
[PASS] All placeholders mapped -> validation passes
[PASS] One missing placeholder -> activation validation fails and names 'total'
[PASS] No mapping defined -> validation fails listing missing placeholders
[PASS] Invalid mapping entry (missing key) -> validation fails with descriptive error
[PASS] Template with zero placeholders -> validation passes

--- Group 2: Template Change Reconcile Function ---
[PASS] Template change drops stale mapping rows ('old_code' removed)
[PASS] Template change keeps matching mapping rows ('name' preserved)
[PASS] Template change leaves newly introduced placeholders unmapped (triggering inline mapping warnings)

--- Group 3: Variable Resolution with Fallbacks ---
[PASS] Fallback used when contact name is null ('Valued Customer')
[PASS] Fallback used when contact name is whitespace ('Valued Customer')
[PASS] Contact name used when present ('Alice Johnson'), fallback ignored
[PASS] Fallback used when custom attribute is missing ('your city')
[PASS] Missing contact value without fallback returns error as expected

--- Group 4: flattenToEngineSteps Mapping Pass-Through ---
[PASS] flattenToEngineSteps preserves variableMapping on engine step
[PASS] flattenToEngineSteps preserves exact variable mapping keys, values, and fallback
[PASS] flattenToEngineSteps preserves variableMapping on nested conditional branch steps

========================================
Verification Complete: 16 Passed, 0 Failed
========================================
```

---

## TypeScript Compilation Status (`npx tsc --noEmit`)

- `packages/core`: Clean (0 errors, exit code 0)
- `apps/api`: Clean (0 errors, exit code 0)
- `apps/worker`: Clean (0 errors, exit code 0)
- `apps/web`: Clean (0 errors, exit code 0)

---

## Runtime Visibility & Database Notes

- **Step / Run Outcome Structure:** The database schema (`packages/db/prisma/schema.prisma`) maintains `JourneyRun` state with `currentStepIndex`, `status`, and `nextStepAt`. There is currently no dedicated `JourneyRunEvent` or step execution audit table in the schema.
- **Engine Behavior:** When variable resolution fails, the engine logs a structured warning containing `(reason: VARIABLE_RESOLUTION_FAILED)` and the specific placeholder name, and advances the run to the next step (`currentStepIndex + 1`), preserving safe forward progress consistent with the consent guard and frequency capping patterns.

---

## Deviations & Unverified Items

- **No Browser / UI Automation:** In strict adherence to the project rules, no browser was opened and no automated UI testing was performed. All validation was verified using `npx tsc --noEmit` and standalone executable TypeScript tests.
- **No Unsolicited Sources Added:** Did not add cart/order trigger sources (e.g. cart recovery link) to `resolveTemplateVariables` or the journey mapping UI, as requested.
