import { Router, Request, Response } from "express";
import {
  ApiError,
  forWorkspace,
  validateOrThrow,
  decryptToken,
  sendFreeformMessage,
} from "@nextcrm/core";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  sendMessageSchema,
  SendMessageInput,
} from "../validation/messageSchema";

export const conversationsRouter = Router();

/**
 * GET /
 * Lists conversations for the authenticated workspace.
 * Ordered by updatedAt desc, max 50 items.
 */
conversationsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const conversations = await forWorkspace(req.workspaceId!).conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    res.status(200).json(conversations);
  })
);

/**
 * GET /:id/messages
 * Lists messages in one conversation for the authenticated workspace.
 * Returns 404 if conversation does not exist.
 */
conversationsRouter.get(
  "/:id/messages",
  asyncHandler(async (req: Request, res: Response) => {
    const conversation = await forWorkspace(req.workspaceId!).conversation.findUnique({
      where: { id: req.params.id },
    });

    if (!conversation) {
      throw new ApiError(404, "Conversation not found");
    }

    const messages = await forWorkspace(req.workspaceId!).message.findMany({
      where: { conversationId: req.params.id },
      orderBy: { createdAt: "asc" },
    });

    res.status(200).json(messages);
  })
);

/**
 * POST /:id/messages
 * Sends a free-form reply within an open 24-hour conversation window.
 */
conversationsRouter.post(
  "/:id/messages",
  asyncHandler(async (req: Request, res: Response) => {
    const validatedData = validateOrThrow<SendMessageInput>(
      sendMessageSchema,
      req.body
    );

    const conversation = await forWorkspace(req.workspaceId!).conversation.findUnique({
      where: { id: req.params.id },
      include: { contact: true },
    });

    if (!conversation) {
      throw new ApiError(404, "Conversation not found");
    }

    // CRITICAL CHECK: Enforce the 24-hour window BEFORE any Meta API call
    if (!conversation.windowExpiresAt || conversation.windowExpiresAt < new Date()) {
      throw new ApiError(
        400,
        "Cannot send a free-form message: the 24-hour conversation window is closed. Use a template message instead."
      );
    }

    const channel = await forWorkspace(req.workspaceId!).channel.findUnique({
      where: { id: conversation.channelId },
    });

    if (!channel) {
      throw new ApiError(404, "Channel not found");
    }

    if (!channel.accessTokenEnc || !channel.phoneNumberId) {
      throw new ApiError(400, "Channel is missing required Meta credentials");
    }

    let toPhone = conversation.contact?.phone;
    if (!toPhone) {
      const contact = await forWorkspace(req.workspaceId!).contact.findUnique({
        where: { id: conversation.contactId },
      });
      if (!contact) {
        throw new ApiError(404, "Contact not found");
      }
      toPhone = contact.phone;
    }

    const accessToken = decryptToken(channel.accessTokenEnc);

    const result = await sendFreeformMessage({
      accessToken,
      phoneNumberId: channel.phoneNumberId,
      to: toPhone,
      body: validatedData.body,
    });

    const message = await forWorkspace(req.workspaceId!).message.create({
      data: {
        conversationId: conversation.id,
        contactId: conversation.contactId,
        direction: "outbound",
        providerMessageId: result.providerMessageId,
        body: validatedData.body,
        status: "sent",
      } as any,
    });

    res.status(201).json(message);
  })
);
