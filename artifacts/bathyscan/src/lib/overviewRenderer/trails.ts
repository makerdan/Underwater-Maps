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
export type SavedDriftEndpoint = "start" | "end";
export interface SavedDriftHit {
  marker: Marker & { geometry: Extract<Marker["geometry"], { kind: "drift" }> };
  endpoint: SavedDriftEndpoint | null;
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const progress = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + progress * dx), py - (ay + progress * dy));
}

/**
 * Find a saved drift ribbon or one of its endpoint affordances at a canvas
 * position. Endpoint hits win over the ribbon body, and the closest ribbon
 * wins when multiple saved drifts overlap.
 */
export function hitTestSavedDrifts(
  markers: Marker[],
  x: number,
  y: number,
  grid: TerrainData,
  t: OverviewTransform,
  hitRadius = 11,
): SavedDriftHit | null {
  let closest: { hit: SavedDriftHit; distance: number } | null = null;
  let closestEndpoint: { hit: SavedDriftHit; distance: number } | null = null;

  for (const candidate of markers) {
    if (!isDriftMarker(candidate)) continue;
    const points = sampleDriftWaypoints(candidate.geometry, 48);
    if (points.length < 2) continue;
    const canvasPoints = points.map((point) => lonLatToCanvas(point.lon, point.lat, grid, t));
    const first = canvasPoints[0]!;
    const last = canvasPoints[canvasPoints.length - 1]!;
    const startDistance = Math.hypot(x - first[0], y - first[1]);
    const endDistance = Math.hypot(x - last[0], y - last[1]);
    const endpointDistance = Math.min(startDistance, endDistance);
    if (endpointDistance <= hitRadius) {
      const endpoint: SavedDriftEndpoint = startDistance <= endDistance ? "start" : "end";
      const hit: SavedDriftHit = { marker: candidate, endpoint };
      if (!closestEndpoint || endpointDistance < closestEndpoint.distance) {
        closestEndpoint = { hit, distance: endpointDistance };
      }
      continue;
    }

    let ribbonDistance = Number.POSITIVE_INFINITY;
    for (let i = 1; i < canvasPoints.length; i++) {
      const previous = canvasPoints[i - 1]!;
      const current = canvasPoints[i]!;
      ribbonDistance = Math.min(
        ribbonDistance,
        distanceToSegment(x, y, previous[0], previous[1], current[0], current[1]),
      );
    }
    if (ribbonDistance <= hitRadius && (!closest || ribbonDistance < closest.distance)) {
      closest = {
        hit: { marker: candidate, endpoint: null },
        distance: ribbonDistance,
      };
    }
  }

  return closestEndpoint?.hit ?? closest?.hit ?? null;
}

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
  selectedMarkerId: string | null = null,
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
    const selected = marker.id === selectedMarkerId;
    ctx.lineWidth = selected ? 4.5 : 3;
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
    if (selected) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(first[0], first[1], 9, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "#f43f5e";
      ctx.beginPath(); ctx.arc(last[0], last[1], 9, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}
