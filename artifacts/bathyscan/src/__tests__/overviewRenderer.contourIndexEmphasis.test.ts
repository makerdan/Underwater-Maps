/**
 * overviewRenderer.contourIndexEmphasis.test.ts
 *
 * Regression guard for the MOBILE-ONLY index-contour emphasis added to
 * renderContourLines for the mobile Chart View's density stepper:
 *
 *   1. DESKTOP UNCHANGED — without the opts bag, every contour level draws
 *      with the legacy uniform lineWidth / 0.65 alpha, and labels follow the
 *      legacy zoom gate (scale ≥ 2, every level). If index behaviour ever
 *      leaks into the default path, these tests fail.
 *   2. MOBILE EMPHASIS — with { indexIntervalMetres }, every 5th level
 *      (multiples of 5 × interval) draws heavier/more opaque and is the ONLY
 *      labeled level, at any zoom.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildContourLines,
  renderContourLines,
  type OverviewTransform,
} from "../lib/overviewRenderer";
import type { TerrainData } from "../lib/terrain";
import { usePaletteStore } from "../lib/paletteStore";

// Shared stub — implementations live in src/__tests__/mocks/three.ts,
// wired via __mocks__/three.ts so no factory is needed here.
vi.mock("three");

// 2×2 grid spanning depths 0→60 m: with a 10 m interval, buildContourLines
// yields levels 10..50, and 50 is the single index level (5 × 10 m).
function makeGrid(): TerrainData {
  return {
    width: 2,
    height: 2,
    depths: [0, 0, 60, 60],
    minDepth: 0,
    maxDepth: 60,
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
    datasetId: "test",
  } as TerrainData;
}

function makeTransform(scale: number): OverviewTransform {
  return { scale, offsetX: 0, offsetY: 0, pxPerDeg: 200 };
}

/**
 * Canvas-2D mock that records, for every stroke(), the lineWidth/globalAlpha
 * in effect at call time, and every fillText() label string.
 */
function makeRecordingCtx() {
  const strokes: Array<{ lineWidth: number; alpha: number }> = [];
  const labels: string[] = [];
  const ctx = {
    canvas: { width: 400, height: 400 },
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    shadowColor: "",
    shadowBlur: 0,
    lineWidth: 1,
    font: "",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    measureText: vi.fn(() => ({ width: 50 })),
    roundRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    stroke: vi.fn(function (this: void) {
      strokes.push({ lineWidth: ctx.lineWidth, alpha: ctx.globalAlpha });
    }),
    fillText: vi.fn((text: string) => {
      labels.push(text);
    }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes, labels };
}

const INTERVAL = 10; // metres

beforeEach(() => {
  usePaletteStore.getState().reset();
});

describe("renderContourLines — legacy desktop path (no opts) is unchanged", () => {
  it("draws every level with one uniform lineWidth and 0.65 alpha", () => {
    const grid = makeGrid();
    const segments = buildContourLines(grid, INTERVAL);
    expect(segments.length).toBeGreaterThan(0);

    const { ctx, strokes } = makeRecordingCtx();
    renderContourLines(ctx, segments, grid, makeTransform(1), "metric", "ocean");

    expect(strokes.length).toBeGreaterThan(1); // one batch per depth level
    const legacyLineW = Math.max(0.5, Math.min(1.5, 1 * 0.5)); // t.scale = 1
    for (const s of strokes) {
      expect(s.lineWidth).toBe(legacyLineW);
      expect(s.alpha).toBe(0.65);
    }
  });

  it("keeps the legacy zoom gate: no labels below scale 2, labels on EVERY level at scale 2", () => {
    const grid = makeGrid();
    const segments = buildContourLines(grid, INTERVAL);
    const depths = [...new Set(segments.map((s) => s.depth))];

    const zoomedOut = makeRecordingCtx();
    renderContourLines(zoomedOut.ctx, segments, grid, makeTransform(1), "metric", "ocean");
    expect(zoomedOut.labels).toEqual([]);

    const zoomedIn = makeRecordingCtx();
    renderContourLines(zoomedIn.ctx, segments, grid, makeTransform(2), "metric", "ocean");
    // Legacy behaviour: non-index levels are labeled too (e.g. 10 m).
    const labeledDepths = new Set(zoomedIn.labels);
    expect(labeledDepths.size).toBeGreaterThanOrEqual(depths.length);
    expect(zoomedIn.labels.some((l) => l.startsWith("10"))).toBe(true);
  });
});

describe("renderContourLines — MOBILE-ONLY index emphasis via opts", () => {
  it("index levels (multiples of 5×interval) draw heavier and more opaque than regular levels", () => {
    const grid = makeGrid();
    const segments = buildContourLines(grid, INTERVAL);
    const depths = [...new Set(segments.map((s) => s.depth))].sort((a, b) => a - b);
    expect(depths).toContain(50); // the index level

    const { ctx, strokes } = makeRecordingCtx();
    renderContourLines(ctx, segments, grid, makeTransform(1), "metric", "ocean", undefined, {
      indexIntervalMetres: INTERVAL,
    });

    const legacyLineW = Math.max(0.5, Math.min(1.5, 1 * 0.5));
    // One stroke batch per depth level, in map iteration order — pair them up.
    expect(strokes.length).toBe(depths.length ? new Set(segments.map((s) => s.depth)).size : 0);
    const byOrder = [...new Set(segments.map((s) => s.depth))];
    const indexStrokes = strokes.filter((_, i) => byOrder[i] === 50);
    const regularStrokes = strokes.filter((_, i) => byOrder[i] !== 50);

    expect(indexStrokes).toHaveLength(1);
    expect(regularStrokes.length).toBeGreaterThan(0);
    for (const s of indexStrokes) {
      expect(s.lineWidth).toBeGreaterThan(legacyLineW);
      expect(s.alpha).toBe(0.85);
    }
    for (const s of regularStrokes) {
      expect(s.lineWidth).toBe(legacyLineW);
      expect(s.alpha).toBe(0.65);
    }
  });

  it("labels ONLY the index level, even below the legacy zoom gate", () => {
    const grid = makeGrid();
    const segments = buildContourLines(grid, INTERVAL);

    const { ctx, labels } = makeRecordingCtx();
    renderContourLines(ctx, segments, grid, makeTransform(1), "metric", "ocean", undefined, {
      indexIntervalMetres: INTERVAL,
    });

    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.startsWith("50")).toBe(true);
    }
  });

  it("an undefined/non-positive indexIntervalMetres behaves exactly like the legacy path", () => {
    const grid = makeGrid();
    const segments = buildContourLines(grid, INTERVAL);

    const withEmpty = makeRecordingCtx();
    renderContourLines(
      withEmpty.ctx, segments, grid, makeTransform(1), "metric", "ocean", undefined, {},
    );
    const legacy = makeRecordingCtx();
    renderContourLines(legacy.ctx, segments, grid, makeTransform(1), "metric", "ocean");

    expect(withEmpty.strokes).toEqual(legacy.strokes);
    expect(withEmpty.labels).toEqual(legacy.labels);
  });
});
