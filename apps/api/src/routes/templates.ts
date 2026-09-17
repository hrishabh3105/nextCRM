import { Router, Request, Response } from "express";
import {
  ApiError,
  forWorkspace,
  validateOrThrow,
  decryptToken,
  submitTemplate,
  getTemplateStatus,
  sendTemplateMessage,
} from "@nextcrm/core";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createTemplateSchema,
  CreateTemplateInput,
  countVariables,
} from "../validation/templateSchema";

export const templatesRouter = Router();

/**
 * POST /
 * Creates a template (local draft only, does NOT call Meta).
 */
templatesRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const validatedData = validateOrThrow<CreateTemplateInput>(
      createTemplateSchema,
      req.body
    );

    const channel = await forWorkspace(req.workspaceId!).channel.findUnique({
      where: { id: validatedData.channelId },
    });

    if (!channel) {
      throw new ApiError(404, "Channel not found");
    }

    const variableCount = countVariables(validatedData.body);

    const template = await forWorkspace(req.workspaceId!).template.create({
      data: {
        channelId: validatedData.channelId,
        providerName: validatedData.name,
        language: validatedData.language,
        category: validatedData.category,
        bodyPreview: validatedData.body,
        variableCount,
        status: "draft",
      } as any,
    });

    res.status(201).json(template);
  })
);

/**
 * POST /:id/submit
 * Submits an existing draft template to Meta for approval.
 */
templatesRouter.post(
  "/:id/submit",
  asyncHandler(async (req: Request, res: Response) => {
    const template = await forWorkspace(req.workspaceId!).template.findUnique({
      where: { id: req.params.id },
    });

    if (!template) {
      throw new ApiError(404, "Template not found");
    }

    const channel = await forWorkspace(req.workspaceId!).channel.findUnique({
      where: { id: template.channelId },
    });

    if (!channel) {
      throw new ApiError(404, "Channel not found");
    }

    if (!channel.accessTokenEnc || !channel.wabaId) {
      throw new ApiError(400, "Channel is missing required Meta credentials");
    }

    if (template.status !== "draft") {
      throw new ApiError(400, "Only draft templates can be submitted");
    }

    const accessToken = decryptToken(channel.accessTokenEnc);

    const result = await submitTemplate({
      accessToken,
      wabaId: channel.wabaId,
      name: template.providerName,
      language: template.language,
      category: template.category,
      body: template.bodyPreview,
    });

    const updatedTemplate = await forWorkspace(req.workspaceId!).template.update({
      where: { id: template.id },
      data: {
        status: "submitted",
        providerTemplateId: result.providerTemplateId,
      },
    });

    res.status(200).json(updatedTemplate);
  })
);

/**
 * GET /:id/status
 * Polls Meta for template approval status and updates the local record.
 */
templatesRouter.get(
  "/:id/status",
  asyncHandler(async (req: Request, res: Response) => {
    const template = await forWorkspace(req.workspaceId!).template.findUnique({
      where: { id: req.params.id },
    });

    if (!template) {
      throw new ApiError(404, "Template not found");
    }

    const channel = await forWorkspace(req.workspaceId!).channel.findUnique({
      where: { id: template.channelId },
    });

    if (!channel) {
      throw new ApiError(404, "Channel not found");
    }

    if (!template.providerTemplateId) {
      throw new ApiError(400, "Template has not been submitted yet");
    }

    if (!channel.accessTokenEnc) {
      throw new ApiError(400, "Channel is missing access token");
    }

    const accessToken = decryptToken(channel.accessTokenEnc);

    const result = await getTemplateStatus({
      accessToken,
      providerTemplateId: template.providerTemplateId,
    });

    const updatedTemplate = await forWorkspace(req.workspaceId!).template.update({
      where: { id: template.id },
      data: {
        status: result.status,
        rejectionReason: result.rejectionReason,
      },
    });

    res.status(200).json(updatedTemplate);
  })
);

/**
 * POST /:id/send-test
 * Sends a real WhatsApp test message using an approved template.
 */
templatesRouter.post(
  "/:id/send-test",
  asyncHandler(async (req: Request, res: Response) => {
    const { to, variables = [] } = req.body || {};

    if (!to || typeof to !== "string" || !to.trim()) {
      throw new ApiError(400, "'to' phone number is required");
    }

    if (!Array.isArray(variables)) {
      throw new ApiError(400, "'variables' must be an array of strings");
    }

    const template = await forWorkspace(req.workspaceId!).template.findUnique({
      where: { id: req.params.id },
    });

    if (!template) {
      throw new ApiError(404, "Template not found");
    }

    const channel = await forWorkspace(req.workspaceId!).channel.findUnique({
      where: { id: template.channelId },
    });

    if (!channel) {
      throw new ApiError(404, "Channel not found");
    }

    if (template.status !== "approved") {
      throw new ApiError(400, "Template must be approved before sending");
    }

    if (!channel.accessTokenEnc || !channel.phoneNumberId) {
      throw new ApiError(400, "Channel is missing required Meta credentials");
    }

    const accessToken = decryptToken(channel.accessTokenEnc);

    const result = await sendTemplateMessage({
      accessToken,
      phoneNumberId: channel.phoneNumberId,
      to: to.trim(),
      templateName: template.providerName,
      language: template.language,
      variables: variables.map((v) => String(v)),
    });

    res.status(200).json({ providerMessageId: result.providerMessageId });
  })
);
