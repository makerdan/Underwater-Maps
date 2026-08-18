/**
 * Unit tests for the special-collection background image overlay math in
 * overviewRenderer:
 *
 *   1. computeBgAnchorAffine — identity, scale, rotation, and translation
 *      cases derived from two geo-anchor pairs; degenerate inputs → null.
 *   2. computeBgFallbackRect — union-bbox stretch placement.
 *   3. drawBackgroundImage — anchor path uses ctx.transform + drawImage(0,0);
 *      fallback path draws into the union rect; opacity via globalAlpha;
 *      no draw at opacity 0.
 *
 * jsdom has no canvas — the ctx is a plain recording stub.
 */
import { describe, it, expect, vi } from "vitest";
import {
  computeBgAnchorAffine,
  computeBgFallbackRect,
  drawBackgroundImage,
  lonLatToCanvas,
  type BgGeoAnchorPoint,
  type OverviewTransform,
} from "../overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";

// World grid spanning lon 0..10, lat 0..10; identity-ish transform where
// 1 degree = 10 canvas px → canvas 100×100, lat 10 at y=0 (north-up).
const GRID = { minLon: 0, maxLon: 10, minLat: 0, maxLat: 10 } as unknown as TerrainData;
const T: OverviewTransform = { scale: 1, offsetX: 0, offsetY: 0, pxPerDeg: 10 };

const anchor = (imgX: number, imgY: number, lon: number, lat: number): BgGeoAnchorPoint => ({
  imgX,
  imgY,
  lon,
  lat,
});

function makeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    transform: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D & {
    save: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    transform: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
  };
}

const IMAGE = {} as CanvasImageSource;

describe("computeBgAnchorAffine", () => {
  it("identity mapping when image pixels line up 1:1 with canvas", () => {
    // img (0,0) → lon 0 / lat 10 → canvas (0,0); img (100,0) → lon 10 / lat 10 → canvas (100,0).
    const affine = computeBgAnchorAffine(
      [anchor(0, 0, 0, 10), anchor(100, 0, 10, 10)],
      GRID,
      T,
    )!;
    expect(affine).not.toBeNull();
    expect(affine.a).toBeCloseTo(1, 9);
    expect(affine.b).toBeCloseTo(0, 9);
    expect(affine.c).toBeCloseTo(0, 9);
    expect(affine.d).toBeCloseTo(1, 9);
    expect(affine.e).toBeCloseTo(0, 9);
    expect(affine.f).toBeCloseTo(0, 9);
  });

  it("uniform scale: a 200 px image span over the full 100 px canvas → scale 0.5", () => {
    const affine = computeBgAnchorAffine(
      [anchor(0, 0, 0, 10), anchor(200, 0, 10, 10)],
      GRID,
      T,
    )!;
    expect(affine.a).toBeCloseTo(0.5, 9);
    expect(affine.d).toBeCloseTo(0.5, 9);
    expect(affine.b).toBeCloseTo(0, 9);
  });

  it("rotation: image +y axis mapped onto canvas +x axis (90° CCW image)", () => {
    // img (0,0) → canvas (0,0); img (0,100) → canvas (100,0).
    const affine = computeBgAnchorAffine(
      [anchor(0, 0, 0, 10), anchor(0, 100, 10, 10)],
      GRID,
      T,
    )!;
    // Verify by transforming the second image point through the matrix.
    const x = affine.a * 0 + affine.c * 100 + affine.e;
    const y = affine.b * 0 + affine.d * 100 + affine.f;
    expect(x).toBeCloseTo(100, 9);
    expect(y).toBeCloseTo(0, 9);
    // And the first anchor stays pinned.
    expect(affine.e).toBeCloseTo(0, 9);
    expect(affine.f).toBeCloseTo(0, 9);
  });

  it("translation: anchors offset from origin pin the image correctly", () => {
    // img (10, 10) → lon 5 / lat 5 → canvas (50, 50); 1:1 scale via second anchor.
    const affine = computeBgAnchorAffine(
      [anchor(10, 10, 5, 5), anchor(30, 10, 7, 5)],
      GRID,
      T,
    )!;
    const x = affine.a * 10 + affine.c * 10 + affine.e;
    const y = affine.b * 10 + affine.d * 10 + affine.f;
    const [ex, ey] = lonLatToCanvas(5, 5, GRID, T);
    expect(x).toBeCloseTo(ex, 9);
    expect(y).toBeCloseTo(ey, 9);
  });

  it("returns null for coincident image points", () => {
    expect(
      computeBgAnchorAffine([anchor(5, 5, 0, 0), anchor(5, 5, 10, 10)], GRID, T),
    ).toBeNull();
  });

  it("returns null for coincident geographic points", () => {
    expect(
      computeBgAnchorAffine([anchor(0, 0, 3, 3), anchor(100, 0, 3, 3)], GRID, T),
    ).toBeNull();
  });

  it("returns null unless exactly two anchors are given", () => {
    expect(computeBgAnchorAffine([anchor(0, 0, 0, 0)], GRID, T)).toBeNull();
  });
});

describe("computeBgFallbackRect", () => {
  it("stretches over the union of multiple bboxes", () => {
    const rect = computeBgFallbackRect(
      [
        { minLon: 0, maxLon: 5, minLat: 0, maxLat: 5 },
        { minLon: 5, maxLon: 10, minLat: 5, maxLat: 10 },
      ],
      GRID,
      T,
    )!;
    // Union covers the whole grid: lat 10 → y 0, lat 0 → y 100.
    expect(rect).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("returns null with no bboxes", () => {
    expect(computeBgFallbackRect([], GRID, T)).toBeNull();
  });
});

describe("drawBackgroundImage", () => {
  const BBOXES = [{ minLon: 0, maxLon: 10, minLat: 0, maxLat: 10 }];

  it("anchor path: applies the affine via ctx.transform and draws at origin", () => {
    const ctx = makeCtx();
    drawBackgroundImage(
      ctx,
      IMAGE,
      100,
      100,
      [anchor(0, 0, 0, 10), anchor(100, 0, 10, 10)],
      BBOXES,
      GRID,
      T,
      0.5,
    );
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.transform).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledWith(IMAGE, 0, 0);
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("fallback path (no anchors): stretches into the union bbox rect", () => {
    const ctx = makeCtx();
    drawBackgroundImage(ctx, IMAGE, 100, 100, null, BBOXES, GRID, T, 0.5);
    expect(ctx.transform).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(IMAGE, 0, 0, 100, 100);
  });

  it("sets globalAlpha to the clamped opacity while drawing", () => {
    const ctx = makeCtx();
    let alphaAtDraw = -1;
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      alphaAtDraw = ctx.globalAlpha;
    });
    drawBackgroundImage(ctx, IMAGE, 100, 100, null, BBOXES, GRID, T, 0.37);
    expect(alphaAtDraw).toBeCloseTo(0.37, 9);
  });

  it("draws nothing at opacity 0 or with a degenerate image size", () => {
    const ctx = makeCtx();
    drawBackgroundImage(ctx, IMAGE, 100, 100, null, BBOXES, GRID, T, 0);
    drawBackgroundImage(ctx, IMAGE, 0, 100, null, BBOXES, GRID, T, 0.5);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("draws nothing on the fallback path when there are no bboxes", () => {
    const ctx = makeCtx();
    drawBackgroundImage(ctx, IMAGE, 100, 100, null, [], GRID, T, 0.5);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
