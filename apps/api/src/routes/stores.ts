import { Router, Request, Response } from "express";
import {
  ApiError,
  forWorkspace,
  validateOrThrow,
  verifyStoreConnection,
  registerWebhooks,
  getShopifyAccessToken,
  shopifyGraphQL,
  EXPECTED_WEBHOOK_TOPICS,
  REQUIRED_APP_SCOPES,
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

export interface HealthCheckItem {
  key: string;
  status: "ok" | "warn" | "error";
  message: string;
  fix?: string;
}

interface StoreHealthCacheEntry {
  result: { checks: HealthCheckItem[] };
  cachedAt: number;
}

const storeHealthCache = new Map<string, StoreHealthCacheEntry>();

/**
 * GET /:id/health
 * Returns health checks for the specified Shopify store connection:
 * - Shopify connection (verifyStoreConnection, 5s timeout)
 * - Registered webhooks vs expected topics
 * - Granted access scopes vs required
 * - Last webhook recency (warn if null or older than 7 days)
 * - Orders in the last 30 days without resolvable phone
 * - Consent switch state
 *
 * Caches results for 60s per store. Never returns tokens or secrets.
 * An individual check failing will not fail the whole endpoint.
 */
storesRouter.get(
  "/:id/health",
  asyncHandler(async (req: Request, res: Response) => {
    const store = await forWorkspace(req.workspaceId!).storeConnection.findUnique({
      where: { id: req.params.id },
    });

    if (!store) {
      throw new ApiError(404, "Store connection not found");
    }

    const force = req.query.force === "true";
    const cacheKey = `${req.workspaceId}:${store.id}`;
    const cached = storeHealthCache.get(cacheKey);

    if (!force && cached && Date.now() - cached.cachedAt < 60000) {
      res.status(200).json(cached.result);
      return;
    }

    const checks: HealthCheckItem[] = [];

    // Check 1: Shopify connection (5s timeout)
    try {
      const isConnected = await verifyStoreConnection(store.shopDomain, 5000);
      if (isConnected) {
        checks.push({
          key: "shopify_connection",
          status: "ok",
          message: "Successfully connected to Shopify Admin API.",
        });
      } else {
        checks.push({
          key: "shopify_connection",
          status: "error",
          message: "Could not connect to Shopify or obtain access token.",
          fix: "Reconnect your store or verify that the app is installed in your Shopify admin.",
        });
      }
    } catch (err: any) {
      checks.push({
        key: "shopify_connection",
        status: "error",
        message: `Connection check failed: ${err?.message || "Unknown error"}`,
        fix: "Check your Shopify credentials and reconnect the store.",
      });
    }

    // Check 2: Registered webhooks
    try {
      const webhookQuery = `
        query getWebhookSubscriptions {
          webhookSubscriptions(first: 50) {
            edges {
              node {
                id
                topic
              }
            }
          }
        }
      `;
      const data = await shopifyGraphQL<{
        webhookSubscriptions?: {
          edges?: Array<{ node: { id: string; topic: string } }>;
        };
      }>(store.shopDomain, webhookQuery, undefined, { timeoutMs: 5000 });

      const registered = (data?.webhookSubscriptions?.edges || []).map(
        (e) => e.node.topic
      );
      const missingTopics = EXPECTED_WEBHOOK_TOPICS.filter(
        (topic) => !registered.includes(topic)
      );

      if (missingTopics.length === 0) {
        checks.push({
          key: "webhooks",
          status: "ok",
          message: `All ${EXPECTED_WEBHOOK_TOPICS.length} expected webhook topics are registered with Shopify.`,
        });
      } else {
        checks.push({
          key: "webhooks",
          status: "warn",
          message: `Missing ${missingTopics.length} webhook topic(s): ${missingTopics.join(", ")}.`,
          fix: "Click Reconnect to re-register all required webhooks.",
        });
      }
    } catch (err: any) {
      checks.push({
        key: "webhooks",
        status: "warn",
        message: `Could not verify registered webhooks: ${err?.message || "GraphQL error"}`,
        fix: "Click Reconnect to refresh webhook subscriptions.",
      });
    }

    // Check 3: Access scopes
    try {
      let grantedHandles: string[] = [];

      try {
        const scopesQuery = `
          query getAppScopes {
            currentAppInstallation {
              accessScopes {
                handle
              }
            }
          }
        `;
        const scopeData = await shopifyGraphQL<{
          currentAppInstallation?: {
            accessScopes?: Array<{ handle: string }>;
          };
        }>(store.shopDomain, scopesQuery, undefined, { timeoutMs: 5000 });

        grantedHandles = (scopeData?.currentAppInstallation?.accessScopes || []).map(
          (s) => s.handle
        );
      } catch {
        // Fallback to grantedScopes stored on storeConnection if live query fails
        if (store.grantedScopes) {
          grantedHandles = store.grantedScopes.split(/[\s,]+/).filter(Boolean);
        }
      }

      const missingScopes = REQUIRED_APP_SCOPES.filter((reqScope) => {
        const writeVariant = reqScope.replace(/^read_/, "write_");
        return (
          !grantedHandles.includes(reqScope) &&
          !grantedHandles.includes(writeVariant)
        );
      });

      if (missingScopes.length === 0) {
        checks.push({
          key: "scopes",
          status: "ok",
          message: `All required access scopes are granted (${REQUIRED_APP_SCOPES.join(", ")}).`,
        });
      } else {
        checks.push({
          key: "scopes",
          status: "error",
          message: `Missing required access scope(s): ${missingScopes.join(", ")}.`,
          fix: "Update your Shopify app configuration in the Partners Dashboard to grant required scopes, then reinstall the app.",
        });
      }
    } catch (err: any) {
      checks.push({
        key: "scopes",
        status: "error",
        message: `Scope check failed: ${err?.message || "Unknown error"}`,
        fix: "Verify app permissions in Shopify admin.",
      });
    }

    // Check 4: Last webhook recency
    try {
      if (!store.lastWebhookAt) {
        checks.push({
          key: "last_webhook",
          status: "warn",
          message: "No webhooks have been received yet from this store.",
          fix: "Place a test order or initiate checkout in your store to test webhook delivery.",
        });
      } else {
        const diffMs = Date.now() - new Date(store.lastWebhookAt).getTime();
        const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        if (diffDays >= 7) {
          checks.push({
            key: "last_webhook",
            status: "warn",
            message: `Last webhook was received ${diffDays} day(s) ago.`,
            fix: "Check your store activity or click Reconnect to refresh webhooks.",
          });
        } else {
          checks.push({
            key: "last_webhook",
            status: "ok",
            message: `Last webhook was received on ${new Date(store.lastWebhookAt).toISOString().split("T")[0]}.`,
          });
        }
      }
    } catch (err: any) {
      checks.push({
        key: "last_webhook",
        status: "warn",
        message: `Could not evaluate last webhook timestamp: ${err?.message || "Unknown error"}`,
      });
    }

    // Check 5: Orders in the last 30 days with no resolvable phone
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const ordersWithoutPhone = await forWorkspace(req.workspaceId!).order.count({
        where: {
          contactId: null,
          createdAt: { gte: thirtyDaysAgo },
        },
      });

      if (ordersWithoutPhone > 0) {
        checks.push({
          key: "orders_without_phone",
          status: "warn",
          message: `${ordersWithoutPhone} order(s) in the last 30 days had no resolvable phone number.`,
          fix: "Configure Shopify checkout to make phone numbers required (Settings > Checkout > Customer contact method).",
        });
      } else {
        checks.push({
          key: "orders_without_phone",
          status: "ok",
          message: "All orders in the last 30 days have a resolvable phone number.",
        });
      }
    } catch (err: any) {
      checks.push({
        key: "orders_without_phone",
        status: "warn",
        message: `Could not count orders without phone: ${err?.message || "Unknown error"}`,
      });
    }

    // Check 6: Consent switch state (informational)
    try {
      const isConsentOn = store.treatShopifySmsAsWhatsappConsent ?? true;
      checks.push({
        key: "consent_switch",
        status: "ok",
        message: isConsentOn
          ? "Shopify SMS consent fallback is enabled (customers agreeing to SMS can receive WhatsApp promotional messages)."
          : "Shopify SMS consent fallback is disabled (only explicit WhatsApp consent is accepted).",
      });
    } catch (err: any) {
      checks.push({
        key: "consent_switch",
        status: "ok",
        message: "Consent switch state verified.",
      });
    }

    const payload = { checks };
    storeHealthCache.set(cacheKey, {
      result: payload,
      cachedAt: Date.now(),
    });

    res.status(200).json(payload);
  })
);
