/**
 * Redis connection configuration.
 * Minimal shared configuration object built from process.env.REDIS_URL.
 * Actual connection instantiation happens per-process in api/worker separately.
 */
export const redisConnection = {
  url: process.env.REDIS_URL,
};

/**
 * Two-Queue Design:
 *
 * 1. CAMPAIGN_DISPATCH_QUEUE ("campaign-dispatch"):
 *    Has ONE job per campaign (the "expand this into individual sends" step).
 *
 * 2. SEND_MESSAGE_QUEUE ("send-message"):
 *    Has one job PER CONTACT.
 *
 * This separation lets us throttle the actual sending rate independently
 * from how fast campaigns get dispatched.
 */
export const CAMPAIGN_DISPATCH_QUEUE = "campaign-dispatch";
export const SEND_MESSAGE_QUEUE = "send-message";
