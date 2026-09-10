import jwt from "jsonwebtoken";
import { AuthTokenPayload } from "@nextcrm/core";
import { env } from "../config/env";

export const issueToken = (payload: AuthTokenPayload): string => {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "7d" });
};

export const verifyToken = (token: string): AuthTokenPayload => {
  return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
};
