import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { authRouter } from "./routes/auth";
import { contactsRouter } from "./routes/contacts";
import { channelsRouter } from "./routes/channels";
import { templatesRouter } from "./routes/templates";
import { campaignsRouter } from "./routes/campaigns";
import { webhooksRouter } from "./routes/webhooks";
import { conversationsRouter } from "./routes/conversations";
import { usageRouter } from "./routes/usage";
import { requireAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

app.use(cors());

// Webhook routes must be mounted BEFORE global express.json() middleware.
// Why:
// 1. Meta webhook signature verification requires the exact, untouched raw request
//    body as a Buffer to compute the HMAC-SHA256 digest. If express.json() runs first,
//    it consumes the incoming HTTP request stream and transforms req.body into a parsed
//    JavaScript object, destroying the original byte sequence and preventing express.raw()
//    from accessing the stream.
// 2. By mounting /webhooks before express.json(), webhook requests hit express.raw()
//    at the route level and complete their response cycle immediately. All other API
//    routes fall through and receive standard express.json() body parsing as usual.
// 3. No requireAuth is used here: Meta does not send NextCRM JWT tokens. Instead, the
//    POST endpoint is authenticated cryptographically via X-Hub-Signature-256 HMAC verification.
app.use("/webhooks", webhooksRouter);

app.use(express.json());

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

// Error handling middleware (must be registered last)
app.use(errorHandler);

const port = Number(env.PORT) || 4000;

app.listen(port, () => {
  console.log(`API server running on port ${port}`);
});

export default app;
