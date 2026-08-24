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
import { lonLatToCanvas, canvasToLonLat, type OverviewTransform } from "./overviewRenderer";
import type { PuzzleTransform } from "./puzzleStore";

/**
 * Rebase pixel-space puzzle offsets when the overview's effective pixel
 * density changes.  Persisted puzzle layouts intentionally remain in the
 * historical `{tx, ty, angleDeg, flipH, flipV}` shape; this conversion keeps
 * the same geographic displacement at the new view scale.
 */
export function rebasePuzzleTransformsForView(
  transforms: ReadonlyMap<string, PuzzleTransform>,
  previousDensity: number,
  nextDensity: number,
): Map<string, PuzzleTransform> {
  if (!Number.isFinite(previousDensity) || previousDensity <= 0 ||
      !Number.isFinite(nextDensity) || nextDensity <= 0 ||
      previousDensity === nextDensity) {
    return new Map(transforms);
  }
  const ratio = nextDensity / previousDensity;
  const next = new Map<string, PuzzleTransform>();
  for (const [id, transform] of transforms) {
    next.set(id, {
      ...transform,
      tx: transform.tx * ratio,
      ty: transform.ty * ratio,
    });
  }
  return next;
}

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
  const flipH = transform.flipH ?? false;
  const flipV = transform.flipV ?? false;
  const angleRad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  // Replicate the canvas transform sequence:
  //   translate(tcx + tx, tcy + ty) · rotate(angleRad) · scale(flipH?-1:1, flipV?-1:1) · translate(-tcx, -tcy)
  // Applied to canvas point (mx, my):
  const dx = mx - tcx;
  const dy = my - tcy;
  // Rotate first, then apply flip in the rotated frame.
  const rotX = cosA * dx - sinA * dy;
  const rotY = sinA * dx + cosA * dy;
  const finalCx = (flipH ? -1 : 1) * rotX + tcx + tx;
  const finalCy = (flipV ? -1 : 1) * rotY + tcy + ty;

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

// ---------------------------------------------------------------------------
// Puzzle layout → geographic corrections (Apply-to-3D)
// ---------------------------------------------------------------------------

/**
 * Geographic correction for one dataset, derived from its saved puzzle-tile
 * transform. `dLon`/`dLat` shift the dataset's effective 3D render origin;
 * `angleDeg` is retained as a heading offset for secondary mesh and
 * marker-group rotation.
 */
export interface GeoCorrection {
  dLon: number;
  dLat: number;
  angleDeg: number;
}

/** Minimal tile shape shared by saved layout revisions and restore payloads. */
export interface LayoutTileTransform {
  datasetId: string;
  tx: number;
  ty: number;
  angleDeg: number;
}

/** Geographic bbox of one dataset tile (its overview grid extent). */
export interface GeoBbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/** Fold a longitude delta into [-180, 180] (antimeridian-safe, exact at 0). */
function normaliseLonDeltaDeg(d: number): number {
  return ((d + 540) % 360) - 180;
}

/**
 * Convert a saved puzzle layout (revision tiles) into per-dataset geographic
 * corrections for the 3D scene.
 *
 * For each tile we run its bbox centre through `applyPuzzleTransformToLonLat`
 * — the same canvas-space math the Overview Map uses to draw the tile — and
 * take the lon/lat delta between the corrected and canonical centre. Because
 * the pivot point IS the tile centre, rotation contributes nothing to the
 * centre shift (a point rotated around itself stays put); only the pixel
 * translation `{tx, ty}` produces a delta. `angleDeg` is carried through
 * unchanged as a heading offset.
 *
 * Identity tiles (tx=0, ty=0, angleDeg=0) therefore produce deltas of ~0
 * (floating-point round-trip noise only) — unshifted tiles must load at their
 * original geographic positions.
 *
 * Pure function: never mutates the tiles, bboxes, or reference grid.
 *
 * @param tiles            Tiles from the active layout revision
 * @param bboxByDatasetId  Geographic bbox per dataset (overview grid extents)
 * @param referenceGrid    The reference grid used by the overview canvas
 * @param ovTransform      Current pan/zoom state of the overview canvas
 * @returns Record of datasetId → {dLon, dLat, angleDeg}. Tiles without a
 *          known bbox are skipped.
 */
export function puzzleLayoutToGeoCorrections(
  tiles: readonly LayoutTileTransform[],
  bboxByDatasetId: Readonly<Record<string, GeoBbox>>,
  referenceGrid: TerrainData,
  ovTransform: OverviewTransform,
): Record<string, GeoCorrection> {
  const out: Record<string, GeoCorrection> = {};
  for (const tile of tiles) {
    const bbox = bboxByDatasetId[tile.datasetId];
    if (!bbox) continue;
    const { centerLon, centerLat } = tileCenterLonLat(bbox);
    const corrected = applyPuzzleTransformToLonLat(
      centerLon,
      centerLat,
      centerLon,
      centerLat,
      { tx: tile.tx, ty: tile.ty, angleDeg: tile.angleDeg, flipH: false, flipV: false },
      referenceGrid,
      ovTransform,
    );
    out[tile.datasetId] = {
      dLon: normaliseLonDeltaDeg(corrected.lon - centerLon),
      dLat: corrected.lat - centerLat,
      angleDeg: tile.angleDeg,
    };
  }
  return out;
}
