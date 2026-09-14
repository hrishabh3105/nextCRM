/**
 * Pure phone utility functions for E.164 normalization and validation.
 * No external dependencies on Zod or Express.
 */

/**
 * Converts a raw phone number string into E.164 format.
 * Handles:
 * - Numbers already starting with +
 * - 10-digit Indian numbers with no country code (assumes +91)
 * - Numbers starting with 91 prefix without + (prepends +)
 * - Cleans common formatting characters (spaces, hyphens, parentheses, dots)
 */
export const normalizePhoneE164 = (raw: string): string => {
  if (!raw) return "";

  // Strip whitespace, hyphens, parentheses, and dots
  const cleaned = raw.trim().replace(/[\s\-().]/g, "");

  // Already starting with +
  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  // 10-digit Indian number without country code
  if (/^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  // 12-digit number with 91 prefix but no +
  if (/^91\d{10}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  // 11 digits starting with 0 (e.g. 0XXXXXXXXXX -> +91XXXXXXXXXX)
  if (/^0\d{10}$/.test(cleaned)) {
    return `+91${cleaned.slice(1)}`;
  }

  // If entirely digits between 8 and 15 digits, prepend +
  if (/^\d{8,15}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  return cleaned;
};

/**
 * Validates whether a phone string conforms to E.164 format:
 * + followed by 1 to 15 digits, where the first digit is 1-9.
 */
export const isValidE164 = (phone: string): boolean => {
  return /^\+[1-9]\d{0,14}$/.test(phone);
};
