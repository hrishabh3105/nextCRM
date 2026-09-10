import { Request, Response, NextFunction } from "express";

/**
 * Wraps an async Express route handler so unhandled Promise rejections
 * or thrown errors are automatically forwarded to next(err).
 *
 * Why this exists: Route handlers can use async/await cleanly without
 * wrapping every single controller or route body in a manual try/catch block.
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
};
