/**
 * Unit tests for the gap/overlap indicator raster in overviewRenderer:
 *
 *   1. computeGapOverlapMask — coverage counting for flush, overlapping,
 *      and gapped tiles; rotation via inverse-rotated sampling; guards
 *      (empty input, cell budget).
 *   2. drawGapOverlap — red hatch cells only where count = 0, orange fill
 *      only where count ≥ 2 (recording-stub ctx; jsdom has no canvas).
 */
import { describe, it, expect, vi } from "vitest";
import {
  computeGapOverlapMask,
  drawGapOverlap,
  GAP_OVERLAP_STEP_PX,
  type GapOverlapTileInput,
} from "../overviewRenderer";

const tile = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  extra: Partial<GapOverlapTileInput> = {},
): GapOverlapTileInput => ({ x0, y0, x1, y1, tx: 0, ty: 0, angleDeg: 0, ...extra });

/** Count cells by coverage bucket. */
function tally(counts: Uint8Array) {
  let zero = 0,
    one = 0,
    multi = 0;
  for (const c of counts) {
    if (c === 0) zero++;
    else if (c === 1) one++;
    else multi++;
  }
  return { zero, one, multi };
}

describe("computeGapOverlapMask — coverage counting", () => {
  it("two flush tiles → every cell covered exactly once", () => {
    const mask = computeGapOverlapMask(
      [tile(0, 0, 40, 40), tile(40, 0, 80, 40)],
      4,
    )!;
    expect(mask).not.toBeNull();
    const { zero, multi } = tally(mask.counts);
    expect(zero).toBe(0);
    expect(multi).toBe(0);
    expect(mask.w).toBe(20); // 80 px / 4 px cells
    expect(mask.h).toBe(10);
  });

  it("overlapping tiles → cells in the intersection count ≥ 2", () => {
    // Tiles 0..40 and 20..60 overlap on x 20..40.
    const mask = computeGapOverlapMask(
      [tile(0, 0, 40, 40), tile(20, 0, 60, 40)],
      4,
    )!;
    const { zero, multi } = tally(mask.counts);
    expect(zero).toBe(0);
    // Overlap band is 20 px wide × 40 px tall = 5 × 10 cells.
    expect(multi).toBe(50);
  });

  it("gapped tiles → cells in the gap count 0", () => {
    // Tiles 0..40 and 60..100 leave a 20 px empty band.
    const mask = computeGapOverlapMask(
      [tile(0, 0, 40, 40), tile(60, 0, 100, 40)],
      4,
    )!;
    const { zero, multi } = tally(mask.counts);
    expect(multi).toBe(0);
    expect(zero).toBe(50); // 20 px × 40 px = 5 × 10 cells
  });

  it("puzzle translation (tx/ty) shifts the footprint", () => {
    // Same base rects as the flush case, but the second tile is pushed
    // +20 px right by its transform → creates a 20 px gap.
    const mask = computeGapOverlapMask(
      [tile(0, 0, 40, 40), tile(40, 0, 80, 40, { tx: 20 })],
      4,
    )!;
    expect(tally(mask.counts).zero).toBe(50);
  });

  it("rotation: a 90°-rotated non-square tile covers its rotated footprint", () => {
    // 40×20 rect centred at (20,10); rotated 90° it occupies x 10..30, y −10..30.
    const mask = computeGapOverlapMask([tile(0, 0, 40, 20, { angleDeg: 90 })], 4)!;
    // Union bbox equals the rotated extents: w = 20 px, h = 40 px.
    expect(mask.x0).toBeCloseTo(10, 6);
    expect(mask.y0).toBeCloseTo(-10, 6);
    expect(mask.w).toBe(5);
    expect(mask.h).toBe(10);
    // Every cell centre inside the rotated rect → fully covered, no gaps.
    expect(tally(mask.counts).zero).toBe(0);
  });

  it("returns null for empty input or non-positive step", () => {
    expect(computeGapOverlapMask([], 4)).toBeNull();
    expect(computeGapOverlapMask([tile(0, 0, 10, 10)], 0)).toBeNull();
  });

  it("returns null when the raster would exceed the cell budget", () => {
    expect(computeGapOverlapMask([tile(0, 0, 10_000, 10_000)], 1, 1000)).toBeNull();
  });

  it("default step constant is the ¼-resolution 4 px", () => {
    expect(GAP_OVERLAP_STEP_PX).toBe(4);
  });
});

describe("drawGapOverlap", () => {
  function makeCtx() {
    const fills: Array<{ style: string; x: number; y: number }> = [];
    let fillStyle = "";
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: (x: number, y: number) => {
        fills.push({ style: fillStyle, x, y });
      },
      set fillStyle(v: string) {
        fillStyle = v;
      },
      get fillStyle() {
        return fillStyle;
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
  }

  it("hatches gaps in red and fills overlaps in orange — never both for one cell", () => {
    // 3-cell strip: counts [0, 1, 2].
    const mask = {
      counts: new Uint8Array([0, 1, 2]),
      w: 3,
      h: 1,
      x0: 0,
      y0: 0,
      step: 4,
    };
    const { ctx, fills } = makeCtx();
    drawGapOverlap(ctx, mask);
    const red = fills.filter((f) => f.style.includes("255, 60, 60"));
    const orange = fills.filter((f) => f.style.includes("255, 165, 0"));
    // Gap cell (index 0, hatch pattern includes cell (0,0) since (0+0)&3 < 2).
    expect(red).toHaveLength(1);
    expect(red[0]).toMatchObject({ x: 0, y: 0 });
    // Overlap cell at index 2 → canvas x = 8.
    expect(orange).toHaveLength(1);
    expect(orange[0]).toMatchObject({ x: 8, y: 0 });
    // The singly-covered cell (x = 4) is never painted.
    expect(fills.some((f) => f.x === 4)).toBe(false);
  });

  it("hatch pattern paints roughly half the gap cells (diagonal stripes)", () => {
    const mask = {
      counts: new Uint8Array(64), // all zero → all gaps
      w: 8,
      h: 8,
      x0: 0,
      y0: 0,
      step: 4,
    };
    const { ctx, fills } = makeCtx();
    drawGapOverlap(ctx, mask);
    expect(fills.length).toBe(32); // ((ix+iy)&3) < 2 → exactly half
  });
});
