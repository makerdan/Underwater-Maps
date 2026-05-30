import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Reads `X-Request-Id` from the incoming request (if present) or generates a
 * fresh UUID, stamps it onto `req.id`, and echoes it in the `X-Request-Id`
 * response header. Must be mounted before pino-http so that genReqId can read
 * `req.id` and include the same value in every log line for the request.
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  const id = typeof incoming === "string" && incoming.length > 0 ? incoming : randomUUID();
  // pino-http augments IncomingMessage (and therefore Express Request) with
  // `id: ReqId`; we write through the same slot so genReqId can read it back.
  (req as Request & { id: string }).id = id;
  res.setHeader("X-Request-Id", id);
  next();
}

/**
 * Global request timeout ceiling. Any route that forgets its own AbortSignal
 * or long-poll guard is cut off after 60 s with a 503 so the socket does not
 * hang forever. Must be mounted after correlationIdMiddleware so the 503
 * response already carries X-Request-Id.
 */
export function globalTimeoutMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.setTimeout(60_000, () => {
    if (!res.headersSent) {
      res.status(503).json({ error: "Request timeout" });
    }
  });
  next();
}
