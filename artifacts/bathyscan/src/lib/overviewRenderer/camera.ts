/**
 * overviewRenderer/camera.ts — camera view-cone + legacy camera-arrow
 * indicators drawn at the camera's geographic position.
 */
import type { TerrainData } from "@workspace/api-client-react";
import { lonLatToCanvas, type OverviewTransform } from "./transforms";

/**
 * Draw a view-cone (filled triangle) at the camera's geographic position.
 *
 * The cone tip sits at the camera's ground-projected position.
 * Its opening angle reflects the camera's horizontal field of view, and its
 * length scales with the camera's altitude above terrain so users can see
 * both heading and approximate scene footprint at a glance.
 *
 * @param cameraWorldY  Camera Y position in THREE.js world-space units.
 *                      Positive = above terrain surface, 0 = at surface.
 * @param fovDeg        Camera horizontal field of view in degrees.
 */
export function renderViewCone(
  ctx: CanvasRenderingContext2D,
  lon: number,
  lat: number,
  headingDeg: number,
  cameraWorldY: number,
  fovDeg: number,
  grid: TerrainData,
  t: OverviewTransform,
): void {
  const [cx, cy] = lonLatToCanvas(lon, lat, grid, t);

  // North-up convention: heading 180° = North = top of canvas = rotate(0).
  const rad = (180 - headingDeg) * (Math.PI / 180);

  // Cone length scales with altitude: clamp cameraWorldY to [0, 80] world
  // units (MAX_DEPTH_WORLD * 1.6 covers all practical flythrough heights)
  // then map to [28, 145] canvas pixels.
  const altNorm = Math.max(0, Math.min(1, cameraWorldY / 80));
  const coneLength = 28 + altNorm * 117;

  // Half-angle from horizontal FOV — cone opening widens with larger FOV.
  const halfAngleRad = (Math.max(10, Math.min(120, fovDeg)) / 2) * (Math.PI / 180);

  const sinH = Math.sin(halfAngleRad);
  const cosH = Math.cos(halfAngleRad);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);

  // Filled semi-transparent cone: tip at origin, opening toward negative Y
  // (which maps to "forward / North" before the heading rotation is applied).
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-sinH * coneLength, -cosH * coneLength);
  ctx.lineTo(sinH * coneLength, -cosH * coneLength);
  ctx.closePath();

  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Small dot at the tip marks the exact camera ground position.
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.restore();
}

/** @deprecated Use renderViewCone instead. */
export function renderCameraArrow(
  ctx: CanvasRenderingContext2D,
  lon: number,
  lat: number,
  headingDeg: number,
  grid: TerrainData,
  t: OverviewTransform,
): void {
  renderViewCone(ctx, lon, lat, headingDeg, 20, 45, grid, t);
}
