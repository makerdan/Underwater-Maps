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
  canvasToLonLat,
  zoomTransformAtPoint,
  type BgGeoAnchorPoint,
  type OverviewTransform,
} from "../overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";

// World grid spanning lon 0..10, lat 0..10; identity-ish transform where
// 1 degree = 10 canvas px → canvas 100×100, lat 10 at y=0 (north-up).
const GRID = { minLon: 0, maxLon: 10, minLat: 0, maxLat: 10 } as unknown as TerrainData;
const T: OverviewTransform = { scale: 1, offsetX: 0, offsetY: 0, pxPerDeg: 10 };
const PAN_ZOOM_T: OverviewTransform = { scale: 2.4, offsetX: 37, offsetY: -19, pxPerDeg: 7 };
const ANTIMERIDIAN_GRID = {
  minLon: 170,
  maxLon: -170,
  minLat: 0,
  maxLat: 10,
} as unknown as TerrainData;

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

function applyAffine(affine: NonNullable<ReturnType<typeof computeBgAnchorAffine>>, x: number, y: number) {
  return [affine.a * x + affine.c * y + affine.e, affine.b * x + affine.d * y + affine.f] as const;
}

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

  it("pins both GPS anchors after a zoom and pan transform", () => {
    const anchors = [anchor(25, 80, 2, 8), anchor(245, 135, 8, 3)] as const;
    const affine = computeBgAnchorAffine(anchors, GRID, PAN_ZOOM_T)!;
    for (const point of anchors) {
      const [x, y] = applyAffine(affine, point.imgX, point.imgY);
      const [targetX, targetY] = lonLatToCanvas(point.lon, point.lat, GRID, PAN_ZOOM_T);
      expect(x).toBeCloseTo(targetX, 9);
      expect(y).toBeCloseTo(targetY, 9);
    }
  });

  it("maps both points when the anchors are supplied in reverse order", () => {
    const anchors = [anchor(245, 135, 8, 3), anchor(25, 80, 2, 8)] as const;
    const affine = computeBgAnchorAffine(anchors, GRID, PAN_ZOOM_T)!;
    for (const point of anchors) {
      const [x, y] = applyAffine(affine, point.imgX, point.imgY);
      const [targetX, targetY] = lonLatToCanvas(point.lon, point.lat, GRID, PAN_ZOOM_T);
      expect(x).toBeCloseTo(targetX, 9);
      expect(y).toBeCloseTo(targetY, 9);
    }
  });

  it("keeps anchors aligned across the antimeridian", () => {
    const anchors = [anchor(10, 20, 175, 8), anchor(210, 95, -175, 2)] as const;
    const affine = computeBgAnchorAffine(anchors, ANTIMERIDIAN_GRID, PAN_ZOOM_T)!;
    for (const point of anchors) {
      const [x, y] = applyAffine(affine, point.imgX, point.imgY);
      const [targetX, targetY] = lonLatToCanvas(point.lon, point.lat, ANTIMERIDIAN_GRID, PAN_ZOOM_T);
      expect(x).toBeCloseTo(targetX, 9);
      expect(y).toBeCloseTo(targetY, 9);
    }
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

  it.each([
    [anchor(Number.NaN, 0, 0, 10), anchor(100, 0, 10, 10)],
    [anchor(0, 0, 181, 10), anchor(100, 0, 10, 10)],
    [anchor(-1, 0, 0, 10), anchor(100, 0, 10, 10)],
  ])("returns null for malformed anchors", (anchors) => {
    expect(computeBgAnchorAffine(anchors, GRID, T)).toBeNull();
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

  it("safely uses the bbox fallback for malformed legacy anchors", () => {
    const ctx = makeCtx();
    drawBackgroundImage(
      ctx,
      IMAGE,
      100,
      100,
      [anchor(Number.NaN, 0, 0, 10), anchor(100, 0, 10, 10)],
      BBOXES,
      GRID,
      T,
      0.5,
    );
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

  it("draws the active collection image at the default 50% opacity", () => {
    const ctx = makeCtx();
    let alphaAtDraw = -1;
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      alphaAtDraw = ctx.globalAlpha;
    });
    drawBackgroundImage(ctx, IMAGE, 100, 100, null, BBOXES, GRID, T, 0.5);
    expect(ctx.drawImage).toHaveBeenCalledOnce();
    expect(alphaAtDraw).toBeCloseTo(0.5, 9);
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

describe("zoomTransformAtPoint — geographic registration", () => {
  it("keeps the toolbar focal point fixed through an animated zoom path and round trip", () => {
    const pivot = { x: 63, y: 41 };
    const start: OverviewTransform = {
      scale: 1.25,
      offsetX: -18,
      offsetY: 27,
      pxPerDeg: 10,
    };
    const zoomed = zoomTransformAtPoint(start, 1.35, pivot, GRID, 800, 600);
    const zoomedBack = zoomTransformAtPoint(zoomed, 1 / 1.35, pivot, GRID, 800, 600);
    const startGeo = canvasToLonLat(pivot.x, pivot.y, GRID, start);
    const zoomedGeo = canvasToLonLat(pivot.x, pivot.y, GRID, zoomed);
    const roundTripGeo = canvasToLonLat(pivot.x, pivot.y, GRID, zoomedBack);

    expect(zoomedGeo.lon).toBeCloseTo(startGeo.lon, 9);
    expect(zoomedGeo.lat).toBeCloseTo(startGeo.lat, 9);
    expect(zoomedBack.scale).toBeCloseTo(start.scale, 9);
    expect(zoomedBack.offsetX).toBeCloseTo(start.offsetX, 9);
    expect(zoomedBack.offsetY).toBeCloseTo(start.offsetY, 9);
    expect(roundTripGeo.lon).toBeCloseTo(startGeo.lon, 9);
    expect(roundTripGeo.lat).toBeCloseTo(startGeo.lat, 9);
  });

  it("keeps a reference-image anchor and its dataset point on the same geographic frame", () => {
    const pivot = { x: 63, y: 41 };
    const start: OverviewTransform = {
      scale: 1,
      offsetX: 12,
      offsetY: -8,
      pxPerDeg: 10,
    };
    const zoomed = zoomTransformAtPoint(start, 1.35, pivot, GRID, 800, 600);
    const geographicPoint = canvasToLonLat(120, 80, GRID, start);
    const [startX, startY] = lonLatToCanvas(geographicPoint.lon, geographicPoint.lat, GRID, start);
    const [zoomedX, zoomedY] = lonLatToCanvas(geographicPoint.lon, geographicPoint.lat, GRID, zoomed);

    // Both renderers consume lonLatToCanvas, so the dataset bitmap and the
    // anchor-derived reference image must move by the same transform delta.
    expect(startX).toBeCloseTo(120, 9);
    expect(startY).toBeCloseTo(80, 9);
    expect(zoomedX - pivot.x).toBeCloseTo((startX - pivot.x) * 1.35, 9);
    expect(zoomedY - pivot.y).toBeCloseTo((startY - pivot.y) * 1.35, 9);
  });
});
