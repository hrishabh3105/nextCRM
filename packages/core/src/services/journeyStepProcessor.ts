import { forWorkspace } from "../tenantScope";
import { decryptToken } from "../tokenEncryption";
import { sendTemplateMessage, TemplateButtonComponent } from "./metaClient";
import { recordMessageCost } from "./costTracker";
import { checkFrequencyCap, recordOutboundMessage } from "./messageRecorder";
import {
  resolveTemplateVariables,
  VariableMapping,
  getTemplateDynamicButton,
  resolveButtonVariable,
} from "./templateVariableResolver";
import { journeyTickQueue } from "../queue";
import { evaluateSendPermission, SendContext } from "./consentService";
import { logJourneyStep, JOURNEY_STEP_REASON_CODES } from "./journeyStepLogger";

export interface JourneyStep {
  type: "wait" | "send_message" | "condition" | "exit" | string;
  durationMs?: number;
  templateId?: string;
  channelId?: string;
  variables?: string[];
  variableMapping?: VariableMapping;
  check?: string;
  conditionType?: string;
  onTrue?: "exit" | string;
  onTrueIndex?: number;
  onFalse?: "exit" | string;
  onFalseIndex?: number;
  reason?: string;
  [key: string]: any;
}

const CONFIRM_KEYWORDS = ["yes", "confirm", "confirmed", "haan", "ok", "okay"];
const DECLINE_KEYWORDS = ["no", "cancel", "nahi", "decline", "stop"];

function matchesKeywords(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase().trim();
  return keywords.some((kw) => normalized.includes(kw));
}

/**
 * TIER 1 — simple keyword matching for reply intent classification.
 * Upgrade path: replace the body of this function with a call to an
 * LLM classification service (prompt: "classify this WhatsApp reply
 * as confirmed/declined/unclear"), keeping the same function
 * signature — callers (the condition step logic below) don't need
 * to change. This is a deliberate interim implementation, not an
 * oversight — see project notes for the Tier 2 plan.
 */
async function getLatestInboundReplySince(
  db: any,
  contactId: string,
  since: Date
): Promise<string | null> {
  const message = await db.message.findFirst({
    where: { contactId, direction: "inbound", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });
  return message?.body ?? null;
}

/**
 * Core engine logic for processing a single step of a JourneyRun.
 *
 * Safe to call repeatedly for the same run at different points in time:
 * - When a run starts (called synchronously)
 * - When a delayed tick fires (called from journeyTickWorker)
 * - Sequentially following immediate steps (send_message, condition)
 */
export async function processJourneyStep(
  runId: string,
  workspaceId: string,
  depth = 0,
  dbOverride?: any
): Promise<void> {
  const db = dbOverride || forWorkspace(workspaceId);

  // Prevent infinite loops on cyclic or malformed journey graphs
  if (depth > 25) {
    console.error(
      `[journey-step-processor] Max recursion depth exceeded for run ${runId} in workspace ${workspaceId}. Marking as failed.`
    );
    const existingRun = await db.journeyRun.findFirst({
      where: { id: runId },
    });
    await db.journeyRun.update({
      where: { id: runId },
      data: { status: "failed", nextStepAt: null },
    });
    if (existingRun) {
      await logJourneyStep({
        workspaceId,
        journeyId: existingRun.journeyId,
        journeyRunId: existingRun.id,
        stepIndex: existingRun.currentStepIndex,
        contactId: existingRun.contactId,
        stepType: "recursion_guard",
        outcome: "FAILED",
        reasonCode: JOURNEY_STEP_REASON_CODES.RECURSION_DEPTH_EXCEEDED,
        detail: `Max recursion depth exceeded for run ${runId}`,
        dbOverride: db,
      });
    }
    return;
  }

  // 1. Fetch the run to inspect current step index and status
  const run = await db.journeyRun.findFirst({
    where: { id: runId },
    include: { journey: true },
  });

  if (!run) {
    console.warn(
      `[journey-step-processor] JourneyRun ${runId} not found in workspace ${workspaceId}. Skipping.`
    );
    return;
  }

  const priorStatus = run.status;
  if (priorStatus !== "running" && priorStatus !== "waiting") {
    console.log(
      `[journey-step-processor] Run ${runId} has terminal or unexpected status '${priorStatus}'. Skipping execution.`
    );
    return;
  }

  // 2. ATOMIC CLAIM: Transition from priorStatus ("running" | "waiting") to transient "processing"
  const claimed = await db.journeyRun.updateMany({
    where: {
      id: runId,
      status: priorStatus,
    },
    data: {
      status: "processing",
    },
  });

  if (claimed.count === 0) {
    console.log(
      `[journey-step-processor] Run ${runId} could not be claimed (prior status changed from '${priorStatus}'). Skipping.`
    );
    return;
  }

  // 3. Fetch the run's JourneyVersion via journeyVersionId (pinning guarantee)
  const version = await db.journeyVersion.findUnique({
    where: { id: run.journeyVersionId },
  });

  if (!version) {
    console.error(
      `[journey-step-processor] JourneyVersion ${run.journeyVersionId} not found for run ${runId}. Marking failed.`
    );
    await db.journeyRun.update({
      where: { id: runId },
      data: { status: "failed", nextStepAt: null },
    });
    await logJourneyStep({
      workspaceId,
      journeyId: run.journeyId,
      journeyRunId: run.id,
      stepIndex: run.currentStepIndex,
      contactId: run.contactId,
      stepType: "unknown",
      outcome: "FAILED",
      reasonCode: JOURNEY_STEP_REASON_CODES.UNKNOWN_ERROR,
      detail: `JourneyVersion ${run.journeyVersionId} not found for run ${runId}`,
      dbOverride: db,
    });
    return;
  }

  const steps = (Array.isArray(version.steps) ? version.steps : []) as JourneyStep[];
  const step = steps[run.currentStepIndex];

  // 4. Ran off the end: mark completed
  if (!step) {
    console.log(
      `[journey-step-processor] Run ${runId} reached end of steps (index ${run.currentStepIndex}). Marking completed.`
    );
    await db.journeyRun.update({
      where: { id: runId },
      data: {
        status: "completed",
        nextStepAt: null,
      },
    });
    return;
  }

  // 5. Switch on step.type
  switch (step.type) {
    case "wait": {
      const durationMs = typeof step.durationMs === "number" ? Math.max(0, step.durationMs) : 0;
      const nextStepAt = new Date(Date.now() + durationMs);

      await journeyTickQueue.add(
        "journey-tick",
        { runId, workspaceId },
        { delay: durationMs }
      );

      await db.journeyRun.update({
        where: { id: runId },
        data: {
          currentStepIndex: run.currentStepIndex + 1,
          status: "waiting",
          nextStepAt,
        },
      });
      return;
    }

    case "send_message": {
      const contact = await db.contact.findUnique({
        where: { id: run.contactId },
      });

      if (!contact) {
        console.error(`[journey-step-processor] Contact ${run.contactId} not found for run ${runId}`);
        await db.journeyRun.update({
          where: { id: runId },
          data: { status: "failed", nextStepAt: null },
        });
        await logJourneyStep({
          workspaceId,
          journeyId: run.journeyId,
          journeyRunId: run.id,
          stepIndex: run.currentStepIndex,
          stepId: step.id,
          contactId: run.contactId,
          stepType: step.type,
          outcome: "FAILED",
          reasonCode: JOURNEY_STEP_REASON_CODES.NO_PHONE,
          detail: `Contact ${run.contactId} not found for run ${runId}`,
          dbOverride: db,
        });
        return;
      }

      if (!step.templateId) {
        console.error(`[journey-step-processor] Step missing templateId for run ${runId}`);
        await db.journeyRun.update({
          where: { id: runId },
          data: { status: "failed", nextStepAt: null },
        });
        await logJourneyStep({
          workspaceId,
          journeyId: run.journeyId,
          journeyRunId: run.id,
          stepIndex: run.currentStepIndex,
          stepId: step.id,
          contactId: run.contactId,
          stepType: step.type,
          outcome: "FAILED",
          reasonCode: JOURNEY_STEP_REASON_CODES.UNKNOWN_ERROR,
          detail: `Step missing templateId for run ${runId}`,
          dbOverride: db,
        });
        return;
      }

      const template = await db.template.findUnique({
        where: { id: step.templateId },
      });

      if (!template) {
        console.error(`[journey-step-processor] Template ${step.templateId} not found for run ${runId}`);
        await db.journeyRun.update({
          where: { id: runId },
          data: { status: "failed", nextStepAt: null },
        });
        await logJourneyStep({
          workspaceId,
          journeyId: run.journeyId,
          journeyRunId: run.id,
          stepIndex: run.currentStepIndex,
          stepId: step.id,
          contactId: run.contactId,
          stepType: step.type,
          outcome: "FAILED",
          reasonCode: JOURNEY_STEP_REASON_CODES.TEMPLATE_NOT_APPROVED,
          detail: `Template ${step.templateId} not found for run ${runId}`,
          dbOverride: db,
        });
        return;
      }

      // Channel lookup: explicitly prefer step.channelId, fallback to template.channelId
      const channelId = step.channelId || template.channelId;
      const channel = await db.channel.findUnique({
        where: { id: channelId },
      });

      if (!channel || !channel.accessTokenEnc || !channel.phoneNumberId) {
        console.error(
          `[journey-step-processor] Channel ${channelId} missing or incomplete for run ${runId}`
        );
        await db.journeyRun.update({
          where: { id: runId },
          data: { status: "failed", nextStepAt: null },
        });
        await logJourneyStep({
          workspaceId,
          journeyId: run.journeyId,
          journeyRunId: run.id,
          stepIndex: run.currentStepIndex,
          stepId: step.id,
          contactId: run.contactId,
          stepType: step.type,
          outcome: "FAILED",
          reasonCode: JOURNEY_STEP_REASON_CODES.CHANNEL_NOT_CONFIGURED,
          detail: `Channel ${channelId} missing or incomplete for run ${runId}`,
          dbOverride: db,
        });
        return;
      }

      // Final guard for cart_abandoned journeys right before sending: re-read the cart
      if (run.journey?.triggerEvent === "cart_abandoned" && run.triggerContextId) {
        const cart = await db.cart.findUnique({
          where: { id: run.triggerContextId },
        });

        if (cart && (cart.status === "converted" || cart.convertedAt != null)) {
          console.log(
            `[journey-step-processor] Cart ${cart.id} is converted for run ${runId}. Skipping send_message step and exiting run with reason CART_CONVERTED.`
          );
          await db.journeyRun.update({
            where: { id: runId },
            data: {
              status: "exited",
              exitReason: "CART_CONVERTED",
              nextStepAt: null,
            },
          });
          await logJourneyStep({
            workspaceId,
            journeyId: run.journeyId,
            journeyRunId: run.id,
            stepIndex: run.currentStepIndex,
            stepId: step.id,
            contactId: run.contactId,
            stepType: step.type,
            outcome: "EXITED",
            reasonCode: JOURNEY_STEP_REASON_CODES.CART_CONVERTED,
            detail: `Cart ${cart.id} is converted for run ${runId}. Skipping send_message step and exiting run with reason CART_CONVERTED.`,
            dbOverride: db,
          });
          return;
        }
      }

      // Consent evaluation: MARKETING requires consent (exempt for cart_abandoned unless OPTED_OUT)
      const sendContext: SendContext =
        run.journey?.triggerEvent === "cart_abandoned"
          ? "journey_abandoned_cart"
          : "journey";

      const permission = evaluateSendPermission({
        contact,
        template,
        context: sendContext,
      });

      if (!permission.allowed) {
        console.log(
          `[journey-step-processor] Contact ${contact.id} blocked by consent guard (${permission.reason}) in run ${runId}. Skipping send_message step.`
        );
        await db.journeyRun.update({
          where: { id: runId },
          data: {
            currentStepIndex: run.currentStepIndex + 1,
            status: "running",
            nextStepAt: null,
          },
        });
        await logJourneyStep({
          workspaceId,
          journeyId: run.journeyId,
          journeyRunId: run.id,
          stepIndex: run.currentStepIndex,
          stepId: step.id,
          contactId: run.contactId,
          stepType: step.type,
          outcome: "SKIPPED",
          reasonCode:
            permission.reason === "OPTED_OUT"
              ? JOURNEY_STEP_REASON_CODES.OPTED_OUT
              : JOURNEY_STEP_REASON_CODES.NO_CONSENT,
          detail: `Contact ${contact.id} blocked by consent guard (${permission.reason}) in run ${runId}`,
          dbOverride: db,
        });
        return processJourneyStep(runId, workspaceId, depth + 1, dbOverride);
      }

      const canSend = await checkFrequencyCap(db, contact.id);
      if (!canSend) {
        console.log(
          `[journey-step-processor] Contact ${contact.id} reached frequency cap in run ${runId}. Skipping send_message step.`
        );
        await db.journeyRun.update({
          where: { id: runId },
          data: {
            currentStepIndex: run.currentStepIndex + 1,
            status: "running",
            nextStepAt: null,
          },
        });
        await logJourneyStep({
          workspaceId,
          journeyId: run.journeyId,
          journeyRunId: run.id,
          stepIndex: run.currentStepIndex,
          stepId: step.id,
          contactId: run.contactId,
          stepType: step.type,
          outcome: "SKIPPED",
          reasonCode: JOURNEY_STEP_REASON_CODES.FREQUENCY_CAP,
          detail: `Contact ${contact.id} reached frequency cap in run ${runId}`,
          dbOverride: db,
        });
        return processJourneyStep(runId, workspaceId, depth + 1, dbOverride);
      }

      const templatePlaceholders = Array.isArray(template.positionalPlaceholders)
        ? (template.positionalPlaceholders as string[])
        : Array.isArray(template.placeholders)
          ? (template.placeholders as string[])
          : [];

      let variables: string[] = [];

      if (templatePlaceholders.length > 0) {
        const mapping =
          step.variableMapping &&
          typeof step.variableMapping === "object" &&
          !Array.isArray(step.variableMapping)
            ? (step.variableMapping as any)
            : {};

        const resolvedResult = await resolveTemplateVariables({
          placeholders: templatePlaceholders,
          mapping,
          contact,
          db,
          workspaceId,
          cartId:
            run.cartId ||
            (run.journey?.triggerEvent === "cart_abandoned"
              ? run.triggerContextId
              : null),
          orderId:
            run.orderId ||
            (run.journey?.triggerEvent?.startsWith("order_")
              ? run.triggerContextId
              : null),
        });

        if ("error" in resolvedResult) {
          console.warn(
            `[journey-step-processor] Variable resolution failed for contact ${contact.id} in run ${runId}: ${resolvedResult.error} (reason: VARIABLE_RESOLUTION_FAILED). Advancing to next step.`
          );
          await db.journeyRun.update({
            where: { id: runId },
            data: {
              currentStepIndex: run.currentStepIndex + 1,
              status: "running",
              nextStepAt: null,
            },
          });
          await logJourneyStep({
            workspaceId,
            journeyId: run.journeyId,
            journeyRunId: run.id,
            stepIndex: run.currentStepIndex,
            stepId: step.id,
            contactId: run.contactId,
            stepType: step.type,
            outcome: "SKIPPED",
            reasonCode: JOURNEY_STEP_REASON_CODES.MISSING_VARIABLE,
            detail: resolvedResult.error,
            dbOverride: db,
          });
          return processJourneyStep(runId, workspaceId, depth + 1, dbOverride);
        }

        variables = resolvedResult.resolved;
      }

      // Dynamic URL button resolution
      const dynamicBtn = getTemplateDynamicButton(template);
      let buttonComponent: TemplateButtonComponent | undefined = undefined;

      if (dynamicBtn) {
        const stepMapping = (step.variableMapping || {}) as Record<string, any>;
        const buttonEntry =
          stepMapping["button:url"] ||
          stepMapping[`button:${dynamicBtn.index}`] ||
          stepMapping["button_url"];

        if (!buttonEntry) {
          console.error(
            `[journey-step-processor] Template '${template.providerName}' in run ${runId} has dynamic button '${dynamicBtn.text}' but no button mapping is configured. Failing step.`
          );
          await db.journeyRun.update({
            where: { id: runId },
            data: { status: "failed", nextStepAt: null },
          });
          await logJourneyStep({
            workspaceId,
            journeyId: run.journeyId,
            journeyRunId: run.id,
            stepIndex: run.currentStepIndex,
            stepId: step.id,
            contactId: run.contactId,
            stepType: step.type,
            outcome: "FAILED",
            reasonCode: JOURNEY_STEP_REASON_CODES.MISSING_BUTTON_VARIABLE,
            detail: `Template '${template.providerName}' in run ${runId} has dynamic button '${dynamicBtn.text}' but no button mapping is configured`,
            dbOverride: db,
          });
          return;
        }

        const cartId =
          run.cartId ||
          (run.journey?.triggerEvent === "cart_abandoned"
            ? run.triggerContextId
            : null);
        let cart = null;
        if (cartId) {
          cart = await db.cart.findFirst({ where: { id: cartId } });
        }

        const btnResolution = resolveButtonVariable({
          buttonUrl: dynamicBtn.url,
          buttonIndex: dynamicBtn.index,
          buttonText: dynamicBtn.text,
          mappingEntry: buttonEntry,
          cart,
          contact,
        });

        if ("error" in btnResolution) {
          console.error(
            `[journey-step-processor] Failed to resolve button '${dynamicBtn.text}' variable for contact ${contact.id} in run ${runId}: ${btnResolution.error}. Failing step.`
          );
          await db.journeyRun.update({
            where: { id: runId },
            data: { status: "failed", nextStepAt: null },
          });
          await logJourneyStep({
            workspaceId,
            journeyId: run.journeyId,
            journeyRunId: run.id,
            stepIndex: run.currentStepIndex,
            stepId: step.id,
            contactId: run.contactId,
            stepType: step.type,
            outcome: "FAILED",
            reasonCode: JOURNEY_STEP_REASON_CODES.MISSING_BUTTON_VARIABLE,
            detail: btnResolution.error,
            dbOverride: db,
          });
          return;
        }

        buttonComponent = {
          type: "button",
          sub_type: "url",
          index: String(dynamicBtn.index),
          parameters: [{ type: "text", text: btnResolution.value }],
        };
      }

      try {
        const accessToken = decryptToken(channel.accessTokenEnc);
        const result = await sendTemplateMessage({
          accessToken,
          phoneNumberId: channel.phoneNumberId,
          to: contact.phone,
          templateName: template.providerName,
          language: template.language,
          variables,
          buttonComponent,
        });

        await recordMessageCost({
          workspaceId,
          messageId: result.providerMessageId,
          category: template.category,
        });

        const messageId = await recordOutboundMessage({
          workspaceId,
          contactId: contact.id,
          channelId: channel.id,
          providerMessageId: result.providerMessageId,
          body: template.bodyPreview,
        });

        await logJourneyStep({
          workspaceId,
          journeyId: run.journeyId,
          journeyRunId: run.id,
          stepIndex: run.currentStepIndex,
          stepId: step.id,
          contactId: run.contactId,
          stepType: step.type,
          outcome: "SENT",
          messageId: messageId ?? undefined,
          dbOverride: db,
        });
      } catch (metaErr) {
        console.error(`[journey-step-processor] Meta send error in run ${runId}:`, metaErr);
        await db.journeyRun.update({
          where: { id: runId },
          data: { status: "failed", nextStepAt: null },
        });
        await logJourneyStep({
          workspaceId,
          journeyId: run.journeyId,
          journeyRunId: run.id,
          stepIndex: run.currentStepIndex,
          stepId: step.id,
          contactId: run.contactId,
          stepType: step.type,
          outcome: "FAILED",
          reasonCode: JOURNEY_STEP_REASON_CODES.META_ERROR,
          detail: metaErr,
          dbOverride: db,
        });
        return;
      }

      // Advance currentStepIndex + 1 and transition back to "running"
      await db.journeyRun.update({
        where: { id: runId },
        data: {
          currentStepIndex: run.currentStepIndex + 1,
          status: "running",
          nextStepAt: null,
        },
      });

      // Recursively continue immediately
      return processJourneyStep(runId, workspaceId, depth + 1, dbOverride);
    }

    case "condition": {
      let matched = false;
      const check = step.check || step.conditionType;

      if (check === "order_exists_since_run_start") {
        const order = await db.order.findFirst({
          where: {
            contactId: run.contactId,
            createdAt: {
              gte: run.createdAt,
            },
          },
        });
        matched = !!order;
      } else if (check === "customer_confirmed_via_reply") {
        const reply = await getLatestInboundReplySince(
          db,
          run.contactId,
          run.createdAt
        );
        matched = !!reply && matchesKeywords(reply, CONFIRM_KEYWORDS);
      } else if (check === "customer_declined_via_reply") {
        const reply = await getLatestInboundReplySince(
          db,
          run.contactId,
          run.createdAt
        );
        matched = !!reply && matchesKeywords(reply, DECLINE_KEYWORDS);
      }

      if (matched) {
        if (step.onTrue === "exit") {
          await db.journeyRun.update({
            where: { id: runId },
            data: { status: "exited", nextStepAt: null },
          });
          await logJourneyStep({
            workspaceId,
            journeyId: run.journeyId,
            journeyRunId: run.id,
            stepIndex: run.currentStepIndex,
            stepId: step.id,
            contactId: run.contactId,
            stepType: step.type,
            outcome: "EXITED",
            reasonCode: JOURNEY_STEP_REASON_CODES.CONDITION_EXIT,
            detail: `Condition '${check}' met (true), branching to exit`,
            dbOverride: db,
          });
          return;
        }

        const nextIndex =
          typeof step.onTrueIndex === "number"
            ? step.onTrueIndex
            : run.currentStepIndex + 1;

        await db.journeyRun.update({
          where: { id: runId },
          data: {
            currentStepIndex: nextIndex,
            status: "running",
            nextStepAt: null,
          },
        });

        return processJourneyStep(runId, workspaceId, depth + 1, dbOverride);
      } else {
        if (step.onFalse === "exit") {
          await db.journeyRun.update({
            where: { id: runId },
            data: { status: "exited", nextStepAt: null },
          });
          await logJourneyStep({
            workspaceId,
            journeyId: run.journeyId,
            journeyRunId: run.id,
            stepIndex: run.currentStepIndex,
            stepId: step.id,
            contactId: run.contactId,
            stepType: step.type,
            outcome: "EXITED",
            reasonCode: JOURNEY_STEP_REASON_CODES.CONDITION_EXIT,
            detail: `Condition '${check}' not met (false), branching to exit`,
            dbOverride: db,
          });
          return;
        }

        const nextIndex =
          typeof step.onFalseIndex === "number"
            ? step.onFalseIndex
            : run.currentStepIndex + 1;

        await db.journeyRun.update({
          where: { id: runId },
          data: {
            currentStepIndex: nextIndex,
            status: "running",
            nextStepAt: null,
          },
        });

        return processJourneyStep(runId, workspaceId, depth + 1, dbOverride);
      }
    }

    case "exit": {
      const status = step.reason ? "exited" : "completed";
      await db.journeyRun.update({
        where: { id: runId },
        data: {
          status,
          exitReason: step.reason ?? null,
          nextStepAt: null,
        },
      });
      await logJourneyStep({
        workspaceId,
        journeyId: run.journeyId,
        journeyRunId: run.id,
        stepIndex: run.currentStepIndex,
        stepId: step.id,
        contactId: run.contactId,
        stepType: step.type,
        outcome: "EXITED",
        reasonCode: step.reason ? JOURNEY_STEP_REASON_CODES.STEP_EXIT : null,
        detail: step.reason || "Journey reached exit step",
        dbOverride: db,
      });
      return;
    }

    default: {
      console.warn(
        `[journey-step-processor] Unknown step type '${step.type}' at index ${run.currentStepIndex} for run ${runId}`
      );
      await db.journeyRun.update({
        where: { id: runId },
        data: { status: "failed", nextStepAt: null },
      });
      await logJourneyStep({
        workspaceId,
        journeyId: run.journeyId,
        journeyRunId: run.id,
        stepIndex: run.currentStepIndex,
        stepId: step.id,
        contactId: run.contactId,
        stepType: String(step.type),
        outcome: "FAILED",
        reasonCode: JOURNEY_STEP_REASON_CODES.UNKNOWN_STEP_TYPE,
        detail: `Unknown step type '${step.type}' at index ${run.currentStepIndex}`,
        dbOverride: db,
      });
      return;
    }
  }
}
