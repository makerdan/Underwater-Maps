/**
 * terrainShader-land-gray.test.ts
 *
 * Regression tests for the land-cell override branch in the terrain
 * fragment shader (terrainShader.ts).
 *
 * Full GLSL execution is not feasible in a Node unit-test environment.
 * Instead we test the TypeScript equivalent of the GLSL depth-reconstruction
 * and branch-condition logic that drives the land override, confirming:
 *
 *   1. The formula that reconstructs depthM from world-Y, gridMinDepth, and
 *      gridMaxDepth matches the shader's computation.
 *   2. The branch fires (land override) for cells at or above the waterline
 *      (depthM ≤ 0).
 *   3. The branch does NOT fire for cells below the waterline (depthM > 0).
 *   4. The material factory exposes a uLandColor uniform (defaulting to the
 *      historical 0.82 light gray) that TerrainMesh syncs to the user's
 *      nodata color setting, and the fragment shader uses it in the land
 *      branch — which stays LAST before gl_FragColor so no overlay bleeds
 *      onto land.
 *
 * GLSL shader lines being mirrored (from terrainShader.ts):
 *   float t_land = clamp(-vWorldPos.y / 50.0, 0.0, 1.0);
 *   float depthM_land = uGridMinDepth + t_land * (uGridMaxDepth - uGridMinDepth);
 *   if (depthM_land <= 0.0) { finalColor = uLandColor; }
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";

import { MAX_DEPTH_WORLD } from "../lib/terrain";
import {
  createTerrainShaderMaterial,
  DEFAULT_LAND_COLOR_GRAY,
} from "../lib/terrainShader";
import type { TerrainTextures } from "../lib/textures";

function reconstructDepthM(
  worldY: number,
  gridMinDepth: number,
  gridMaxDepth: number,
): number {
  const t = Math.max(0, Math.min(1, -worldY / MAX_DEPTH_WORLD));
  return gridMinDepth + t * (gridMaxDepth - gridMinDepth);
}

function landBranchFires(
  worldY: number,
  gridMinDepth: number,
  gridMaxDepth: number,
): boolean {
  return reconstructDepthM(worldY, gridMinDepth, gridMaxDepth) <= 0;
}

function makeFakeTextures(): TerrainTextures {
  const tex = () => new THREE.Texture() as unknown as THREE.CanvasTexture;
  return {
    colorTextures: [tex(), tex(), tex(), tex()],
    normalMaps: [tex(), tex(), tex(), tex()],
  } as TerrainTextures;
}

describe("terrainShader — land override branch condition (TS mirror of GLSL)", () => {
  describe("branch fires (depthM ≤ 0) → land override applied", () => {
    it("Y=0 (waterline vertex, land-clamped cell) fires when gridMinDepth=0", () => {
      expect(landBranchFires(0, 0, 1000)).toBe(true);
    });

    it("Y=0 in a coastal grid that straddles 0 (minDepth negative) fires", () => {
      // Coastal dataset: minDepth=-50 (some underwater), maxDepth=5 (some land).
      // Land cells are clamped to Y=0 in geometry, reconstructed depthM=minDepth (-50) → ≤ 0.
      expect(landBranchFires(0, -50, 5)).toBe(true);
    });

    it("Y=0 with all-positive depth range still fires (depthM = gridMinDepth = 0)", () => {
      expect(landBranchFires(0, 0, 500)).toBe(true);
    });

    it("slightly positive Y (above waterline — would not appear in geometry) fires", () => {
      expect(landBranchFires(1, 0, 1000)).toBe(true);
    });
  });

  describe("branch does NOT fire (depthM > 0) → normal underwater coloring", () => {
    it("mid-depth cell in an all-positive range does not fire", () => {
      // worldY = -25 → t=0.5 → depthM = 0 + 0.5 * 1000 = 500 > 0
      expect(landBranchFires(-25, 0, 1000)).toBe(false);
    });

    it("deepest cell does not fire", () => {
      expect(landBranchFires(-MAX_DEPTH_WORLD, 0, 1000)).toBe(false);
    });

    it("shallow underwater cell with negative minDepth does not fire", () => {
      // minDepth=-50, maxDepth=500, worldY=-5 → t=0.1 → depthM = 5 > 0
      expect(landBranchFires(-5, -50, 500)).toBe(false);
    });

    it("deep cell in an all-underwater grid does not fire", () => {
      // minDepth=10 (no land), maxDepth=500, worldY=-10 → t=0.2 → depthM=108 > 0
      expect(landBranchFires(-10, 10, 500)).toBe(false);
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

  describe("uLandColor uniform", () => {
    it("material factory exposes uLandColor defaulting to the historical light gray", () => {
      const mat = createTerrainShaderMaterial(makeFakeTextures(), 10);
      const u = mat.uniforms["uLandColor"];
      expect(u).toBeDefined();
      const c = u!.value as THREE.Color;
      expect(c.r).toBeCloseTo(DEFAULT_LAND_COLOR_GRAY, 5);
      expect(c.g).toBeCloseTo(DEFAULT_LAND_COLOR_GRAY, 5);
      expect(c.b).toBeCloseTo(DEFAULT_LAND_COLOR_GRAY, 5);
      mat.dispose();
    });

    it("uLandColor uniform can be live-updated (TerrainMesh sync path)", () => {
      const mat = createTerrainShaderMaterial(makeFakeTextures(), 10);
      const c = mat.uniforms["uLandColor"]!.value as THREE.Color;
      c.setRGB(0.1, 0.2, 0.3);
      const after = mat.uniforms["uLandColor"]!.value as THREE.Color;
      expect(after.r).toBeCloseTo(0.1, 5);
      expect(after.g).toBeCloseTo(0.2, 5);
      expect(after.b).toBeCloseTo(0.3, 5);
      mat.dispose();
    });

    it("fragment shader declares uLandColor and assigns it in the land branch", () => {
      const mat = createTerrainShaderMaterial(makeFakeTextures(), 10);
      const src = mat.fragmentShader;
      expect(src).toContain("uniform vec3 uLandColor;");
      expect(src).toContain("finalColor = uLandColor;");
      // No hardcoded land gray remains in the shader source.
      expect(src).not.toContain("vec3(0.82");
      mat.dispose();
    });

    it("land override stays LAST — no overlay code runs after the land branch", () => {
      const mat = createTerrainShaderMaterial(makeFakeTextures(), 10);
      const src = mat.fragmentShader;
      const landIdx = src.indexOf("finalColor = uLandColor;");
      const fragIdx = src.indexOf("gl_FragColor =");
      expect(landIdx).toBeGreaterThan(-1);
      expect(fragIdx).toBeGreaterThan(landIdx);
      // Every other assignment/mix into finalColor happens before the land branch.
      const between = src.slice(landIdx + "finalColor = uLandColor;".length, fragIdx);
      expect(between).not.toMatch(/finalColor\s*[*+\-]?=/);
      mat.dispose();
    });

    it("DEFAULT_LAND_COLOR_GRAY is 0.82 and lighter than the default no-data gray (0.75)", () => {
      expect(DEFAULT_LAND_COLOR_GRAY).toBeCloseTo(0.82, 5);
      expect(DEFAULT_LAND_COLOR_GRAY).toBeGreaterThan(0.75);
    });
  });
});
