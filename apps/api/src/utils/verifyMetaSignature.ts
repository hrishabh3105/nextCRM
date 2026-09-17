import crypto from "crypto";

/**
 * Verifies the X-Hub-Signature-256 header sent by Meta webhook requests.
 *
 * - Meta sends signature as "sha256=<hex digest>" in X-Hub-Signature-256 header.
 * - Computes HMAC-SHA256 of rawBody using appSecret as the secret key.
 * - Compares computed HMAC and header signature using crypto.timingSafeEqual to prevent timing attacks.
 * - Returns false (never throws) if header is missing, malformed, or signature is invalid.
 *
 * @param rawBody - The unparsed request body Buffer
 * @param signatureHeader - The X-Hub-Signature-256 header value
 * @param appSecret - The Meta App Secret
 * @returns boolean - true if valid, false otherwise
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  try {
    if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
      return false;
    }

    if (!Buffer.isBuffer(rawBody) || !appSecret) {
      return false;
    }

    const signatureHex = signatureHeader.slice(7).trim();
    if (signatureHex.length !== 64) {
      return false;
    }

    const signatureBuffer = Buffer.from(signatureHex, "hex");
    const expectedBuffer = crypto
      .createHmac("sha256", appSecret)
      .update(rawBody)
      .digest();

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
