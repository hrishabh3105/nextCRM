import crypto from "crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // 96 bits is the standard, recommended IV size for AES-GCM

/**
 * IMPORTANT CRYPTOGRAPHIC NOTE ON IV REUSE:
 * A NEW random IV (initialization vector) MUST be generated per encryption call,
 * even when encrypting with the same secret key.
 *
 * In AES-GCM mode, reusing an IV with the same key is a catastrophic cryptographic
 * weakness: it destroys both confidentiality (by exposing the XOR difference of plaintexts)
 * and authenticity (allowing an attacker to forge the GHASH authentication key and forge
 * messages). Generating a cryptographically random IV per call is a mandatory security
 * requirement, not a stylistic preference.
 */

/**
 * Derives a 32-byte Buffer key from env.TOKEN_ENCRYPTION_KEY.
 * Accepts a 64-character hex string directly or falls back to SHA-256 hashing.
 */
function getEncryptionKey(): Buffer {
  const rawKey = env.TOKEN_ENCRYPTION_KEY;
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }
  return crypto.createHash("sha256").update(rawKey).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Generates a fresh random IV per call.
 *
 * @param plaintext The raw token string to encrypt
 * @returns A single string formatted as "iv:authTag:ciphertext" (all hex-encoded)
 */
export const encryptToken = (plaintext: string): string => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
};

/**
 * Decrypts a stored token string formatted as "iv:authTag:ciphertext".
 * Validates the GCM authentication tag and throws clearly if tampered or corrupt.
 *
 * @param stored The "iv:authTag:ciphertext" string to decrypt
 * @returns The original decrypted plaintext token
 */
export const decryptToken = (stored: string): string => {
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token: expected format iv:authTag:ciphertext");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted token: missing required components");
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error("Token decryption failed: authentication tag mismatch or corrupted data");
  }
};
