import { z } from "zod";
import { logger } from "../lib/logger.js";

/**
 * Inline response validator — call before res.json() to catch handler
 * shape mismatches before they reach the client.
 *
 * Calls schema.parse(data). If parse throws (ZodError or otherwise), logs
 * a structured error and re-throws as a plain Error with { status: 500 } so
 * asyncHandler propagates it to Express error middleware.
 *
 * Usage:
 *   res.json(validateResponse(MyResponseSchema, rows, "GET /api/markers"));
 *
 * @param schema     - Zod schema for the outgoing response.
 * @param data       - The data the handler would return.
 * @param routeLabel - Human-readable route label used in log messages.
 * @returns          - Parsed (and potentially coerced/stripped) data.
 */
export function validateResponse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  routeLabel: string,
): z.infer<T> {
  try {
    schema.parse(data);
    return data as z.infer<T>;
  } catch (err) {
    logger.error(
      { route: routeLabel, err },
      `${routeLabel} — response schema validation failed`,
    );
    const httpErr = Object.assign(
      new Error(`Response shape mismatch on ${routeLabel}`),
      { status: 500 },
    );
    throw httpErr;
  }
}
