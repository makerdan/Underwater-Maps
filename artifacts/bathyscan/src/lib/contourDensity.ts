/**
 * contourDensity.ts — MOBILE-ONLY: pure math helpers for the mobile Chart
 * View's 1×/2×/3× contour-density stepper and index-contour emphasis.
 *
 * The desktop Overview Map does NOT use these helpers — its contour interval
 * behaviour is unchanged. They live in their own module (rather than inside
 * overviewRenderer.ts) so the mobile-only surface is unmistakable in review
 * and trivially unit-testable.
 */
import type { UnitsSystem } from "./settingsStore";

/** MOBILE-ONLY: allowed contour-density multipliers (1× / 2× / 3×). */
export type ContourDensity = 1 | 2 | 3;

/** MOBILE-ONLY: ordered stepper values for the on-map segmented control. */
export const CONTOUR_DENSITY_VALUES: readonly ContourDensity[] = [1, 2, 3];

/**
 * MOBILE-ONLY: every N-th contour level is an "index" contour — drawn heavier
 * and the only one labeled — so the 3× density stays readable on a phone.
 * 5 is the cartographic convention (e.g. USGS topo maps).
 */
export const INDEX_CONTOUR_EVERY = 5;

/**
 * MOBILE-ONLY: coerce an untrusted value (settings sync, old localStorage)
 * into a valid ContourDensity. Anything unexpected falls back to 1×.
 */
export function toValidContourDensity(v: unknown): ContourDensity {
  return v === 2 || v === 3 ? v : 1;
}

/**
 * MOBILE-ONLY: divide the base contour interval by the density multiplier.
 * 1× = the user's configured interval, 2× = twice as many lines (interval/2),
 * 3× = three times as many (interval/3).
 *
 * Non-finite / non-positive base intervals are returned unchanged so the
 * caller's existing "interval <= 0 → no contours" guard still applies.
 */
export function applyContourDensity(
  baseIntervalMetres: number,
  density: ContourDensity,
): number {
  if (!Number.isFinite(baseIntervalMetres) || baseIntervalMetres <= 0) {
    return baseIntervalMetres;
  }
  return baseIntervalMetres / toValidContourDensity(density);
}

/**
 * MOBILE-ONLY: convert the user-facing contour interval (stored in the active
 * unit system) to metres. Mirrors the conversion the desktop OverviewMap
 * performs inline (OverviewMap.tsx contour rebuild effect):
 *   metric   → already metres
 *   nautical → fathoms  (1 fm = 1.8288 m)
 *   imperial → feet     (1 ft = 1/3.28084 m)
 */
export function contourIntervalToMetres(
  interval: number,
  units: UnitsSystem,
): number {
  if (units === "metric") return interval;
  if (units === "nautical") return interval * 1.8288;
  return interval / 3.28084;
}

/**
 * MOBILE-ONLY: true when `depthMetres` sits on an index contour level, i.e.
 * a whole multiple of (effectiveIntervalMetres × INDEX_CONTOUR_EVERY).
 *
 * Uses a relative tolerance because contour levels are accumulated with
 * repeated float addition in buildContourLines (isoDepth += interval), so an
 * exact modulo comparison would misclassify deep levels.
 */
export function isIndexContourDepth(
  depthMetres: number,
  effectiveIntervalMetres: number,
): boolean {
  if (!Number.isFinite(effectiveIntervalMetres) || effectiveIntervalMetres <= 0) {
    return false;
  }
  const indexSpacing = effectiveIntervalMetres * INDEX_CONTOUR_EVERY;
  const ratio = depthMetres / indexSpacing;
  return Math.abs(ratio - Math.round(ratio)) < 1e-3;
}
