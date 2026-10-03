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

    const db = forWorkspace(req.workspaceId!);

    const [aggregateResult, firstCostRow, categoryBreakdown] =
      await Promise.all([
        db.messageCost.aggregate({
          where: {
            createdAt: {
              gte: periodStart,
            },
          },
          _sum: {
            billedAmount: true,
          },
          _count: true,
        }),
        db.messageCost.findFirst({
          where: {
            createdAt: {
              gte: periodStart,
            },
          },
          select: {
            currency: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        }),
        db.messageCost.groupBy({
          by: ["category"],
          where: {
            createdAt: {
              gte: periodStart,
            },
          },
          _sum: {
            billedAmount: true,
          },
          _count: true,
        }),
      ]);

    const currency = firstCostRow?.currency || "INR";

    const byCategory = categoryBreakdown.map((item) => ({
      category: item.category,
      totalSpend: item._sum.billedAmount ?? 0,
      messageCount: item._count,
    }));

    res.status(200).json({
      totalSpend: aggregateResult._sum.billedAmount ?? 0,
      messageCount: aggregateResult._count,
      currency,
      periodStart,
      byCategory,
    });
  })
);
