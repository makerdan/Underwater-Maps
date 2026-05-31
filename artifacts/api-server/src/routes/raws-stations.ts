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
import { logger } from "../lib/logger.js";
import { fetchRawsStations, type RawsStation } from "../lib/rawsStations.js";

const router = Router();

const DEFAULT_RADIUS_KM = 150;
const MAX_RADIUS_KM = 500;

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

router.get("/raws-stations", async (req, res): Promise<void> => {
  const lat = parseFloat(String(req.query["lat"] ?? ""));
  const lon = parseFloat(String(req.query["lon"] ?? ""));
  const rawRadius = req.query["radiusKm"];
  const radiusKm =
    rawRadius !== undefined
      ? parseFloat(String(rawRadius))
      : DEFAULT_RADIUS_KM;

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    res.status(400).json({
      error: "invalid_params",
      details: "lat and lon are required and must be valid coordinates",
    });
    return;
  }

  if (isNaN(radiusKm) || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM) {
    res.status(400).json({
      error: "invalid_params",
      details: `radiusKm must be a positive number ≤ ${MAX_RADIUS_KM}`,
    });
    return;
  }

  try {
    const all = await fetchRawsStations();
    if (!all) {
      res.json({ available: false, stations: [], source: "aoos-raws" });
      return;
    }

    const nearby: RawsStation[] = all.filter(
      (s) => haversineKm(lat, lon, s.lat, s.lon) <= radiusKm,
    );

    res.json({ available: true, stations: nearby, source: "aoos-raws" });
  } catch (err) {
    logger.warn({ err }, "raws-stations: unexpected error");
    res.json({ available: false, stations: [], source: "aoos-raws" });
  }
});

export default router;
