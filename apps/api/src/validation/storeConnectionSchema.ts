import { z } from "zod";
import { isValidShopDomain } from "@nextcrm/core";

/**
 * Validation schema for connecting a Shopify store.
 * Only requires shopDomain; extra fields are ignored.
 * Validates domain using isValidShopDomain.
 */
export const createStoreConnectionSchema = z.object({
  shopDomain: z
    .string()
    .min(1, "shopDomain is required")
    .refine(isValidShopDomain, "must be a valid myshopify.com domain"),
});

export type CreateStoreConnectionInput = z.infer<typeof createStoreConnectionSchema>;

/**
 * No body is required for reconnecting a store connection.
 */
export const reconnectStoreConnectionSchema = z.object({}).passthrough();

export type ReconnectStoreConnectionInput = z.infer<typeof reconnectStoreConnectionSchema>;

export const updateStoreConsentSettingsSchema = z.object({
  // Controls whether Shopify SMS marketing subscription is treated as WhatsApp consent (SMS FALLBACK ONLY; explicit WhatsApp consent takes precedence)
  treatShopifySmsAsWhatsappConsent: z.boolean(),
  confirmWording: z.boolean().optional(),
});

export type UpdateStoreConsentSettingsInput = z.infer<typeof updateStoreConsentSettingsSchema>;
