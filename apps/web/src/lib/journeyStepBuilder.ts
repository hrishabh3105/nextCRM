/**
 * apps/web/src/lib/journeyStepBuilder.ts
 *
 * Translation layer converting the human-friendly, nested UI tree of steps
 * into the flat engine steps array with precise jump indices (onTrueIndex / onFalseIndex).
 *
 * Pure logic — kept strictly separate from UI components for independent reasoning and unit testing.
 */

export type VariableMappingEntry = {
  source: "contact_field" | "contact_attribute" | "fixed";
  field?: "name" | "email" | "phone";
  key?: string;
  value?: string;
  fallback?: string;
};

export type FriendlyStep =
  | {
      kind: "send_message";
      templateId: string;
      channelId: string;
      variableMapping?: Record<string, VariableMappingEntry>;
    }
  | { kind: "wait"; amount: number; unit: "minutes" | "hours" | "days" }
  | {
      kind:
        | "check_order_placed"
        | "check_customer_replied_confirm"
        | "check_customer_replied_decline";
      ifYes: FriendlyStep[];
      ifNo: FriendlyStep[];
    };

export interface EngineSendMessageStep {
  type: "send_message";
  templateId: string;
  channelId: string;
  variables: string[];
  variableMapping?: Record<string, VariableMappingEntry>;
}

export interface EngineWaitStep {
  type: "wait";
  durationMs: number;
}

export interface EngineConditionStep {
  type: "condition";
  check: string;
  onTrue?: "exit";
  onTrueIndex?: number;
  onFalse?: "exit";
  onFalseIndex: number;
}

export interface EngineExitStep {
  type: "exit";
  reason?: string;
}

export type EngineStep =
  | EngineSendMessageStep
  | EngineWaitStep
  | EngineConditionStep
  | EngineExitStep;

export const UNIT_MULTIPLIERS = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
} as const;

export const CHECK_MAPPING: Record<
  | "check_order_placed"
  | "check_customer_replied_confirm"
  | "check_customer_replied_decline",
  string
> = {
  check_order_placed: "order_exists_since_run_start",
  check_customer_replied_confirm: "customer_confirmed_via_reply",
  check_customer_replied_decline: "customer_declined_via_reply",
};

/**
 * =========================================================================================
 * ARCHITECTURAL NOTES & WHY THIS TRANSLATION IS TRICKY:
 *
 * This function is the single trickiest piece of the journeys feature.
 *
 * The NextCRM execution engine (packages/core/src/services/journeyStepProcessor.ts) executes
 * steps from a FLAT array. By default, after executing any non-terminal step (wait,
 * send_message), the engine simply increments currentStepIndex by 1 (advancing sequentially).
 *
 * Condition steps evaluate a check:
 * - If matched (true): jumps to onTrueIndex, or terminates if onTrue === "exit".
 * - If not matched (false): jumps to onFalseIndex, or terminates if onFalse === "exit".
 *
 * Because there is NO "goto" or unconditional jump step in the engine:
 * 1. If we lay out `ifYes` steps followed immediately by `ifNo` steps in the flat array,
 *    any run executing `ifYes` would naturally fall through into `ifNo` once `ifYes` completes!
 *    To maintain branch isolation, the `ifYes` branch MUST terminate with an explicit
 *    `{ type: "exit" }` step before the `ifNo` branch begins.
 * 2. If a branch is empty:
 *    - Empty `ifYes`: we mark `onTrue: "exit"` (and point `onTrueIndex` to an exit step).
 *    - Empty `ifNo`: we point `onFalseIndex` to an exit step (and mark `onFalse: "exit"`).
 * 3. The entire journey array must conclude with a final `{ type: "exit" }` step if the
 *    last step is not already a terminal exit step, guaranteeing clean run completion.
 *
 * =========================================================================================
 * HAND-TRACED TRANSLATION EXAMPLE:
 *
 * Suppose a merchant configures an Abandoned Cart Recovery journey with COD confirmation:
 *
 * Friendly representation:
 * [
 *   { kind: "wait", amount: 2, unit: "hours" },
 *   {
 *     kind: "check_order_placed",
 *     ifYes: [], // Customer already ordered within 2 hours -> exit run immediately
 *     ifNo: [
 *       { kind: "send_message", templateId: "tpl_cart_reminder", channelId: "chn_1" },
 *       { kind: "wait", amount: 1, unit: "days" },
 *       {
 *         kind: "check_customer_replied_confirm",
 *         ifYes: [
 *           { kind: "send_message", templateId: "tpl_thanks_confirmed", channelId: "chn_1" }
 *         ],
 *         ifNo: [
 *           { kind: "send_message", templateId: "tpl_recovery_discount", channelId: "chn_1" }
 *         ]
 *       }
 *     ]
 *   }
 * ]
 *
 * Hand-traced flattening walkthrough:
 *
 * 1. Step 0 (wait 2 hours):
 *    -> amount: 2 * 3,600,000 ms = 7,200,000 ms
 *    -> output[0] = { type: "wait", durationMs: 7200000 }
 *
 * 2. Step 1 (check_order_placed):
 *    -> maps to check: "order_exists_since_run_start"
 *    -> output[1] = condition placeholder
 *    -> ifYes is empty ([]):
 *       * condition.onTrue = "exit"
 *    -> ifNo begins at next available index (2):
 *       * condition.onFalseIndex = 2
 *
 * 3. Step 2 (inside ifNo):
 *    -> output[2] = { type: "send_message", templateId: "tpl_cart_reminder", channelId: "chn_1", variables: [] }
 *
 * 4. Step 3 (inside ifNo):
 *    -> output[3] = { type: "wait", durationMs: 86400000 } (1 day)
 *
 * 5. Step 4 (inside ifNo, nested condition check_customer_replied_confirm):
 *    -> maps to check: "customer_confirmed_via_reply"
 *    -> output[4] = condition placeholder
 *    -> nested ifYes begins at index 5:
 *       * nested condition.onTrueIndex = 5
 *       * output[5] = { type: "send_message", templateId: "tpl_thanks_confirmed", channelId: "chn_1", variables: [] }
 *       * output[6] = { type: "exit" }  <-- Prevents ifYes from leaking into ifNo!
 *    -> nested ifNo begins at index 7:
 *       * nested condition.onFalseIndex = 7
 *       * output[7] = { type: "send_message", templateId: "tpl_recovery_discount", channelId: "chn_1", variables: [] }
 *       * output[8] = { type: "exit" }  <-- Terminal step for ifNo branch
 *
 * 6. Top-level condition onTrueIndex points to terminal exit at index 8 (dual-safe with onTrue: "exit").
 *
 * Resulting flat engine steps array:
 *   Index 0: { type: "wait", durationMs: 7200000 }
 *   Index 1: { type: "condition", check: "order_exists_since_run_start", onTrue: "exit", onFalseIndex: 2, onTrueIndex: 8 }
 *   Index 2: { type: "send_message", templateId: "tpl_cart_reminder", channelId: "chn_1", variables: [] }
 *   Index 3: { type: "wait", durationMs: 86400000 }
 *   Index 4: { type: "condition", check: "customer_confirmed_via_reply", onTrueIndex: 5, onFalseIndex: 7 }
 *   Index 5: { type: "send_message", templateId: "tpl_thanks_confirmed", channelId: "chn_1", variables: [] }
 *   Index 6: { type: "exit" }
 *   Index 7: { type: "send_message", templateId: "tpl_recovery_discount", channelId: "chn_1", variables: [] }
 *   Index 8: { type: "exit" }
 *
 * Engine execution analysis:
 * - Customer ordered? Step 1 onTrue: "exit" triggers immediate completion.
 * - Customer didn't order? Jumps to Step 2, sends reminder, waits 1 day at Step 3.
 * - Confirmed reply? Jumps to Step 5, sends confirmation, hits Step 6 exit and stops.
 * - No confirmed reply? Jumps to Step 7, sends discount, hits Step 8 exit and stops.
 * Every branch is isolated, deterministic, and safe.
 * =========================================================================================
 */
export function flattenToEngineSteps(friendlySteps: FriendlyStep[]): any[] {
  const output: EngineStep[] = [];

  function flattenBranch(steps: FriendlyStep[]): void {
    for (const step of steps) {
      if (step.kind === "wait") {
        const multiplier = UNIT_MULTIPLIERS[step.unit] ?? 60000;
        const durationMs = Math.max(0, Number(step.amount) || 0) * multiplier;
        output.push({
          type: "wait",
          durationMs,
        });
      } else if (step.kind === "send_message") {
        output.push({
          type: "send_message",
          templateId: step.templateId,
          channelId: step.channelId,
          variables: [],
          variableMapping: step.variableMapping || {},
        });
      } else if (
        step.kind === "check_order_placed" ||
        step.kind === "check_customer_replied_confirm" ||
        step.kind === "check_customer_replied_decline"
      ) {
        const check = CHECK_MAPPING[step.kind];

        // Placeholder condition step
        const conditionStep: EngineConditionStep = {
          type: "condition",
          check,
          onFalseIndex: -1,
        };
        output.push(conditionStep);

        const hasYes = Array.isArray(step.ifYes) && step.ifYes.length > 0;
        const hasNo = Array.isArray(step.ifNo) && step.ifNo.length > 0;

        if (!hasYes && !hasNo) {
          // Both branches empty -> emit an exit step and point both to it
          const exitIdx = output.length;
          output.push({ type: "exit" });
          conditionStep.onTrue = "exit";
          conditionStep.onTrueIndex = exitIdx;
          conditionStep.onFalse = "exit";
          conditionStep.onFalseIndex = exitIdx;
        } else if (!hasYes && hasNo) {
          // ifYes is empty -> exit on true
          conditionStep.onTrue = "exit";
          conditionStep.onFalseIndex = output.length;
          flattenBranch(step.ifNo);
          if (output[output.length - 1]?.type !== "exit") {
            output.push({ type: "exit" });
          }
          // Point onTrueIndex to the terminal exit step for dual compatibility
          conditionStep.onTrueIndex = output.length - 1;
        } else if (hasYes && !hasNo) {
          // ifYes has steps, ifNo is empty
          conditionStep.onTrueIndex = output.length;
          flattenBranch(step.ifYes);
          if (output[output.length - 1]?.type !== "exit") {
            output.push({ type: "exit" });
          }
          // Point onFalseIndex to the terminal exit step created after ifYes
          const terminalExitIdx = output.length - 1;
          conditionStep.onFalseIndex = terminalExitIdx;
          conditionStep.onFalse = "exit";
        } else {
          // Both branches non-empty
          conditionStep.onTrueIndex = output.length;
          flattenBranch(step.ifYes);
          // CRITICAL: Prevent ifYes from falling through into ifNo
          if (output[output.length - 1]?.type !== "exit") {
            output.push({ type: "exit" });
          }

          conditionStep.onFalseIndex = output.length;
          flattenBranch(step.ifNo);
          // Ensure ifNo branch is terminated
          if (output[output.length - 1]?.type !== "exit") {
            output.push({ type: "exit" });
          }
        }
      }
    }
  }

  flattenBranch(friendlySteps);

  // Always end the WHOLE flattened array with a final exit step if the last
  // friendly step isn't already a terminal one.
  if (output.length === 0 || output[output.length - 1]?.type !== "exit") {
    output.push({ type: "exit" });
  }

  return output;
}

/**
 * Reconciles variable mappings when the selected template changes:
 * drops mapping keys that no longer exist in the new template placeholders,
 * and preserves matching ones.
 */
export function reconcileVariableMapping(
  existingMapping: Record<string, VariableMappingEntry> | undefined,
  newPlaceholders: string[]
): Record<string, VariableMappingEntry> {
  const result: Record<string, VariableMappingEntry> = {};
  if (!existingMapping || typeof existingMapping !== "object") return result;

  for (const placeholder of newPlaceholders) {
    if (existingMapping[placeholder]) {
      result[placeholder] = existingMapping[placeholder];
    }
  }

  return result;
}
