import { describe, it, expect, vi } from "vitest";

// Shared stub — implementations live in src/__tests__/mocks/three.ts,
// wired via __mocks__/three.ts so no factory is needed here.
vi.mock("three");

// zoneMap module has no three.js dep — mock as passthrough
vi.mock("../lib/zoneMap", () => ({
  SALTWATER_ZONE_TO_SLOT: [0, 1, 2, 3, 3, 3, 1, 0],
  FRESHWATER_ZONE_TO_SLOT: [0, 0, 3, 2, 1, 3, 1, 2],
}));

import {
  buildTerrainGeometry,
  worldXZToLonLat,
  WORLD_SIZE,
} from "../lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

/**
 * North–south orientation contract (#3836).
 *
 * Terrain grids are served row 0 = minLat (SOUTH). buildTerrainGeometry
 * writes depths linearly into a PlaneGeometry whose first vertex row sits at
 * world z = −WORLD_SIZE/2, and worldXZToLonLat maps z = −half → minLat.
 * Together: data row 0 renders at the southern edge, so a grid whose rows
 * follow the served contract comes out north-up.
 *
 * The api-server side of this contract is pinned by
 * artifacts/api-server/src/lib/terrain-bundle-orientation.test.ts (the
 * bundled Lake Ray Roberts grid is flipped to row-0-south at load time).
 * If either side changes sign independently, terrain renders mirrored
 * north–south — this spec exists to catch exactly that.
 */

function makeGrid(N: number, overrides: Partial<TerrainData> = {}): TerrainData {
  const depths = Array.from({ length: N * N }, () => 0);
  return {
    datasetId: "test",
    name: "Test",
    waterType: "freshwater",
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: 0,
    maxDepth: 10,
    minLon: -97.15,
    maxLon: -96.92,
    minLat: 33.3,
    maxLat: 33.52,
    centerLon: -97.035,
    centerLat: 33.41,
    ...overrides,
  };
}

describe("terrain north–south orientation contract", () => {
  it("renders data row 0 at the SOUTHERN world edge (z = −half)", () => {
    const N = 3;
    // Row 0 shallow (1 m), row 2 deep (9 m) — row-major, row 0 = south.
    const depths = [1, 1, 1, 5, 5, 5, 9, 9, 9];
    const grid = makeGrid(N, { depths, minDepth: 1, maxDepth: 9 });
    const geo = buildTerrainGeometry(grid);
    const positions = (geo as unknown as {
      attributes: { position: { array: Float32Array } };
    }).attributes.position.array;

    const half = WORLD_SIZE / 2;
    for (let v = 0; v < N * N; v++) {
      const y = positions[v * 3 + 1]!;
      const z = positions[v * 3 + 2]!;
      const dataRow = Math.floor(v / N);
      // Vertex i must consume depths[i]: the shallow row (highest Y) must be
      // the row placed at z = −half, the deep row (lowest Y) at z = +half.
      if (dataRow === 0) {
        expect(z).toBeCloseTo(-half, 5);
      } else if (dataRow === N - 1) {
        expect(z).toBeCloseTo(half, 5);
      }
      if (z === -half) {
        // Southern edge carries the shallow row → least-negative Y.
        expect(y).toBeCloseTo(0, 5);
      } else if (z === half) {
        // Northern edge carries the deep row → most-negative Y.
        expect(y).toBeLessThan(positions[1]! - 0.001);
      }
    }
  });

  it("maps the southern world edge (z = −half) to minLat", () => {
    const grid = makeGrid(3);
    const half = WORLD_SIZE / 2;
    const south = worldXZToLonLat(0, -half, grid);
    const north = worldXZToLonLat(0, half, grid);
    expect(south.lat).toBeCloseTo(grid.minLat, 6);
    expect(north.lat).toBeCloseTo(grid.maxLat, 6);
  });
});
