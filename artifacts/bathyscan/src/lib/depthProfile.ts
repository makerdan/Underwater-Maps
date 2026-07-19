/**
 * depthProfile — utilities for analysing a dataset's depth distribution and
 * recommending the most visually effective colormap + band boundaries.
 *
 * All functions are pure (no side-effects, no store reads) so they can be
 * unit-tested independently of the React component tree.
 */
import type { ColormapTheme } from "./settingsStore";

/** Statistical profile of a terrain dataset's depth values (in feet). */
export interface DepthProfile {
  /** Minimum depth in the dataset (shallowest point), in feet. */
  min: number;
  /** Maximum depth in the dataset (deepest point), in feet. */
  max: number;
  /** 10th-percentile depth, in feet. */
  p10: number;
  /** 50th-percentile depth (median), in feet. */
  p50: number;
  /** 90th-percentile depth, in feet. */
  p90: number;
}

/**
 * Compute a statistical depth profile from a flat array of depth values.
 * Depths are expected to be in feet and non-negative.
 *
 * Returns null when the array has fewer than 4 valid (finite, non-negative)
 * values — not enough data to compute meaningful percentiles.
 */
export function computeDepthProfile(depths: Float32Array | (number | null)[]): DepthProfile | null {
  const valid: number[] = [];
  for (let i = 0; i < depths.length; i++) {
    const v = depths[i];
    if (v != null && Number.isFinite(v) && v >= 0) valid.push(v);
  }
  if (valid.length < 4) return null;

  valid.sort((a, b) => a - b);
  const n = valid.length;

  const percentile = (p: number): number => {
    const idx = (p / 100) * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, n - 1);
    const frac = idx - lo;
    return valid[lo]! + (valid[hi]! - valid[lo]!) * frac;
  };

  return {
    min: valid[0]!,
    max: valid[n - 1]!,
    p10: percentile(10),
    p50: percentile(50),
    p90: percentile(90),
  };
}

/**
 * The fixed maximum of the Ocean band-boundary scale (feet).
 * Mirrors OCEAN_MAX_DEPTH_FT in colormap.ts / paletteStore.ts.
 */
const OCEAN_MAX_FT = 2000;

/**
 * Suggestion result: the recommended colormap theme and a fresh set of
 * 11 band boundaries (in feet, matching the paletteStore schema) that
 * evenly distribute the 10 bands across the dataset's actual depth range.
 */
export interface ColormapSuggestion {
  theme: ColormapTheme;
  bandBoundaries: number[];
}

/**
 * Select the most appropriate depth colormap for a given depth profile.
 *
 * Heuristics (applied in priority order):
 *   1. Very shallow (max < 30 ft)                      → freshwater  (gentle teal ramp)
 *   2. Narrow range (max - min < 100 ft)               → thermal     (high local contrast)
 *   3. Wide ocean (p90 > 200 ft)                       → ocean       (familiar nautical blue)
 *   4. Wide scientific range (range > 500 ft)          → viridis     (perceptually uniform)
 *   5. Mixed / moderate (100–500 ft, p90 ≤ 200 ft)    → grayscale   (neutral, high-contrast)
 *
 * Also returns 11 `bandBoundaries` whose 9 interior points are evenly spaced
 * from `min` to `max`, concentrating the colour bands on the actual data range.
 * The first boundary is always 0 and the last is always OCEAN_MAX_FT (2000)
 * to satisfy the paletteStore schema constraint.
 */
export function suggestColormap(profile: DepthProfile): ColormapSuggestion {
  const { min, max, p90 } = profile;
  const range = max - min;

  let theme: ColormapTheme;
  if (max < 30) {
    // Very shallow lake, harbour, or river mouth — freshwater palette reads better.
    theme = "freshwater";
  } else if (range < 100) {
    // Narrow depth range: maximise local contrast with the thermal ramp.
    theme = "thermal";
  } else if (p90 > 200) {
    // Deep ocean dataset — the canonical blue ocean palette is most recognisable.
    theme = "ocean";
  } else if (range > 500) {
    // Very wide range with diverse depth spread → perceptually-uniform viridis.
    theme = "viridis";
  } else {
    // Mixed / moderate (100–500 ft total range, p90 ≤ 200 ft): doesn't fit a
    // single theme cleanly — grayscale offers neutral, printable contrast.
    theme = "grayscale";
  }

  const bandBoundaries = buildBandBoundaries(min, max);
  return { theme, bandBoundaries };
}

/**
 * Build a valid 11-entry band boundaries array with interior points evenly
 * spread between `dataMin` and `dataMax`, clamped to [0, OCEAN_MAX_FT].
 *
 * Invariants guaranteed by this function (required by sanitizeBandBoundaries):
 *   bb[0]  === 0             (fixed lower sentinel)
 *   bb[10] === OCEAN_MAX_FT  (fixed upper sentinel)
 *   bb[i]  <  bb[i+1]        (strictly monotone throughout)
 *   bb[1..9] ∈ [1, OCEAN_MAX_FT - 1]  (interior points never touch endpoints)
 */
function buildBandBoundaries(dataMin: number, dataMax: number): number[] {
  // lo/hi are the bounds of the data in feet, kept well within [0, 2000].
  const lo = Math.max(0, Math.min(Math.round(dataMin), OCEAN_MAX_FT - 10));
  const hi = Math.max(lo + 10, Math.min(Math.round(dataMax), OCEAN_MAX_FT));

  // Interior points must stay strictly below OCEAN_MAX_FT so the fixed
  // endpoint bb[10] = 2000 is always the largest value.
  const INTERIOR_MAX = OCEAN_MAX_FT - 1;

  const bb: number[] = [0];
  for (let i = 1; i <= 9; i++) {
    // Divide the range [lo, hi] into 10 equal tenths; place interior boundary
    // i at the i-th tenth mark.  t never reaches 1.0, so raw ≤ hi ≤ 2000;
    // the explicit Math.min guard defends against hi === OCEAN_MAX_FT edge cases.
    const t = i / 10;
    const raw = Math.round(lo + t * (hi - lo));
    bb.push(Math.min(raw, INTERIOR_MAX));
  }
  bb.push(OCEAN_MAX_FT);

  // Enforce strict monotonicity on interior points only.
  // The loop stops before bb[10] = 2000 to preserve the fixed endpoint.
  for (let i = 1; i < bb.length - 1; i++) {
    if (bb[i]! <= bb[i - 1]!) {
      bb[i] = Math.min(bb[i - 1]! + 1, INTERIOR_MAX);
    }
  }

  return bb;
}
