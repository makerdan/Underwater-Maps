import type { Request, Response, NextFunction, RequestHandler } from "express";

type AsyncExpressHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

/**
 * Wraps an async Express route handler so that any rejected promise is
 * forwarded to the next(err) error-handling middleware.
 *
 * Express 4 does not automatically catch rejected promises from async
 * handlers, so without this wrapper a DB timeout or unexpected throw leaves
 * the request hanging until the global timeout fires. Wrapping with
 * asyncHandler ensures a clean 500 is returned immediately via the existing
 * error middleware.
 */
export function asyncHandler(fn: AsyncExpressHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
