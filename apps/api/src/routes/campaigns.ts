import { Router, Request, Response } from "express";
import { ApiError, forWorkspace, validateOrThrow } from "@nextcrm/core";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createCampaignSchema,
  CreateCampaignInput,
} from "../validation/campaignSchema";
import { campaignDispatchQueue } from "../queues/campaignQueue";

export const campaignsRouter = Router();

/**
 * POST /
 * Creates a campaign (draft only, does not dispatch).
 */
campaignsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const validatedData = validateOrThrow<CreateCampaignInput>(
      createCampaignSchema,
      req.body
    );

    // Confirm the template belongs to this workspace
    const template = await forWorkspace(req.workspaceId!).template.findUnique({
      where: { id: validatedData.templateId },
    });

    if (!template) {
      throw new ApiError(404, "Template not found");
    }

    // Confirm the channel belongs to this workspace
    const channel = await forWorkspace(req.workspaceId!).channel.findUnique({
      where: { id: validatedData.channelId },
    });

    if (!channel) {
      throw new ApiError(404, "Channel not found");
    }

    // Create the campaign in draft status
    const campaign = await forWorkspace(req.workspaceId!).campaign.create({
      data: {
        name: validatedData.name,
        templateId: validatedData.templateId,
        channelId: validatedData.channelId,
        status: "draft",
      } as any,
    });

    res.status(201).json(campaign);
  })
);

/**
 * POST /:id/dispatch
 * Validates requirements and enqueues campaign for dispatch.
 */
campaignsRouter.post(
  "/:id/dispatch",
  asyncHandler(async (req: Request, res: Response) => {
    // 1. Fetch campaign first to verify existence and get templateId
    const campaign = await forWorkspace(req.workspaceId!).campaign.findUnique({
      where: { id: req.params.id },
    });

    if (!campaign) {
      throw new ApiError(404, "Campaign not found");
    }

    // 2. Fetch and validate the template is approved
    const template = await forWorkspace(req.workspaceId!).template.findUnique({
      where: { id: campaign.templateId },
    });

    if (!template) {
      throw new ApiError(404, "Template not found");
    }

    if (template.status !== "approved") {
      throw new ApiError(400, "Campaign's template must be approved before dispatching");
    }

    // 3. Perform atomic status transition claim: only succeeds if status is still 'draft'
    const claimed = await forWorkspace(req.workspaceId!).campaign.updateMany({
      where: { id: req.params.id, status: "draft" },
      data: { status: "queued" },
    });

    if (claimed.count === 0) {
      throw new ApiError(400, "Only draft campaigns can be dispatched");
    }

    // 4. Enqueue job to BullMQ campaign dispatch queue
    await campaignDispatchQueue.add("dispatch", {
      campaignId: campaign.id,
      workspaceId: req.workspaceId!,
    });

    // Fetch the updated campaign row for the response
    const updatedCampaign = await forWorkspace(req.workspaceId!).campaign.findUnique({
      where: { id: campaign.id },
    });

    res.status(200).json(updatedCampaign);
  })
);

/**
 * GET /:id
 * Polls for live progress of a campaign.
 */
campaignsRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const campaign = await forWorkspace(req.workspaceId!).campaign.findUnique({
      where: { id: req.params.id },
    });

    if (!campaign) {
      throw new ApiError(404, "Campaign not found");
    }

    res.status(200).json(campaign);
  })
);
