import crypto from "crypto";

/**
 * Verifies connectivity to a Shopify store via admin API.
 * Soft check — returns true if valid, false on any failure (never throws).
 * GET https://{shopDomain}/admin/api/2025-01/shop.json
 */
export async function verifyStoreConnection(params: {
  shopDomain: string;
  accessToken: string;
}): Promise<boolean> {
  const { shopDomain, accessToken } = params;

  try {
    const response = await fetch(`https://${shopDomain}/admin/api/2025-01/shop.json`, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": accessToken,
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Registers a webhook subscription with Shopify for a given topic and target address.
 * Soft check — returns { success: boolean }, never throws.
 * POST https://{shopDomain}/admin/api/2025-01/webhooks.json
 */
export async function registerWebhook(params: {
  shopDomain: string;
  accessToken: string;
  topic: string;
  address: string;
}): Promise<{ success: boolean }> {
  const { shopDomain, accessToken, topic, address } = params;

  try {
    const response = await fetch(`https://${shopDomain}/admin/api/2025-01/webhooks.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        webhook: {
          topic,
          address,
          format: "json",
        },
      }),
    });

    return { success: response.ok };
  } catch {
    return { success: false };
  }
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
