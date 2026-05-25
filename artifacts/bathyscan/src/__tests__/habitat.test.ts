import { describe, it, expect } from "vitest";
import {
  depthSuitability,
  structuralComplexity,
  substrateSuitability,
  slopeSuitability,
  extractHotspots,
  computeHabitatScore,
  SPECIES_CONFIGS,
} from "@/lib/habitat";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Helper: build a minimal TerrainData for testing
// ---------------------------------------------------------------------------

function makeGrid(
  resolution: number,
  depths: number[],
  overrides: Partial<TerrainData> = {},
): TerrainData {
  return {
    datasetId: "test",
    resolution,
    width: resolution,
    height: resolution,
    depths,
    minDepth: Math.min(...depths),
    maxDepth: Math.max(...depths),
    minLon: 0,
    maxLon: 1,
    minLat: 0,
    maxLat: 1,
    waterType: "saltwater",
    ...overrides,
  } as unknown as TerrainData;
}

// ---------------------------------------------------------------------------
// depthSuitability
// ---------------------------------------------------------------------------

describe("depthSuitability", () => {
  const config = SPECIES_CONFIGS["dungeness_crab"]!;
  // optimal: [10, 120]  tolerance: [5, 180]

  it("returns 1.0 inside optimal range", () => {
    expect(depthSuitability(10, config)).toBe(1);
    expect(depthSuitability(65, config)).toBe(1);
    expect(depthSuitability(120, config)).toBe(1);
  });

  it("returns 0.0 outside tolerance range", () => {
    expect(depthSuitability(0, config)).toBe(0);
    expect(depthSuitability(181, config)).toBe(0);
    expect(depthSuitability(4, config)).toBe(0);
  });

  it("returns a value between 0 and 1 in the taper zones", () => {
    // Below optimal, within tolerance: 5–10 m
    const low = depthSuitability(7.5, config); // midpoint → ~0.5
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(1);

    // Above optimal, within tolerance: 120–180 m
    const high = depthSuitability(150, config); // midpoint → ~0.5
    expect(high).toBeGreaterThan(0);
    expect(high).toBeLessThan(1);
  });

  it("returns exactly 0.5 at the midpoint of the lower taper", () => {
    // optMin=10, tolMin=5 → midpoint = 7.5
    expect(depthSuitability(7.5, config)).toBeCloseTo(0.5, 5);
  });

  it("handles rockfish high-depth tolerance", () => {
    const rc = SPECIES_CONFIGS["rockfish"]!;
    // optimal [50,400] tolerance [20,800]
    expect(depthSuitability(50, rc)).toBe(1);
    expect(depthSuitability(400, rc)).toBe(1);
    expect(depthSuitability(20, rc)).toBeCloseTo(0, 1); // at tolerance edge → 0
    expect(depthSuitability(19, rc)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// structuralComplexity
// ---------------------------------------------------------------------------

describe("structuralComplexity", () => {
  it("returns 0 for a perfectly flat grid", () => {
    const flat = Array.from({ length: 100 }, () => 50);
    const grid = makeGrid(10, flat);
    expect(structuralComplexity(grid, 5, 5)).toBe(0);
  });

  it("returns > 0 for a grid with depth variation", () => {
    const varied = Array.from({ length: 100 }, (_, i) => i * 3);
    const grid = makeGrid(10, varied);
    expect(structuralComplexity(grid, 5, 5)).toBeGreaterThan(0);
  });

  it("clamps to [0,1]", () => {
    // Extreme variation
    const extreme = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0 : 1000));
    const grid = makeGrid(10, extreme);
    const c = structuralComplexity(grid, 5, 5);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// substrateSuitability
// ---------------------------------------------------------------------------

describe("substrateSuitability", () => {
  const config = SPECIES_CONFIGS["rockfish"]!;

  it("returns the correct preference for basalt_rock (index 3 in SALTWATER_ZONES)", () => {
    const zones = ["sandy_shelf", "coarse_sediment", "silt_plain", "basalt_rock"] as const;
    expect(substrateSuitability(3, config, zones)).toBe(1.0);
  });

  it("returns 0.2 for sandy_shelf for rockfish", () => {
    const zones = ["sandy_shelf", "coarse_sediment", "silt_plain", "basalt_rock"] as const;
    expect(substrateSuitability(0, config, zones)).toBe(0.2);
  });

  it("returns 0.5 for an undefined zone", () => {
    expect(substrateSuitability(99, config, [])).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// slopeSuitability
// ---------------------------------------------------------------------------

describe("slopeSuitability", () => {
  it("gentle: 1.0 at 0°, 0.0 at 15°+", () => {
    const config = SPECIES_CONFIGS["dungeness_crab"]!;
    expect(slopeSuitability(0, config)).toBeCloseTo(1, 5);
    expect(slopeSuitability(15, config)).toBeCloseTo(0, 5);
    expect(slopeSuitability(30, config)).toBe(0);
  });

  it("steep: 0.0 at 0°, 1.0 at 30°+", () => {
    const config = SPECIES_CONFIGS["rockfish"]!;
    expect(slopeSuitability(0, config)).toBeCloseTo(0, 5);
    expect(slopeSuitability(30, config)).toBeCloseTo(1, 5);
    expect(slopeSuitability(60, config)).toBe(1);
  });

  it("any: always 1.0", () => {
    const config = SPECIES_CONFIGS["demersal_fish"]!;
    expect(slopeSuitability(0, config)).toBe(1);
    expect(slopeSuitability(45, config)).toBe(1);
    expect(slopeSuitability(90, config)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeHabitatScore
// ---------------------------------------------------------------------------

describe("computeHabitatScore", () => {
  it("returns a Float32Array of length N×N", () => {
    const N = 4;
    const depths = Array.from({ length: N * N }, (_, i) => 20 + i * 5);
    const grid = makeGrid(N, depths);
    const config = SPECIES_CONFIGS["dungeness_crab"]!;
    const scores = computeHabitatScore(grid, null, config);
    expect(scores).toBeInstanceOf(Float32Array);
    expect(scores.length).toBe(N * N);
  });

  it("all scores are in [0,1]", () => {
    const N = 8;
    const depths = Array.from({ length: N * N }, (_, i) => 10 + i * 2);
    const grid = makeGrid(N, depths);
    const config = SPECIES_CONFIGS["halibut"]!;
    const scores = computeHabitatScore(grid, null, config);
    for (let i = 0; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(0);
      expect(scores[i]).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// extractHotspots
// ---------------------------------------------------------------------------

describe("extractHotspots", () => {
  it("returns up to 10 hotspots", () => {
    const N = 16;
    // All high-scoring cells
    const depths = Array.from({ length: N * N }, () => 60);
    const grid = makeGrid(N, depths);
    const scores = new Float32Array(N * N).fill(0.9);
    const hotspots = extractHotspots(scores, grid, null, 0.75, 3);
    expect(hotspots.length).toBeLessThanOrEqual(10);
  });

  it("respects minScore threshold", () => {
    const N = 8;
    const depths = Array.from({ length: N * N }, () => 50);
    const grid = makeGrid(N, depths);
    const scores = new Float32Array(N * N).fill(0.5);
    const hotspots = extractHotspots(scores, grid, null, 0.75);
    expect(hotspots.length).toBe(0);
  });

  it("respects minSpacing", () => {
    const N = 10;
    const depths = Array.from({ length: N * N }, () => 50);
    const grid = makeGrid(N, depths);
    // One high-scoring cell at (0,0) and one very close to it at (0,1)
    const scores = new Float32Array(N * N).fill(0);
    scores[0] = 0.95;
    scores[1] = 0.90;
    const hotspots = extractHotspots(scores, grid, null, 0.75, 5);
    // Only the first one should be picked; the second is too close
    expect(hotspots.length).toBe(1);
    expect(hotspots[0]!.score).toBeCloseTo(0.95, 3);
  });

  it("includes correct lon/lat coordinates", () => {
    const N = 3;
    const depths = Array.from({ length: N * N }, () => 100);
    const grid = makeGrid(N, depths, { minLon: 10, maxLon: 11, minLat: 20, maxLat: 21 });
    const scores = new Float32Array(N * N).fill(0);
    scores[0] = 0.99; // row=0, col=0
    const hotspots = extractHotspots(scores, grid, null, 0.75, 1);
    expect(hotspots.length).toBe(1);
    expect(hotspots[0]!.lon).toBeCloseTo(10, 5);
    expect(hotspots[0]!.lat).toBeCloseTo(20, 5);
  });
});
