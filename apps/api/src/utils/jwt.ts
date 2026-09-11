import jwt from "jsonwebtoken";
import { AuthTokenPayload } from "@nextcrm/core";
import { env } from "../config/env";

// Note: Refresh tokens are NOT JWTs — they are opaque random strings stored hashed
// in the database and handled separately in refreshToken.ts. Only access tokens are JWTs.

export const issueAccessToken = (payload: AuthTokenPayload): string => {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "20m" });
};

export const verifyToken = (token: string): AuthTokenPayload => {
  return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
};

