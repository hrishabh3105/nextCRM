import { Router, Request, Response } from "express";
import express from "express";
import { env } from "../config/env";
import { verifyMetaSignature } from "../utils/verifyMetaSignature";

export const webhooksRouter = Router();

/**
 * GET /meta
 * Webhook verification handshake endpoint called by Meta when configuring the webhook URL.
 *
 * Meta sends:
 * - hub.mode: "subscribe"
 * - hub.verify_token: The verify token configured in Meta App Dashboard
 * - hub.challenge: Random challenge string that must be returned in the response body
 */
webhooksRouter.get("/meta", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const verifyToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && verifyToken === env.META_WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(String(challenge));
    return;
  }

  res.sendStatus(403);
});

/**
 * POST /meta
 * Webhook event receiver called by Meta for incoming events (delivery status, inbound messages).
 *
 * - Uses express.raw({ type: "application/json" }) route-level middleware to capture raw Buffer
 *   needed for HMAC signature verification before any JSON parsing.
 * - Verifies X-Hub-Signature-256 header against META_APP_SECRET using HMAC-SHA256.
 * - Responds 401 immediately if signature is missing or invalid.
 * - Parses JSON and logs the event payload, responding 200 immediately without blocking.
 */
webhooksRouter.post(
  "/meta",
  express.raw({ type: "application/json" }),
  (req: Request, res: Response) => {
    console.log("[webhook] POST /meta hit, headers: " + JSON.stringify(req.headers));
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      res.sendStatus(400);
      return;
    }

    const isValid = verifyMetaSignature(rawBody, signature, env.META_APP_SECRET);
    console.log("[webhook] signature valid: " + isValid);
    if (!isValid) {
      res.sendStatus(401);
      return;
    }

    try {
      const payload = JSON.parse(rawBody.toString("utf8"));
      console.log(`[webhook] received event:\n${JSON.stringify(payload, null, 2)}`);
      res.sendStatus(200);
    } catch (err) {
      console.error("[webhook] Failed to parse JSON body:", err);
      res.sendStatus(400);
    }
  }
);
