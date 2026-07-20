/**
 * computeDrift.shallowWater.test.ts
 *
 * Validates that the shallow-water tidal amplification model
 * (shallowWaterTidalScale) is correctly wired into computeDrift so that
 * tidal currents accelerate over shoals as mandated by continuity (Q = A × v).
 *
 * Two scenarios:
 *   A. Deep water (50 m) — scale factor is 1.0 → drift uses raw tidal speed.
 *   B. Shallow shoal (5 m, no tide offset) — scale = 30/5 = 6, capped at 3×
 *      → drift is 3× larger than scenario A.
 *
 * Also validates the waypoint (trolling) branch applies the same scaling.
 */

import { describe, it, expect } from "vitest";
import { computeDrift } from "../computeDrift";
import type { ComputeDriftOptions } from "../computeDrift";
import type { HourlySurfaceCondition } from "../driftStore";
import type { TerrainData } from "@workspace/api-client-react";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Build a flat terrain grid where every cell has the given depth. */
function flatTerrain(depthM: number): TerrainData {
  const N = 4;
  const depths = new Array<number>(N * N).fill(depthM);
  return {
    datasetId: "test",
    name: "test",
    waterType: "saltwater",
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: depthM,
    maxDepth: depthM,
    minLon: -132.5,
    maxLon: -132.3,
    minLat: 55.9,
    maxLat: 56.1,
    centerLon: -132.4,
    centerLat: 56.0,
  } as unknown as TerrainData;
}

/** A single, repeating hourly condition: 1 kt tidal current due north, no wind. */
const CONDITIONS: HourlySurfaceCondition[] = [
  {
    hour: 0,
    tidalSpeedKnots: 1,
    tidalDegrees: 0,
    windSpeedKnots: 0,
    windDegrees: 0,
    tideHeightM: 0,
    isSlack: false,
    phase: "flood",
  },
];

const BASE_OPTS: Omit<ComputeDriftOptions, "terrain"> = {
  conditions: CONDITIONS,
  startLat: 56.0,
  startLon: -132.4,
  lineLengthM: 200,
  mode: "drift",
};

// ── Tests — pure drift branch ─────────────────────────────────────────────────

describe("computeDrift — shallow-water tidal scaling (pure drift)", () => {
  it("deep water (50 m): scale is 1.0 — tidal input passes through unchanged", () => {
    const deep = flatTerrain(50);
    const result = computeDrift({ ...BASE_OPTS, terrain: deep });

    // Hour 0 drift should be non-zero (tide is pushing north).
    const h0 = result[0]!;
    expect(h0.driftContributionKnots).toBeGreaterThan(0);
  });

  it("shallow shoal (5 m): drift speed is significantly larger than at 50 m", () => {
    const deep = flatTerrain(50);
    const shallow = flatTerrain(5);

    const deepResult = computeDrift({ ...BASE_OPTS, terrain: deep });
    const shallowResult = computeDrift({ ...BASE_OPTS, terrain: shallow });

    const deepDrift = deepResult[0]!.driftContributionKnots;
    const shallowDrift = shallowResult[0]!.driftContributionKnots;

    // At 5 m depth, scale = min(3, 30/5) = 3.0 → tidal speed becomes 3 kt.
    // At 50 m depth, scale = 1.0 → tidal speed stays at 1 kt.
    // The 70% tidal blend means shallow drift ≈ 3× deep drift.
    expect(shallowDrift).toBeGreaterThan(deepDrift * 2.5);
  });

  it("shoal drift is at most 3× deep-water drift (TIDAL_MAX_SCALE cap)", () => {
    const deep = flatTerrain(50);
    const veryShallow = flatTerrain(1); // depth 1 m — would give scale=30 without cap

    const deepResult = computeDrift({ ...BASE_OPTS, terrain: deep });
    const shallowResult = computeDrift({ ...BASE_OPTS, terrain: veryShallow });

    const deepDrift = deepResult[0]!.driftContributionKnots;
    const shallowDrift = shallowResult[0]!.driftContributionKnots;

    // Scale is capped at 3.0 regardless of depth.
    expect(shallowDrift).toBeLessThanOrEqual(deepDrift * 3.0 + 1e-9);
  });

  it("scale factor matches shallowWaterTidalScale formula: 30/effectiveDepth capped at 3", () => {
    // terrainDepth=10, tideHeight=0 → effectiveDepth=10, scale=30/10=3.0
    const terrain10 = flatTerrain(10);
    // terrainDepth=15, tideHeight=0 → effectiveDepth=15, scale=30/15=2.0
    const terrain15 = flatTerrain(15);

    const r10 = computeDrift({ ...BASE_OPTS, terrain: terrain10 });
    const r15 = computeDrift({ ...BASE_OPTS, terrain: terrain15 });

    const drift10 = r10[0]!.driftContributionKnots;
    const drift15 = r15[0]!.driftContributionKnots;

    // Ratio of drifts should match ratio of scale factors: 3.0 / 2.0 = 1.5
    expect(drift10 / drift15).toBeCloseTo(1.5, 3);
  });

  it("tideHeightM raises effective depth and reduces amplification", () => {
    // Without tide: depth=5, scale=3×
    // With 25 m tide: effectiveDepth=30 → scale=1× (no amplification)
    const shallow = flatTerrain(5);

    const condNoTide: HourlySurfaceCondition[] = [
      { ...CONDITIONS[0]!, tideHeightM: 0 },
    ];
    const condHighTide: HourlySurfaceCondition[] = [
      { ...CONDITIONS[0]!, tideHeightM: 25 },
    ];

    const resultNoTide = computeDrift({ ...BASE_OPTS, terrain: shallow, conditions: condNoTide });
    const resultHighTide = computeDrift({ ...BASE_OPTS, terrain: shallow, conditions: condHighTide });

    const driftNoTide = resultNoTide[0]!.driftContributionKnots;
    const driftHighTide = resultHighTide[0]!.driftContributionKnots;

    // High tide should reduce the tidal amplification substantially.
    expect(driftNoTide).toBeGreaterThan(driftHighTide * 2);
  });
});

// ── Tests — waypoint (trolling) branch ───────────────────────────────────────

describe("computeDrift — shallow-water tidal scaling (waypoint/trolling branch)", () => {
  it("shallow-water amplification also applies in the waypoint trolling branch", () => {
    const deep = flatTerrain(50);
    const shallow = flatTerrain(5);

    const trollOpts: Omit<ComputeDriftOptions, "terrain"> = {
      ...BASE_OPTS,
      mode: "trolling",
      boatSpeedKnots: 2,
      boatHeadingDeg: 0,
      trollWaypoints: [
        { lat: 56.05, lon: -132.4 },
      ],
    };

    const deepResult = computeDrift({ ...trollOpts, terrain: deep });
    const shallowResult = computeDrift({ ...trollOpts, terrain: shallow });

    // driftContributionKnots reflects the wind+tide component only
    // (not boat speed), so the shallow-water effect is still visible.
    const deepDrift = deepResult[0]!.driftContributionKnots;
    const shallowDrift = shallowResult[0]!.driftContributionKnots;

    expect(shallowDrift).toBeGreaterThan(deepDrift * 2.5);
  });
});
