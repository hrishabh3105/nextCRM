import { Router, Request, Response } from "express";
import express from "express";
import { env } from "../config/env";
import { verifyMetaSignature } from "../utils/verifyMetaSignature";
import {
  handleInboundWebhookPayload,
  handleTemplateStatusUpdate,
} from "../services/inboundMessageHandler";

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
 * Webhook event receiver called by Meta for incoming events (delivery status, inbound messages, template updates).
 *
 * - Uses express.raw({ type: "application/json" }) route-level middleware to capture raw Buffer
 *   needed for HMAC signature verification before any JSON parsing.
 * - Verifies X-Hub-Signature-256 header against META_APP_SECRET using HMAC-SHA256.
 * - Responds 401 immediately if signature is missing or invalid.
 * - Parses JSON and processes template status updates and inbound messages, responding 200.
 */
webhooksRouter.post(
  "/meta",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
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

      const entries = payload?.entry ?? [];
      const hasTemplateStatusUpdate = entries.some((entry: any) =>
        entry.changes?.some((change: any) => change.field === "message_template_status_update")
      );

      if (hasTemplateStatusUpdate) {
        await handleTemplateStatusUpdate(payload);
      }

      // TODO: move to a queue (like campaign-dispatch) if webhook processing time ever
      // risks exceeding Meta's timeout, or if volume increases enough that inline DB writes
      // here become a bottleneck.
      await handleInboundWebhookPayload(payload);

      res.sendStatus(200);
    } catch (err) {
      console.error("[webhook] Failed to process webhook event:", err);
      res.sendStatus(400);
    }
  }
);
