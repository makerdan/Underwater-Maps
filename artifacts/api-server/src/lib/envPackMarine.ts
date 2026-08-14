/**
 * envPackMarine.ts — Fetches a 14-day Open-Meteo Marine forecast for the
 * Environmental Data Pack.
 *
 * Variables retrieved: sea_surface_temperature, wave_height, wave_direction.
 * The Marine API is free with no key required.
 */

import { logger } from "./logger.js";
import type { MarineConditionsPack } from "./envPack.js";

const MARINE_BASE = "https://marine-api.open-meteo.com/v1/marine";
const FETCH_TIMEOUT_MS = 10_000;

interface OpenMeteoMarineResponse {
  hourly?: {
    time?: string[];
    sea_surface_temperature?: (number | null)[];
    wave_height?: (number | null)[];
    wave_direction?: (number | null)[];
  };
}

/**
 * Fetch an Open-Meteo Marine 14-day hourly forecast for sea-surface
 * temperature, wave height, and wave direction at the given center point.
 *
 * Returns null on any network error or when the upstream returns no usable
 * data.
 */
export async function fetchMarineConditions(
  lat: number,
  lon: number,
  days: number,
): Promise<MarineConditionsPack | null> {
  const url =
    `${MARINE_BASE}?latitude=${lat}&longitude=${lon}` +
    `&hourly=sea_surface_temperature,wave_height,wave_direction` +
    `&forecast_days=${days}&timezone=UTC`;

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      logger.warn({ lat, lon, status: res.status }, "[envPackMarine] Open-Meteo non-OK response");
      return null;
    }
    const json = (await res.json()) as OpenMeteoMarineResponse;
    const times = json.hourly?.time ?? [];
    const sst = json.hourly?.sea_surface_temperature ?? [];
    const waveH = json.hourly?.wave_height ?? [];
    const waveD = json.hourly?.wave_direction ?? [];

    if (times.length === 0) return null;

    // Normalise time strings to ISO 8601 UTC (Open-Meteo returns "YYYY-MM-DDTHH:MM").
    const normalizedTimes = times.map((t) =>
      typeof t === "string" ? new Date(`${t}Z`).toISOString() : t,
    );

    return {
      times: normalizedTimes,
      seaSurfaceTemperatureC: sst.map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null)),
      waveHeightM: waveH.map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null)),
      waveDirectionDeg: waveD.map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null)),
    };
  } catch (err) {
    logger.warn({ err, lat, lon }, "[envPackMarine] Open-Meteo fetch failed");
    return null;
  } finally {
    clearTimeout(timerId);
  }
}
