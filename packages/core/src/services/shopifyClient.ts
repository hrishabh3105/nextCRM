import crypto from "crypto";
import { ApiError } from "../apiError";

interface TokenCacheEntry {
  accessToken: string;
  scope: string;
  expiresAt: number; // timestamp in ms
}

const tokenCache = new Map<string, TokenCacheEntry>();
const inFlightRequests = new Map<string, Promise<{ accessToken: string; scope: string }>>();

/**
 * Validates a shop domain string against the *.myshopify.com format.
 * Anchored at BOTH ends (^ and $): a missing $ would let shop.myshopify.com.attacker.example through.
 */
export function isValidShopDomain(shop: string): boolean {
  if (!shop || typeof shop !== "string") {
    return false;
  }
  return /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop.trim());
}

/**
 * Clears the in-memory token cache for a shop (or all shops if not specified).
 * Useful when receiving a 401 or for testing.
 */
export function clearShopifyTokenCache(shopDomain?: string): void {
  if (shopDomain) {
    tokenCache.delete(shopDomain.trim());
  } else {
    tokenCache.clear();
  }
}

/**
 * Obtains an Admin API access token for a Shopify development store using the client credentials grant.
 * Caches tokens in-memory and reuses until 5 minutes before expiry.
 * Concurrent callers share a single in-flight promise per shop (single-flight).
 *
 * 30s timeout via AbortSignal.timeout.
 * Errors:
 * - "shop_not_permitted" -> ApiError(400, "Shopify refused access: the store must be in the same organization as the NextCRM Dev app, and the app must be installed on it")
 * - other non-OK -> ApiError(502)
 * - network/timeout -> ApiError(503)
 * Never logs the token or the secret.
 */
export async function getShopifyAccessToken(
  shopDomain: string
): Promise<{ accessToken: string; scope: string }> {
  const shop = shopDomain.trim();
  const cached = tokenCache.get(shop);
  const now = Date.now();

  // Reuse until 5 minutes before expiry (5 * 60 * 1000 = 300,000 ms)
  if (cached && cached.expiresAt - 5 * 60 * 1000 > now) {
    return {
      accessToken: cached.accessToken,
      scope: cached.scope,
    };
  }

  // Single-flight deduplication: reuse in-flight request if present
  const inFlight = inFlightRequests.get(shop);
  if (inFlight) {
    return inFlight;
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new ApiError(500, "Shopify client credentials not configured in environment");
  }

  const requestPromise = (async () => {
    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        let errorData: any = null;
        try {
          errorData = await response.json();
        } catch {
          try {
            errorData = await response.text();
          } catch {
            errorData = null;
          }
        }

        const errorString =
          typeof errorData === "string"
            ? errorData
            : typeof errorData?.error === "string"
            ? errorData.error
            : typeof errorData?.error_description === "string"
            ? errorData.error_description
            : JSON.stringify(errorData || {});

        if (errorString.includes("shop_not_permitted")) {
          throw new ApiError(
            400,
            "Shopify refused access: the store must be in the same organization as the NextCRM Dev app, and the app must be installed on it"
          );
        }

        throw new ApiError(502, `Shopify token request failed with status ${response.status}`);
      }

      const data = (await response.json()) as {
        access_token: string;
        scope: string;
        expires_in: number;
      };

      if (!data?.access_token) {
        throw new ApiError(502, "Shopify token response missing access_token");
      }

      const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : 86400;
      const expiresAt = Date.now() + expiresInSec * 1000;

      tokenCache.set(shop, {
        accessToken: data.access_token,
        scope: data.scope || "",
        expiresAt,
      });

      return {
        accessToken: data.access_token,
        scope: data.scope || "",
      };
    } catch (err: any) {
      if (err instanceof ApiError) {
        throw err;
      }

      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        throw new ApiError(503, "Shopify token request timed out after 30 seconds");
      }

      throw new ApiError(503, `Failed to connect to Shopify: ${err?.message || "network error"}`);
    } finally {
      inFlightRequests.delete(shop);
    }
  })();

  inFlightRequests.set(shop, requestPromise);
  return requestPromise;
}

/**
 * Executes a GraphQL query/mutation against the Shopify Admin GraphQL API.
 * Uses getShopifyAccessToken to obtain the access token.
 * On HTTP 401, clears the shop's cached token and retries once.
 * Throws ApiError if Shopify returns top-level GraphQL errors.
 */
export async function shopifyGraphQL<T = any>(
  shopDomain: string,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const shop = shopDomain.trim();
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-07";
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

  async function executeRequest(token: string): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30000),
    });
  }

  let { accessToken } = await getShopifyAccessToken(shop);
  let response = await executeRequest(accessToken);

  // On a 401, clear that shop's cache entry and retry once
  if (response.status === 401) {
    tokenCache.delete(shop);
    const refreshed = await getShopifyAccessToken(shop);
    accessToken = refreshed.accessToken;
    response = await executeRequest(accessToken);
  }

  if (!response.ok) {
    let errBody: any;
    try {
      errBody = await response.json();
    } catch {
      errBody = null;
    }

    if (errBody?.errors && Array.isArray(errBody.errors)) {
      const msg = errBody.errors.map((e: any) => e.message || JSON.stringify(e)).join("; ");
      throw new ApiError(502, `Shopify GraphQL error: ${msg}`, errBody.errors);
    }

    throw new ApiError(
      response.status === 503 ? 503 : 502,
      `Shopify GraphQL request failed with HTTP ${response.status}`
    );
  }

  const json = (await response.json()) as any;

  if (json?.errors && Array.isArray(json.errors) && json.errors.length > 0) {
    const msg = json.errors.map((e: any) => e.message || JSON.stringify(e)).join("; ");
    throw new ApiError(502, `Shopify GraphQL error: ${msg}`, json.errors);
  }

  return json.data as T;
}

/**
 * Verifies connectivity to a Shopify store by querying shop name via GraphQL.
 * Soft check — returns true if valid, false on any failure (never throws).
 */
export async function verifyStoreConnection(shopDomain: string): Promise<boolean> {
  try {
    const data = await shopifyGraphQL<{ shop?: { name?: string } }>(
      shopDomain,
      `query { shop { name } }`
    );
    return Boolean(data?.shop?.name);
  } catch {
    return false;
  }
}

export interface RegisterWebhookResult {
  topic: string;
  ok: boolean;
  detail?: string;
}

/**
 * Registers webhook subscriptions for required topics via Shopify GraphQL mutation webhookSubscriptionCreate.
 * For topics ORDERS_CREATE, ORDERS_UPDATED, CHECKOUTS_CREATE, CHECKOUTS_UPDATE, APP_UNINSTALLED.
 * Treats a userError saying the address/topic is already taken as success (ok: true, detail "already registered").
 * Returns an array of { topic, ok, detail? } and never throws.
 */
export async function registerWebhooks(
  shopDomain: string,
  address: string
): Promise<RegisterWebhookResult[]> {
  const topics = [
    "ORDERS_CREATE",
    "ORDERS_UPDATED",
    "CHECKOUTS_CREATE",
    "CHECKOUTS_UPDATE",
    "APP_UNINSTALLED",
  ];

  const mutation = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription {
          id
          topic
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const results: RegisterWebhookResult[] = [];

  for (const topic of topics) {
    try {
      const data = await shopifyGraphQL<{
        webhookSubscriptionCreate?: {
          webhookSubscription?: { id: string; topic: string } | null;
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      }>(shopDomain, mutation, {
        topic,
        webhookSubscription: {
          callbackUrl: address,
          format: "JSON",
        },
      });

      const userErrors = data?.webhookSubscriptionCreate?.userErrors || [];

      if (userErrors.length > 0) {
        const isAlreadyTaken = userErrors.some((err) =>
          /already\s+been\s+taken|already\s+exists|taken/i.test(err.message)
        );

        if (isAlreadyTaken) {
          results.push({
            topic,
            ok: true,
            detail: "already registered",
          });
        } else {
          results.push({
            topic,
            ok: false,
            detail: userErrors.map((e) => e.message).join("; "),
          });
        }
      } else if (data?.webhookSubscriptionCreate?.webhookSubscription?.id) {
        results.push({
          topic,
          ok: true,
        });
      } else {
        results.push({
          topic,
          ok: false,
          detail: "Unknown response from Shopify GraphQL",
        });
      }
    } catch (err: any) {
      results.push({
        topic,
        ok: false,
        detail: err?.message || "Registration failed",
      });
    }
  }

  return results;
}

/**
 * Verifies incoming Shopify webhook signature using HMAC-SHA256 in base64 format.
 * Uses timingSafeEqual to guard against timing attacks.
 * Soft check — returns false on any mismatch or exception (never throws).
 */
export async function verifyShopifyWebhook(params: {
  rawBody: Buffer;
  hmacHeader: string | undefined;
  apiSecret: string;
}): Promise<boolean> {
  const { rawBody, hmacHeader, apiSecret } = params;

  try {
    if (!hmacHeader || typeof hmacHeader !== "string") {
      return false;
    }

    if (!Buffer.isBuffer(rawBody) || !apiSecret) {
      return false;
    }

    const computedBuffer = crypto
      .createHmac("sha256", apiSecret)
      .update(rawBody)
      .digest();
    const headerBuffer = Buffer.from(hmacHeader.trim(), "base64");

    if (computedBuffer.length !== headerBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(computedBuffer, headerBuffer);
  } catch {
    return false;
  }
}
