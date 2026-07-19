import { describe, it, expect } from "vitest";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { buildLandmassGeometry } from "@/components/LandmassMesh";
import { MAX_DEPTH_WORLD } from "@/lib/terrain";

/**
 * Builds a small "Hawaii-like" preset: a centred conical island rising out of
 * a uniformly deep sea floor. The grid is intentionally tiny (N=8) so the
 * test stays fast while still exercising the full elevation ramp.
 */
function makeIslandPreset(): { grid: TerrainData; topography: number[] } {
  const N = 8;
  const depths: number[] = [];
  const topography: number[] = [];
  const cx = (N - 1) / 2;
  const cy = (N - 1) / 2;
  const maxR = Math.hypot(cx, cy);
  // Peak ~2000 m so we cover wet-sand → snow band.
  const peak = 2000;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x - cx, y - cy);
      const t = 1 - r / maxR; // 1 at centre, 0 at corners
      if (t > 0.15) {
        topography.push(peak * (t - 0.15));
        depths.push(0);
      } else {
        topography.push(0);
        depths.push(500 * (0.15 - t));
      }
    }
  }
  const grid: TerrainData = {
    datasetId: "hawaii-test",
    name: "Hawaii (test)",
    waterType: "saltwater",
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: 0,
    maxDepth: Math.max(...depths, 1),
    minLon: -156,
    maxLon: -155,
    minLat: 19,
    maxLat: 20,
    centerLon: -155.5,
    centerLat: 19.5,
    topography,
    hasTopography: true,
  };
  return { grid, topography };
}

describe("LandmassMesh / buildLandmassGeometry", () => {
  it("produces a geometry with per-vertex RGBA colour and elevation-driven Y", () => {
    const { grid, topography } = makeIslandPreset();
    const geo = buildLandmassGeometry(grid, topography, "realistic");

    const N = grid.resolution;
    const expectedVerts = N * N;

    const pos = geo.attributes["position"] as THREE.BufferAttribute;
    expect(pos).toBeDefined();
    expect(pos.count).toBe(expectedVerts);

    const color = geo.attributes["color"] as THREE.BufferAttribute;
    expect(color).toBeDefined();
    // Per-vertex RGBA so we can fade the shoreline.
    expect(color.itemSize).toBe(4);
    expect(color.count).toBe(expectedVerts);

    const normal = geo.attributes["normal"] as THREE.BufferAttribute;
    expect(normal).toBeDefined();
    expect(normal.count).toBe(expectedVerts);

    // Highest topography vertex should sit at exactly MAX_DEPTH_WORLD.
    // In the island preset the peak elevation (1700 m) far exceeds the depth
    // range (~75 m), so the topography-aware scale kicks in and the tallest
    // vertex is normalised to 1.0 × MAX_DEPTH_WORLD.
    let maxY = -Infinity;
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > maxY) maxY = y;
      if (y < minY) minY = y;
    }
    expect(maxY).toBeCloseTo(MAX_DEPTH_WORLD, 3);
    expect(minY).toBe(0); // water cells stay at y = 0

    // Alpha channel: water cells (elev <= 0) are fully transparent; high-
    // elevation cells are fully opaque. At least one of each must exist.
    const arr = color.array as Float32Array;
    let sawTransparentWater = false;
    let sawOpaqueLand = false;
    for (let i = 0; i < expectedVerts; i++) {
      const a = arr[i * 4 + 3];
      const elev = topography[i] ?? 0;
      if (elev <= 0) {
        expect(a).toBe(0);
        sawTransparentWater = true;
      }
      if (elev > 50) {
        // Well past the SHORE_BAND_M smoothstep ramp → must be opaque.
        expect(a).toBeCloseTo(1, 5);
        sawOpaqueLand = true;
      }
    }
    expect(sawTransparentWater).toBe(true);
    expect(sawOpaqueLand).toBe(true);

    // Colour ramp sanity: the highest peak vertex should be visibly brighter
    // (skewed toward rock/snow) than the lowest land vertex (sandy/green).
    let peakIdx = 0;
    let lowLandIdx = -1;
    let lowLandElev = Infinity;
    for (let i = 0; i < topography.length; i++) {
      const e = topography[i] ?? 0;
      if (e > (topography[peakIdx] ?? 0)) peakIdx = i;
      if (e > 0 && e < lowLandElev) {
        lowLandElev = e;
        lowLandIdx = i;
      }
    }
    expect(lowLandIdx).toBeGreaterThanOrEqual(0);
    const peakLum = arr[peakIdx * 4 + 0]! + arr[peakIdx * 4 + 1]! + arr[peakIdx * 4 + 2]!;
    const lowLum =
      arr[lowLandIdx * 4 + 0]! + arr[lowLandIdx * 4 + 1]! + arr[lowLandIdx * 4 + 2]!;
    expect(peakLum).toBeGreaterThan(lowLum);
  });

  describe("topography taller than depthRange", () => {
    /**
     * Shallow lake (maxDepth=5 → depthRange=5) with a tall hill (100 m).
     * Before the fix: 100/5 = 20× → vertex at 20 × MAX_DEPTH_WORLD = 1000 world units.
     * After the fix: scale = max(5, 100) = 100 → vertex at exactly MAX_DEPTH_WORLD.
     */
    function makeShallowLakeTallTerrain() {
      // 3×3 grid: centre cell is tall land, corners are water, one mid-edge at 50 m.
      const N = 3;
      const topography = [
        100, 50,  0,
          0,  0,  0,
          0,  0,  0,
      ];
      const depths = [
        0, 0, 0,
        0, 5, 5,
        0, 5, 5,
      ];
      const grid: TerrainData = {
        datasetId: "shallow-lake-test",
        name: "Shallow Lake (test)",
        waterType: "freshwater",
        resolution: N,
        width: N,
        height: N,
        depths,
        minDepth: 0,
        maxDepth: 5,
        minLon: -97,
        maxLon: -96,
        minLat: 33,
        maxLat: 34,
        centerLon: -96.5,
        centerLat: 33.5,
        topography,
        hasTopography: true,
      };
      return { grid, topography };
    }

    it("no vertex exceeds MAX_DEPTH_WORLD", () => {
      const { grid, topography } = makeShallowLakeTallTerrain();
      const geo = buildLandmassGeometry(grid, topography, "realistic");
      const pos = geo.attributes["position"] as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        expect(pos.getY(i)).toBeLessThanOrEqual(MAX_DEPTH_WORLD + 0.001);
      }
    });

    it("tallest vertex is at MAX_DEPTH_WORLD", () => {
      const { grid, topography } = makeShallowLakeTallTerrain();
      const geo = buildLandmassGeometry(grid, topography, "realistic");
      const pos = geo.attributes["position"] as THREE.BufferAttribute;
      let maxY = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > maxY) maxY = y;
      }
      expect(maxY).toBeCloseTo(MAX_DEPTH_WORLD);
    });

    it("water cells (elevation 0) remain at Y = 0", () => {
      const { grid, topography } = makeShallowLakeTallTerrain();
      const geo = buildLandmassGeometry(grid, topography, "realistic");
      const pos = geo.attributes["position"] as THREE.BufferAttribute;
      for (let i = 0; i < topography.length; i++) {
        if ((topography[i] ?? 0) === 0) {
          expect(pos.getY(i)).toBe(0);
        }
      }
    });

    it("relative ordering preserved: elev 50 < elev 100 in Y", () => {
      const { grid, topography } = makeShallowLakeTallTerrain();
      const geo = buildLandmassGeometry(grid, topography, "realistic");
      const pos = geo.attributes["position"] as THREE.BufferAttribute;
      // Index 0 → elev 100, Index 1 → elev 50
      const y100 = pos.getY(0);
      const y50  = pos.getY(1);
      expect(y50).toBeGreaterThan(0);
      expect(y100).toBeGreaterThan(y50);
    });
  });

  describe("all land below depthRange", () => {
    /**
     * When all topography elevations are within the depth range, depthRange wins
     * Math.max and the existing behaviour is preserved: peak lands at
     * (peakElev / depthRange) × MAX_DEPTH_WORLD.
     */
    function makeLowTerrain() {
      const N = 3;
      const peakElev = 10;
      const topography = [
        peakElev, 5, 0,
               0, 0, 0,
               0, 0, 0,
      ];
      const depths = [
        0, 0,  0,
        0, 50, 50,
        0, 50, 50,
      ];
      const grid: TerrainData = {
        datasetId: "low-terrain-test",
        name: "Low Terrain (test)",
        waterType: "freshwater",
        resolution: N,
        width: N,
        height: N,
        depths,
        minDepth: 0,
        maxDepth: 50,
        minLon: -97,
        maxLon: -96,
        minLat: 33,
        maxLat: 34,
        centerLon: -96.5,
        centerLat: 33.5,
        topography,
        hasTopography: true,
      };
      return { grid, topography, peakElev };
    }

    it("peak vertex lands at (peakElev / depthRange) × MAX_DEPTH_WORLD", () => {
      const { grid, topography, peakElev } = makeLowTerrain();
      const depthRange = grid.maxDepth - grid.minDepth || 1;
      const expectedPeakY = (peakElev / depthRange) * MAX_DEPTH_WORLD;
      const geo = buildLandmassGeometry(grid, topography, "realistic");
      const pos = geo.attributes["position"] as THREE.BufferAttribute;
      let maxY = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > maxY) maxY = y;
      }
      expect(maxY).toBeCloseTo(expectedPeakY, 3);
    });
  });

  it("uses a uniform flat colour when style = 'flat'", () => {
    const { grid, topography } = makeIslandPreset();
    const geo = buildLandmassGeometry(grid, topography, "flat");
    const color = geo.attributes["color"] as THREE.BufferAttribute;
    const arr = color.array as Float32Array;

    // All land vertices share the same RGB triple.
    let firstLand = -1;
    for (let i = 0; i < topography.length; i++) {
      if ((topography[i] ?? 0) > 0) {
        firstLand = i;
        break;
      }
    }
    expect(firstLand).toBeGreaterThanOrEqual(0);
    const r0 = arr[firstLand * 4 + 0];
    const g0 = arr[firstLand * 4 + 1];
    const b0 = arr[firstLand * 4 + 2];
    for (let i = 0; i < topography.length; i++) {
      if ((topography[i] ?? 0) > 0) {
        expect(arr[i * 4 + 0]).toBe(r0);
        expect(arr[i * 4 + 1]).toBe(g0);
        expect(arr[i * 4 + 2]).toBe(b0);
      }
    }
  });
});
