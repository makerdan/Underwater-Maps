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
 * Returns the Zod-parsed output (which may be stripped of extra keys and/or
 * coerced by the schema), not the raw input. This ensures the serialised
 * response is always schema-conformant even when the handler produces a
 * superset object.
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
    const result = schema.parse(data);
    return result as z.infer<T>;
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

/**
 * Validate an upstream-derived response while preserving its documented
 * unavailable fallback. Proxy payloads must not turn an upstream shape change
 * into a malformed 2xx response, but they also should not crash the UI.
 */
export function validateProxyResponse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  fallback: z.input<T>,
  routeLabel: string,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data as z.infer<T>;
  logger.warn(
    { route: routeLabel, err: result.error },
    `${routeLabel} — upstream response schema validation failed; using fallback`,
  );
  return fallback as z.infer<T>;
}
