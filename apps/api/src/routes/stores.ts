import { Router, Request, Response } from "express";
import {
  forWorkspace,
  validateOrThrow,
  encryptToken,
  verifyStoreConnection,
  registerWebhook,
} from "@nextcrm/core";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createStoreConnectionSchema,
  CreateStoreConnectionInput,
} from "../validation/storeConnectionSchema";

export const storesRouter = Router();

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

    const isVerified = await verifyStoreConnection({
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

      // Register webhooks for order and checkout events
      const webhookUrl = `${env.PUBLIC_WEBHOOK_BASE_URL}/webhooks/shopify`;
      const topics = ["orders/create", "checkouts/create", "checkouts/update"];

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
