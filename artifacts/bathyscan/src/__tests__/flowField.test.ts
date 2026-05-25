import { describe, it, expect } from "vitest";
import {
  buildFlowField,
  sampleFlowField,
  tidePhaseToAmbient,
  ambientToVector,
  vectorToDirectionDeg,
  fingerprintFor,
} from "@/lib/flowField";
import { WORLD_SIZE } from "@/lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

/** Make a flat all-water terrain at uniform depth. */
function makeFlatGrid(N: number, depth: number): TerrainData {
  const depths = new Array(N * N).fill(depth);
  return {
    datasetId: "test-flat",
    resolution: N,
    minLat: 0, maxLat: 1, minLon: 0, maxLon: 1,
    minDepth: depth, maxDepth: depth,
    depths,
    waterType: "saltwater",
  } as unknown as TerrainData;
}

/** Make a grid with a square island of land in the centre. */
function makeIslandGrid(N: number): TerrainData {
  const depths: number[] = [];
  const lo = Math.floor(N * 0.4);
  const hi = Math.floor(N * 0.6);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (r >= lo && r <= hi && c >= lo && c <= hi) {
        depths.push(-1); // land: negative depth (treated as land/above-water)
      } else {
        depths.push(40);
      }
    }
  }
  return {
    datasetId: "test-island",
    resolution: N,
    minLat: 0, maxLat: 1, minLon: 0, maxLon: 1,
    minDepth: -1, maxDepth: 40,
    depths,
    waterType: "saltwater",
  } as unknown as TerrainData;
}

describe("flowField", () => {
  describe("ambientToVector / vectorToDirectionDeg", () => {
    it("0° = +Z (south)", () => {
      const v = ambientToVector(1, 0);
      expect(v.vx).toBeCloseTo(0, 5);
      expect(v.vz).toBeCloseTo(1, 5);
    });
    it("90° = +X (east)", () => {
      const v = ambientToVector(1, 90);
      expect(v.vx).toBeCloseTo(1, 5);
      expect(v.vz).toBeCloseTo(0, 5);
    });
    it("round-trips through vectorToDirectionDeg", () => {
      for (const dir of [0, 45, 90, 135, 200, 350]) {
        const v = ambientToVector(2, dir);
        expect(vectorToDirectionDeg(v.vx, v.vz)).toBeCloseTo(dir, 3);
      }
    });
  });

  describe("buildFlowField", () => {
    it("land cells carry zero velocity and zero mask", () => {
      const grid = makeIslandGrid(16);
      const field = buildFlowField(grid, {
        ambientSpeedKnots: 1.0,
        ambientDirectionDeg: 90,
      });
      let landZero = true;
      let landCount = 0;
      for (let i = 0; i < field.mask.length; i++) {
        if (field.mask[i] === 0) {
          landCount++;
          if (field.vx[i] !== 0 || field.vz[i] !== 0) landZero = false;
        }
      }
      expect(landCount).toBeGreaterThan(0);
      expect(landZero).toBe(true);
    });

    it("flow deflects around a land obstacle (no net push into it)", () => {
      const grid = makeIslandGrid(20);
      const field = buildFlowField(grid, {
        ambientSpeedKnots: 1.0,
        ambientDirectionDeg: 90, // flowing east (+X)
        passes: 6,
      });
      // Inspect water cells immediately west of the land block: their flow
      // should not be a pure +X push — some vertical (vz) component must
      // have appeared as the field deflects around the island.
      const N = field.resolution;
      const lo = Math.floor(N * 0.4);
      const hi = Math.floor(N * 0.6);
      const colJustWest = lo - 1;
      let totalVz = 0;
      let cells = 0;
      for (let r = lo; r <= hi; r++) {
        const i = r * N + colJustWest;
        if (field.mask[i] === 1) {
          totalVz += Math.abs(field.vz[i]!);
          cells++;
        }
      }
      expect(cells).toBeGreaterThan(0);
      expect(totalVz / cells).toBeGreaterThan(0.02);
    });

    it("produces a stable fingerprint for identical inputs", () => {
      const grid = makeFlatGrid(8, 30);
      const opts = { ambientSpeedKnots: 1.2, ambientDirectionDeg: 45 };
      expect(fingerprintFor(grid, opts)).toBe(fingerprintFor(grid, opts));
      expect(fingerprintFor(grid, opts)).not.toBe(
        fingerprintFor(grid, { ambientSpeedKnots: 1.3, ambientDirectionDeg: 45 }),
      );
    });
  });

  describe("sampleFlowField", () => {
    it("bilinear sampling returns ambient velocity for a uniform flat field", () => {
      const grid = makeFlatGrid(16, 30);
      const field = buildFlowField(grid, {
        ambientSpeedKnots: 0.8,
        ambientDirectionDeg: 90,
      });
      const s = sampleFlowField(field, 0, 0);
      expect(s.vx).toBeGreaterThan(0.5);
      expect(Math.abs(s.vz)).toBeLessThan(0.1);
    });

    it("returns zero for samples outside the grid", () => {
      const grid = makeFlatGrid(8, 30);
      const field = buildFlowField(grid, {
        ambientSpeedKnots: 1.0, ambientDirectionDeg: 0,
      });
      const s = sampleFlowField(field, WORLD_SIZE, WORLD_SIZE);
      expect(s.speed).toBe(0);
    });
  });

  describe("tidePhaseToAmbient", () => {
    it("phase=0 → full forward speed in base direction", () => {
      const a = tidePhaseToAmbient(1.0, 90, 0);
      expect(a.speedKnots).toBeCloseTo(1.0, 5);
      expect(a.directionDeg).toBe(90);
    });
    it("phase=0.5 → full speed in reversed direction", () => {
      const a = tidePhaseToAmbient(1.0, 90, 0.5);
      expect(a.speedKnots).toBeCloseTo(1.0, 5);
      expect(a.directionDeg).toBe(270);
    });
    it("phase=0.25 → slack water (zero speed)", () => {
      const a = tidePhaseToAmbient(1.0, 90, 0.25);
      expect(a.speedKnots).toBeLessThan(0.01);
    });
  });
});
