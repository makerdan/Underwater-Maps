/**
 * waterTemp — water-temperature model used by the HUD readout and marker
 * detail card.
 *
 * Strategy:
 *   1. The surface anchor (depth = 0 m) is sourced from a live ocean SST
 *      feed via `useSurfaceTemperature` — Open-Meteo's Marine API, fetched
 *      through /api/water-temperature for the dataset centre / GPS point.
 *   2. Below the surface we still need an estimate of how the column cools
 *      with depth (the global thermocline). BathyScan does not have a
 *      live, dataset-wide temperature profile, so we apply a simple
 *      exponential decay from the live surface value toward a cold-floor
 *      asymptote. This keeps the depth response of the chip meaningful
 *      without inventing data points we don't have.
 *   3. When the live SST feed is unavailable we fall back to a fixed
 *      surface anchor so the chip degrades gracefully instead of going
 *      blank — callers can surface this fallback state to the user via
 *      the returned `source`.
 */

/** Temperature the deep water column asymptotes toward (°C). */
const DEEP_C = 3;
/** Depth (m) at which ~63% of the surface→deep transition has happened. */
const THERMOCLINE_SCALE_M = 60;
/** Fallback surface temperature used when no live SST is available (°C). */
const FALLBACK_SURFACE_C = 15;

export interface WaterTempSample {
  /** Estimated temperature at `depthMetres`, or null when depth is unknown. */
  celsius: number | null;
  /** Human-readable attribution for the surface anchor used. */
  source: string;
  /** True when the surface anchor came from the live feed. */
  live: boolean;
  /** Surface SST (°C) used as the model anchor. */
  surfaceC: number;
  /** ISO timestamp of the surface sample, when known. */
  timestamp: string | null;
  /** Canonical URL for the data source (when applicable). */
  sourceUrl: string | null;
}

export interface SurfaceAnchor {
  /** Live sea-surface temperature in °C, or null when unavailable. */
  sstCelsius: number | null;
  /** Human-readable source label (e.g. "Open-Meteo Marine API"). */
  source: string | null;
  /** Canonical URL for the source. */
  sourceUrl: string | null;
  /** ISO timestamp of the live sample. */
  timestamp: string | null;
}

/**
 * Estimate water temperature (°C) at the given depth in metres, using
 * `anchor` as the live surface SST when available. Returns null when depth
 * is unknown / non-finite so callers can render an em-dash.
 */
export function estimateWaterTemperature(
  depthMetres: number | null | undefined,
  anchor?: SurfaceAnchor | null,
): WaterTempSample {
  const live = !!(anchor && typeof anchor.sstCelsius === "number" && Number.isFinite(anchor.sstCelsius));
  const surfaceC = live ? (anchor!.sstCelsius as number) : FALLBACK_SURFACE_C;
  const source = live
    ? (anchor!.source ?? "Live ocean feed")
    : "Estimated thermocline (no live feed)";
  const sourceUrl = live ? (anchor?.sourceUrl ?? null) : null;
  const timestamp = live ? (anchor?.timestamp ?? null) : null;

  if (depthMetres === null || depthMetres === undefined || !Number.isFinite(depthMetres)) {
    return { celsius: null, source, live, surfaceC, timestamp, sourceUrl };
  }
  const d = Math.max(0, depthMetres);
  // Decay toward DEEP_C, but never warmer than the surface anchor.
  const deep = Math.min(DEEP_C, surfaceC);
  const celsius = deep + (surfaceC - deep) * Math.exp(-d / THERMOCLINE_SCALE_M);
  return { celsius, source, live, surfaceC, timestamp, sourceUrl };
}

/**
 * Back-compat shim: returns just the °C value for callers that don't need
 * source metadata. Uses the deterministic fallback anchor (no live data).
 */
export function waterTemperatureC(depthMetres: number | null | undefined): number | null {
  return estimateWaterTemperature(depthMetres, null).celsius;
}
