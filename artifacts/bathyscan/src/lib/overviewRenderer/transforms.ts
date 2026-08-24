/**
 * overviewRenderer/transforms.ts — pan/zoom transform + lon/lat ↔ canvas
 * coordinate conversions for the OverviewMap. No React, no drawing.
 */
import type { TerrainData } from "@workspace/api-client-react";
import {
  longitudeSpan,
  projectGeoPoint,
  unprojectGeoPoint,
  unwrapLongitude,
  type GeoBounds,
} from "@workspace/shared-types";

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/**
 * Describes the current pan/zoom state of the overview canvas.
 *
 * At `scale=1` the terrain spans `pxPerDeg × lonRange` × `pxPerDeg × latRange`
 * canvas pixels, positioned so its top-left corner is at (offsetX, offsetY).
 */
export interface OverviewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Pixels per geographic degree at scale = 1 (uniform, preserves terrain aspect). */
  pxPerDeg: number;
}

/**
 * Return the effective longitude span for a bounding box, handling the case
 * where the box crosses the antimeridian (minLon > maxLon).
 * e.g. minLon=170, maxLon=-170  →  span = 20°
 */
export function lonRangeOf(grid: TerrainData): number {
  return longitudeSpan(grid);
}

/**
 * Normalise a longitude value so it lies on the same continuous number line as
 * grid.minLon when the bbox crosses the antimeridian.
 * e.g. with minLon=170: lon=-175 → 185 (so the fraction is (185-170)/20 = 0.75)
 */
export function normaliseLon(lon: number, grid: TerrainData): number {
  return unwrapLongitude(lon, grid);
}

/** Compute (offsetX, offsetY) for a lon/lat point given the transform. */
export function lonLatToCanvas(
  lon: number,
  lat: number,
  grid: TerrainData,
  t: OverviewTransform,
): [number, number] {
  const lonRange = longitudeSpan(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  const projected = projectGeoPoint({ lon, lat }, grid, terrainW, terrainH);
  return [
    t.offsetX + projected.x,
    t.offsetY + projected.y,
  ];
}

/** Convert a canvas pixel back to (lon, lat). */
export function canvasToLonLat(
  cx: number,
  cy: number,
  grid: TerrainData,
  t: OverviewTransform,
): { lon: number; lat: number } {
  const bounds = grid as GeoBounds;
  const lonRange = longitudeSpan(bounds);
  const latRange = bounds.maxLat - bounds.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  const point = unprojectGeoPoint(
    { x: cx - t.offsetX, y: cy - t.offsetY },
    bounds,
    terrainW,
    terrainH,
  );
  return point;
}

/** Build the initial transform so the terrain fits into the canvas at 88% fill. */
export function computeInitialTransform(
  grid: TerrainData,
  canvasW: number,
  canvasH: number,
): OverviewTransform {
  const lonRange = lonRangeOf(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const margin = 0.88;
  const pxPerDeg = Math.min(
    (canvasW * margin) / lonRange,
    (canvasH * margin) / latRange,
  );
  const terrainW = pxPerDeg * lonRange;
  const terrainH = pxPerDeg * latRange;
  return {
    scale: 1,
    offsetX: (canvasW - terrainW) / 2,
    offsetY: (canvasH - terrainH) / 2,
    pxPerDeg,
  };
}

/**
 * Compute a transform that centres and fills the canvas around an arbitrary
 * bounding box at 88% fill. Used by the "Fit to Data" button to frame the
 * union bbox of all visible datasets.
 *
 * Unlike `computeInitialTransform`, this accepts a plain bbox object rather
 * than a full TerrainData grid, and handles the antimeridian-crossing case
 * (minLon > maxLon) the same way `lonRangeOf` does.
 */
export function computeFitTransform(
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number },
  canvasW: number,
  canvasH: number,
): OverviewTransform {
  const lonRange = longitudeSpan(bbox);
  const latRange = bbox.maxLat - bbox.minLat || 1;
  const margin = 0.88;
  const pxPerDeg = Math.min(
    (canvasW * margin) / lonRange,
    (canvasH * margin) / latRange,
  );
  const terrainW = pxPerDeg * lonRange;
  const terrainH = pxPerDeg * latRange;
  return {
    scale: 1,
    offsetX: (canvasW - terrainW) / 2,
    offsetY: (canvasH - terrainH) / 2,
    pxPerDeg,
  };
}

/**
 * Clamp the transform so at least 10% of the terrain remains visible.
 * Does NOT modify `pxPerDeg` or `scale`.
 */
export function clampTransform(
  t: OverviewTransform,
  grid: TerrainData,
  canvasW: number,
  canvasH: number,
): OverviewTransform {
  const lonRange = lonRangeOf(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  const minVis = 0.10;
  return {
    ...t,
    offsetX: Math.max(-terrainW * (1 - minVis), Math.min(canvasW - terrainW * minVis, t.offsetX)),
    offsetY: Math.max(-terrainH * (1 - minVis), Math.min(canvasH - terrainH * minVis, t.offsetY)),
  };
}
