/**
 * overviewRenderer/puzzle.ts — special-collection puzzle-mode overlays:
 * background reference image placement + gap/overlap indicator raster.
 */
import type { TerrainData } from "@workspace/api-client-react";
import { lonLatToCanvas, type OverviewTransform } from "./transforms";

// ═══════════════════════════════════════════════════════════════════════════
// Special-collection background image overlay (puzzle mode)
// ═══════════════════════════════════════════════════════════════════════════

/** One geo-anchor control point: image pixel ↔ geographic coordinate. */
export interface BgGeoAnchorPoint {
  lon: number;
  lat: number;
  imgX: number;
  imgY: number;
}

/**
 * 2×3 affine transform (canvas setTransform order): x' = a·x + c·y + e,
 * y' = b·x + d·y + f.
 */
export interface BgAffine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Compute the similarity transform (uniform scale + rotation + translation)
 * that maps background-image pixel coordinates onto Overview canvas
 * coordinates, from two geo-anchor pairs.
 *
 * Uses the complex-ratio construction: with image points p1, p2 and their
 * canvas targets q1, q2, r = (q2 − q1) / (p2 − p1) gives the rotation+scale
 * as a complex number; the matrix is [re −im; im re].
 *
 * Returns null when the anchors are degenerate (coincident image points).
 */
export function computeBgAnchorAffine(
  anchors: readonly BgGeoAnchorPoint[],
  grid: TerrainData,
  t: OverviewTransform,
): BgAffine | null {
  const a1 = anchors[0];
  const a2 = anchors[1];
  if (anchors.length !== 2 || !a1 || !a2) return null;
  const px = a2.imgX - a1.imgX;
  const py = a2.imgY - a1.imgY;
  const denom = px * px + py * py;
  if (denom < 1e-12) return null;

  const [q1x, q1y] = lonLatToCanvas(a1.lon, a1.lat, grid, t);
  const [q2x, q2y] = lonLatToCanvas(a2.lon, a2.lat, grid, t);
  const qx = q2x - q1x;
  const qy = q2y - q1y;
  if (qx * qx + qy * qy < 1e-12) return null;

  // r = q / p (complex division)
  const re = (qx * px + qy * py) / denom;
  const im = (qy * px - qx * py) / denom;

  // Matrix [re −im; im re]; translation so p1 → q1.
  const e = q1x - (re * a1.imgX - im * a1.imgY);
  const f = q1y - (im * a1.imgX + re * a1.imgY);
  return { a: re, b: im, c: -im, d: re, e, f };
}

/**
 * Fallback placement when no geo-anchors are set: stretch the image over the
 * union bbox of the given dataset bboxes. Returns a canvas-space rect or null
 * when there are no bboxes.
 */
export function computeBgFallbackRect(
  bboxes: ReadonlyArray<{ minLon: number; maxLon: number; minLat: number; maxLat: number }>,
  grid: TerrainData,
  t: OverviewTransform,
): { x: number; y: number; w: number; h: number } | null {
  if (bboxes.length === 0) return null;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const b of bboxes) {
    minLon = Math.min(minLon, b.minLon);
    maxLon = Math.max(maxLon, b.maxLon);
    minLat = Math.min(minLat, b.minLat);
    maxLat = Math.max(maxLat, b.maxLat);
  }
  const [x0, y0] = lonLatToCanvas(minLon, maxLat, grid, t); // NW corner
  const [x1, y1] = lonLatToCanvas(maxLon, minLat, grid, t); // SE corner
  const w = x1 - x0;
  const h = y1 - y0;
  if (!(w > 0) || !(h > 0)) return null;
  return { x: x0, y: y0, w, h };
}

/**
 * Draw the special-collection reference image behind puzzle tiles.
 *
 * With two valid geo-anchors the image is placed via the anchor similarity
 * transform; otherwise it is stretched over the union bbox of the supplied
 * dataset bboxes. Opacity is applied via ctx.globalAlpha and restored.
 */
export function drawBackgroundImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imgW: number,
  imgH: number,
  anchors: readonly BgGeoAnchorPoint[] | null,
  bboxes: ReadonlyArray<{ minLon: number; maxLon: number; minLat: number; maxLat: number }>,
  grid: TerrainData,
  t: OverviewTransform,
  opacity: number,
): void {
  if (imgW <= 0 || imgH <= 0) return;
  const alpha = Math.max(0, Math.min(1, opacity));
  if (alpha <= 0) return;

  const affine = anchors && anchors.length === 2 ? computeBgAnchorAffine(anchors, grid, t) : null;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (affine) {
    ctx.transform(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f);
    ctx.drawImage(image, 0, 0);
  } else {
    const rect = computeBgFallbackRect(bboxes, grid, t);
    if (rect) ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════
// Gap / overlap indicator overlay (puzzle mode)
// ═══════════════════════════════════════════════════════════════════════════

/** A puzzle tile footprint in canvas space: base rect + puzzle transform. */
export interface GapOverlapTileInput {
  /** Untransformed canvas-space bbox of the tile. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Puzzle translation (canvas px). */
  tx: number;
  ty: number;
  /** Rotation about the rect centre, degrees. */
  angleDeg: number;
}

export interface GapOverlapMask {
  /** Per-cell tile coverage count, row-major, w×h. */
  counts: Uint8Array;
  w: number;
  h: number;
  /** Canvas-space origin of cell (0,0). */
  x0: number;
  y0: number;
  /** Cell size in canvas px. */
  step: number;
}

/**
 * Rasterize tile coverage counts over the union bbox of the transformed
 * tiles, sampling at cell centres every `step` canvas pixels. Rotation is
 * handled by inverse-rotating each sample point about the tile centre; flips
 * are irrelevant (a rect is symmetric about its centre).
 */
export function computeGapOverlapMask(
  tiles: readonly GapOverlapTileInput[],
  step: number,
  maxCells: number = 200_000,
): GapOverlapMask | null {
  if (tiles.length === 0 || step <= 0) return null;

  // Union bbox over transformed tile corners.
  let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
  const pre = tiles.map((tile) => {
    const cx = (tile.x0 + tile.x1) / 2 + tile.tx;
    const cy = (tile.y0 + tile.y1) / 2 + tile.ty;
    const hw = (tile.x1 - tile.x0) / 2;
    const hh = (tile.y1 - tile.y0) / 2;
    const rad = (tile.angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Transformed corner extents about (cx, cy).
    const ex = Math.abs(hw * cos) + Math.abs(hh * sin);
    const ey = Math.abs(hw * sin) + Math.abs(hh * cos);
    ux0 = Math.min(ux0, cx - ex);
    uy0 = Math.min(uy0, cy - ey);
    ux1 = Math.max(ux1, cx + ex);
    uy1 = Math.max(uy1, cy + ey);
    return { cx, cy, hw, hh, cos, sin };
  });
  if (!(ux1 > ux0) || !(uy1 > uy0)) return null;

  const w = Math.ceil((ux1 - ux0) / step);
  const h = Math.ceil((uy1 - uy0) / step);
  if (w <= 0 || h <= 0 || w * h > maxCells) return null;

  const counts = new Uint8Array(w * h);
  for (let iy = 0; iy < h; iy++) {
    const py = uy0 + (iy + 0.5) * step;
    for (let ix = 0; ix < w; ix++) {
      const px = ux0 + (ix + 0.5) * step;
      let n = 0;
      for (const p of pre) {
        const dx = px - p.cx;
        const dy = py - p.cy;
        // Inverse-rotate the sample point into tile-local space.
        const lx = dx * p.cos + dy * p.sin;
        const ly = -dx * p.sin + dy * p.cos;
        if (Math.abs(lx) <= p.hw && Math.abs(ly) <= p.hh) {
          n++;
          if (n >= 255) break;
        }
      }
      counts[iy * w + ix] = n;
    }
  }
  return { counts, w, h, x0: ux0, y0: uy0, step };
}

/** Default raster cell size — ¼ resolution per the task spec. */
export const GAP_OVERLAP_STEP_PX = 4;

/**
 * Draw the gap/overlap indicator: red translucent hatching where no tile
 * covers the union bbox, orange translucent fill where two or more overlap.
 */
export function drawGapOverlap(
  ctx: CanvasRenderingContext2D,
  mask: GapOverlapMask,
): void {
  const { counts, w, h, x0, y0, step } = mask;
  ctx.save();
  // Gaps — red translucent hatch (diagonal stripe pattern at cell scale).
  ctx.fillStyle = "rgba(255, 60, 60, 0.25)";
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      if (counts[iy * w + ix] === 0 && ((ix + iy) & 3) < 2) {
        ctx.fillRect(x0 + ix * step, y0 + iy * step, step, step);
      }
    }
  }
  // Overlaps — orange translucent fill.
  ctx.fillStyle = "rgba(255, 165, 0, 0.2)";
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      if ((counts[iy * w + ix] ?? 0) >= 2) {
        ctx.fillRect(x0 + ix * step, y0 + iy * step, step, step);
      }
    }
  }
  ctx.restore();
}
