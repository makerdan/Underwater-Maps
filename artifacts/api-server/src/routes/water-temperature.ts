/**
 * water-temperature.ts — Current sea-surface temperature for a lat/lon point.
 *
 * GET /api/water-temperature?lat=&lon=
 *
 * Data source: Open-Meteo Marine API (free, no API key required).
 *   https://marine-api.open-meteo.com/v1/marine
 *
 * The HUD temperature readout (see artifacts/bathyscan/src/lib/waterTemp.ts)
 * uses the returned SST as the surface anchor of a thermocline model so the
 * value reflects real ocean conditions for the user's dataset / GPS location.
 * When the live feed is unreachable we return { available: false } so the
 * client can gracefully fall back to its deterministic mock and the chip can
 * surface a "simulated" attribution to the user.
 */

import { Router } from "express";

const router = Router();

const MARINE_BASE = "https://marine-api.open-meteo.com/v1/marine";
const SOURCE_LABEL = "Open-Meteo Marine API (sea-surface temperature)";
const SOURCE_URL = "https://open-meteo.com/en/docs/marine-weather-api";

async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

interface MarineResponse {
  hourly?: {
    time?: string[];
    sea_surface_temperature?: (number | null)[];
  };
}

/**
 * Pick the sample from `hourly` whose timestamp matches the current UTC hour,
 * falling back to the most recent finite sample available.
 */
export function pickCurrentSst(
  json: MarineResponse,
  now: Date = new Date(),
): { sst: number; timestamp: string } | null {
  const times = json.hourly?.time ?? [];
  const ssts = json.hourly?.sea_surface_temperature ?? [];
  if (times.length === 0 || ssts.length === 0) return null;

  const target = new Date(now);
  target.setUTCMinutes(0, 0, 0);
  const targetIso = target.toISOString().slice(0, 13); // YYYY-MM-DDTHH

  let exactIdx = -1;
  let lastFiniteIdx = -1;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const v = ssts[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    lastFiniteIdx = i;
    if (typeof t === "string" && t.slice(0, 13) === targetIso) {
      exactIdx = i;
      break;
    }
  }

  const idx = exactIdx !== -1 ? exactIdx : lastFiniteIdx;
  if (idx === -1) return null;

  const sstRaw = ssts[idx] as number;
  const timeRaw = times[idx];
  const tsDate = typeof timeRaw === "string" ? new Date(`${timeRaw}Z`) : target;
  return {
    sst: Math.round(sstRaw * 100) / 100,
    timestamp: tsDate.toISOString(),
  };
}

router.get("/water-temperature", async (req, res): Promise<void> => {
  const lat = parseFloat(req.query["lat"] as string);
  const lon = parseFloat(req.query["lon"] as string);

  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < -90 || lat > 90 || lon < -180 || lon > 180
  ) {
    res.status(400).json({
      error: "invalid_params",
      details: "lat and lon are required and must be valid coordinates",
    });
    return;
  }

  // Cache for 30 minutes — SST changes very slowly and the Open-Meteo
  // forecast is itself hourly.
  res.setHeader("Cache-Control", "public, max-age=1800");

  try {
    const url = `${MARINE_BASE}?latitude=${lat}&longitude=${lon}&hourly=sea_surface_temperature&forecast_days=1&timezone=UTC`;
    const upstream = await fetchWithTimeout(url, 6000);
    if (upstream.ok) {
      const json = (await upstream.json()) as MarineResponse;
      const picked = pickCurrentSst(json);
      if (picked) {
        res.json({
          available: true,
          lat,
          lon,
          sstCelsius: picked.sst,
          timestamp: picked.timestamp,
          source: SOURCE_LABEL,
          sourceUrl: SOURCE_URL,
        });
        return;
      }
    }
  } catch {
    // fall through to unavailable response
  }

  res.json({
    available: false,
    lat,
    lon,
    source: SOURCE_LABEL,
    sourceUrl: SOURCE_URL,
  });
});

export default router;
