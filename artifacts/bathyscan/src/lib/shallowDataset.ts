/**
 * shallowDataset.ts — pure helpers for shallow-dataset detection and the
 * fine-detail display suggestion (vertical exaggeration + fine contours).
 *
 * A dataset is "shallow" when its full depth range spans less than
 * SHALLOW_RANGE_METRES (20 ft ≈ 6.1 m). Such datasets are nearly invisible
 * in the 3D view at 1:1 vertical scale, and coarse contour intervals produce
 * zero or one contour line. The suggestion pipeline (useShallowSuggestion)
 * uses these helpers to surface a dismissible banner — settings are never
 * changed automatically.
 */
import type { UnitsSystem } from "./settingsStore";

/** Depth-range threshold below which a dataset counts as shallow (20 ft). */
export const SHALLOW_RANGE_METRES = 6.096;

/**
 * True when the dataset's total depth range is under the shallow threshold.
 * Degenerate ranges (zero, negative, or non-finite) are NOT considered
 * shallow — there is nothing meaningful to exaggerate.
 */
export function isShallowDataset(minDepth: number, maxDepth: number): boolean {
  const range = maxDepth - minDepth;
  if (!Number.isFinite(range)) return false;
  return range > 0 && range < SHALLOW_RANGE_METRES;
}

/** Vertical exaggeration multiplier suggested for shallow datasets. */
export const SHALLOW_SUGGESTED_EXAGGERATION = 5;

/**
 * Fine contour interval suggested for shallow datasets, expressed in the
 * user's active unit system (the same convention as `contourInterval` in
 * settingsStore): metres for metric, feet for imperial, fathoms for nautical.
 */
export function fineContourIntervalFor(units: UnitsSystem): number {
  if (units === "imperial") return 1; // 1 ft
  return 0.5; // 0.5 m (metric) / 0.5 fm (nautical)
}

/** Human-readable label for the fine contour interval in the given units. */
export function fineContourIntervalLabel(units: UnitsSystem): string {
  if (units === "imperial") return "1 ft";
  if (units === "nautical") return "0.5 fm";
  return "0.5 m";
}
