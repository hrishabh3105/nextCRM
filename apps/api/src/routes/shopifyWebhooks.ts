import { Router, Request, Response } from "express";
import express from "express";
import { prisma } from "@nextcrm/db";
import { decryptToken, verifyShopifyWebhook } from "@nextcrm/core";
import {
  handleShopifyOrder,
  handleShopifyCheckout,
} from "../services/shopifyWebhookHandler";

export const shopifyWebhooksRouter = Router();

/**
 * POST /shopify (and POST / for flexible mounting)
 *
 * Receives webhook events from Shopify (orders/create, checkouts/create, checkouts/update).
 * Uses express.raw({ type: "application/json" }) to capture the untouched raw body Buffer
 * required for HMAC-SHA256 signature verification.
 */
shopifyWebhooksRouter.post(
  ["/shopify", "/"],
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ error: "Invalid body, raw buffer expected" });
      return;
    }

    const shopDomain = req.headers["x-shopify-shop-domain"] as string | undefined;
    if (!shopDomain) {
      res.status(400).json({ error: "Missing X-Shopify-Shop-Domain header" });
      return;
    }

    // Unscoped query: find which StoreConnection owns this shopDomain
    const storeConnection = await prisma.storeConnection.findUnique({
      where: { shopDomain },
    });

    if (!storeConnection) {
      console.warn(
        `[shopify-webhook] StoreConnection not found for shopDomain: ${shopDomain}`
      );
      // Return 200 to prevent Shopify retry storms for unrecognized shops
      res.status(200).json({ message: "Store not recognized, ignored" });
      return;
    }

    if (!storeConnection.apiSecretEnc) {
      console.warn(
        `[shopify-webhook] No apiSecretEnc found for store connection ${storeConnection.id} (${shopDomain})`
      );
      res.status(200).json({ message: "Store not configured for webhooks" });
      return;
    }

    let apiSecret: string;
    try {
      apiSecret = decryptToken(storeConnection.apiSecretEnc);
    } catch (err) {
      console.error(
        `[shopify-webhook] Failed to decrypt apiSecretEnc for store ${storeConnection.id}:`,
        err
      );
      res.status(200).json({ message: "Decryption failure" });
      return;
    }

    const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string | undefined;
    const isValid = await verifyShopifyWebhook({
      rawBody,
      hmacHeader,
      apiSecret,
    });

    if (!isValid) {
      console.warn(
        `[shopify-webhook] Invalid HMAC signature for shopDomain: ${shopDomain}`
      );
      res.sendStatus(401);
      return;
    }

    const topic = req.headers["x-shopify-topic"] as string | undefined;

    try {
      const payload = JSON.parse(rawBody.toString("utf8"));

      switch (topic) {
        case "orders/create":
          await handleShopifyOrder(payload, storeConnection.workspaceId);
          break;

        case "checkouts/create":
        case "checkouts/update":
          await handleShopifyCheckout(payload, storeConnection.workspaceId, "active");
          break;

        default:
          console.log(
            `[shopify-webhook] Unhandled topic "${topic}" for shopDomain ${shopDomain}, ignoring`
          );
          break;
      }

      res.status(200).json({ status: "ok" });
    } catch (err) {
      // Log the real error, but respond 200 to prevent Shopify webhook retry storms
      console.error(
        `[shopify-webhook] Error processing webhook event for topic "${topic}":`,
        err
      );
      res.status(200).json({ status: "error_logged" });
    }
  }
);
