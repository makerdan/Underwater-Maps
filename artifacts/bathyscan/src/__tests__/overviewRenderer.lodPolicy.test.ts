/**
 * Regression tests for the polygon LOD (level-of-detail) zoom threshold.
 *
 * OverviewMap.tsx gates renderEfhOverlay and renderSubstrateOverlay behind
 * shouldDrawOverlayAtScale() (from overviewRenderer.ts) so polygon layers are
 * suppressed when the canvas is zoomed out too far to read individual polygons.
 *
 * The renderer functions themselves do not perform the check — the gate is
 * applied by the caller via shouldDrawOverlayAtScale(). These tests verify:
 *   1. POLYGON_LOD_MIN_ZOOM is exactly 1.5 (the agreed-upon threshold).
 *   2. shouldDrawOverlayAtScale (the production gate function) returns false
 *      below the threshold and true at/above it.
 *   3. The spy-based tests demonstrate that renderEfhOverlay's draw calls are
 *      suppressed when shouldDrawOverlayAtScale returns false (beginPath never
 *      fires below the threshold) and proceed when it returns true.
 *
 * shouldDrawOverlayAtScale is imported from the production overviewRenderer.ts
 * so any change to the gate function is caught here immediately.
 */

import { describe, it, expect, vi } from "vitest";
import type { OverviewTransform } from "../lib/overviewRenderer";
import {
  POLYGON_LOD_MIN_ZOOM,
  shouldDrawOverlayAtScale,
  renderEfhOverlay,
} from "../lib/overviewRenderer";
import { EfhFeatureType } from "@workspace/api-client-react";
import type { EfhFeature, TerrainData } from "@workspace/api-client-react";

vi.mock("three");

function makeGrid(): TerrainData {
  return {
    width: 4, height: 4,
    depths: Array(16).fill(50) as number[],
    minDepth: 0, maxDepth: 100,
    minLon: -120, maxLon: -119,
    minLat: 47, maxLat: 48,
    datasetId: "test",
  } as TerrainData;
}

function makeTransform(scale: number): OverviewTransform {
  return { scale, offsetX: 0, offsetY: 0, pxPerDeg: 200 };
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
    measureText: vi.fn(() => ({ width: 50 })),
    roundRect: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
  };
}

function makePolygon(): EfhFeature {
  return {
    type: EfhFeatureType.Feature,
    properties: {
      species: "test_sp", commonName: "Pollock",
      fmp: "Test", depthRangeM: [0, 100],
      habitatDescription: "Test", source: "test",
      creditUrl: "https://example.com", color: "#00e5ff",
    },
    geometry: {
      type: "Polygon",
      coordinates: [[[-119.8, 47.2], [-119.6, 47.2], [-119.6, 47.4], [-119.8, 47.2]]],
    },
  };
}

describe("POLYGON_LOD_MIN_ZOOM — constant value", () => {
  it("is exactly 1.5", () => {
    expect(POLYGON_LOD_MIN_ZOOM).toBe(1.5);
  });
});

describe("shouldDrawOverlayAtScale — production LOD gate", () => {
  it("returns false at scale 0 (fully zoomed out)", () => {
    expect(shouldDrawOverlayAtScale(0)).toBe(false);
  });

  it("returns false at scale 1 (initial fit)", () => {
    expect(shouldDrawOverlayAtScale(1)).toBe(false);
  });

  it("returns false at scale 1.49 (just below threshold)", () => {
    expect(shouldDrawOverlayAtScale(1.49)).toBe(false);
  });

  it("returns true at exactly the threshold (scale = 1.5)", () => {
    expect(shouldDrawOverlayAtScale(POLYGON_LOD_MIN_ZOOM)).toBe(true);
  });

  it("returns true at scale 2 (zoomed in)", () => {
    expect(shouldDrawOverlayAtScale(2)).toBe(true);
  });

  it("returns true at scale 10 (heavily zoomed in)", () => {
    expect(shouldDrawOverlayAtScale(10)).toBe(true);
  });
});

describe("LOD gate — renderEfhOverlay draw call suppression", () => {
  const grid = makeGrid();
  const features = [makePolygon()];

  it("beginPath is NOT called when production LOD gate returns false at scale 1.0", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const t = makeTransform(1.0);
    if (shouldDrawOverlayAtScale(t.scale)) {
      renderEfhOverlay(ctx, features, grid, t);
    }
    expect((ctx.beginPath as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("beginPath is NOT called when production LOD gate returns false at scale 1.49", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const t = makeTransform(1.49);
    if (shouldDrawOverlayAtScale(t.scale)) {
      renderEfhOverlay(ctx, features, grid, t);
    }
    expect((ctx.beginPath as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("beginPath IS called when production LOD gate returns true at scale = POLYGON_LOD_MIN_ZOOM", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const t = makeTransform(POLYGON_LOD_MIN_ZOOM);
    if (shouldDrawOverlayAtScale(t.scale)) {
      renderEfhOverlay(ctx, features, grid, t);
    }
    expect((ctx.beginPath as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it("beginPath IS called when production LOD gate returns true at scale 3", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const t = makeTransform(3);
    if (shouldDrawOverlayAtScale(t.scale)) {
      renderEfhOverlay(ctx, features, grid, t);
    }
    expect((ctx.beginPath as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it("multiple features only draw when gate is open — gate applies globally, not per-feature", () => {
    const twoFeatures = [makePolygon(), makePolygon()];

    const ctxBelow = makeCtx() as unknown as CanvasRenderingContext2D;
    const tBelow = makeTransform(1.0);
    if (shouldDrawOverlayAtScale(tBelow.scale)) renderEfhOverlay(ctxBelow, twoFeatures, grid, tBelow);
    expect((ctxBelow.beginPath as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    const ctxAbove = makeCtx() as unknown as CanvasRenderingContext2D;
    const tAbove = makeTransform(2.0);
    if (shouldDrawOverlayAtScale(tAbove.scale)) renderEfhOverlay(ctxAbove, twoFeatures, grid, tAbove);
    expect((ctxAbove.beginPath as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});
