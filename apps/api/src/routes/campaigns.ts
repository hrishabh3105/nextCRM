import { Router, Request, Response } from "express";
import { ApiError, forWorkspace, validateOrThrow } from "@nextcrm/core";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createCampaignSchema,
  CreateCampaignInput,
  updateCampaignSchema,
  UpdateCampaignInput,
  SegmentInput,
} from "../validation/campaignSchema";
import { campaignDispatchQueue } from "../queues/campaignQueue";

export const campaignsRouter = Router();

/**
 * Validates that all contact IDs in a segment belong to the authenticated workspace.
 */
async function validateSegmentContactIds(
  workspaceId: string,
  segment?: SegmentInput
): Promise<void> {
  if (segment?.type === "contact_ids") {
    const contactIds = segment.contactIds;
    const contacts = await forWorkspace(workspaceId).contact.findMany({
      where: { id: { in: contactIds } },
    });

    if (contacts.length !== contactIds.length) {
      throw new ApiError(
        400,
        "One or more contact IDs do not belong to this workspace or do not exist"
      );
    }
  }
}

/**
 * GET /
 * Lists all campaigns for the authenticated workspace.
 */
campaignsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const includeArchived = req.query.includeArchived === "true";
    const where: any = {};
    if (!includeArchived) {
      where.archived = false;
    }

    const campaigns = await forWorkspace(req.workspaceId!).campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(campaigns);
  })
);

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

    const templatePlaceholders = Array.isArray(template.placeholders)
      ? (template.placeholders as string[])
      : [];

    let variableMappingToStore: any = null;

    if (templatePlaceholders.length > 0) {
      const mapping = validatedData.variableMapping;
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
        throw new ApiError(
          400,
          `Template requires variableMapping for placeholders: ${templatePlaceholders.map((p) => `'{{${p}}}'`).join(", ")}`
        );
      }

      const missing = templatePlaceholders.filter((p) => !(p in mapping) || !mapping[p]);
      if (missing.length > 0) {
        throw new ApiError(
          400,
          `Missing variable mapping for placeholder(s): ${missing.map((p) => `'{{${p}}}'`).join(", ")}`
        );
      }

      variableMappingToStore = mapping;
    }

    // Validate segment contact_ids if specified
    await validateSegmentContactIds(req.workspaceId!, validatedData.segment);

    // Create the campaign in draft status
    const campaign = await forWorkspace(req.workspaceId!).campaign.create({
      data: {
        name: validatedData.name,
        templateId: validatedData.templateId,
        channelId: validatedData.channelId,
        variableMapping: variableMappingToStore,
        segment: validatedData.segment ?? null,
        status: "draft",
      } as any,
    });

    res.status(201).json(campaign);
  })
);

/**
 * PATCH /:id
 * Updates an existing draft campaign within the authenticated workspace.
 */
campaignsRouter.patch(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const campaign = await forWorkspace(req.workspaceId!).campaign.findUnique({
      where: { id: req.params.id },
    });

    if (!campaign) {
      throw new ApiError(404, "Campaign not found");
    }

    if (campaign.status !== "draft") {
      throw new ApiError(400, "Only draft campaigns can be edited");
    }

    const validatedData = validateOrThrow<UpdateCampaignInput>(
      updateCampaignSchema,
      req.body
    );

    // Validate channel if provided
    if (validatedData.channelId) {
      const channel = await forWorkspace(req.workspaceId!).channel.findUnique({
        where: { id: validatedData.channelId },
      });
      if (!channel) {
        throw new ApiError(404, "Channel not found");
      }
    }

    // Determine effective templateId
    const effectiveTemplateId = validatedData.templateId || campaign.templateId;
    const template = await forWorkspace(req.workspaceId!).template.findUnique({
      where: { id: effectiveTemplateId },
    });

    if (!template) {
      throw new ApiError(404, "Template not found");
    }

    const templatePlaceholders = Array.isArray(template.placeholders)
      ? (template.placeholders as string[])
      : [];

    let variableMappingToStore = campaign.variableMapping;

    if (validatedData.variableMapping !== undefined || validatedData.templateId !== undefined) {
      if (templatePlaceholders.length > 0) {
        const mapping = validatedData.variableMapping ?? (campaign.variableMapping as any);
        if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
          throw new ApiError(
            400,
            `Template requires variableMapping for placeholders: ${templatePlaceholders.map((p) => `'{{${p}}}'`).join(", ")}`
          );
        }

        const missing = templatePlaceholders.filter((p) => !(p in mapping) || !mapping[p]);
        if (missing.length > 0) {
          throw new ApiError(
            400,
            `Missing variable mapping for placeholder(s): ${missing.map((p) => `'{{${p}}}'`).join(", ")}`
          );
        }

        variableMappingToStore = mapping;
      } else {
        variableMappingToStore = null;
      }
    }

    // Validate segment contact_ids if specified
    if (validatedData.segment !== undefined) {
      await validateSegmentContactIds(req.workspaceId!, validatedData.segment);
    }

    const updatePayload: any = {};
    if (validatedData.name !== undefined) updatePayload.name = validatedData.name;
    if (validatedData.templateId !== undefined) updatePayload.templateId = validatedData.templateId;
    if (validatedData.channelId !== undefined) updatePayload.channelId = validatedData.channelId;
    if (validatedData.variableMapping !== undefined || validatedData.templateId !== undefined) {
      updatePayload.variableMapping = variableMappingToStore;
    }
    if (validatedData.segment !== undefined) {
      updatePayload.segment = validatedData.segment ?? null;
    }

    const updated = await forWorkspace(req.workspaceId!).campaign.update({
      where: { id: req.params.id },
      data: updatePayload,
    });

    res.status(200).json(updated);
  })
);

/**
 * DELETE /:id
 * Deletes a draft campaign that has zero recipient records.
 */
campaignsRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const campaign = await forWorkspace(req.workspaceId!).campaign.findUnique({
      where: { id: req.params.id },
    });

    if (!campaign) {
      throw new ApiError(404, "Campaign not found");
    }

    if (campaign.status !== "draft") {
      throw new ApiError(
        400,
        "Only draft campaigns can be deleted — dispatched campaigns can be archived instead"
      );
    }

    const recipientCount = await forWorkspace(req.workspaceId!).campaignRecipient.count({
      where: { campaignId: req.params.id },
    });

    if (recipientCount > 0) {
      throw new ApiError(
        400,
        "This campaign has recipient records and cannot be deleted — archive it instead"
      );
    }

    await forWorkspace(req.workspaceId!).campaign.delete({
      where: { id: req.params.id },
    });

    res.status(204).send();
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
 * POST /:id/cancel
 * Cancels an in-progress campaign (queued or sending).
 */
campaignsRouter.post(
  "/:id/cancel",
  asyncHandler(async (req: Request, res: Response) => {
    // 1. Fetch campaign first to verify existence within authenticated workspace
    const campaign = await forWorkspace(req.workspaceId!).campaign.findUnique({
      where: { id: req.params.id },
    });

    if (!campaign) {
      throw new ApiError(404, "Campaign not found");
    }

    // 2. Perform atomic status transition claim: only succeeds if status is 'queued' or 'sending'
    const claimed = await forWorkspace(req.workspaceId!).campaign.updateMany({
      where: {
        id: req.params.id,
        status: { in: ["queued", "sending"] },
      },
      data: { status: "cancelled" },
    });

    if (claimed.count === 0) {
      throw new ApiError(
        400,
        "Campaign cannot be cancelled — it may already be completed, still a draft, or already cancelled"
      );
    }

    // 3. Fetch and return the updated campaign row
    const updatedCampaign = await forWorkspace(req.workspaceId!).campaign.findUnique({
      where: { id: req.params.id },
    });

    res.status(200).json(updatedCampaign);
  })
);

/**
 * POST /:id/archive
 * Sets archived: true on the campaign (no status restriction).
 */
campaignsRouter.post(
  "/:id/archive",
  asyncHandler(async (req: Request, res: Response) => {
    const campaign = await forWorkspace(req.workspaceId!).campaign.findUnique({
      where: { id: req.params.id },
    });

    if (!campaign) {
      throw new ApiError(404, "Campaign not found");
    }

    const updated = await forWorkspace(req.workspaceId!).campaign.update({
      where: { id: req.params.id },
      data: { archived: true },
    });

    res.status(200).json(updated);
  })
);

/**
 * POST /:id/unarchive
 * Sets archived: false on the campaign.
 */
campaignsRouter.post(
  "/:id/unarchive",
  asyncHandler(async (req: Request, res: Response) => {
    const campaign = await forWorkspace(req.workspaceId!).campaign.findUnique({
      where: { id: req.params.id },
    });

    if (!campaign) {
      throw new ApiError(404, "Campaign not found");
    }

    const updated = await forWorkspace(req.workspaceId!).campaign.update({
      where: { id: req.params.id },
      data: { archived: false },
    });

    res.status(200).json(updated);
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
