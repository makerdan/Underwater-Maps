/**
 * puzzleTransform.ts — pure utility for translating a geographic coordinate
 * by a puzzle-tile spatial transform.
 *
 * The math mirrors the canvas sequence used by drawPuzzleTile / applyPuzzleTransform
 * in OverviewMap.tsx:
 *
 *   ctx.translate(tcx + tx, tcy + ty);
 *   ctx.rotate(angleRad);
 *   ctx.translate(-tcx, -tcy);
 *
 * i.e. rotate around the tile centre, then translate.
 *
 * No React or Three.js dependencies — safe to import in unit tests.
 */
import type { TerrainData } from "@workspace/api-client-react";
import { lonLatToCanvas, canvasToLonLat } from "./overviewRenderer";
import type { OverviewTransform } from "./overviewRenderer";
import type { PuzzleTransform } from "./puzzleStore";

/**
 * Apply a puzzle-tile spatial transform to a geographic coordinate.
 *
 * @param lon           Marker longitude (degrees)
 * @param lat           Marker latitude (degrees)
 * @param tileCenterLon Bbox centre longitude of the owning dataset tile
 * @param tileCenterLat Bbox centre latitude of the owning dataset tile
 * @param transform     The puzzle transform ({tx, ty} in canvas pixels, angleDeg)
 * @param referenceGrid The reference grid used by the overview canvas
 *                      (worldGrid — union bbox when multiple datasets are visible,
 *                       primary overviewGrid otherwise)
 * @param ovTransform   Current pan/zoom state of the overview canvas
 * @returns Adjusted {lon, lat} after the puzzle transform is applied
 */
export function applyPuzzleTransformToLonLat(
  lon: number,
  lat: number,
  tileCenterLon: number,
  tileCenterLat: number,
  transform: PuzzleTransform,
  referenceGrid: TerrainData,
  ovTransform: OverviewTransform,
): { lon: number; lat: number } {
  // Project marker and tile centre into canvas pixel space.
  const [mx, my] = lonLatToCanvas(lon, lat, referenceGrid, ovTransform);
  const [tcx, tcy] = lonLatToCanvas(tileCenterLon, tileCenterLat, referenceGrid, ovTransform);

  const { tx, ty, angleDeg } = transform;
  const angleRad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  // Replicate the canvas transform sequence:
  //   translate(tcx + tx, tcy + ty) · rotate(angleRad) · translate(-tcx, -tcy)
  // Applied to canvas point (mx, my):
  const dx = mx - tcx;
  const dy = my - tcy;
  const finalCx = cosA * dx - sinA * dy + tcx + tx;
  const finalCy = sinA * dx + cosA * dy + tcy + ty;

  return canvasToLonLat(finalCx, finalCy, referenceGrid, ovTransform);
}

/**
 * Compute the geographic centre of a dataset's bbox, used as the tile pivot.
 *
 * For antimeridian-crossing bboxes (minLon > maxLon) the centre is computed
 * on the normalised number line and then wrapped back into [-180, 180].
 */
export function tileCenterLonLat(og: {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}): { centerLon: number; centerLat: number } {
  let centerLon: number;
  if (og.minLon > og.maxLon) {
    // Antimeridian crossing: normalise to a continuous span, find centre, wrap back.
    const mid = og.minLon + (og.maxLon + 360 - og.minLon) / 2;
    centerLon = mid > 180 ? mid - 360 : mid;
  } else {
    centerLon = (og.minLon + og.maxLon) / 2;
  }
  return { centerLon, centerLat: (og.minLat + og.maxLat) / 2 };
}
