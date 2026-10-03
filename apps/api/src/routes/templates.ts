import { Router, Request, Response } from "express";
import multer from "multer";
import {
  ApiError,
  forWorkspace,
  validateOrThrow,
  decryptToken,
  submitTemplate,
  uploadMediaForTemplate,
  getTemplateStatus,
  sendTemplateMessage,
  recordMessageCost,
  checkFrequencyCap,
  recordOutboundMessage,
} from "@nextcrm/core";
import { env } from "../config/env";
import { normalizePhoneE164 } from "../utils/phone";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createTemplateSchema,
  CreateTemplateInput,
  extractPlaceholders,
  extractPositionalPlaceholders,
} from "../validation/templateSchema";

export const templatesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/**
 * POST /upload-media
 * Uploads an image file for a template header via Meta's Resumable Upload API.
 * The file is passed directly in memory to Meta and never persisted to local disk/database.
 */
templatesRouter.post(
  "/upload-media",
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new ApiError(400, "File is required (form field 'file')");
    }

    const { channelId } = req.body;
    if (!channelId || typeof channelId !== "string" || !channelId.trim()) {
      throw new ApiError(400, "channelId is required");
    }

    // Validate file type: image/jpeg or image/png
    const allowedMimeTypes = ["image/jpeg", "image/png"];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      throw new ApiError(400, "Invalid file type. Only image/jpeg and image/png are supported.");
    }

    // Validate file size: under 5MB
    const maxSizeBytes = 5 * 1024 * 1024;
    if (req.file.size > maxSizeBytes) {
      throw new ApiError(400, "File size exceeds the 5MB limit.");
    }

    const channel = await forWorkspace(req.workspaceId!).channel.findUnique({
      where: { id: channelId.trim() },
    });

    if (!channel) {
      throw new ApiError(404, "Channel not found");
    }

    if (!channel.accessTokenEnc) {
      throw new ApiError(400, "Channel is missing required Meta credentials");
    }

    const accessToken = decryptToken(channel.accessTokenEnc);

    const result = await uploadMediaForTemplate({
      accessToken,
      appId: env.META_APP_ID,
      fileBuffer: req.file.buffer,
      fileType: req.file.mimetype,
      fileLength: req.file.size,
    });

    res.status(200).json({ handle: result.handle });
  })
);

/**
 * GET /
 * Lists all templates for the authenticated workspace.
 */
templatesRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const templates = await forWorkspace(req.workspaceId!).template.findMany({
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(templates);
  })
);

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

    const placeholders = extractPlaceholders(validatedData.body);
    const positionalPlaceholders = extractPositionalPlaceholders(validatedData.body);

    const template = await forWorkspace(req.workspaceId!).template.create({
      data: {
        channelId: validatedData.channelId,
        providerName: validatedData.name,
        language: validatedData.language,
        category: validatedData.category,
        headerType: validatedData.headerType ?? "TEXT",
        headerText: validatedData.headerText ?? null,
        headerMediaHandle: validatedData.headerMediaHandle ?? null,
        bodyPreview: validatedData.body,
        footerText: validatedData.footerText ?? null,
        buttons: validatedData.buttons ?? null,
        placeholders,
        positionalPlaceholders,
        examples: validatedData.examples ?? null,
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

    const examples =
      template.examples &&
      typeof template.examples === "object" &&
      !Array.isArray(template.examples)
        ? (template.examples as Record<string, string>)
        : undefined;

    const positionalPlaceholders =
      Array.isArray(template.positionalPlaceholders)
        ? (template.positionalPlaceholders as string[])
        : extractPositionalPlaceholders(template.bodyPreview);

    const result = await submitTemplate({
      accessToken,
      wabaId: channel.wabaId,
      name: template.providerName,
      language: template.language,
      category: template.category,
      body: template.bodyPreview,
      positionalPlaceholders,
      headerType: template.headerType ?? undefined,
      headerText: template.headerText ?? undefined,
      headerMediaHandle: template.headerMediaHandle ?? undefined,
      footerText: template.footerText ?? undefined,
      buttons: (template.buttons as any) ?? undefined,
      examples,
    });

    const updatedTemplate = await forWorkspace(req.workspaceId!).template.update({
      where: { id: template.id },
      data: {
        status: "submitted",
        providerTemplateId: result.providerTemplateId,
        positionalPlaceholders: template.positionalPlaceholders ? undefined : positionalPlaceholders,
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

    const db = forWorkspace(req.workspaceId!);
    const rawPhone = to.trim();
    const normalizedPhone = normalizePhoneE164(rawPhone) || rawPhone;

    let contact = await db.contact.findFirst({
      where: {
        OR: [
          { phone: normalizedPhone },
          { phone: rawPhone },
        ],
      },
    });

    if (!contact) {
      try {
        contact = await db.contact.create({
          data: {
            phone: normalizedPhone,
            optedInAt: new Date(),
          } as any,
        });
      } catch (err: any) {
        if (err?.code === "P2002") {
          contact = await db.contact.findFirst({
            where: { phone: normalizedPhone },
          });
        } else {
          throw err;
        }
      }
    }

    if (!contact) {
      throw new ApiError(500, "Failed to resolve contact for test message");
    }

    const canSend = await checkFrequencyCap(db, contact.id);
    if (!canSend) {
      throw new ApiError(429, "Frequency cap reached for this contact, try again later");
    }

    const accessToken = decryptToken(channel.accessTokenEnc);

    const result = await sendTemplateMessage({
      accessToken,
      phoneNumberId: channel.phoneNumberId,
      to: normalizedPhone || rawPhone,
      templateName: template.providerName,
      language: template.language,
      variables: variables.map((v) => String(v)),
    });

    await recordMessageCost({
      workspaceId: req.workspaceId!,
      messageId: result.providerMessageId,
      category: template.category,
    });

    await recordOutboundMessage({
      workspaceId: req.workspaceId!,
      contactId: contact.id,
      channelId: channel.id,
      providerMessageId: result.providerMessageId,
      body: template.bodyPreview,
    });

    res.status(200).json({ providerMessageId: result.providerMessageId });
  })
);

/**
 * DELETE /:id
 * Deletes a draft template. Submitted or approved templates cannot be deleted,
 * nor can templates referenced by any campaign.
 */
templatesRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const db = forWorkspace(req.workspaceId!);

    const template = await db.template.findUnique({
      where: { id: req.params.id },
    });

    if (!template) {
      throw new ApiError(404, "Template not found");
    }

    if (template.status !== "draft") {
      throw new ApiError(
        400,
        "Only draft templates can be deleted — submitted or approved templates may be in use by campaigns"
      );
    }

    const campaignCount = await db.campaign.count({
      where: { templateId: req.params.id },
    });

    if (campaignCount > 0) {
      throw new ApiError(
        400,
        "This template is referenced by one or more campaigns and cannot be deleted"
      );
    }

    await db.template.delete({
      where: { id: req.params.id },
    });

    res.status(204).send();
  })
);
