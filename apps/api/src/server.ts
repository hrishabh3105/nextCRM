import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { authRouter } from "./routes/auth";
import { contactsRouter } from "./routes/contacts";
import { channelsRouter } from "./routes/channels";
import { requireAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Mount routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/contacts", requireAuth, contactsRouter);
app.use("/api/v1/channels", requireAuth, channelsRouter);

// Error handling middleware (must be registered last)
app.use(errorHandler);

const port = Number(env.PORT) || 4000;

app.listen(port, () => {
  console.log(`API server running on port ${port}`);
});

export default app;
