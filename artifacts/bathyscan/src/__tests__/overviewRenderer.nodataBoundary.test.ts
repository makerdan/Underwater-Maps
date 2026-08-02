/**
 * Unit tests for `buildNodataBoundarySegments` — the survey-gap boundary
 * segment generator.
 *
 * Coverage:
 *   1. Empty / degenerate grid → no segments.
 *   2. All-null grid → only outer-perimeter segments (no interior).
 *   3. Single interior null cell in a 3×3 grid → 4 boundary segments.
 *   4. No null cells → no segments.
 *   5. 2×2 block of null cells in a larger grid → perimeter only (8 segs).
 *   6. Segment cap: output is bounded by MAX_NODATA_BOUNDARY_SEGMENTS.
 *   7. Grid with NaN depths treated as null.
 *   8. Interior null cell: correct x/y coordinate values.
 */

import { describe, it, expect } from "vitest";
import {
  buildNodataBoundarySegments,
  MAX_NODATA_BOUNDARY_SEGMENTS,
} from "../lib/overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";

/** Minimal TerrainData fixture. Only `width`, `height`, and `depths` are used
 *  by `buildNodataBoundarySegments`; the other fields are set to safe defaults. */
function makeGrid(
  W: number,
  H: number,
  depths: (number | null)[],
): TerrainData {
  return {
    width: W,
    height: H,
    resolution: W,
    depths: depths as (number | null | undefined)[],
    minDepth: 0,
    maxDepth: 10,
    minLon: -1,
    maxLon: 1,
    minLat: -1,
    maxLat: 1,
  } as unknown as TerrainData;
}

// ---------------------------------------------------------------------------

describe("buildNodataBoundarySegments — degenerate grids", () => {
  it("returns empty array for a 0×0 grid", () => {
    const grid = makeGrid(0, 0, []);
    expect(buildNodataBoundarySegments(grid)).toEqual([]);
  });

  it("returns empty array for a 1×1 all-null grid (no neighbors)", () => {
    // A single null cell with no non-null neighbors should still show its
    // outer boundary on all 4 sides (outer edge treated as non-null).
    const grid = makeGrid(1, 1, [null]);
    const segs = buildNodataBoundarySegments(grid);
    expect(segs).toHaveLength(4);
  });

  it("returns empty array when no null cells exist", () => {
    // 3×3 fully surveyed grid
    const grid = makeGrid(3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(buildNodataBoundarySegments(grid)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("buildNodataBoundarySegments — single interior null cell (3×3)", () => {
  /**
   * Grid (W=3, H=3):
   *   row 0: [1, 2, 3]
   *   row 1: [4, null, 6]
   *   row 2: [7, 8, 9]
   *
   * The null cell is at (row=1, col=1). All 4 of its neighbours are non-null,
   * so exactly 4 boundary segments should be emitted:
   *   top    (y=1): x0=1, y0=1, x1=2, y1=1
   *   bottom (y=2): x0=1, y0=2, x1=2, y1=2
   *   left   (x=1): x0=1, y0=1, x1=1, y1=2
   *   right  (x=2): x0=2, y0=1, x1=2, y1=2
   */
  const grid = makeGrid(3, 3, [1, 2, 3, 4, null, 6, 7, 8, 9]);

  it("emits exactly 4 segments for a single interior null cell", () => {
    expect(buildNodataBoundarySegments(grid)).toHaveLength(4);
  });

  it("emits the correct top-edge segment", () => {
    const segs = buildNodataBoundarySegments(grid);
    expect(segs).toContainEqual({ x0: 1, y0: 1, x1: 2, y1: 1 });
  });

  it("emits the correct bottom-edge segment", () => {
    const segs = buildNodataBoundarySegments(grid);
    expect(segs).toContainEqual({ x0: 1, y0: 2, x1: 2, y1: 2 });
  });

  it("emits the correct left-edge segment", () => {
    const segs = buildNodataBoundarySegments(grid);
    expect(segs).toContainEqual({ x0: 1, y0: 1, x1: 1, y1: 2 });
  });

  it("emits the correct right-edge segment", () => {
    const segs = buildNodataBoundarySegments(grid);
    expect(segs).toContainEqual({ x0: 2, y0: 1, x1: 2, y1: 2 });
  });
});

// ---------------------------------------------------------------------------

describe("buildNodataBoundarySegments — 2×2 null block in a 4×4 grid", () => {
  /**
   * Grid (W=4, H=4):
   *   row 0: [1, 1, 1, 1]
   *   row 1: [1, null, null, 1]
   *   row 2: [1, null, null, 1]
   *   row 3: [1, 1, 1, 1]
   *
   * The 2×2 null block is at rows 1–2, cols 1–2.  Its perimeter consists of
   * 8 unit edges.  Shared edges between two null cells are NOT emitted.
   */
  const depths = [
    1, 1, 1, 1,
    1, null, null, 1,
    1, null, null, 1,
    1, 1, 1, 1,
  ];
  const grid = makeGrid(4, 4, depths);

  it("emits exactly 8 segments for a 2×2 interior null block", () => {
    expect(buildNodataBoundarySegments(grid)).toHaveLength(8);
  });

  it("does NOT emit the shared interior edge between the two top null cells", () => {
    const segs = buildNodataBoundarySegments(grid);
    // The boundary between (row=1,col=1) and (row=1,col=2) would be x=2,y=1→y=2.
    // But both are null, so NO segment at x0=2 spanning exactly y=1..y=2.
    const sharedEdge = segs.filter(
      (s) => s.x0 === 2 && s.x1 === 2 && s.y0 === 1 && s.y1 === 2,
    );
    expect(sharedEdge).toHaveLength(0);
  });

  it("emits the top boundary of the block (row=1 top edge)", () => {
    const segs = buildNodataBoundarySegments(grid);
    // Two horizontal segments: (1,1→2,1) and (2,1→3,1)
    expect(segs).toContainEqual({ x0: 1, y0: 1, x1: 2, y1: 1 });
    expect(segs).toContainEqual({ x0: 2, y0: 1, x1: 3, y1: 1 });
  });
});

// ---------------------------------------------------------------------------

describe("buildNodataBoundarySegments — NaN treated as null", () => {
  it("treats NaN depth as a survey gap", () => {
    const grid = makeGrid(3, 3, [1, 2, 3, 4, NaN, 6, 7, 8, 9]);
    // Same layout as the null test — should produce 4 segments.
    expect(buildNodataBoundarySegments(grid)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------

describe("buildNodataBoundarySegments — segment cap", () => {
  it("stops at MAX_NODATA_BOUNDARY_SEGMENTS for a very dense grid", () => {
    // Build a large checkerboard of null cells to trigger the cap.
    const W = 512;
    const H = 512;
    const depths: (number | null)[] = [];
    for (let i = 0; i < W * H; i++) depths.push(i % 2 === 0 ? null : 1);
    const grid = makeGrid(W, H, depths);
    const segs = buildNodataBoundarySegments(grid);
    expect(segs.length).toBeLessThanOrEqual(MAX_NODATA_BOUNDARY_SEGMENTS);
  });
});

// ---------------------------------------------------------------------------

describe("buildNodataBoundarySegments — all-null 2×2 grid (outer perimeter)", () => {
  /**
   * When ALL cells are null, no interior edges are emitted (all neighbours
   * are also null), but each outer-edge boundary IS emitted (the edge of the
   * grid is treated as non-null).
   *
   * 2×2 outer perimeter has 8 unit edges.
   */
  it("emits 8 outer-perimeter segments for a 2×2 all-null grid", () => {
    const grid = makeGrid(2, 2, [null, null, null, null]);
    expect(buildNodataBoundarySegments(grid)).toHaveLength(8);
  });
});
