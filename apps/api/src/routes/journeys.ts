import { Router, Request, Response } from "express";
import { ApiError, forWorkspace } from "@nextcrm/core";
import { processJourneyStep } from "@nextcrm/worker";
import { asyncHandler } from "../middleware/asyncHandler";

export const journeysRouter = Router();

/**
 * GET /runs/:id
 * Fetches a single run's current state (status, currentStepIndex, nextStepAt).
 * Mounted before /:id to prevent route matching collisions.
 */
journeysRouter.get(
  "/runs/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const run = await forWorkspace(req.workspaceId!).journeyRun.findUnique({
      where: { id: req.params.id },
    });

    if (!run) {
      throw new ApiError(404, "Journey run not found");
    }

    res.status(200).json(run);
  })
);

/**
 * POST /
 * Creates a journey (status "active") and its first JourneyVersion (versionNumber 1),
 * then updates Journey.currentVersionId to point to it.
 */
journeysRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { name, triggerEvent, steps } = req.body;

    if (!name || typeof name !== "string") {
      throw new ApiError(400, "Journey name is required");
    }

    if (!triggerEvent || typeof triggerEvent !== "string") {
      throw new ApiError(400, "triggerEvent is required");
    }

    if (!Array.isArray(steps)) {
      throw new ApiError(400, "steps array is required");
    }

    const db = forWorkspace(req.workspaceId!);

    // 1. Create Journey row with status 'active'
    const journey = await db.journey.create({
      data: {
        workspaceId: req.workspaceId!,
        name,
        triggerEvent,
        status: "active",
      },
    });

    // 2. Create first JourneyVersion (versionNumber: 1)
    const version = await db.journeyVersion.create({
      data: {
        journeyId: journey.id,
        versionNumber: 1,
        steps,
      },
    });

    // 3. Update Journey.currentVersionId to point at it
    const updatedJourney = await db.journey.update({
      where: { id: journey.id },
      data: {
        currentVersionId: version.id,
      },
    });

    res.status(201).json({
      journey: updatedJourney,
      version,
    });
  })
);

/**
 * POST /:id/test-run
 * MANUAL test trigger only.
 * Creates a JourneyRun pinned to the journey's CURRENT version,
 * then calls processJourneyStep() immediately (synchronously in the request).
 */
journeysRouter.post(
  "/:id/test-run",
  asyncHandler(async (req: Request, res: Response) => {
    const { contactId } = req.body;

    if (!contactId || typeof contactId !== "string") {
      throw new ApiError(400, "contactId is required");
    }

    const db = forWorkspace(req.workspaceId!);

    const journey = await db.journey.findUnique({
      where: { id: req.params.id },
    });

    if (!journey) {
      throw new ApiError(404, "Journey not found");
    }

    if (!journey.currentVersionId) {
      throw new ApiError(400, "Journey does not have an active version");
    }

    const contact = await db.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new ApiError(404, "Contact not found");
    }

    // 1. Create JourneyRun pinned to the journey's current version
    const run = await db.journeyRun.create({
      data: {
        workspaceId: req.workspaceId!,
        journeyId: journey.id,
        journeyVersionId: journey.currentVersionId,
        contactId: contact.id,
        status: "running",
        currentStepIndex: 0,
      },
    });

    // 2. Start run synchronously via processJourneyStep
    await processJourneyStep(run.id, req.workspaceId!);

    // 3. Return the updated run state
    const currentRun = await db.journeyRun.findUnique({
      where: { id: run.id },
    });

    res.status(201).json(currentRun || run);
  })
);
