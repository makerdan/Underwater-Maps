/**
 * envPackInterpolation.ts — smooth weather value interpolation from an EnvPack.
 *
 * Provides `getWeatherAtTime`, which linearly interpolates temperature and wind
 * speed and circularly interpolates wind direction between the two NWS hourly
 * forecast periods that bracket a given timestamp.
 *
 * Mirrors the cosine-interpolation pattern in `offlinePackStore.ts` /
 * `envOfflineStore.ts` (tide height), but uses linear interpolation for weather
 * since NWS hourly forecasts already represent smoothed hour-level averages.
 */

import type { EnvPack, WeatherHourlyForecastPeriod } from "./envPackTypes";

// ── Return type ───────────────────────────────────────────────────────────────

export interface InterpolatedWeather {
  /** Temperature in °F (native NWS unit for hourly forecasts). */
  temperatureF: number | null;
  /** Wind speed in knots (parsed and converted from NWS string like "5 mph"). */
  windSpeedKnots: number | null;
  /** Wind direction in degrees (0–360, from cardinal string like "NW"). */
  windDirDeg: number | null;
}

// ── Cardinal-direction lookup ─────────────────────────────────────────────────

const CARDINAL_DEG: Readonly<Record<string, number>> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

/**
 * Parse a NWS wind direction string (cardinal or numeric) to degrees.
 * Returns null when the string cannot be interpreted.
 */
export function parseWindDirection(dir: string): number | null {
  const upper = dir.trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(CARDINAL_DEG, upper)) {
    return CARDINAL_DEG[upper]!;
  }
  const n = parseFloat(upper);
  if (!isNaN(n)) return ((n % 360) + 360) % 360;
  return null;
}

// ── Unit conversion helper ────────────────────────────────────────────────────

function applySpeedUnit(value: number, unit: string): number {
  const u = unit.trim().toLowerCase();
  if (u === "mph" || u === "mi/h" || u === "mi/hr") return value * 0.868976;
  if (u === "km/h" || u === "kph" || u === "kmh") return value * 0.539957;
  if (u === "m/s" || u === "mps") return value * 1.94384;
  // bare number, "kt", "kts", "knot", "knots" — already knots
  return value;
}

/**
 * Parse a NWS wind speed string to knots.
 *
 * Handles:
 *   - Single values with or without units: "5 mph", "10 kt", "8 knots", "12 km/h"
 *   - NWS range strings:  "5 to 10 mph", "5 to 10 kt"
 *     The midpoint of the range is converted using the trailing unit.
 *
 * Returns null when the string cannot be interpreted.
 */
export function parseWindSpeedKnots(speed: string): number | null {
  const s = speed.trim();
  if (!s) return null;

  // Range format: "5 to 10 mph"
  const rangeMatch = s.match(/^([\d.]+)\s+to\s+([\d.]+)\s*(.*)$/i);
  if (rangeMatch) {
    const lo = parseFloat(rangeMatch[1]!);
    const hi = parseFloat(rangeMatch[2]!);
    if (!isNaN(lo) && !isNaN(hi)) {
      return applySpeedUnit((lo + hi) / 2, rangeMatch[3] ?? "");
    }
  }

  // Single-value format: "10 mph"
  const match = s.match(/^([\d.]+)\s*(.*)$/i);
  if (!match) return null;
  const value = parseFloat(match[1]!);
  if (isNaN(value)) return null;
  return applySpeedUnit(value, match[2] ?? "");
}

// ── Circular interpolation ────────────────────────────────────────────────────

/**
 * Interpolate between two angles (degrees) by fraction t ∈ [0, 1] using a
 * unit-vector mean. Handles the 350°→10° wraparound correctly.
 */
function circularInterp(a: number, b: number, t: number): number {
  const toRad = Math.PI / 180;
  const sinI = Math.sin(a * toRad) + (Math.sin(b * toRad) - Math.sin(a * toRad)) * t;
  const cosI = Math.cos(a * toRad) + (Math.cos(b * toRad) - Math.cos(a * toRad)) * t;
  const deg = (Math.atan2(sinI, cosI) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

// ── Single-period snapshot ────────────────────────────────────────────────────

function periodToWeather(p: WeatherHourlyForecastPeriod): InterpolatedWeather {
  return {
    temperatureF: p.temperature ?? null,
    windSpeedKnots: parseWindSpeedKnots(p.windSpeed),
    windDirDeg: parseWindDirection(p.windDirection),
  };
}

// ── Primary export ────────────────────────────────────────────────────────────

/**
 * Return smoothly interpolated weather at `timestamp` from the `hourlyForecast`
 * array of the specified weather station in `envPack`.
 *
 * @param envPack   - The offline env pack containing weather station data.
 * @param timestamp - Unix epoch ms of the desired time (e.g. `targetTime.getTime()`).
 * @param stationId - Optional station ID to look up. When provided the function
 *                    finds the matching station; falls back to index 0 if the
 *                    ID is not found. Omit to always use index 0.
 *
 * Algorithm:
 *   1. Find `prev` = the last period whose `startTime` ≤ `timestamp`.
 *   2. Find `next` = the first period whose `startTime` > `timestamp`.
 *   3. If there is no `prev` (timestamp before the first period) → **null**.
 *   4. If there is no `next` (timestamp is inside or after the last period):
 *        - If timestamp ≤ last period's `endTime` → return last period values.
 *        - Otherwise → **null** (past the end of the window).
 *   5. Linearly interpolate temperature and wind speed; circularly interpolate
 *      wind direction. When one neighbour has a null field, the other's value
 *      is used as-is (no attempt to interpolate a null).
 *
 * Returns `null` whenever the timestamp falls outside the forecast window so
 * the caller can treat it as "unavailable".
 */
export function getWeatherAtTime(
  envPack: EnvPack,
  timestamp: number,
  stationId?: string,
): InterpolatedWeather | null {
  const stations = envPack.weatherStations;
  const station =
    stationId != null
      ? (stations?.find((s) => s.id === stationId) ?? stations?.[0])
      : stations?.[0];
  if (!station?.hourlyForecast || station.hourlyForecast.length === 0) return null;

  const forecast = station.hourlyForecast;

  let prev: WeatherHourlyForecastPeriod | null = null;
  let next: WeatherHourlyForecastPeriod | null = null;

  for (const period of forecast) {
    const start = new Date(period.startTime).getTime();
    if (start <= timestamp) {
      prev = period;
    } else if (next === null) {
      next = period;
      break;
    }
  }

  // Timestamp is before the first period — outside window.
  if (prev === null) return null;

  // Timestamp is past the last period's startTime: check endTime boundary.
  if (next === null) {
    const lastPeriod = forecast[forecast.length - 1]!;
    const lastEnd = new Date(lastPeriod.endTime).getTime();
    if (timestamp <= lastEnd) return periodToWeather(lastPeriod);
    return null; // After end of window.
  }

  // Normal case: interpolate between prev and next.
  const t0 = new Date(prev.startTime).getTime();
  const t1 = new Date(next.startTime).getTime();
  const span = t1 - t0;

  // Guard against degenerate (zero-span) bracket — return prev directly.
  if (span <= 0) return periodToWeather(prev);

  const t = (timestamp - t0) / span;

  // Temperature — linear interpolation.
  const tempA = prev.temperature;
  const tempB = next.temperature;
  const temperatureF =
    tempA != null && tempB != null
      ? tempA + (tempB - tempA) * t
      : (tempA ?? tempB ?? null);

  // Wind speed — linear interpolation.
  const wsA = parseWindSpeedKnots(prev.windSpeed);
  const wsB = parseWindSpeedKnots(next.windSpeed);
  const windSpeedKnots =
    wsA != null && wsB != null
      ? wsA + (wsB - wsA) * t
      : (wsA ?? wsB ?? null);

  // Wind direction — circular interpolation (handles 350°→10° wraparound).
  const wdA = parseWindDirection(prev.windDirection);
  const wdB = parseWindDirection(next.windDirection);
  const windDirDeg =
    wdA != null && wdB != null
      ? circularInterp(wdA, wdB, t)
      : (wdA ?? wdB ?? null);

  return { temperatureF, windSpeedKnots, windDirDeg };
}
