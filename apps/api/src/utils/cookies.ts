import { Response } from "express";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Sets httpOnly authentication cookies for accessToken and refreshToken.
 *
 * Security configurations:
 * - httpOnly: true prevents client-side JavaScript (XSS attacks) from reading the tokens.
 * - secure: set to true in production (requires HTTPS), false in local development.
 * - sameSite: "strict" prevents the browser from sending cookies on cross-site requests, mitigating CSRF attacks.
 *
 * Path scoping:
 * - accessToken is scoped to "/" so it is sent on all API requests requiring authentication.
 * - refreshToken is scoped strictly to "/api/v1/auth" so the browser ONLY sends it on requests
 *   to /api/v1/auth/* (refresh, logout), not on every single API call. Since it is more sensitive
 *   and longer-lived (30 days vs 20 minutes), it does not need to be transmitted everywhere the
 *   access token does.
 */
export const setAuthCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string
): void => {
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: 20 * 60 * 1000, // 20 minutes
    path: "/",
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: "/api/v1/auth",
  });
};

/**
 * Clears authentication cookies upon logout.
 *
 * Note: When clearing cookies, the path (and other key options such as secure and sameSite)
 * must exactly match the options used when the cookie was originally set; otherwise browsers
 * will ignore the Set-Cookie clear header.
 */
export const clearAuthCookies = (res: Response): void => {
  res.clearCookie("accessToken", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
  });

  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/api/v1/auth",
  });
};
