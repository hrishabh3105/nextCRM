import { Router, Request, Response } from "express";
import { ApiError } from "@nextcrm/core";
// We import the raw, unscoped PrismaClient directly from @nextcrm/db here.
// Signup, login, refresh, and logout are permitted to bypass workspace scoping,
// because these operations authenticate or manage global User sessions rather than workspace-scoped data.
import { prisma } from "@nextcrm/db";
import { asyncHandler } from "../middleware/asyncHandler";
import { hashPassword, comparePassword } from "../utils/password";
import { issueAccessToken } from "../utils/jwt";
import { generateRefreshToken, hashToken } from "../utils/refreshToken";
import { setAuthCookies, clearAuthCookies } from "../utils/cookies";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

/**
 * POST /signup
 * Creates Workspace + User + Membership(role=owner) atomically,
 * issues short-lived accessToken and 30-day refreshToken via httpOnly cookies.
 */
authRouter.post(
  "/signup",
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password, workspaceName } = req.body;

    if (!email || !password || !workspaceName) {
      throw new ApiError(
        400,
        "email, password, and workspaceName are required"
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ApiError(409, "User with this email already exists");
    }

    const passwordHash = await hashPassword(password);

    // Atomically create Workspace, User, and Membership (role="owner")
    const { workspace, user } = await prisma.$transaction(async (tx) => {
      const createdWorkspace = await tx.workspace.create({
        data: {
          name: workspaceName,
        },
      });

      const createdUser = await tx.user.create({
        data: {
          email,
          passwordHash,
        },
      });

      await tx.membership.create({
        data: {
          userId: createdUser.id,
          workspaceId: createdWorkspace.id,
          role: "owner",
        },
      });

      return { workspace: createdWorkspace, user: createdUser };
    });

    const accessToken = issueAccessToken({
      userId: user.id,
      workspaceId: workspace.id,
      role: "owner",
    });

    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    setAuthCookies(res, accessToken, rawRefreshToken);

    res.status(201).json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
      },
    });
  })
);

/**
 * POST /login
 * Authenticates user credentials and sets workspace-scoped accessToken and refreshToken cookies.
 */
authRouter.post(
  "/login",
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, "email and password are required");
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: {
            workspace: true,
          },
        },
      },
    });

    // Unified 401 error to avoid leaking whether the email or the password was incorrect
    if (!user) {
      throw new ApiError(401, "Invalid email or password");
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      throw new ApiError(401, "Invalid email or password");
    }

    if (!user.memberships || user.memberships.length === 0) {
      throw new ApiError(403, "This account has no workspace");
    }

    // Default to the first membership as active workspace
    const primaryMembership = user.memberships[0];

    const accessToken = issueAccessToken({
      userId: user.id,
      workspaceId: primaryMembership.workspaceId,
      role: primaryMembership.role as "owner" | "agent",
    });

    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const workspaces = user.memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
    }));

    setAuthCookies(res, accessToken, rawRefreshToken);

    res.status(200).json({
      workspaces,
    });
  })
);

/**
 * POST /refresh
 * Validates the incoming refresh token from httpOnly cookie, detects potential token reuse,
 * rotates the refresh token atomically, and sets a new access + refresh token cookie pair.
 */
authRouter.post(
  "/refresh",
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new ApiError(401, "No refresh token provided");
    }

    const incomingHash = hashToken(refreshToken);

    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash: incomingHash },
    });

    if (!tokenRecord) {
      throw new ApiError(401, "Invalid refresh token");
    }

    // REUSE DETECTION:
    // If replacedBy is set, this token was rotated in a previous request and is being presented again.
    // This indicates potential token theft or replay attack. We immediately revoke ALL existing sessions for this user.
    if (tokenRecord.replacedBy) {
      await prisma.refreshToken.updateMany({
        where: {
          userId: tokenRecord.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      throw new ApiError(
        401,
        "Refresh token reuse detected — all sessions have been revoked, please log in again"
      );
    }

    // Clean revocation / logged out token (revokedAt is set, but was not rotated)
    if (tokenRecord.revokedAt) {
      throw new ApiError(401, "Invalid refresh token");
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new ApiError(401, "Refresh token expired");
    }

    // Valid token: fetch user and their memberships to rebuild the access token payload
    const user = await prisma.user.findUnique({
      where: { id: tokenRecord.userId },
      include: {
        memberships: {
          include: {
            workspace: true,
          },
        },
      },
    });

    if (!user || !user.memberships || user.memberships.length === 0) {
      throw new ApiError(403, "This account has no workspace");
    }

    const primaryMembership = user.memberships[0];

    const newRawRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Atomically create the new refresh token record and mark the old one as revoked + replaced
    await prisma.$transaction(async (tx) => {
      const newRefreshTokenRecord = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: newRefreshTokenHash,
          expiresAt: newExpiresAt,
        },
      });

      await tx.refreshToken.update({
        where: { id: tokenRecord.id },
        data: {
          revokedAt: new Date(),
          replacedBy: newRefreshTokenRecord.id,
        },
      });
    });

    // Issue a new access token using the user's first membership (same as login)
    const accessToken = issueAccessToken({
      userId: user.id,
      workspaceId: primaryMembership.workspaceId,
      role: primaryMembership.role as "owner" | "agent",
    });

    setAuthCookies(res, accessToken, newRawRefreshToken);

    res.status(200).json({ success: true });
  })
);

/**
 * POST /logout
 * Revokes the refresh token provided in the httpOnly cookie and clears auth cookies.
 * This endpoint is idempotent — if the token is not found or already revoked,
 * it clears cookies and returns success anyway without erroring.
 */
authRouter.post(
  "/logout",
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = req.cookies?.refreshToken;

    if (refreshToken) {
      const incomingHash = hashToken(refreshToken);

      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { tokenHash: incomingHash },
      });

      if (tokenRecord && !tokenRecord.revokedAt) {
        await prisma.refreshToken.update({
          where: { id: tokenRecord.id },
          data: {
            revokedAt: new Date(),
          },
        });
      }
    }

    clearAuthCookies(res);

    res.status(200).json({ message: "Logged out" });
  })
);

/**
 * GET /me
 * Returns authenticated user info and active workspace details for session hydration.
 */
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true },
    });

    const membership = await prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId: req.userId!,
          workspaceId: req.workspaceId!,
        },
      },
      include: {
        workspace: {
          select: { id: true, name: true },
        },
      },
    });

    if (!user || !membership) {
      throw new ApiError(404, "User or workspace membership not found");
    }

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
      },
      workspace: {
        id: membership.workspace.id,
        name: membership.workspace.name,
        role: membership.role,
      },
    });
  })
);

