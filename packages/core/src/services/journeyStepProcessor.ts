import { forWorkspace } from "../tenantScope";
import { decryptToken } from "../tokenEncryption";
import { sendTemplateMessage } from "./metaClient";
import { recordMessageCost } from "./costTracker";
import { checkFrequencyCap, recordOutboundMessage } from "./messageRecorder";
import { resolveTemplateVariables, VariableMapping } from "./templateVariableResolver";
import { journeyTickQueue } from "../queue";
import { evaluateSendPermission, SendContext } from "./consentService";

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
  depth = 0
): Promise<void> {
  // Prevent infinite loops on cyclic or malformed journey graphs
  if (depth > 25) {
    console.error(
      `[journey-step-processor] Max recursion depth exceeded for run ${runId} in workspace ${workspaceId}. Marking as failed.`
    );
    const db = forWorkspace(workspaceId);
    await db.journeyRun.update({
      where: { id: runId },
      data: { status: "failed", nextStepAt: null },
    });
    return;
  }

  const db = forWorkspace(workspaceId);

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
        return;
      }

      if (!step.templateId) {
        console.error(`[journey-step-processor] Step missing templateId for run ${runId}`);
        await db.journeyRun.update({
          where: { id: runId },
          data: { status: "failed", nextStepAt: null },
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
        return;
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
        return processJourneyStep(runId, workspaceId, depth + 1);
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
        return processJourneyStep(runId, workspaceId, depth + 1);
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

        const resolvedResult = resolveTemplateVariables({
          placeholders: templatePlaceholders,
          mapping,
          contact,
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
          return processJourneyStep(runId, workspaceId, depth + 1);
        }

        variables = resolvedResult.resolved;
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
        });

        await recordMessageCost({
          workspaceId,
          messageId: result.providerMessageId,
          category: template.category,
        });

        await recordOutboundMessage({
          workspaceId,
          contactId: contact.id,
          channelId: channel.id,
          providerMessageId: result.providerMessageId,
          body: template.bodyPreview,
        });
      } catch (metaErr) {
        console.error(`[journey-step-processor] Meta send error in run ${runId}:`, metaErr);
        await db.journeyRun.update({
          where: { id: runId },
          data: { status: "failed", nextStepAt: null },
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
      return processJourneyStep(runId, workspaceId, depth + 1);
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

        return processJourneyStep(runId, workspaceId, depth + 1);
      } else {
        if (step.onFalse === "exit") {
          await db.journeyRun.update({
            where: { id: runId },
            data: { status: "exited", nextStepAt: null },
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

        return processJourneyStep(runId, workspaceId, depth + 1);
      }
    }

    case "exit": {
      const status = step.reason ? "exited" : "completed";
      await db.journeyRun.update({
        where: { id: runId },
        data: {
          status,
          nextStepAt: null,
        },
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
      return;
    }
  }
}
