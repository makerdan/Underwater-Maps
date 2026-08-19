/**
 * overviewRenderer/nodata.ts — survey-gap (no-data) boundary segment
 * detection + dashed boundary rendering on the overview canvas.
 */
import type { TerrainData } from "@workspace/api-client-react";
import { lonRangeOf, lonLatToCanvas, type OverviewTransform } from "./transforms";

// ---------------------------------------------------------------------------
// No-data boundary segments
// ---------------------------------------------------------------------------

/**
 * One line segment on the boundary between a null (no-data) depth cell and
 * either a non-null cell or the outer edge of the grid.
 *
 * Coordinates are in fractional grid space: x ∈ [0, W], y ∈ [0, H].
 * An x/y value of `k` means the boundary sits at the edge between columns/rows
 * k−1 and k.
 */
export interface NodataBoundarySegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** True when a depth value represents a survey gap (null / undefined / NaN). */
function isNullDepth(d: number | null | undefined): boolean {
  return d === null || d === undefined || Number.isNaN(d as number);
}

/**
 * Hard cap on the number of boundary segments `buildNodataBoundarySegments`
 * will emit. A dense checkerboard pattern could otherwise generate 4×W×H
 * segments on a high-resolution grid; the cap keeps rendering tractable.
 */
export const MAX_NODATA_BOUNDARY_SEGMENTS = 200_000;

/**
 * Find all edges between null (survey-gap) depth cells and non-null cells
 * (or the outer edge of the grid) in the given terrain grid.
 *
 * Each returned segment is a unit edge in fractional grid coordinates.
 * Horizontal edges (top/bottom of a cell) run in the x direction;
 * vertical edges (left/right) run in the y direction.
 *
 * The result can be rendered with `renderNodataBoundary` (2D overview map)
 * or converted to world-space geometry for the 3D viewer.
 */
export function buildNodataBoundarySegments(grid: TerrainData): NodataBoundarySegment[] {
  const { width: W, height: H, depths } = grid;
  if (W < 1 || H < 1) return [];

  const segments: NodataBoundarySegment[] = [];

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const cell = depths[row * W + col];
      if (!isNullDepth(cell)) continue;

      if (segments.length >= MAX_NODATA_BOUNDARY_SEGMENTS) return segments;

      // Top edge: boundary with (row−1, col), or outer grid edge when row=0.
      const topIsNull = row > 0 && isNullDepth(depths[(row - 1) * W + col]);
      if (!topIsNull) {
        segments.push({ x0: col, y0: row, x1: col + 1, y1: row });
      }

      // Bottom edge: boundary with (row+1, col), or outer grid edge when row=H−1.
      const bottomIsNull = row < H - 1 && isNullDepth(depths[(row + 1) * W + col]);
      if (!bottomIsNull) {
        segments.push({ x0: col, y0: row + 1, x1: col + 1, y1: row + 1 });
      }

      // Left edge: boundary with (row, col−1), or outer grid edge when col=0.
      const leftIsNull = col > 0 && isNullDepth(depths[row * W + (col - 1)]);
      if (!leftIsNull) {
        segments.push({ x0: col, y0: row, x1: col, y1: row + 1 });
      }

      // Right edge: boundary with (row, col+1), or outer grid edge when col=W−1.
      const rightIsNull = col < W - 1 && isNullDepth(depths[row * W + (col + 1)]);
      if (!rightIsNull) {
        segments.push({ x0: col + 1, y0: row, x1: col + 1, y1: row + 1 });
      }
    }
  }

  return segments;
}

/**
 * Draw survey-boundary indicators on the 2D overview canvas.
 *
 * Each boundary segment separating a null cell from a surveyed cell is drawn
 * as a short dashed dark-grey stroke. The rendering is intentionally subtle —
 * the dashed grey lines should read as "data ends here" without obscuring the
 * underlying heatmap or contour lines.
 *
 * Draw order: call after `renderHeatmapAtBbox` / `renderHeatmap`, before
 * `renderContourLines`, so contour labels remain fully crisp on top.
 */
export function renderNodataBoundary(
  ctx: CanvasRenderingContext2D,
  segments: NodataBoundarySegment[],
  grid: TerrainData,
  t: OverviewTransform,
  worldGrid?: TerrainData,
): void {
  if (!segments.length) return;

  const { width: W, height: H } = grid;
  const lonRange = lonRangeOf(grid);
  const latRange = grid.maxLat - grid.minLat || 1;

  /** Convert fractional grid coords (gx, gy) to canvas pixel coords.
   *  Uses worldGrid (when present) as the coordinate frame so nodata
   *  boundary segments are placed correctly in multi-dataset mode where
   *  the transform is derived from the union bbox rather than this grid's
   *  own bbox (same pattern as renderContourLines). */
  const toCanvas = (gx: number, gy: number): [number, number] => {
    const lon = grid.minLon + (gx / Math.max(W, 1)) * lonRange;
    const lat = grid.minLat + (gy / Math.max(H, 1)) * latRange;
    return lonLatToCanvas(lon, lat, worldGrid ?? grid, t);
  };

  ctx.save();
  ctx.strokeStyle = "rgba(80,90,100,0.70)";
  ctx.lineWidth = Math.max(0.75, Math.min(1.5, t.scale * 0.4));
  ctx.setLineDash([3, 3]);
  ctx.lineCap = "butt";

  ctx.beginPath();
  for (const seg of segments) {
    const [cx0, cy0] = toCanvas(seg.x0, seg.y0);
    const [cx1, cy1] = toCanvas(seg.x1, seg.y1);
    ctx.moveTo(cx0, cy0);
    ctx.lineTo(cx1, cy1);
  }
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.restore();
}
