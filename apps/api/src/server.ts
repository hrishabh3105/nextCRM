import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { authRouter } from "./routes/auth";
import { contactsRouter } from "./routes/contacts";
import { channelsRouter } from "./routes/channels";
import { templatesRouter } from "./routes/templates";
import { campaignsRouter } from "./routes/campaigns";
import { webhooksRouter } from "./routes/webhooks";
import { shopifyWebhooksRouter } from "./routes/shopifyWebhooks";
import { conversationsRouter } from "./routes/conversations";
import { usageRouter } from "./routes/usage";
import { storesRouter } from "./routes/stores";
import { journeysRouter } from "./routes/journeys";
import { requireAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

// CORS with credentials (cookies):
// When credentials: true is configured, browsers strictly mandate a specific, explicit origin
// (e.g. process.env.FRONTEND_URL or "http://localhost:5173") and will reject the response if
// Access-Control-Allow-Origin is set to wildcard "*".
// Both a specific origin and credentials: true are required together for cross-origin cookie
// transmission and storage. This is a hard browser security specification rule, not an optional config choice.
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);

// Webhook routes must be mounted BEFORE global express.json() middleware.
// Why:
// 1. Meta and Shopify webhook signature verification requires the exact, untouched raw request
//    body as a Buffer to compute the HMAC-SHA256 digest. If express.json() runs first,
//    it consumes the incoming HTTP request stream and transforms req.body into a parsed
//    JavaScript object, destroying the original byte sequence and preventing express.raw()
//    from accessing the stream.
// 2. By mounting /webhooks before express.json(), webhook requests hit express.raw()
//    at the route level and complete their response cycle immediately. All other API
//    routes fall through and receive standard express.json() body parsing as usual.
// 3. No requireAuth is used here: Meta and Shopify do not send NextCRM JWT tokens. Instead, their
//    POST endpoints are authenticated cryptographically via HMAC signature verification (X-Hub-Signature-256 / X-Shopify-Hmac-Sha256).
app.use("/webhooks", webhooksRouter);
app.use("/webhooks", shopifyWebhooksRouter);

app.use(express.json());
app.use(cookieParser());

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Mount routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/contacts", requireAuth, contactsRouter);
app.use("/api/v1/channels", requireAuth, channelsRouter);
app.use("/api/v1/templates", requireAuth, templatesRouter);
app.use("/api/v1/campaigns", requireAuth, campaignsRouter);
app.use("/api/v1/conversations", requireAuth, conversationsRouter);
app.use("/api/v1/usage", requireAuth, usageRouter);
app.use("/api/v1/stores", requireAuth, storesRouter);
app.use("/api/v1/journeys", requireAuth, journeysRouter);

// Error handling middleware (must be registered last)
app.use(errorHandler);

const port = Number(env.PORT) || 4000;

app.listen(port, () => {
  console.log(`API server running on port ${port}`);
});

export default app;
