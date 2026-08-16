import { describe, it, expect } from "vitest";

import { BUNDLED_TERRAIN, flipGridRowsInPlace } from "./terrain.js";

/**
 * Regression tests for the bundled Lake Ray Roberts north–south orientation
 * fix (#3836).
 *
 * The committed demoTerrain.gen.json stores rows top-down (row 0 = north,
 * GeoTIFF order) but the serving contract — assumed by the client geometry
 * loop, picking math, overview renderer, and matched by the `gridPoints`
 * gridder for uploaded datasets — is row 0 = minLat (south).
 * `loadBundledTerrain` flips the grid at load time; these tests pin both the
 * flip helper's behaviour and the real bundle's served orientation.
 */

describe("flipGridRowsInPlace", () => {
  it("reverses row order and leaves columns intact (even height)", () => {
    // 3 wide × 4 tall, values 0..11 in row-major order.
    const g = Array.from({ length: 12 }, (_, i) => i);
    flipGridRowsInPlace(g, 3, 4);
    expect(g).toEqual([9, 10, 11, 6, 7, 8, 3, 4, 5, 0, 1, 2]);
  });

  it("leaves the middle row untouched (odd height)", () => {
    const g = [0, 1, 2, 3, 4, 5, 6, 7, 8]; // 3×3
    flipGridRowsInPlace(g, 3, 3);
    expect(g).toEqual([6, 7, 8, 3, 4, 5, 0, 1, 2]);
  });

  it("is an involution — flipping twice restores the original", () => {
    const original = Array.from({ length: 20 }, (_, i) => i * 1.5);
    const g = original.slice();
    flipGridRowsInPlace(g, 5, 4);
    flipGridRowsInPlace(g, 5, 4);
    expect(g).toEqual(original);
  });
});

describe("BUNDLED_TERRAIN['lake-ray-roberts'] served orientation", () => {
  it("serves the grid with row 0 = south (deep water near the dam sits in low rows)", () => {
    const bundle = BUNDLED_TERRAIN["lake-ray-roberts"];
    if (!bundle) return; // bundle file unavailable in this environment

    const { width: W, height: H, depths } = bundle;

    // Lake Ray Roberts geography: the dam and the deepest basin are at the
    // SOUTH end of the lake (~33.35°N, near the bbox's minLat edge); the two
    // shallow feeder arms (Isle du Bois / Elm Fork) are in the north.
    // Under the served row-0-south contract the deepest cells must therefore
    // cluster in the LOW row indices. Before the flip they clustered at
    // row ≈ 176 of 256 (northern half of the array = upside-down render).
    const waterCells: Array<[depth: number, row: number]> = [];
    for (let i = 0; i < depths.length; i++) {
      const d = depths[i];
      if (d !== null && d !== undefined && Number.isFinite(d) && d > 0) {
        waterCells.push([d, Math.floor(i / W)]);
      }
    }
    expect(waterCells.length).toBeGreaterThan(1000); // sanity: it's a real lake

    waterCells.sort((a, b) => b[0] - a[0]);
    const deepest = waterCells.slice(0, Math.max(1, Math.floor(waterCells.length * 0.02)));
    const meanDeepRow = deepest.reduce((s, [, r]) => s + r, 0) / deepest.length;
    expect(meanDeepRow).toBeLessThan(H / 2);

    // Corollary: the southern half must be deeper on average than the
    // northern half (dam basin vs feeder arms).
    let southSum = 0, southN = 0, northSum = 0, northN = 0;
    for (const [d, r] of waterCells) {
      if (r < H / 2) { southSum += d; southN++; }
      else { northSum += d; northN++; }
    }
    expect(southN).toBeGreaterThan(0);
    expect(northN).toBeGreaterThan(0);
    expect(southSum / southN).toBeGreaterThan(northSum / northN);
  });
});
