/**
 * Unit tests for depthProfile.ts — computeDepthProfile, suggestColormap, and
 * the internal buildBandBoundaries helper (exercised via suggestColormap).
 *
 * Focus areas (per code-review requirement):
 *   - All five heuristic branches of suggestColormap are reachable.
 *   - buildBandBoundaries output always satisfies sanitizeBandBoundaries:
 *       bb[0] === 0, bb[10] === 2000, strictly increasing, all finite integers.
 *   - Edge cases: dataMax === 2000, dataMax > 2000, very narrow ranges.
 */
import { describe, it, expect } from "vitest";
import { computeDepthProfile, suggestColormap } from "../depthProfile";
import { sanitizeBandBoundaries } from "../paletteStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a flat depth array with the given min and max spread evenly. */
function depthArray(min: number, max: number, count = 100): number[] {
  return Array.from({ length: count }, (_, i) => min + (i / (count - 1)) * (max - min));
}

/**
 * Assert that a band-boundaries array satisfies every constraint enforced by
 * sanitizeBandBoundaries so the store will actually commit it.
 */
function expectValidBoundaries(bb: number[]): void {
  const result = sanitizeBandBoundaries(bb);
  expect(result).not.toBeNull();
  // Fixed endpoints
  expect(bb[0]).toBe(0);
  expect(bb[10]).toBe(2000);
  // Length
  expect(bb).toHaveLength(11);
  // Strictly monotone
  for (let i = 1; i < bb.length; i++) {
    expect(bb[i]).toBeGreaterThan(bb[i - 1]!);
  }
  // All integers
  for (const v of bb) {
    expect(Number.isInteger(v)).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// computeDepthProfile
// ---------------------------------------------------------------------------

describe("computeDepthProfile", () => {
  it("returns null for fewer than 4 values", () => {
    expect(computeDepthProfile([])).toBeNull();
    expect(computeDepthProfile([10, 20, 30])).toBeNull();
  });

  it("returns null when all values are negative (invalid depths)", () => {
    expect(computeDepthProfile([-5, -10, -20, -30])).toBeNull();
  });

  it("computes correct min/max for a simple array", () => {
    const profile = computeDepthProfile(depthArray(0, 1000));
    expect(profile).not.toBeNull();
    expect(profile!.min).toBeCloseTo(0, 0);
    expect(profile!.max).toBeCloseTo(1000, 0);
  });

  it("percentile p50 is near the median for a linear distribution", () => {
    const profile = computeDepthProfile(depthArray(0, 1000, 101));
    expect(profile!.p50).toBeCloseTo(500, 0);
  });

  it("p10 < p50 < p90 for any non-trivial dataset", () => {
    const profile = computeDepthProfile(depthArray(0, 1000));
    expect(profile!.p10).toBeLessThan(profile!.p50);
    expect(profile!.p50).toBeLessThan(profile!.p90);
  });

  it("filters out NaN and Infinity before computing stats", () => {
    const depths = [10, NaN, Infinity, 20, 30, -Infinity, 40];
    const profile = computeDepthProfile(depths);
    expect(profile).not.toBeNull();
    expect(profile!.min).toBe(10);
    expect(profile!.max).toBe(40);
  });

  it("works with Float32Array input", () => {
    const arr = new Float32Array([0, 100, 200, 300, 400, 500]);
    const profile = computeDepthProfile(arr);
    expect(profile).not.toBeNull();
    expect(profile!.max).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// suggestColormap — heuristic branches
// ---------------------------------------------------------------------------

describe("suggestColormap — theme selection", () => {
  it("very shallow (max < 30 ft) → freshwater", () => {
    const profile = computeDepthProfile(depthArray(0, 20))!;
    expect(suggestColormap(profile).theme).toBe("freshwater");
  });

  it("narrow range (< 100 ft) → thermal", () => {
    // max = 120, range = 50 → range < 100
    const profile = computeDepthProfile(depthArray(70, 120))!;
    expect(suggestColormap(profile).theme).toBe("thermal");
  });

  it("p90 > 200 ft (deep ocean) → ocean", () => {
    // range = 600 ft but p90 is well above 200 ft
    const profile = computeDepthProfile(depthArray(0, 600))!;
    expect(profile.p90).toBeGreaterThan(200);
    expect(suggestColormap(profile).theme).toBe("ocean");
  });

  it("range > 500, p90 ≤ 200 ft (scientific wide) → viridis", () => {
    // Heavily skewed: 90% of points are shallow (0-100 ft), last 10% reach 700 ft.
    const shallow = depthArray(0, 100, 90);
    const deep = depthArray(100, 700, 10);
    const profile = computeDepthProfile([...shallow, ...deep])!;
    expect(profile.p90).toBeLessThanOrEqual(200);
    expect(profile.max - profile.min).toBeGreaterThan(500);
    expect(suggestColormap(profile).theme).toBe("viridis");
  });

  it("moderate range 100–500 ft, p90 ≤ 200 ft → grayscale", () => {
    // Most points between 50 and 250 ft (range = 200, p90 ≤ 200).
    const shallow = depthArray(50, 200, 90);
    const fringe = depthArray(200, 250, 10);
    const profile = computeDepthProfile([...shallow, ...fringe])!;
    expect(profile.max - profile.min).toBeGreaterThanOrEqual(100);
    expect(profile.max - profile.min).toBeLessThanOrEqual(500);
    expect(profile.p90).toBeLessThanOrEqual(200);
    expect(suggestColormap(profile).theme).toBe("grayscale");
  });
});

// ---------------------------------------------------------------------------
// buildBandBoundaries — schema validity and edge cases
// ---------------------------------------------------------------------------

describe("suggestColormap — bandBoundaries validity (via sanitizeBandBoundaries)", () => {
  it("normal shallow dataset (max < 100 ft) produces valid boundaries", () => {
    const profile = computeDepthProfile(depthArray(0, 80))!;
    const { bandBoundaries } = suggestColormap(profile);
    expectValidBoundaries(bandBoundaries);
  });

  it("dataMax exactly at 2000 ft (previously buggy) produces valid boundaries", () => {
    // This was the blocking bug: interior bb[9] became 2000, monotonic-fix
    // pushed bb[10] to 2001, breaking sanitizeBandBoundaries.
    const profile = computeDepthProfile(depthArray(0, 2000))!;
    const { bandBoundaries } = suggestColormap(profile);
    expectValidBoundaries(bandBoundaries);
    // All interior points must be strictly less than 2000.
    for (let i = 1; i <= 9; i++) {
      expect(bandBoundaries[i]).toBeLessThan(2000);
    }
  });

  it("dataMax > 2000 ft (clamped) produces valid boundaries", () => {
    // Depths beyond 2000 ft are clamped to 2000 inside buildBandBoundaries.
    const profile = computeDepthProfile(depthArray(0, 3000))!;
    const { bandBoundaries } = suggestColormap(profile);
    expectValidBoundaries(bandBoundaries);
  });

  it("very narrow range (5 ft) produces valid boundaries", () => {
    // lo and hi are forced at least 10 apart by the max(lo+10, ...) guard.
    const profile = computeDepthProfile(depthArray(100, 105))!;
    const { bandBoundaries } = suggestColormap(profile);
    expectValidBoundaries(bandBoundaries);
  });

  it("dataMin === dataMax (all same depth) produces valid boundaries", () => {
    const profile = computeDepthProfile(new Array(20).fill(500))!;
    const { bandBoundaries } = suggestColormap(profile);
    expectValidBoundaries(bandBoundaries);
  });

  it("interior points are always in range (1, 1999)", () => {
    const testCases = [
      depthArray(0, 100),
      depthArray(0, 500),
      depthArray(0, 1000),
      depthArray(0, 2000),   // critical edge case
      depthArray(1800, 2000),
      depthArray(0, 3000),   // clamped
    ];
    for (const depths of testCases) {
      const profile = computeDepthProfile(depths)!;
      const { bandBoundaries: bb } = suggestColormap(profile);
      for (let i = 1; i <= 9; i++) {
        expect(bb[i]).toBeGreaterThan(0);
        expect(bb[i]).toBeLessThan(2000);
      }
    }
  });

  it("interior points are strictly increasing and strictly between endpoints", () => {
    const profile = computeDepthProfile(depthArray(0, 2000))!;
    const { bandBoundaries: bb } = suggestColormap(profile);
    for (let i = 1; i <= 9; i++) {
      expect(bb[i]).toBeGreaterThan(bb[i - 1]!);
      expect(bb[i]).toBeLessThan(bb[i + 1]!);
    }
  });

  it("near-maximum dataset (lo=1990) still produces 10 distinct boundaries", () => {
    // lo will be clamped to OCEAN_MAX_FT - 10 = 1990; hi = 2000.
    // All 9 interior points must fit in [1991, 1999].
    const profile = computeDepthProfile(depthArray(1990, 2000))!;
    const { bandBoundaries: bb } = suggestColormap(profile);
    expectValidBoundaries(bb);
    const uniqueVals = new Set(bb);
    expect(uniqueVals.size).toBe(11);
  });
});
