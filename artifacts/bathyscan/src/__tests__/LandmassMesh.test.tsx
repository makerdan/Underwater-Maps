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

    // Highest topography vertex should sit above sea level by the same vertical
    // scale used by the bathymetry mesh.
    const depthRange = grid.maxDepth - grid.minDepth || 1;
    const peakElev = Math.max(...topography);
    const expectedPeakY = (peakElev / depthRange) * MAX_DEPTH_WORLD;
    let maxY = -Infinity;
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > maxY) maxY = y;
      if (y < minY) minY = y;
    }
    expect(maxY).toBeCloseTo(expectedPeakY, 3);
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
