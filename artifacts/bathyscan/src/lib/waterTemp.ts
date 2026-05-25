/**
 * waterTemp — simple mock model for estimating water temperature at depth.
 *
 * Data source: deterministic mock. There is no live oceanographic feed wired
 * into BathyScan today, so we approximate a typical temperate-coastal
 * thermocline: a warm surface mixed layer that decays exponentially toward
 * a cold deep-water floor. This gives the new HUD temperature readout a
 * plausible value that responds to the user's depth focus and exercises the
 * `formatTemperature` helper / Units toggle. Swap this for a real SST or
 * dataset-metadata source when one is available.
 */

const SURFACE_C = 15;
const DEEP_C = 3;
/** Depth (m) at which ~63% of the surface→deep transition has happened. */
const THERMOCLINE_SCALE_M = 60;

/**
 * Estimate water temperature (°C) at the given depth in metres.
 * Returns null when depth is unknown/non-finite so callers can render "—".
 */
export function waterTemperatureC(depthMetres: number | null | undefined): number | null {
  if (depthMetres === null || depthMetres === undefined || !Number.isFinite(depthMetres)) {
    return null;
  }
  const d = Math.max(0, depthMetres);
  return DEEP_C + (SURFACE_C - DEEP_C) * Math.exp(-d / THERMOCLINE_SCALE_M);
}
