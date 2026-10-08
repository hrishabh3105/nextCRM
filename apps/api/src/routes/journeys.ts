import { Router, Request, Response } from "express";
import { ApiError, forWorkspace, processJourneyStep } from "@nextcrm/core";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateJourneyStepsForActivation } from "../validation/journeySchema";

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

export const ACTIVE_JOURNEY_CONFLICT_MSG = (triggerEvent: string) =>
  `An active journey already exists for trigger '${triggerEvent}'. Pause or deactivate it before activating a new one for the same trigger.`;

/**
 * GET /
 * Lists all journeys for the workspace, ordered by creation date descending.
 * Includes versions so clients can inspect steps and step count.
 */
journeysRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const journeys = await forWorkspace(req.workspaceId!).journey.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
        },
      },
    });

    res.status(200).json(journeys);
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
    const { name, triggerEvent, steps, status = "active" } = req.body;

    if (!name || typeof name !== "string") {
      throw new ApiError(400, "Journey name is required");
    }

    if (!triggerEvent || typeof triggerEvent !== "string") {
      throw new ApiError(400, "triggerEvent is required");
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new ApiError(400, "steps array must have at least one step");
    }

    const db = forWorkspace(req.workspaceId!);

    if (status === "active") {
      const validationResult = await validateJourneyStepsForActivation(db, steps);
      if (!validationResult.valid) {
        throw new ApiError(
          400,
          `Cannot activate journey: ${validationResult.errors.join("; ")}`
        );
      }
    }

    // 1. Create Journey row with initial status
    let journey;
    try {
      journey = await db.journey.create({
        data: {
          workspaceId: req.workspaceId!,
          name,
          triggerEvent,
          status,
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new ApiError(409, ACTIVE_JOURNEY_CONFLICT_MSG(triggerEvent));
      }
      throw err;
    }

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
 * POST /:id/pause
 * Pauses an active journey.
 */
journeysRouter.post(
  "/:id/pause",
  asyncHandler(async (req: Request, res: Response) => {
    const db = forWorkspace(req.workspaceId!);

    const journey = await db.journey.findUnique({
      where: { id: req.params.id },
    });

    if (!journey) {
      throw new ApiError(404, "Journey not found");
    }

    if (journey.status !== "active") {
      throw new ApiError(400, "Only active journeys can be paused");
    }

    const updated = await db.journey.update({
      where: { id: req.params.id },
      data: { status: "paused" },
    });

    res.status(200).json(updated);
  })
);

/**
 * POST /:id/activate
 * Activates a paused/draft journey, reusing the atomic claim behavior
 * against the partial unique index.
 */
journeysRouter.post(
  "/:id/activate",
  asyncHandler(async (req: Request, res: Response) => {
    const db = forWorkspace(req.workspaceId!);

    const journey = await db.journey.findUnique({
      where: { id: req.params.id },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
        },
      },
    });

    if (!journey) {
      throw new ApiError(404, "Journey not found");
    }

    if (journey.status === "active") {
      throw new ApiError(400, "Journey is already active");
    }

    const currentVersion = journey.currentVersionId
      ? journey.versions.find((v: any) => v.id === journey.currentVersionId) || journey.versions[0]
      : journey.versions[0];

    const stepsToValidate = Array.isArray(currentVersion?.steps) ? currentVersion.steps : [];
    const validationResult = await validateJourneyStepsForActivation(db, stepsToValidate);
    if (!validationResult.valid) {
      throw new ApiError(
        400,
        `Cannot activate journey: ${validationResult.errors.join("; ")}`
      );
    }

    try {
      const updated = await db.journey.update({
        where: { id: req.params.id },
        data: { status: "active" },
      });

      res.status(200).json(updated);
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new ApiError(
          409,
          ACTIVE_JOURNEY_CONFLICT_MSG(journey.triggerEvent)
        );
      }
      throw err;
    }
  })
);

/**
 * PATCH /:id
 * Updates an existing journey (name, triggerEvent, status, steps).
 * If activating or saving active steps, enforces variable mappings.
 */
journeysRouter.patch(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { name, triggerEvent, status, steps } = req.body;
    const db = forWorkspace(req.workspaceId!);

    const journey = await db.journey.findUnique({
      where: { id: req.params.id },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
        },
      },
    });

    if (!journey) {
      throw new ApiError(404, "Journey not found");
    }

    const targetStatus = status || journey.status;
    let newVersion: any = null;

    if (steps && Array.isArray(steps)) {
      if (targetStatus === "active") {
        const validationResult = await validateJourneyStepsForActivation(db, steps);
        if (!validationResult.valid) {
          throw new ApiError(
            400,
            `Cannot activate journey: ${validationResult.errors.join("; ")}`
          );
        }
      }

      const maxVersion = journey.versions.reduce(
        (max: number, v: any) => Math.max(max, v.versionNumber),
        0
      );

      newVersion = await db.journeyVersion.create({
        data: {
          journeyId: journey.id,
          versionNumber: maxVersion + 1,
          steps,
        },
      });
    } else if (status === "active" && journey.status !== "active") {
      const currentVersion = journey.currentVersionId
        ? journey.versions.find((v: any) => v.id === journey.currentVersionId) || journey.versions[0]
        : journey.versions[0];

      const stepsToValidate = Array.isArray(currentVersion?.steps) ? currentVersion.steps : [];
      const validationResult = await validateJourneyStepsForActivation(db, stepsToValidate);
      if (!validationResult.valid) {
        throw new ApiError(
          400,
          `Cannot activate journey: ${validationResult.errors.join("; ")}`
        );
      }
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (triggerEvent) updateData.triggerEvent = triggerEvent;
    if (status) updateData.status = status;
    if (newVersion) updateData.currentVersionId = newVersion.id;

    try {
      const updated = await db.journey.update({
        where: { id: req.params.id },
        data: updateData,
      });

      res.status(200).json({
        journey: updated,
        version: newVersion,
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new ApiError(
          409,
          ACTIVE_JOURNEY_CONFLICT_MSG(triggerEvent || journey.triggerEvent)
        );
      }
      throw err;
    }
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
