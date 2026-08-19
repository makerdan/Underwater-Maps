/**
 * overviewRenderer/routes.ts — MOBILE-ONLY Plan-tab overlay renderers
 * (route polyline + drift path).
 */
import type { TerrainData } from "@workspace/api-client-react";
import { lonLatToCanvas, type OverviewTransform } from "./transforms";

// ---------------------------------------------------------------------------
// MOBILE-ONLY: Plan-tab overlay renderers (route polyline + drift path)
// These functions are called only from MobileChartView's rAF loop. The
// desktop 3D scene renders equivalent visuals via DriftPath / TourScene.
// ---------------------------------------------------------------------------

/**
 * MOBILE-ONLY: draw the active saved route as a leg polyline with waypoint
 * dot markers on the 2D chart canvas. Color (#34d399 green) matches the
 * route accent used in the mobile Plan UI.
 *
 * @param waypoints  Ordered lon/lat waypoints (at least 2 needed for legs).
 */
export function renderRoutePath(
  ctx: CanvasRenderingContext2D,
  waypoints: ReadonlyArray<{ lon: number; lat: number }>,
  grid: TerrainData,
  t: OverviewTransform,
): void {
  if (waypoints.length === 0) return;

  // MOBILE-ONLY: route accent colour — matches the depth-profile / plan UI.
  const ROUTE_COLOR = "#34d399";

  // ── Leg polyline (dashed so it reads over the heatmap) ──────────────────
  if (waypoints.length >= 2) {
    ctx.beginPath();
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i]!;
      const [x, y] = lonLatToCanvas(wp.lon, wp.lat, grid, t);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = ROUTE_COLOR;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Waypoint dots (endpoints slightly larger) ────────────────────────────
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i]!;
    const [x, y] = lonLatToCanvas(wp.lon, wp.lat, grid, t);
    const isEndpoint = i === 0 || i === waypoints.length - 1;
    const r = isEndpoint ? 5 : 3.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = isEndpoint ? ROUTE_COLOR : "rgba(52,211,153,0.6)";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/**
 * MOBILE-ONLY: draw the drift planner's predicted path on the 2D chart canvas.
 * Renders the forward drift path, boat start marker, reverse drift path
 * (when active), and user-placed trolling turn points.
 *
 * Colors mirror the 3D DriftPath component:
 *   - Forward drift:    amber  (#fbbf24)
 *   - Reverse drift:   rose   (#fb7185)
 *   - Trolling points: orange (#f97316)
 *
 * @param driftPath         Forward drift waypoints (null when not computed).
 * @param startLat/Lon      Boat starting position (null when not placed).
 * @param reverseDriftPath  Backwards drift from catch point (null when off).
 * @param trollWaypoints    User-placed trolling turn points.
 */
export function renderDriftPath(
  ctx: CanvasRenderingContext2D,
  driftPath: ReadonlyArray<{ lat: number; lon: number }> | null,
  startLat: number | null,
  startLon: number | null,
  reverseDriftPath: ReadonlyArray<{ lat: number; lon: number }> | null,
  trollWaypoints: ReadonlyArray<{ lat: number; lon: number }>,
  grid: TerrainData,
  t: OverviewTransform,
): void {
  // MOBILE-ONLY: drift overlay colours — mirror the 3D DriftPath component.
  const DRIFT_COLOR   = "#fbbf24"; // amber  — forward drift line
  const REVERSE_COLOR = "#fb7185"; // rose   — reverse drift line
  const TROLL_COLOR   = "#f97316"; // orange — trolling turn points

  // ── Forward drift path ──────────────────────────────────────────────────
  if (driftPath && driftPath.length >= 2) {
    ctx.beginPath();
    for (let i = 0; i < driftPath.length; i++) {
      const wp = driftPath[i]!;
      const [x, y] = lonLatToCanvas(wp.lon, wp.lat, grid, t);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = DRIFT_COLOR;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // ── End marker: filled rotated square at the drift terminus ─────────
    const last = driftPath[driftPath.length - 1]!;
    const [ex, ey] = lonLatToCanvas(last.lon, last.lat, grid, t);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.rect(-4, -4, 8, 8);
    ctx.fillStyle = DRIFT_COLOR;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // ── Start marker: boat dot at driftStart ────────────────────────────────
  if (startLat !== null && startLon !== null) {
    const [sx, sy] = lonLatToCanvas(startLon, startLat, grid, t);
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fillStyle = DRIFT_COLOR;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Inner white dot — "boat" symbol
    ctx.beginPath();
    ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  // ── Reverse drift path (dashed rose line) ───────────────────────────────
  if (reverseDriftPath && reverseDriftPath.length >= 2) {
    ctx.beginPath();
    for (let i = 0; i < reverseDriftPath.length; i++) {
      const wp = reverseDriftPath[i]!;
      const [x, y] = lonLatToCanvas(wp.lon, wp.lat, grid, t);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = REVERSE_COLOR;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Trolling waypoints (user-placed turn points) ─────────────────────────
  for (const wp of trollWaypoints) {
    const [x, y] = lonLatToCanvas(wp.lon, wp.lat, grid, t);
    // Cross + filled centre dot
    const S = 5;
    ctx.beginPath();
    ctx.moveTo(x - S, y); ctx.lineTo(x + S, y);
    ctx.moveTo(x, y - S); ctx.lineTo(x, y + S);
    ctx.strokeStyle = TROLL_COLOR;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = TROLL_COLOR;
    ctx.fill();
  }
}
