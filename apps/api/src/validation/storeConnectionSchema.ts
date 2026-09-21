import { z } from "zod";

/**
 * Validation schema for connecting a Shopify store.
 *
 * Note: Shopify's custom-app tokens (Admin API access tokens) are tied directly to
 * the store's primary *.myshopify.com domain, rather than any branded custom domains
 * (e.g. store.com). Therefore, we strictly require the *.myshopify.com format.
 */
export const createStoreConnectionSchema = z.object({
  shopDomain: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+\.myshopify\.com$/, "must be a valid myshopify.com domain"),
  accessToken: z.string().min(1),
  apiSecretKey: z.string().min(1),
});

export type CreateStoreConnectionInput = z.infer<typeof createStoreConnectionSchema>;
