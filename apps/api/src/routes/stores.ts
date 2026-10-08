import { Router, Request, Response } from "express";
import {
  ApiError,
  forWorkspace,
  validateOrThrow,
  verifyStoreConnection,
  registerWebhooks,
  getShopifyAccessToken,
} from "@nextcrm/core";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createStoreConnectionSchema,
  CreateStoreConnectionInput,
  updateStoreConsentSettingsSchema,
  UpdateStoreConsentSettingsInput,
} from "../validation/storeConnectionSchema";

export const storesRouter = Router();

/**
 * POST /
 * Connects a new Shopify store for the authenticated workspace.
 *
 * NOTE: DEV-ONLY: This client-credentials path only works for stores in our own
 * Shopify organization. Real merchants will need the OAuth install flow.
 *
 * CRITICAL: accessTokenEnc and apiSecretEnc are explicitly stripped out and NEVER returned to the client.
 */
storesRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const validatedData = validateOrThrow<CreateStoreConnectionInput>(
      createStoreConnectionSchema,
      req.body
    );

    const { shopDomain } = validatedData;

    // Get an access token via client credentials.
    // Fails clearly with ApiError(400) if the app isn't installed or the store is not in the organization.
    const tokenResponse = await getShopifyAccessToken(shopDomain);

    const isVerified = await verifyStoreConnection(shopDomain);
    const status = isVerified ? "connected" : "pending";
    const verificationWarning = isVerified
      ? undefined
      : "Could not verify this store connection with Shopify. Double check your credentials.";

    // Creates the StoreConnection record. P2002 unique constraint violations on shopDomain
    // propagate to the global errorHandler middleware, which returns HTTP 409.
    const store = await forWorkspace(req.workspaceId!).storeConnection.create({
      data: {
        shopDomain,
        authMode: "client_credentials",
        grantedScopes: tokenResponse.scope,
        status,
      } as any,
    });

    const webhookAddress = `${env.PUBLIC_WEBHOOK_BASE_URL.trim()}/webhooks/shopify`;
    const webhooks = await registerWebhooks(shopDomain, webhookAddress);

    // Explicitly exclude accessTokenEnc and apiSecretEnc from response
    const {
      accessTokenEnc: _strippedToken,
      apiSecretEnc: _strippedSecret,
      ...safeStore
    } = store;

    res.status(201).json({
      ...safeStore,
      webhooks,
      ...(verificationWarning ? { verificationWarning } : {}),
    });
  })
);

/**
 * PATCH /:id/reconnect
 * Reconnects or refreshes webhooks for an existing Shopify store connection.
 * No body needed; re-verifies connectivity, re-runs webhook registration, updates status,
 * and returns the updated store along with the webhooks registration results.
 */
storesRouter.patch(
  "/:id/reconnect",
  asyncHandler(async (req: Request, res: Response) => {
    const store = await forWorkspace(req.workspaceId!).storeConnection.findUnique({
      where: { id: req.params.id },
    });

    if (!store) {
      throw new ApiError(404, "Store connection not found");
    }

    const isVerified = await verifyStoreConnection(store.shopDomain);
    const webhookAddress = `${env.PUBLIC_WEBHOOK_BASE_URL.trim()}/webhooks/shopify`;
    const webhooks = await registerWebhooks(store.shopDomain, webhookAddress);

    const status = isVerified ? "connected" : "pending";
    const verificationWarning = isVerified
      ? undefined
      : "Could not verify this store connection with Shopify. Double check your credentials.";

    const updatedStore = await forWorkspace(req.workspaceId!).storeConnection.update({
      where: { id: store.id },
      data: { status },
    });

    const {
      accessTokenEnc: _strippedToken,
      apiSecretEnc: _strippedSecret,
      ...safeStore
    } = updatedStore;

    res.status(200).json({
      ...safeStore,
      webhooks,
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

/**
 * PATCH /:id/consent-settings
 * Updates whether to treat Shopify SMS marketing subscription as WhatsApp consent (SMS FALLBACK ONLY).
 * Explicit WhatsApp marketing consent from Shopify's CustomerPhoneNumber.whatsAppMarketingConsent
 * is used as the primary signal regardless of this setting. This setting controls only the SMS fallback.
 * Enabling requires confirmWording: true and records consentAttestedAt and consentAttestedByUserId.
 */
storesRouter.patch(
  "/:id/consent-settings",
  asyncHandler(async (req: Request, res: Response) => {
    const validatedData = validateOrThrow<UpdateStoreConsentSettingsInput>(
      updateStoreConsentSettingsSchema,
      req.body
    );

    const store = await forWorkspace(req.workspaceId!).storeConnection.findUnique({
      where: { id: req.params.id },
    });

    if (!store) {
      throw new ApiError(404, "Store connection not found");
    }

    const { treatShopifySmsAsWhatsappConsent, confirmWording } = validatedData;
    const updateData: any = {
      treatShopifySmsAsWhatsappConsent,
    };

    if (treatShopifySmsAsWhatsappConsent) {
      if (confirmWording !== true) {
        throw new ApiError(
          400,
          "confirmWording must be true to enable treating Shopify SMS as WhatsApp consent"
        );
      }
      updateData.consentAttestedAt = new Date();
      updateData.consentAttestedByUserId = (req as any).user?.id || (req as any).userId || null;
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

    res.status(200).json(safeStore);
  })
);
