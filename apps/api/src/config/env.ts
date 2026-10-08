import "dotenv/config";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set.`);
  }
  return value;
};

export const env = {
  PORT: process.env.PORT || "4000",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),
  // Must be a 32-byte value used for AES-256-GCM token encryption.
  // Generate via: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  // Must be DIFFERENT from JWT_SECRET — different secrets protecting different things.
  TOKEN_ENCRYPTION_KEY: required("TOKEN_ENCRYPTION_KEY"),
  META_WEBHOOK_VERIFY_TOKEN: required("META_WEBHOOK_VERIFY_TOKEN"),
  META_APP_SECRET: required("META_APP_SECRET"),
  // Found in Meta App Dashboard > Settings > Basic > App ID.
  // Note: This is a different value from META_APP_SECRET.
  META_APP_ID: required("META_APP_ID"),
  PUBLIC_WEBHOOK_BASE_URL: process.env.PUBLIC_WEBHOOK_BASE_URL || "",
  SHOPIFY_CLIENT_ID: required("SHOPIFY_CLIENT_ID"),
  SHOPIFY_CLIENT_SECRET: required("SHOPIFY_CLIENT_SECRET"),
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2026-07",
};
