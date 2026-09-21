import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      workspaceId?: string;
      role?: "owner" | "agent";
    }
  }
}

export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const token = req.cookies?.accessToken;

  if (!token) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    req.workspaceId = payload.workspaceId;
    req.role = payload.role;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
};
