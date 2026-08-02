/**
 * Unit tests for drawMinimapContours — guards that palette/theme changes
 * which silently break the minimap contour isolines are caught in CI.
 *
 * Pure logic test (no React, no browser canvas): uses a mock 2D context.
 * Runs in the fast tier.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { drawMinimapContours } from "@/components/Minimap";
import { usePaletteStore, DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS } from "@/lib/paletteStore";
import type { DepthsArray } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Mock canvas 2D context — only the methods drawMinimapContours touches.
// ---------------------------------------------------------------------------
function makeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    lineWidth: 0,
    strokeStyle: "",
    globalAlpha: 1,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// Synthetic depth grid: 8×8, depths ramping from minDepth to maxDepth.
// Neighbours on adjacent rows/columns will straddle every contour boundary.
// ---------------------------------------------------------------------------
function makeDepths(w: number, h: number, minD: number, maxD: number): DepthsArray {
  const arr: number[] = [];
  const range = maxD - minD || 1;
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      arr.push(minD + ((gy * w + gx) / (w * h - 1)) * range);
    }
  }
  return arr as unknown as DepthsArray;
}

// ---------------------------------------------------------------------------
// Helper: count how many unique depth-contour strokes would be expected for
// ocean/custom themes given the active paletteStore state and depth range.
//
// Mirrors the interior-boundary logic in drawMinimapContours so the test
// stays in lockstep with the implementation.
// ---------------------------------------------------------------------------
const MINIMAP_FT_TO_M = 0.3048;

function expectedOceanContourCount(
  bandBoundaries: readonly number[],
  minDepth: number,
  maxDepth: number,
): number {
  let count = 0;
  for (let i = 1; i < bandBoundaries.length - 1; i++) {
    const depthM = bandBoundaries[i]! * MINIMAP_FT_TO_M;
    if (depthM > minDepth && depthM < maxDepth) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("drawMinimapContours — early-exit guards", () => {
  beforeEach(() => {
    usePaletteStore.getState().reset();
  });

  it("calls stroke() zero times when width < 4", () => {
    const ctx = makeCtx();
    const depths = makeDepths(3, 8, 0, 200);
    drawMinimapContours(ctx, depths, 3, 8, 0, 200, "ocean",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it("calls stroke() zero times when height < 4", () => {
    const ctx = makeCtx();
    const depths = makeDepths(8, 3, 0, 200);
    drawMinimapContours(ctx, depths, 8, 3, 0, 200, "ocean",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it("calls stroke() zero times when depth range is flat (minDepth === maxDepth)", () => {
    const ctx = makeCtx();
    const depths = makeDepths(8, 8, 50, 50);
    drawMinimapContours(ctx, depths, 8, 8, 50, 50, "ocean",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});

describe("drawMinimapContours — ocean theme", () => {
  beforeEach(() => {
    usePaletteStore.getState().reset();
  });

  it("calls stroke() once per interior band boundary that falls within the depth range", () => {
    const ctx = makeCtx();
    // minDepth = 0, maxDepth = 200 m → all interior DEFAULT_BAND_BOUNDARIES
    // that convert to < 200 m are included.
    const minDepth = 0;
    const maxDepth = 200;
    const depths = makeDepths(8, 8, minDepth, maxDepth);

    drawMinimapContours(ctx, depths, 8, 8, minDepth, maxDepth, "ocean",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);

    const expected = expectedOceanContourCount(DEFAULT_BAND_BOUNDARIES, minDepth, maxDepth);
    // Sanity-check our expectation against the real default boundaries:
    // 50..600 ft in metres are all < 200 m, so all 9 interior boundaries qualify.
    expect(expected).toBeGreaterThan(0);
    expect(ctx.stroke).toHaveBeenCalledTimes(expected);
  });

  it("skips boundaries that lie outside the depth range (very shallow dataset)", () => {
    const ctx = makeCtx();
    // maxDepth = 10 m — only boundaries below 10 m are drawn.
    const minDepth = 0;
    const maxDepth = 10;
    const depths = makeDepths(8, 8, minDepth, maxDepth);

    drawMinimapContours(ctx, depths, 8, 8, minDepth, maxDepth, "ocean",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);

    const expected = expectedOceanContourCount(DEFAULT_BAND_BOUNDARIES, minDepth, maxDepth);
    // 50 ft = 15.24 m > 10 m → no boundary qualifies → 0 strokes.
    expect(expected).toBe(0);
    expect(ctx.stroke).toHaveBeenCalledTimes(0);
  });

  it("stroke() count matches when a custom 3-band palette is active", () => {
    const ctx = makeCtx();
    // 3 bands: [0, 30, 60, 120] ft
    const customBoundaries = [0, 30, 60, 120] as const;
    const customColors = ["#00e5ff", "#0288d1", "#0d47a1"] as const;
    const minDepth = 0;
    const maxDepth = 50; // 50 m > 60 ft (18.3 m) so all interior boundaries qualify
    const depths = makeDepths(8, 8, minDepth, maxDepth);

    drawMinimapContours(ctx, depths, 8, 8, minDepth, maxDepth, "ocean",
      customBoundaries, customColors);

    const expected = expectedOceanContourCount(customBoundaries, minDepth, maxDepth);
    // Interior boundaries: 30 ft = 9.14 m < 50 m ✓, 60 ft = 18.3 m < 50 m ✓ → 2
    expect(expected).toBe(2);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });
});

describe("drawMinimapContours — custom theme", () => {
  beforeEach(() => {
    usePaletteStore.getState().reset();
  });

  it("behaves identically to ocean theme (same boundary/color path)", () => {
    const ctxOcean = makeCtx();
    const ctxCustom = makeCtx();
    const minDepth = 0;
    const maxDepth = 200;
    const depths = makeDepths(8, 8, minDepth, maxDepth);

    drawMinimapContours(ctxOcean, depths, 8, 8, minDepth, maxDepth, "ocean",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);
    drawMinimapContours(ctxCustom, depths, 8, 8, minDepth, maxDepth, "custom",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);

    expect(ctxCustom.stroke).toHaveBeenCalledTimes(ctxOcean.stroke.mock.calls.length);
  });
});

describe("drawMinimapContours — fixed preset themes", () => {
  beforeEach(() => {
    usePaletteStore.getState().reset();
  });

  it("thermal: calls stroke() for each interior color stop (3 interior stops → 3 strokes)", () => {
    const ctx = makeCtx();
    // thermal stops: t=0, 0.25, 0.55, 0.80, 1.0 → interior: t=0.25, 0.55, 0.80
    // depthM = minDepth + t * (maxDepth - minDepth) → always strictly between min & max
    const minDepth = 0;
    const maxDepth = 100;
    const depths = makeDepths(8, 8, minDepth, maxDepth);

    drawMinimapContours(ctx, depths, 8, 8, minDepth, maxDepth, "thermal",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);

    // 3 interior stops for thermal
    expect(ctx.stroke).toHaveBeenCalledTimes(3);
  });

  it("grayscale: only 2 stops (t=0 and t=1) → 0 interior stops → 0 strokes", () => {
    const ctx = makeCtx();
    const minDepth = 0;
    const maxDepth = 100;
    const depths = makeDepths(8, 8, minDepth, maxDepth);

    drawMinimapContours(ctx, depths, 8, 8, minDepth, maxDepth, "grayscale",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);

    // grayscale has t=0 and t=1 only → no interior stops
    expect(ctx.stroke).toHaveBeenCalledTimes(0);
  });

  it("viridis: 5 stops (t=0, 0.25, 0.50, 0.75, 1.0) → 3 interior → 3 strokes", () => {
    const ctx = makeCtx();
    const minDepth = 0;
    const maxDepth = 100;
    const depths = makeDepths(8, 8, minDepth, maxDepth);

    drawMinimapContours(ctx, depths, 8, 8, minDepth, maxDepth, "viridis",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);

    expect(ctx.stroke).toHaveBeenCalledTimes(3);
  });

  it("freshwater: 5 stops (t=0, 0.20, 0.50, 0.75, 1.0) → 3 interior → 3 strokes", () => {
    const ctx = makeCtx();
    const minDepth = 0;
    const maxDepth = 100;
    const depths = makeDepths(8, 8, minDepth, maxDepth);

    drawMinimapContours(ctx, depths, 8, 8, minDepth, maxDepth, "freshwater",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);

    expect(ctx.stroke).toHaveBeenCalledTimes(3);
  });

  it("thermal stroke count changes if FIXED_THEME_STOPS gains or loses an interior stop", () => {
    // This test is the canary: if a future refactor adds/removes interior
    // thermal stops without updating this test, it will fail immediately.
    const ctx = makeCtx();
    const depths = makeDepths(8, 8, 0, 100);

    drawMinimapContours(ctx, depths, 8, 8, 0, 100, "thermal",
      DEFAULT_BAND_BOUNDARIES, DEFAULT_BAND_COLORS);

    // Locked expectation: thermal has exactly 3 interior stops.
    expect(ctx.stroke).toHaveBeenCalledTimes(3);
  });
});
