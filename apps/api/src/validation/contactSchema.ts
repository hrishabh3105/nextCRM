import { z } from "zod";
import { normalizePhoneE164, isValidE164 } from "../utils/phone";

/**
 * Attributes is intentionally a flat key-value object (only string, number, boolean, or null values).
 * Nested objects, arrays, and functions are explicitly disallowed.
 *
 * Rationale:
 * Attributes is meant for simple business facts used in future audience segmentation (e.g., {"vip": true, "leadScore": 85}).
 * Allowing arbitrary nested structures would bloat database JSON storage and needlessly complicate
 * query filtering and segmentation logic later for no real benefit.
 */
export const attributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/**
 * Single source of truth for phone handling.
 * Normalizes input into standard E.164 format and validates the result.
 * Future CSV import and API routes will reuse this exact schema per-row.
 */
const phoneSchema = z
  .string()
  .min(1, "phone is required")
  .transform(normalizePhoneE164)
  .refine(isValidE164, "phone must be a valid phone number after normalization");

/**
 * Validation schema for creating a new Contact.
 */
export const createContactSchema = z.object({
  phone: phoneSchema,
  name: z.string().max(120, "name must be 120 characters or fewer").optional(),
  email: z.string().email("must be a valid email").optional(),
  attributes: z
    .record(z.string(), attributeValueSchema)
    .refine(
      (obj) => Object.keys(obj).length <= 20,
      "attributes cannot have more than 20 keys"
    )
    .optional(),
});

/**
 * Validation schema for updating an existing Contact.
 * Same shape as createContactSchema, but all fields are optional.
 */
export const updateContactSchema = createContactSchema.partial();

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
