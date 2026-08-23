/**
 * overviewRenderer/trails.ts — saved trail polyline rendering.
 */
import type { Marker, TerrainData } from "@workspace/api-client-react";
import { lonLatToCanvas, type OverviewTransform } from "./transforms";
import { isDriftMarker, sampleDriftWaypoints } from "@/lib/driftMarker";

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

/** Draw persisted drift markers as sampled, directional ribbons above the heatmap. */
export function renderSavedDrifts(
  ctx: CanvasRenderingContext2D,
  markers: Marker[],
  grid: TerrainData,
  t: OverviewTransform,
): void {
  for (const marker of markers) {
    if (!isDriftMarker(marker)) continue;
    const points = sampleDriftWaypoints(marker.geometry, 48);
    if (points.length < 2) continue;
    const salmon = marker.type.includes("salmon");
    const colour = salmon ? "#fb923c" : "#a78bfa";
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, y] = lonLatToCanvas(p.lon, p.lat, grid, t);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 1; i < points.length - 1; i += Math.max(1, Math.floor(points.length / 12))) {
      const [x, y] = lonLatToCanvas(points[i]!.lon, points[i]!.lat, grid, t);
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const first = lonLatToCanvas(points[0]!.lon, points[0]!.lat, grid, t);
    const last = lonLatToCanvas(points[points.length - 1]!.lon, points[points.length - 1]!.lat, grid, t);
    ctx.fillStyle = "#22d3ee";
    ctx.beginPath(); ctx.arc(first[0], first[1], 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath(); ctx.arc(last[0], last[1], 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
