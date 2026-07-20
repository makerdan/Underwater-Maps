/**
 * raws-stations.ts — AOOS RAWS station discovery endpoint.
 *
 * GET /raws-stations?lat=&lon=&radiusKm=
 *
 * Returns all RAWS weather stations within `radiusKm` kilometres of the
 * supplied lat/lon, drawn from the AOOS ERDDAP catalog (cached 24 h).
 * Returns `{ available: false }` on ERDDAP failure with HTTP 200 so the
 * UI degrades gracefully.
 */

import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { fetchRawsStations, type RawsStation } from "../lib/rawsStations.js";
import { LatLonQuerySchema } from "./schemas.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";

const DEFAULT_RADIUS_KM = 150;
const MAX_RADIUS_KM = 500;

const RawsStationsQuerySchema = LatLonQuerySchema.extend({
  radiusKm: z.coerce
    .number({ invalid_type_error: "radiusKm must be a valid number" })
    .positive("radiusKm must be a positive number")
    .lte(MAX_RADIUS_KM, `radiusKm must be ≤ ${MAX_RADIUS_KM}`)
    .optional()
    .default(DEFAULT_RADIUS_KM),
});

const router = Router();

const RawsStationsResponseSchema = z.object({
  available: z.boolean(),
  stations: z.array(z.record(z.unknown())),
  source: z.string(),
});

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

router.get("/raws-stations", asyncHandler(async (req, res): Promise<void> => {
  const parsed = RawsStationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: parsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }
  const { lat, lon, radiusKm } = parsed.data;

  try {
    const all = await fetchRawsStations();
    if (!all) {
      const _r0 = { available: false, stations: [] as RawsStation[], source: "aoos-raws" };
      const _p0 = RawsStationsResponseSchema.safeParse(_r0);
      if (!_p0.success) logger.warn({ err: _p0.error }, "GET /api/raws-stations — response shape mismatch");
      res.json(_r0);
      return;
    }

    const nearby: RawsStation[] = all.filter(
      (s) => haversineKm(lat, lon, s.lat, s.lon) <= radiusKm,
    );

    const _r1 = { available: true, stations: nearby, source: "aoos-raws" };
    const _p1 = RawsStationsResponseSchema.safeParse(_r1);
    if (!_p1.success) logger.warn({ err: _p1.error }, "GET /api/raws-stations — response shape mismatch");
    res.json(_r1);
  } catch (err) {
    logger.warn({ err }, "raws-stations: unexpected error");
    const _r2 = { available: false, stations: [] as RawsStation[], source: "aoos-raws" };
    const _p2 = RawsStationsResponseSchema.safeParse(_r2);
    if (!_p2.success) logger.warn({ err: _p2.error }, "GET /api/raws-stations — response shape mismatch");
    res.json(_r2);
  }
}));

export default router;
