/**
 * Regression tests for renderEfhLegend + hitTestEfhLegend.
 *
 * KEY DESIGN PRINCIPLE: Click coordinates for hit-test assertions are computed
 * INDEPENDENTLY from the constants in overviewRenderer.ts, NOT derived from
 * layout.rows[i].rect. This means that if renderEfhLegend produces wrong rect
 * geometry (row height, y-offset, padding drift), the tests will fail even if
 * hitTestEfhLegend internally uses the same wrong layout — because the expected
 * coordinates and the actual rect will disagree in the geometry assertions, and
 * the hit-test with the hardcoded coords will return null or the wrong key.
 *
 * Constants mirrored from overviewRenderer.ts (keep in sync if they change):
 *   PAD=8  SWATCH=9  ROW_H=14  HEADER_H=14  FONT_SIZE=9
 *
 * Test canvas: cW=400, cH=300. measureText stub always returns width=50.
 *   maxW    = 50
 *   headerW = 50 (measureText("EFH SPECIES"))
 *   boxW    = PAD*2 + SWATCH + 6 + max(50,50) = 16 + 9 + 6 + 50 = 81
 *   boxH(2) = PAD*2 + HEADER_H + 2*ROW_H = 16 + 14 + 28 = 58
 *   x       = cW - boxW - 8 = 400 - 81 - 8 = 311
 *   y       = cH - boxH - 30 = 300 - 58 - 30 = 212
 *
 *   row0 rowY = y + PAD + HEADER_H = 212 + 8 + 14 = 234
 *   row0 rect = [x+2, rowY, boxW-4, ROW_H] = [313, 234, 77, 14]
 *
 *   row1 rowY = row0.rowY + ROW_H = 234 + 14 = 248
 *   row1 rect = [313, 248, 77, 14]
 */

import { describe, it, expect, vi } from "vitest";
import {
  renderEfhLegend,
  hitTestEfhLegend,
} from "../lib/overviewRenderer";
import { EfhFeatureType } from "@workspace/api-client-react";
import type { EfhFeature } from "@workspace/api-client-react";

vi.mock("three");

const CW = 400;
const CH = 300;

// ---- Constants mirrored from overviewRenderer.ts ----
const PAD = 8;
const SWATCH = 9;
const ROW_H = 14;
const HEADER_H = 14;
const MEASURE_TEXT_W = 50;

function expectedLayout(numSpecies: number): {
  x: number; y: number; boxW: number; boxH: number;
  row: (i: number) => { x: number; y: number; w: number; h: number; rowY: number };
} {
  const boxW = PAD * 2 + SWATCH + 6 + MEASURE_TEXT_W; // 81
  const boxH = PAD * 2 + HEADER_H + numSpecies * ROW_H;
  const x = CW - boxW - 8;
  const y = CH - boxH - 30;
  return {
    x, y, boxW, boxH,
    row(i: number) {
      const rowY = y + PAD + HEADER_H + i * ROW_H;
      return { x: x + 2, y: rowY, w: boxW - 4, h: ROW_H, rowY };
    },
  };
}

function makeCtx() {
  return {
    save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    arc: vi.fn(), fillText: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    setLineDash: vi.fn(), fillStyle: "", strokeStyle: "",
    shadowColor: "", shadowBlur: 0, lineWidth: 1,
    font: "", textBaseline: "alphabetic" as CanvasTextBaseline,
    globalAlpha: 1, imageSmoothingEnabled: true,
    measureText: vi.fn(() => ({ width: MEASURE_TEXT_W })),
    roundRect: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
  };
}

function makeFeature(commonName: string, color = "#00e5ff"): EfhFeature {
  return {
    type: EfhFeatureType.Feature,
    properties: {
      species: commonName.toLowerCase().replace(/ /g, "_"),
      commonName,
      fmp: "Test",
      depthRangeM: [0, 100],
      habitatDescription: "Test",
      source: "test",
      creditUrl: "https://example.com",
      color,
    },
    geometry: {
      type: "Polygon",
      coordinates: [[[-119.8, 47.2], [-119.6, 47.2], [-119.6, 47.4], [-119.8, 47.2]]],
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry-anchored assertions
// These are the critical tests: row.rect must match independently-derived
// expected coordinates. If renderEfhLegend drifts (wrong y-offset, wrong
// height), these assertions catch the drift before it silently breaks clicking.
// ---------------------------------------------------------------------------

describe("renderEfhLegend — rect geometry pinned to known constants", () => {
  it("returns null for empty features", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    expect(renderEfhLegend(ctx, [], CW, CH)).toBeNull();
  });

  it("row 0 rect matches independently-computed [x, rowY, boxW-4, ROW_H]", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const exp = expectedLayout(2);
    const r0 = exp.row(0);
    expect(layout!.rows[0]!.rect).toEqual([r0.x, r0.y, r0.w, r0.h]);
  });

  it("row 1 rect is exactly ROW_H below row 0 rect (no gap, no overlap)", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const exp = expectedLayout(2);
    const r1 = exp.row(1);
    expect(layout!.rows[1]!.rect).toEqual([r1.x, r1.y, r1.w, r1.h]);
  });

  it("box y-offset places box above the bottom edge by exactly 30px", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock")], CW, CH);
    const [, by, , bh] = layout!.box;
    expect(by + bh).toBe(CH - 30);
  });

  it("box right edge is exactly 8px from canvas right edge", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock")], CW, CH);
    const [bx, , bw] = layout!.box;
    expect(bx + bw).toBe(CW - 8);
  });

  it("row rect width equals boxW - 4 (2px inset on each side)", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const [, , bw] = layout!.box;
    expect(layout!.rows[0]!.rect[2]).toBe(bw - 4);
    expect(layout!.rows[1]!.rect[2]).toBe(bw - 4);
  });

  it("row rect height equals ROW_H (14px)", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    expect(layout!.rows[0]!.rect[3]).toBe(14);
    expect(layout!.rows[1]!.rect[3]).toBe(14);
  });

  it("first row y-offset equals box.y + PAD + HEADER_H (= y+22)", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const [, by] = layout!.box;
    expect(layout!.rows[0]!.rect[1]).toBe(by + PAD + HEADER_H);
  });

  it("deduplicates features with the same commonName — still one row", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(
      ctx,
      [makeFeature("Pollock"), makeFeature("Pollock"), makeFeature("Pollock")],
      CW, CH,
    );
    expect(layout!.rows).toHaveLength(1);
  });

  it("preserves first-seen order with three species", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(
      ctx,
      [makeFeature("Pollock"), makeFeature("Halibut"), makeFeature("Cod")],
      CW, CH,
    );
    expect(layout!.rows.map(r => r.key)).toEqual(["Pollock", "Halibut", "Cod"]);
  });

  it("hiddenSpecies does NOT change row rect geometry", () => {
    const ctx1 = makeCtx() as unknown as CanvasRenderingContext2D;
    const ctx2 = makeCtx() as unknown as CanvasRenderingContext2D;
    const features = [makeFeature("Pollock"), makeFeature("Halibut")];
    const normal = renderEfhLegend(ctx1, features, CW, CH);
    const hidden = renderEfhLegend(ctx2, features, CW, CH, new Set(["Pollock"]));
    expect(hidden!.rows[0]!.rect).toEqual(normal!.rows[0]!.rect);
    expect(hidden!.rows[1]!.rect).toEqual(normal!.rows[1]!.rect);
  });
});

// ---------------------------------------------------------------------------
// Hit-test assertions using hardcoded expected coordinates
// Clicks are computed from the independently-derived layout constants, NOT
// from layout.rows[i].rect. A drift in renderEfhLegend's rect output causes
// the geometry assertions above to fail AND the hit-tests below to return null
// or the wrong key when real painted rows are elsewhere.
// ---------------------------------------------------------------------------

describe("hitTestEfhLegend — coordinates anchored independently of layout.rows", () => {
  it("returns null for null layout", () => {
    expect(hitTestEfhLegend(100, 100, null)).toBeNull();
  });

  it("returns null for a click at canvas origin (0, 0)", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    expect(hitTestEfhLegend(0, 0, layout)).toBeNull();
  });

  it("returns 'Pollock' for a click at the center of the independently-computed row 0 rect", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const exp = expectedLayout(2);
    const r0 = exp.row(0);
    // Click at center of row 0 — coordinates computed from constants, not from layout.rows
    const cx = r0.x + r0.w / 2;
    const cy = r0.y + r0.h / 2;
    expect(hitTestEfhLegend(cx, cy, layout)).toBe("Pollock");
  });

  it("returns 'Halibut' for a click at the center of the independently-computed row 1 rect", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const exp = expectedLayout(2);
    const r1 = exp.row(1);
    const cx = r1.x + r1.w / 2;
    const cy = r1.y + r1.h / 2;
    expect(hitTestEfhLegend(cx, cy, layout)).toBe("Halibut");
  });

  it("returns 'Pollock' at the top-left corner of the independently-computed row 0 rect", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const exp = expectedLayout(2);
    const r0 = exp.row(0);
    expect(hitTestEfhLegend(r0.x, r0.y, layout)).toBe("Pollock");
  });

  it("returns 'Halibut' at the bottom-right corner of the independently-computed row 1 rect", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const exp = expectedLayout(2);
    const r1 = exp.row(1);
    expect(hitTestEfhLegend(r1.x + r1.w, r1.y + r1.h, layout)).toBe("Halibut");
  });

  it("returns null for a click 1px above the independently-computed row 0 top edge", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const exp = expectedLayout(2);
    const r0 = exp.row(0);
    expect(hitTestEfhLegend(r0.x + r0.w / 2, r0.y - 1, layout)).toBeNull();
  });

  it("returns null for a click 1px below the independently-computed last row bottom edge", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const exp = expectedLayout(2);
    const r1 = exp.row(1);
    expect(hitTestEfhLegend(r1.x + r1.w / 2, r1.y + r1.h + 1, layout)).toBeNull();
  });

  it("returns null for a click 1px to the left of the independently-computed row 0 left edge", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const exp = expectedLayout(2);
    const r0 = exp.row(0);
    expect(hitTestEfhLegend(r0.x - 1, r0.y + r0.h / 2, layout)).toBeNull();
  });

  it("returns null for a click 1px to the right of the independently-computed row 0 right edge", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const exp = expectedLayout(2);
    const r0 = exp.row(0);
    expect(hitTestEfhLegend(r0.x + r0.w + 1, r0.y + r0.h / 2, layout)).toBeNull();
  });

  it("returns null for a click in the header area (between box top and first row)", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(ctx, [makeFeature("Pollock"), makeFeature("Halibut")], CW, CH);
    const exp = expectedLayout(2);
    // Header area: y+1 to y+PAD+HEADER_H-1 (before row 0 starts)
    const headerClickY = exp.y + 1;
    const headerClickX = exp.x + exp.boxW / 2;
    expect(hitTestEfhLegend(headerClickX, headerClickY, layout)).toBeNull();
  });

  it("returns 'Cod' for the independently-computed row 2 in a 3-species layout", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(
      ctx,
      [makeFeature("Pollock"), makeFeature("Halibut"), makeFeature("Cod")],
      CW, CH,
    );
    const exp = expectedLayout(3);
    const r2 = exp.row(2);
    expect(hitTestEfhLegend(r2.x + r2.w / 2, r2.y + r2.h / 2, layout)).toBe("Cod");
  });

  it("hit-test still works when hiddenSpecies dims row 0 (geometry unchanged)", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const layout = renderEfhLegend(
      ctx,
      [makeFeature("Pollock"), makeFeature("Halibut")],
      CW, CH,
      new Set(["Pollock"]),
    );
    const exp = expectedLayout(2);
    const r0 = exp.row(0);
    expect(hitTestEfhLegend(r0.x + r0.w / 2, r0.y + r0.h / 2, layout)).toBe("Pollock");
  });
});
