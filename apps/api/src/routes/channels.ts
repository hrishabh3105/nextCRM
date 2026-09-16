import { Router, Request, Response } from "express";
import { ApiError, forWorkspace, validateOrThrow } from "@nextcrm/core";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createChannelSchema,
  CreateChannelInput,
} from "../validation/channelSchema";
import { encryptToken } from "../utils/tokenEncryption";

export const channelsRouter = Router();

/**
 * POST /
 * Creates a new channel for the authenticated workspace.
 * Encrypts the raw accessToken using AES-256-GCM before saving to database.
 * CRITICAL: accessTokenEnc is explicitly stripped out and NEVER returned to the client.
 */
channelsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const validatedData = validateOrThrow<CreateChannelInput>(
      createChannelSchema,
      req.body
    );

    const { accessToken, ...channelData } = validatedData;
    const accessTokenEnc = encryptToken(accessToken);

    const channel = await forWorkspace(req.workspaceId!).channel.create({
      data: {
        ...channelData,
        accessTokenEnc,
        status: "pending",
      } as any,
    });

    // Explicitly exclude accessTokenEnc from response
    const { accessTokenEnc: _stripped, ...safeChannel } = channel;

    res.status(201).json(safeChannel);
  })
);

/**
 * GET /
 * Lists all channels for the authenticated workspace.
 * CRITICAL: Strips accessTokenEnc from every channel before returning.
 */
channelsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const channels = await forWorkspace(req.workspaceId!).channel.findMany({
      orderBy: { createdAt: "desc" },
    });

    const safeChannels = channels.map(
      ({ accessTokenEnc: _stripped, ...safeChannel }) => safeChannel
    );

    res.status(200).json(safeChannels);
  })
);

/**
 * PATCH /:id
 * Updates the access token for an existing channel in the workspace.
 * Encrypts the raw accessToken using AES-256-GCM before saving to database.
 * CRITICAL: accessTokenEnc is explicitly stripped out and NEVER returned to the client.
 */
channelsRouter.patch(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { accessToken } = validateOrThrow<{ accessToken: string }>(
      createChannelSchema.pick({ accessToken: true }),
      req.body
    );

    const channel = await forWorkspace(req.workspaceId!).channel.findUnique({
      where: { id: req.params.id },
    });

    if (!channel) {
      throw new ApiError(404, "Channel not found");
    }

    const accessTokenEnc = encryptToken(accessToken);

    const updatedChannel = await forWorkspace(req.workspaceId!).channel.update({
      where: { id: req.params.id },
      data: {
        accessTokenEnc,
      },
    });

    const { accessTokenEnc: _stripped, ...safeChannel } = updatedChannel;

    res.status(200).json(safeChannel);
  })
);
