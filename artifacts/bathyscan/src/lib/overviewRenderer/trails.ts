/**
 * overviewRenderer/trails.ts — saved trail polyline rendering.
 */
import type { TerrainData } from "@workspace/api-client-react";
import { lonLatToCanvas, type OverviewTransform } from "./transforms";

// ---------------------------------------------------------------------------
// Trail rendering
// ---------------------------------------------------------------------------

export interface CanvasTrailPoint { lon: number; lat: number; }
export interface CanvasSavedTrail { points: CanvasTrailPoint[]; colour: string; id: string; }

/**
 * Draw completed saved trails as thin coloured polylines.
 */
export function renderSavedTrails(
  ctx: CanvasRenderingContext2D,
  trails: CanvasSavedTrail[],
  grid: TerrainData,
  t: OverviewTransform,
): void {
  for (const trail of trails) {
    if (trail.points.length < 2) continue;

    ctx.save();
    ctx.strokeStyle = trail.colour;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.7;

    ctx.beginPath();
    const [x0, y0] = lonLatToCanvas(trail.points[0]!.lon, trail.points[0]!.lat, grid, t);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < trail.points.length; i++) {
      const [x, y] = lonLatToCanvas(trail.points[i]!.lon, trail.points[i]!.lat, grid, t);
      ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Start/end dots
    const [ex, ey] = lonLatToCanvas(
      trail.points[trail.points.length - 1]!.lon,
      trail.points[trail.points.length - 1]!.lat,
      grid,
      t,
    );
    ctx.fillStyle = trail.colour;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(ex, ey, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
