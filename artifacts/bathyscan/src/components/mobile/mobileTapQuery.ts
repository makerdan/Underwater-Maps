/**
 * mobileTapQuery — MOBILE-ONLY: pure helpers behind the Analyze tab's
 * tap-to-query readout on the 2D contour chart.
 *
 * A tap on the chart canvas is mapped through the overview transform to a
 * lon/lat, then to a grid cell, and the cell's depth (positive-down metres)
 * plus a locally-derived slope are returned for display in the user's units.
 *
 * Kept free of React/canvas so the coordinate mapping, out-of-grid rejection,
 * null-cell handling and slope math are unit-testable in isolation.
 */
import type { TerrainData } from "@workspace/api-client-react";
import {
  canvasToLonLat,
  lonRangeOf,
  normaliseLon,
  type OverviewTransform,
} from "@/lib/overviewRenderer";

/** Metres per degree of latitude (WGS-84 mean). */
const M_PER_DEG_LAT = 111_320;

export interface TapQueryResult {
  lon: number;
  lat: number;
  /** Grid row (row 0 = SOUTH, per the served-grid orientation contract). */
  row: number;
  col: number;
  /** Depth in metres, positive-down; null on a no-data (survey gap) cell. */
  depthM: number | null;
  /** Local seafloor slope in degrees, or null when not computable. */
  slopeDeg: number | null;
}

/** Depth at (row, col), or null for gaps / out-of-range indices. */
function depthAt(grid: TerrainData, row: number, col: number): number | null {
  const W = grid.width;
  const H = grid.height;
  if (row < 0 || row >= H || col < 0 || col >= W) return null;
  const d = grid.depths[row * W + col];
  return d === null || d === undefined || !Number.isFinite(d) ? null : d;
}

/**
 * Local slope (degrees) at a cell via central finite differences over the
 * geographic cell size in metres. Null neighbours fall back to the centre
 * cell (one-sided difference); a null centre yields null (no slope on gaps).
 */
export function slopeAtCell(grid: TerrainData, row: number, col: number): number | null {
  const W = grid.width;
  const H = grid.height;
  if (W < 2 || H < 2) return null;
  const centre = depthAt(grid, row, col);
  if (centre === null) return null;

  const latRange = grid.maxLat - grid.minLat || 1;
  const lonRange = lonRangeOf(grid);
  const cellLat = grid.minLat + (row / (H - 1)) * latRange;
  const cellHM = (latRange / (H - 1)) * M_PER_DEG_LAT;
  const cellWM =
    (lonRange / (W - 1)) * M_PER_DEG_LAT * Math.max(0.01, Math.cos((cellLat * Math.PI) / 180));

  /** One-axis gradient: neighbours at ±1 (clamped), null → centre fallback. */
  const gradient = (
    aRow: number, aCol: number, aPos: number,
    bRow: number, bCol: number, bPos: number,
    centrePos: number, cellM: number,
  ): number | null => {
    let a = depthAt(grid, aRow, aCol);
    let b = depthAt(grid, bRow, bCol);
    if (a === null) { a = centre; aPos = centrePos; }
    if (b === null) { b = centre; bPos = centrePos; }
    const span = (bPos - aPos) * cellM;
    if (span === 0) return 0; // both ends collapsed onto the centre — flat as far as we can tell
    return (b - a) / span;
  };

  const c0 = Math.max(0, col - 1);
  const c1 = Math.min(W - 1, col + 1);
  const r0 = Math.max(0, row - 1);
  const r1 = Math.min(H - 1, row + 1);
  const gx = gradient(row, c0, c0, row, c1, c1, col, cellWM);
  const gy = gradient(r0, col, r0, r1, col, r1, col, cellHM);
  if (gx === null || gy === null) return null;
  return Math.atan(Math.hypot(gx, gy)) * (180 / Math.PI);
}

/**
 * Map a canvas-space tap to a grid cell and return depth/slope there.
 * Returns null when the tap lands outside the grid's bounding box.
 */
export function queryGridAtCanvasPoint(
  cx: number,
  cy: number,
  grid: TerrainData,
  t: OverviewTransform,
): TapQueryResult | null {
  const { lon, lat } = canvasToLonLat(cx, cy, grid, t);

  const lonRange = lonRangeOf(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const normLon = normaliseLon(lon, grid);
  const fracX = (normLon - grid.minLon) / lonRange;
  const fracY = (lat - grid.minLat) / latRange;
  if (fracX < 0 || fracX > 1 || fracY < 0 || fracY > 1) return null; // outside the grid bbox

  const W = grid.width;
  const H = grid.height;
  const col = Math.min(W - 1, Math.max(0, Math.round(fracX * (W - 1))));
  // Row 0 = SOUTH (served-grid contract): larger latitude → larger row index.
  const row = Math.min(H - 1, Math.max(0, Math.round(fracY * (H - 1))));

  const depthM = depthAt(grid, row, col);
  return {
    lon,
    lat,
    row,
    col,
    depthM,
    slopeDeg: depthM === null ? null : slopeAtCell(grid, row, col),
  };
}
