import { ZodType } from "zod";
import { ApiError } from "./apiError";

/**
 * Validates unknown data against a Zod schema.
 * - Runs schema.safeParse(data)
 * - If it fails: throws ApiError(400, "Validation failed", details)
 *   where details is the flattened Zod error (.error.flatten()),
 *   matching the shape our existing error handler sends for ApiError instances
 * - If it succeeds: returns the parsed, typed data
 */
export function validateOrThrow<T>(schema: ZodType<T, any, any>, data: unknown): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new ApiError(400, "Validation failed", result.error.flatten());
  }

  return result.data;
}
