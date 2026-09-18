import { Router, Request, Response } from "express";
import { forWorkspace } from "@nextcrm/core";
import { asyncHandler } from "../middleware/asyncHandler";

export const usageRouter = Router();

/**
 * GET /costs
 * Returns month-to-date spend for the authenticated workspace.
 */
usageRouter.get(
  "/costs",
  asyncHandler(async (req: Request, res: Response) => {
    const now = new Date();
    // First day of current month at 00:00:00.000 UTC
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
    );

    const result = await forWorkspace(req.workspaceId!).messageCost.aggregate({
      where: {
        createdAt: {
          gte: periodStart,
        },
      },
      _sum: {
        billedAmount: true,
      },
      _count: true,
    });

    res.status(200).json({
      totalSpend: result._sum.billedAmount ?? 0,
      messageCount: result._count,
      currency: "USD",
      periodStart,
    });
  })
);
