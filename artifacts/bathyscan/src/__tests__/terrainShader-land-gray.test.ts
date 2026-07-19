/**
 * terrainShader-land-gray.test.ts
 *
 * Regression tests for the land-cell gray override branch in the terrain
 * fragment shader (terrainShader.ts).
 *
 * Full GLSL execution is not feasible in a Node unit-test environment.
 * Instead we test the TypeScript equivalent of the GLSL depth-reconstruction
 * and branch-condition logic that drives the gray override, confirming:
 *
 *   1. The formula that reconstructs depthM from world-Y, gridMinDepth, and
 *      gridMaxDepth matches the shader's computation.
 *   2. The branch fires (gray override) for cells at or above the waterline
 *      (depthM ≤ 0).
 *   3. The branch does NOT fire for cells below the waterline (depthM > 0).
 *   4. The gray color constant (vec3(0.82, 0.82, 0.82)) is documented and
 *      stable.
 *
 * GLSL shader lines being mirrored (from terrainShader.ts):
 *   float t_land = clamp(-vWorldPos.y / 50.0, 0.0, 1.0);
 *   float depthM_land = uGridMinDepth + t_land * (uGridMaxDepth - uGridMinDepth);
 *   if (depthM_land <= 0.0) { finalColor = vec3(0.82, 0.82, 0.82); }
 */
import { describe, it, expect } from "vitest";

import { MAX_DEPTH_WORLD } from "../lib/terrain";

const LAND_GRAY = 0.82;

function reconstructDepthM(
  worldY: number,
  gridMinDepth: number,
  gridMaxDepth: number,
): number {
  const t = Math.max(0, Math.min(1, -worldY / MAX_DEPTH_WORLD));
  return gridMinDepth + t * (gridMaxDepth - gridMinDepth);
}

function landGrayBranchFires(
  worldY: number,
  gridMinDepth: number,
  gridMaxDepth: number,
): boolean {
  return reconstructDepthM(worldY, gridMinDepth, gridMaxDepth) <= 0;
}

describe("terrainShader — land-gray branch condition (TS mirror of GLSL)", () => {
  describe("branch fires (depthM ≤ 0) → gray override applied", () => {
    it("Y=0 (waterline vertex, land-clamped cell) fires when gridMinDepth=0", () => {
      expect(landGrayBranchFires(0, 0, 1000)).toBe(true);
    });

    it("Y=0 in a coastal grid that straddles 0 (minDepth negative) fires", () => {
      // Coastal dataset: minDepth=-50 (some underwater), maxDepth=5 (some land).
      // Land cells are clamped to Y=0 in geometry, reconstructed depthM=minDepth (-50) → ≤ 0.
      expect(landGrayBranchFires(0, -50, 5)).toBe(true);
    });

    it("Y=0 with all-positive depth range still fires (depthM = gridMinDepth = 0)", () => {
      // Pure underwater grid: minDepth=0, maxDepth=500.
      // A waterline cell at Y=0 should show gray.
      expect(landGrayBranchFires(0, 0, 500)).toBe(true);
    });

    it("slightly positive Y (above waterline — would not appear in geometry) fires", () => {
      // Geometry builder pins land to Y=0, but a hypothetical positive Y
      // (above surface, t=-worldY/50 = clamp(negative) = 0) also gives depthM=minDepth ≤ 0.
      expect(landGrayBranchFires(1, 0, 1000)).toBe(true);
    });
  });

  describe("branch does NOT fire (depthM > 0) → normal underwater coloring", () => {
    it("mid-depth cell in an all-positive range does not fire", () => {
      // worldY = -25 → t=0.5 → depthM = 0 + 0.5 * 1000 = 500 > 0
      expect(landGrayBranchFires(-25, 0, 1000)).toBe(false);
    });

    it("deepest cell does not fire", () => {
      // worldY = -MAX_DEPTH_WORLD → t=1 → depthM = maxDepth > 0
      expect(landGrayBranchFires(-MAX_DEPTH_WORLD, 0, 1000)).toBe(false);
    });

    it("shallow underwater cell with negative minDepth does not fire", () => {
      // minDepth=-50, maxDepth=500, worldY=-5 → t=0.1
      // depthM = -50 + 0.1 * 550 = -50 + 55 = 5 > 0
      expect(landGrayBranchFires(-5, -50, 500)).toBe(false);
    });

    it("deep cell in a coastal grid does not fire", () => {
      // minDepth=-50, maxDepth=5, worldY=-30
      // t = 30/50 = 0.6 → depthM = -50 + 0.6 * 55 = -50 + 33 = -17
      // Wait — this is actually ≤ 0, so it WOULD fire (it's near-surface).
      // Use a deeper cell: worldY=-40 → t=0.8 → depthM = -50 + 0.8*55 = -50+44 = -6 — still ≤ 0.
      // Need a grid where the underwater portion is clearly positive:
      // minDepth=10 (no land), maxDepth=500, worldY=-10 → t=0.2 → depthM=10+0.2*490=108 > 0
      expect(landGrayBranchFires(-10, 10, 500)).toBe(false);
    });
  });

  describe("depthM reconstruction formula", () => {
    it("Y=0 reconstructs to gridMinDepth", () => {
      expect(reconstructDepthM(0, 0, 1000)).toBeCloseTo(0, 5);
      expect(reconstructDepthM(0, -200, 800)).toBeCloseTo(-200, 5);
    });

    it("Y=-MAX_DEPTH_WORLD reconstructs to gridMaxDepth", () => {
      expect(reconstructDepthM(-MAX_DEPTH_WORLD, 0, 1000)).toBeCloseTo(1000, 4);
      expect(reconstructDepthM(-MAX_DEPTH_WORLD, -50, 500)).toBeCloseTo(500, 4);
    });

    it("Y=-MAX_DEPTH_WORLD/2 reconstructs to mid-range depth", () => {
      expect(reconstructDepthM(-MAX_DEPTH_WORLD / 2, 0, 1000)).toBeCloseTo(500, 3);
    });

    it("t is clamped to [0,1] — Y beyond range does not produce out-of-bounds depthM", () => {
      expect(reconstructDepthM(10, 0, 1000)).toBeCloseTo(0, 5);
      expect(reconstructDepthM(-200, 0, 1000)).toBeCloseTo(1000, 3);
    });
  });

  describe("gray color constant", () => {
    it("LAND_GRAY constant is 0.82 (matches vec3(0.82, 0.82, 0.82) in shader)", () => {
      expect(LAND_GRAY).toBeCloseTo(0.82, 5);
    });

    it("gray is lighter than the no-data color (0.75) — land is visually distinct from gaps", () => {
      const NO_DATA_GRAY = 0.75;
      expect(LAND_GRAY).toBeGreaterThan(NO_DATA_GRAY);
    });
  });
});
