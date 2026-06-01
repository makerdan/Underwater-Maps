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
import { fetchRawsObservation } from "../lib/rawsErddap.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";

const router = Router();

const RawsWeatherQuerySchema = z.object({
  datasetId: z
    .string({ required_error: "datasetId is required" })
    .min(1, "datasetId is required")
    .regex(/^raws_[a-zA-Z0-9_-]+$/, "datasetId is required and must match the raws_* pattern"),
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
  const { datasetId } = parsed.data;

  try {
    const result = await fetchRawsObservation(datasetId);
    if (!result) {
      res.json({ available: false });
      return;
    }
    res.json({
      available: true,
      observation: result.observation,
      stale: result.stale,
      station: { datasetId },
    });
  } catch (err) {
    logger.warn({ err, datasetId }, "raws-weather: unexpected error");
    res.json({ available: false });
  }
}));

export default router;
