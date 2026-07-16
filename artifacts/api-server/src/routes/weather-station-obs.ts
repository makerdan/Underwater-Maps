/**
 * weather-station-obs.ts — NOAA per-station observation at a specific time.
 *
 * GET /api/weather-station-obs?stationId=PADK&time=2024-01-15T12:00:00Z
 *
 * Returns the NOAA observation nearest to the requested UTC time by querying
 * the NOAA observations time-series endpoint with a ±2-hour window.  Returns
 * `{ available: false }` on failure so the UI degrades gracefully.
 */

import { Router } from "express";
import { z } from "zod";
import { fetchStationObsAt } from "../lib/noaaWeatherFetcher.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { logger } from "../lib/logger.js";

const router = Router();

const Schema = z.object({
  stationId: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Z0-9]+$/i, "stationId must be alphanumeric (uppercase ICAO identifier)"),
  time: z.string().datetime({ offset: true }),
});

router.get("/weather-station-obs", asyncHandler(async (req, res): Promise<void> => {
  const parsed = Schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: parsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }

  const { stationId, time } = parsed.data;
  const targetTime = new Date(time);

  try {
    const obs = await fetchStationObsAt(stationId, targetTime);
    if (!obs) {
      res.json({ available: false });
      return;
    }
    res.json({ available: true, observation: obs });
  } catch (err) {
    logger.warn({ err, stationId, time }, "[weather-station-obs] Unexpected error");
    res.json({ available: false });
  }
}));

export default router;
