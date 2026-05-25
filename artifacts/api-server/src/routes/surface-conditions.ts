/**
 * surface-conditions.ts — Hourly wind + wave + tidal conditions for drift planning.
 *
 * GET /api/surface-conditions?lat=&lon=
 *
 * Data sources:
 *   - Wind: Open-Meteo Forecast API (free, no key)
 *   - Waves: Open-Meteo Marine API (free, no key)
 *   - Tidal current: sinusoidal M2 approximation (12.4 h period)
 *
 * Falls back to estimated conditions (estimatedConditions=true) when either
 * Open-Meteo endpoint is unreachable or returns an error.
 */

import { Router } from "express";

const router = Router();

interface HourlySurfaceCondition {
  hour: number;
  windSpeedKnots: number;
  windDegrees: number;
  tidalSpeedKnots: number;
  tidalDegrees: number;
  waveHeightM: number;
}

// ---------------------------------------------------------------------------
// Tidal sinusoidal model — M2 tidal component (period ≈ 12.4 h)
// Produces realistic-looking tidal speed variation; direction alternates
// with the tide, swinging 180° through slack water at each high/low.
// ---------------------------------------------------------------------------

function buildTidalHours(lat: number, lon: number): { tidalSpeedKnots: number; tidalDegrees: number }[] {
  const period = 12.4;
  const maxSpeed = 1.2;
  const baseDir = ((lat + lon) * 73.1) % 360;

  return Array.from({ length: 24 }, (_, h) => {
    const phase = (h / period) * Math.PI * 2;
    const speed = Math.abs(Math.sin(phase)) * maxSpeed;
    const dir = Math.round(baseDir + (Math.sin(phase) > 0 ? 0 : 180)) % 360;
    return { tidalSpeedKnots: Math.round(speed * 10) / 10, tidalDegrees: dir };
  });
}

// ---------------------------------------------------------------------------
// Fallback conditions — used when Open-Meteo is unreachable
// ---------------------------------------------------------------------------

function buildFallbackHours(lat: number, lon: number): HourlySurfaceCondition[] {
  const tidalHours = buildTidalHours(lat, lon);
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    windSpeedKnots: 8,
    windDegrees: 225,
    waveHeightM: 0.3,
    ...tidalHours[h]!,
  }));
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// GET /surface-conditions
// ---------------------------------------------------------------------------

router.get("/surface-conditions", async (req, res): Promise<void> => {
  const rawLat = req.query["lat"];
  const rawLon = req.query["lon"];

  const lat = parseFloat(rawLat as string);
  const lon = parseFloat(rawLon as string);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    res.status(400).json({ error: "invalid_params", details: "lat and lon are required and must be valid coordinates" });
    return;
  }

  const tidalHours = buildTidalHours(lat, lon);

  let windData: { windSpeedKnots: number; windDegrees: number }[] | null = null;
  let waveData: { waveHeightM: number }[] | null = null;
  let estimatedConditions = false;

  try {
    const [forecastRes, marineRes] = await Promise.allSettled([
      fetchWithTimeout(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&forecast_days=1&timezone=UTC`,
      ),
      fetchWithTimeout(
        `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction&forecast_days=1&timezone=UTC`,
      ),
    ]);

    if (forecastRes.status === "fulfilled" && forecastRes.value.ok) {
      const json = await forecastRes.value.json() as {
        hourly?: { wind_speed_10m?: number[]; wind_direction_10m?: number[] };
      };
      const speeds = json.hourly?.wind_speed_10m ?? [];
      const dirs = json.hourly?.wind_direction_10m ?? [];
      if (speeds.length >= 24) {
        windData = Array.from({ length: 24 }, (_, h) => ({
          windSpeedKnots: Math.round((speeds[h] ?? 0) * 10) / 10,
          windDegrees: Math.round(dirs[h] ?? 0),
        }));
      }
    }

    if (marineRes.status === "fulfilled" && marineRes.value.ok) {
      const json = await marineRes.value.json() as {
        hourly?: { wave_height?: number[] };
      };
      const heights = json.hourly?.wave_height ?? [];
      if (heights.length >= 24) {
        waveData = Array.from({ length: 24 }, (_, h) => ({
          waveHeightM: Math.round((heights[h] ?? 0) * 100) / 100,
        }));
      }
    }
  } catch {
    estimatedConditions = true;
  }

  if (!windData || !waveData) {
    estimatedConditions = true;
  }

  const hours: HourlySurfaceCondition[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    windSpeedKnots: windData?.[h]?.windSpeedKnots ?? 8,
    windDegrees: windData?.[h]?.windDegrees ?? 225,
    waveHeightM: waveData?.[h]?.waveHeightM ?? 0.3,
    tidalSpeedKnots: tidalHours[h]!.tidalSpeedKnots,
    tidalDegrees: tidalHours[h]!.tidalDegrees,
  }));

  res.json({
    available: true,
    lat,
    lon,
    dataSource: estimatedConditions ? "estimated" : "open-meteo",
    estimatedConditions,
    hours,
  });
});

export default router;
