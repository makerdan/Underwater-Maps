/**
 * overviewRenderer/transforms.ts — pan/zoom transform + lon/lat ↔ canvas
 * coordinate conversions for the OverviewMap. No React, no drawing.
 */
import type { TerrainData } from "@workspace/api-client-react";

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
  if (grid.minLon > grid.maxLon) {
    return grid.maxLon + 360 - grid.minLon;
  }
  return grid.maxLon - grid.minLon || 1;
}

/**
 * Normalise a longitude value so it lies on the same continuous number line as
 * grid.minLon when the bbox crosses the antimeridian.
 * e.g. with minLon=170: lon=-175 → 185 (so the fraction is (185-170)/20 = 0.75)
 */
export function normaliseLon(lon: number, grid: TerrainData): number {
  if (grid.minLon > grid.maxLon && lon < grid.minLon) {
    return lon + 360;
  }
  return lon;
}

/** Compute (offsetX, offsetY) for a lon/lat point given the transform. */
export function lonLatToCanvas(
  lon: number,
  lat: number,
  grid: TerrainData,
  t: OverviewTransform,
): [number, number] {
  const lonRange = lonRangeOf(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  const normLon = normaliseLon(lon, grid);
  return [
    t.offsetX + ((normLon - grid.minLon) / lonRange) * terrainW,
    // North-up: higher latitudes (North) map to smaller Y values (top of canvas).
    t.offsetY + (1 - (lat - grid.minLat) / latRange) * terrainH,
  ];
}

/** Convert a canvas pixel back to (lon, lat). */
export function canvasToLonLat(
  cx: number,
  cy: number,
  grid: TerrainData,
  t: OverviewTransform,
): { lon: number; lat: number } {
  const lonRange = lonRangeOf(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  let lon = grid.minLon + ((cx - t.offsetX) / terrainW) * lonRange;
  // Wrap back into [-180, 180] only for antimeridian-crossing bboxes where the
  // computed lon can legitimately exceed 180 (e.g. normalised 185 → -175).
  if (grid.minLon > grid.maxLon && lon > 180) lon -= 360;
  return {
    lon,
    // Inverse of the North-up Y formula in lonLatToCanvas.
    lat: grid.minLat + (1 - (cy - t.offsetY) / terrainH) * latRange,
  };
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
  const lonRange =
    bbox.minLon > bbox.maxLon
      ? bbox.maxLon + 360 - bbox.minLon || 1
      : bbox.maxLon - bbox.minLon || 1;
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
