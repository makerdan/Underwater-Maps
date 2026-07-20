/**
 * raws-weather.ts — AOOS RAWS per-station observation endpoint.
 *
 * GET /raws-weather?datasetId=
 *
 * Fetches the latest observation for a single RAWS station. The datasetId
 * must match the pattern `raws_.*` (basic allowlist to prevent arbitrary
 * ERDDAP dataset access). Returns `{ available: false }` on failure with
 * HTTP 200 so the UI degrades gracefully.
 *
 * When ERDDAP is unreachable and a DB fallback exists, the response includes
 * `stale: true` so the UI can indicate that the data may be outdated.
 */

import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { fetchRawsObservation, fetchRawsObservationAt } from "../lib/rawsErddap.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";

const router = Router();

const RawsWeatherResponseSchema = z.union([
  z.object({
    available: z.literal(true),
    observation: z.record(z.unknown()),
    stale: z.boolean().optional(),
    station: z.object({ datasetId: z.string() }),
  }),
  z.object({ available: z.literal(false) }),
]);

const RawsWeatherQuerySchema = z.object({
  datasetId: z
    .string({ required_error: "datasetId is required" })
    .min(1, "datasetId is required")
    .regex(/^raws_[a-zA-Z0-9_-]+$/, "datasetId is required and must match the raws_* pattern"),
  /** Optional ISO 8601 target time; when supplied, returns the observation nearest that moment. */
  time: z.string().datetime({ offset: true }).optional(),
});

router.get("/raws-weather", asyncHandler(async (req, res): Promise<void> => {
  const parsed = RawsWeatherQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: parsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }
  const { datasetId, time } = parsed.data;

  try {
    const result = time
      ? await fetchRawsObservationAt(datasetId, new Date(time))
      : await fetchRawsObservation(datasetId);
    if (!result) {
      const _r0 = { available: false as const };
      const _p0 = RawsWeatherResponseSchema.safeParse(_r0);
      if (!_p0.success) logger.warn({ err: _p0.error }, "GET /api/raws-weather — response shape mismatch");
      res.json(_r0);
      return;
    }
    const _r1 = {
      available: true as const,
      observation: result.observation,
      stale: result.stale,
      station: { datasetId },
    };
    const _p1 = RawsWeatherResponseSchema.safeParse(_r1);
    if (!_p1.success) logger.warn({ err: _p1.error }, "GET /api/raws-weather — response shape mismatch");
    res.json(_r1);
  } catch (err) {
    logger.warn({ err, datasetId }, "raws-weather: unexpected error");
    const _r2 = { available: false as const };
    const _p2 = RawsWeatherResponseSchema.safeParse(_r2);
    if (!_p2.success) logger.warn({ err: _p2.error }, "GET /api/raws-weather — response shape mismatch");
    res.json(_r2);
  }
}));

export default router;
