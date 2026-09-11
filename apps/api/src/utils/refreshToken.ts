import crypto from "crypto";

/**
 * Generates an opaque, cryptographically secure random refresh token.
 * Note: Refresh tokens are NOT JWTs. They carry no embedded payload
 * and are stored as SHA-256 hashes in the database.
 */
export const generateRefreshToken = (): string => {
  return crypto.randomBytes(40).toString("hex");
};

/**
 * Computes the SHA-256 hash of a raw refresh token for database storage and lookup.
 * Comparison happens by hashing incoming raw tokens and querying the unique token hash.
 */
export const hashToken = (raw: string): string => {
  return crypto.createHash("sha256").update(raw).digest("hex");
};
