import { Router, Request, Response } from "express";
import { ApiError } from "@nextcrm/core";
// We import the raw, unscoped PrismaClient directly from @nextcrm/db here.
// Signup and login are the only two routes permitted to bypass workspace scoping,
// because neither operation has an established workspace context yet (during signup
// the workspace does not yet exist; during login we are authenticating the global User).
import { prisma } from "@nextcrm/db";
import { asyncHandler } from "../middleware/asyncHandler";
import { hashPassword, comparePassword } from "../utils/password";
import { issueToken } from "../utils/jwt";

export const authRouter = Router();

/**
 * POST /signup
 * Creates Workspace + User + Membership(role=owner) atomically.
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

    const token = issueToken({
      userId: user.id,
      workspaceId: workspace.id,
      role: "owner",
    });

    res.status(201).json({
      token,
      workspace: {
        id: workspace.id,
        name: workspace.name,
      },
    });
  })
);

/**
 * POST /login
 * Authenticates user credentials and returns a workspace-scoped token.
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

    const token = issueToken({
      userId: user.id,
      workspaceId: primaryMembership.workspaceId,
      role: primaryMembership.role as "owner" | "agent",
    });

    const workspaces = user.memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
    }));

    res.status(200).json({
      token,
      workspaces,
    });
  })
);
