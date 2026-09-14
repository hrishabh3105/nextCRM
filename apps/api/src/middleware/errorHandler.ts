import { Request, Response, NextFunction } from "express";
import { ApiError } from "@nextcrm/core";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {

  if (err.code === "P2002") {
    res.status(409).json({ error: "A record with these details already exists" });
    return;
  }

  if (err.code === "P2025") {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
    });
    return;
  }

  console.error("Unhandled server error:", err);

  res.status(500).json({
    error: "Internal server error",
  });
};
