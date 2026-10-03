import { Router, Request, Response } from "express";
import {
  ApiError,
  forWorkspace,
  validateOrThrow,
  encryptToken,
  decryptToken,
  verifyStoreConnection,
  registerWebhook,
} from "@nextcrm/core";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createStoreConnectionSchema,
  CreateStoreConnectionInput,
  reconnectStoreConnectionSchema,
  ReconnectStoreConnectionInput,
} from "../validation/storeConnectionSchema";

export const storesRouter = Router();

/**
 * Shared helper to verify store connectivity and register Shopify webhooks.
 * Used during initial connection (POST /) and reconnection/refresh (PATCH /:id/reconnect).
 */
async function verifyAndRegisterWebhooks(params: {
  shopDomain: string;
  accessToken: string;
}): Promise<{ isVerified: boolean }> {
  const { shopDomain, accessToken } = params;

  const isVerified = await verifyStoreConnection({
    shopDomain,
    accessToken,
  });

  if (isVerified) {
    const webhookUrl = `${env.PUBLIC_WEBHOOK_BASE_URL.trim()}/webhooks/shopify`;
    const topics = [
      "orders/create",
      "orders/updated",
      "checkouts/create",
      "checkouts/update",
    ];

    for (const topic of topics) {
      const result = await registerWebhook({
        shopDomain,
        accessToken,
        topic,
        address: webhookUrl,
      });

      if (!result.success) {
        console.warn(
          `[shopify] Failed to register webhook topic "${topic}" for store ${shopDomain} at ${webhookUrl}`
        );
      }
    }
  }

  return { isVerified };
}

/**
 * POST /
 * Connects a new Shopify store for the authenticated workspace.
 * Encrypts the raw accessToken and apiSecretKey using AES-256-GCM before saving to database.
 * CRITICAL: accessTokenEnc and apiSecretEnc are explicitly stripped out and NEVER returned to the client.
 */
storesRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const validatedData = validateOrThrow<CreateStoreConnectionInput>(
      createStoreConnectionSchema,
      req.body
    );

    const { shopDomain, accessToken, apiSecretKey } = validatedData;
    const accessTokenEnc = encryptToken(accessToken);

    // Creates the StoreConnection record. P2002 unique constraint violations on shopDomain
    // propagate to the global errorHandler middleware, which returns HTTP 409.
    const store = await forWorkspace(req.workspaceId!).storeConnection.create({
      data: {
        shopDomain,
        accessTokenEnc,
        status: "pending",
      } as any,
    });

    let currentStore = store;
    let verificationWarning: string | undefined = undefined;

    const { isVerified } = await verifyAndRegisterWebhooks({
      shopDomain,
      accessToken,
    });

    if (isVerified) {
      const apiSecretEnc = encryptToken(apiSecretKey);

      currentStore = await forWorkspace(req.workspaceId!).storeConnection.update({
        where: { id: store.id },
        data: {
          status: "connected",
          apiSecretEnc,
        },
      });
    } else {
      verificationWarning =
        "Could not verify this store connection with Shopify. Double check your credentials.";
    }

    // Explicitly exclude accessTokenEnc and apiSecretEnc from response
    const {
      accessTokenEnc: _strippedToken,
      apiSecretEnc: _strippedSecret,
      ...safeStore
    } = currentStore;

    res.status(201).json({
      ...safeStore,
      ...(verificationWarning ? { verificationWarning } : {}),
    });
  })
);

/**
 * PATCH /:id/reconnect
 * Reconnects or refreshes credentials / webhooks for an existing Shopify store connection.
 * Both accessToken and apiSecretKey are optional: if omitted, stored (decrypted) credentials are reused.
 */
storesRouter.patch(
  "/:id/reconnect",
  asyncHandler(async (req: Request, res: Response) => {
    const validatedData = validateOrThrow<ReconnectStoreConnectionInput>(
      reconnectStoreConnectionSchema,
      req.body
    );

    const store = await forWorkspace(req.workspaceId!).storeConnection.findUnique({
      where: { id: req.params.id },
    });

    if (!store) {
      throw new ApiError(404, "Store connection not found");
    }

    const { accessToken, apiSecretKey } = validatedData;

    // Use new accessToken if provided, otherwise decrypt existing stored token
    const effectiveAccessToken = accessToken
      ? accessToken.trim()
      : decryptToken(store.accessTokenEnc);

    const updateData: Record<string, any> = {};

    if (accessToken) {
      updateData.accessTokenEnc = encryptToken(accessToken.trim());
    }

    if (apiSecretKey) {
      updateData.apiSecretEnc = encryptToken(apiSecretKey.trim());
    }

    const { isVerified } = await verifyAndRegisterWebhooks({
      shopDomain: store.shopDomain,
      accessToken: effectiveAccessToken,
    });

    let verificationWarning: string | undefined = undefined;

    if (isVerified) {
      updateData.status = "connected";
    } else {
      updateData.status = "pending";
      verificationWarning =
        "Could not verify this store connection with Shopify. Double check your credentials.";
    }

    const updatedStore = await forWorkspace(req.workspaceId!).storeConnection.update({
      where: { id: store.id },
      data: updateData,
    });

    const {
      accessTokenEnc: _strippedToken,
      apiSecretEnc: _strippedSecret,
      ...safeStore
    } = updatedStore;

    res.status(200).json({
      ...safeStore,
      ...(verificationWarning ? { verificationWarning } : {}),
    });
  })
);

/**
 * GET /
 * Lists all store connections for the authenticated workspace.
 * CRITICAL: Strips accessTokenEnc and apiSecretEnc from every store before returning.
 */
storesRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const stores = await forWorkspace(req.workspaceId!).storeConnection.findMany({
      orderBy: { createdAt: "desc" },
    });

    const safeStores = stores.map(
      ({
        accessTokenEnc: _strippedToken,
        apiSecretEnc: _strippedSecret,
        ...safeStore
      }: any) => safeStore
    );

    res.status(200).json(safeStores);
  })
);
