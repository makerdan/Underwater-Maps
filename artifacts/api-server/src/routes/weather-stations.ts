/**
 * weather-stations.ts — NOAA ASOS/AWOS aviation weather station observations.
 *
 * GET /api/weather-stations?lat=&lon=&radiusMiles=75
 *
 * Returns nearby NOAA weather stations with live observations (wind, visibility,
 * ceiling, temperature) plus the FAA WeatherCams URL for the derived US state.
 *
 * Data source: NOAA Weather API (api.weather.gov) — public, no key required.
 * Observations cached in-memory for 10 minutes (NOAA updates hourly).
 * On NOAA error, falls back to the last-good DB row (up to 1 hour old) and
 * sets `stale: true` in the response so callers can indicate degraded data.
 */

import { Router } from "express";
import { fetchWeatherStations, NoaaUnavailableError } from "../lib/noaaWeatherFetcher.js";
import type { WeatherStation } from "../lib/noaaWeatherFetcher.js";

const router = Router();

router.get("/weather-stations", async (req, res): Promise<void> => {
  const rawLat = req.query["lat"];
  const rawLon = req.query["lon"];
  const rawRadius = req.query["radiusMiles"];

  const lat = parseFloat(rawLat as string);
  const lon = parseFloat(rawLon as string);
  const radiusMiles = rawRadius !== undefined ? parseFloat(rawRadius as string) : 75;

  if (
    isNaN(lat) || isNaN(lon) ||
    lat < -90 || lat > 90 ||
    lon < -180 || lon > 180
  ) {
    res.status(400).json({
      error: "invalid_params",
      details: "lat and lon are required and must be valid coordinates",
    });
    return;
  }

  if (isNaN(radiusMiles) || radiusMiles <= 0 || radiusMiles > 500) {
    res.status(400).json({
      error: "invalid_params",
      details: "radiusMiles must be a positive number ≤ 500",
    });
    return;
  }

  try {
    const result = await fetchWeatherStations(lat, lon, radiusMiles);
    res.json(result);
  } catch (err) {
    if (err instanceof NoaaUnavailableError) {
      console.warn("[weather-stations] NOAA unavailable, no cached data:", (err as Error).message);
      res.status(503).json({
        error: "noaa_unavailable",
        details: "NOAA weather data is currently unavailable and there is no cached data for this location. Please try again later.",
      });
      return;
    }
    console.error("[weather-stations] Fetch failed:", (err as Error).message);
    res.status(502).json({
      error: "upstream_error",
      details: "Could not fetch NOAA weather station data",
    });
  }
});

// GET /weather/pack?lat=&lon=
// Returns a weather snapshot for offline packs.
router.get("/weather/pack", async (req, res): Promise<void> => {
  const rawLat = req.query["lat"];
  const rawLon = req.query["lon"];
  const lat = parseFloat(rawLat as string);
  const lon = parseFloat(rawLon as string);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    res.status(400).json({ error: "invalid_params", details: "lat and lon are required" });
    return;
  }

  try {
    const result = await fetchWeatherStations(lat, lon, 75);
    const nearest = result.stations[0] ?? null;
    res.json({
      station: nearest?.name ?? null,
      observation: nearest as WeatherStation | null,
      snapshotAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof NoaaUnavailableError) {
      res.json({ station: null, observation: null, snapshotAt: new Date().toISOString() });
      return;
    }
    res.json({ station: null, observation: null, snapshotAt: new Date().toISOString() });
  }
});

export default router;
