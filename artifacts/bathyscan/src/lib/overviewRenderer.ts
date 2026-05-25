/**
 * overviewRenderer.ts — pure canvas drawing functions for the OverviewMap.
 *
 * No React dependencies. All functions accept a 2D canvas context plus
 * data params and draw directly. Called every rAF frame.
 */
import type { TerrainData } from "@workspace/api-client-react";
import type { Marker } from "@workspace/api-client-react";
import { depthToColor } from "./colormap";
import { MARKER_COLOR } from "./markerConstants";

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/**
 * Describes the current pan/zoom state of the overview canvas.
 *
 * At `scale=1` the terrain spans `pxPerDeg × lonRange` × `pxPerDeg × latRange`
 * canvas pixels, positioned so its top-left corner is at (offsetX, offsetY).
 */
export interface OverviewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Pixels per geographic degree at scale = 1 (uniform, preserves terrain aspect). */
  pxPerDeg: number;
}

/** Compute (offsetX, offsetY) for a lon/lat point given the transform. */
export function lonLatToCanvas(
  lon: number,
  lat: number,
  grid: TerrainData,
  t: OverviewTransform,
): [number, number] {
  const lonRange = grid.maxLon - grid.minLon || 1;
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  return [
    t.offsetX + ((lon - grid.minLon) / lonRange) * terrainW,
    t.offsetY + ((lat - grid.minLat) / latRange) * terrainH,
  ];
}

/** Convert a canvas pixel back to (lon, lat). */
export function canvasToLonLat(
  cx: number,
  cy: number,
  grid: TerrainData,
  t: OverviewTransform,
): { lon: number; lat: number } {
  const lonRange = grid.maxLon - grid.minLon || 1;
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  return {
    lon: grid.minLon + ((cx - t.offsetX) / terrainW) * lonRange,
    lat: grid.minLat + ((cy - t.offsetY) / terrainH) * latRange,
  };
}

/** Build the initial transform so the terrain fits into the canvas at 88% fill. */
export function computeInitialTransform(
  grid: TerrainData,
  canvasW: number,
  canvasH: number,
): OverviewTransform {
  const lonRange = grid.maxLon - grid.minLon || 1;
  const latRange = grid.maxLat - grid.minLat || 1;
  const margin = 0.88;
  const pxPerDeg = Math.min(
    (canvasW * margin) / lonRange,
    (canvasH * margin) / latRange,
  );
  const terrainW = pxPerDeg * lonRange;
  const terrainH = pxPerDeg * latRange;
  return {
    scale: 1,
    offsetX: (canvasW - terrainW) / 2,
    offsetY: (canvasH - terrainH) / 2,
    pxPerDeg,
  };
}

/**
 * Clamp the transform so at least 10% of the terrain remains visible.
 * Does NOT modify `pxPerDeg` or `scale`.
 */
export function clampTransform(
  t: OverviewTransform,
  grid: TerrainData,
  canvasW: number,
  canvasH: number,
): OverviewTransform {
  const lonRange = grid.maxLon - grid.minLon || 1;
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  const minVis = 0.10;
  return {
    ...t,
    offsetX: Math.max(-terrainW * (1 - minVis), Math.min(canvasW - terrainW * minVis, t.offsetX)),
    offsetY: Math.max(-terrainH * (1 - minVis), Math.min(canvasH - terrainH * minVis, t.offsetY)),
  };
}

// ---------------------------------------------------------------------------
// Heatmap bitmap
// ---------------------------------------------------------------------------

/**
 * Pre-render the depth grid as a coloured bitmap (one pixel per data cell).
 * Result is an offscreen HTMLCanvasElement that can be scaled via drawImage.
 */
export function buildHeatmapBitmap(grid: TerrainData): HTMLCanvasElement {
  const { width: W, height: H, depths, minDepth, maxDepth } = grid;
  const depthRange = maxDepth - minDepth || 1;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(W, H);

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const depth = depths[row * W + col] ?? minDepth;
      const t = Math.max(0, Math.min(1, (depth - minDepth) / depthRange));
      const c = depthToColor(t);
      const i = (row * W + col) * 4;
      imageData.data[i]     = Math.round(c.r * 255);
      imageData.data[i + 1] = Math.round(c.g * 255);
      imageData.data[i + 2] = Math.round(c.b * 255);
      imageData.data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/** Draw the depth heatmap bitmap, scaled to the current transform. */
export function renderHeatmap(
  ctx: CanvasRenderingContext2D,
  bitmap: HTMLCanvasElement,
  grid: TerrainData,
  t: OverviewTransform,
): void {
  const lonRange = grid.maxLon - grid.minLon || 1;
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  ctx.imageSmoothingEnabled = t.scale < 4;
  ctx.drawImage(bitmap, t.offsetX, t.offsetY, terrainW, terrainH);
}

/** Draw lat/lon grid lines with degree labels. Only visible at scale ≥ 2. */
export function renderGridLines(
  ctx: CanvasRenderingContext2D,
  grid: TerrainData,
  t: OverviewTransform,
  canvasW: number,
  canvasH: number,
): void {
  if (t.scale < 2) return;

  let interval: number;
  if (t.scale < 5)       interval = 0.5;
  else if (t.scale < 10) interval = 0.1;
  else                   interval = 0.05;

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 0.75;
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "9px 'JetBrains Mono', monospace";

  // Longitude lines (vertical)
  const startLon = Math.ceil(grid.minLon / interval) * interval;
  for (let lon = startLon; lon <= grid.maxLon + interval * 0.01; lon += interval) {
    const [cx] = lonLatToCanvas(lon, grid.minLat, grid, t);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, canvasH);
    ctx.stroke();
    ctx.textBaseline = "top";
    ctx.fillText(lon.toFixed(interval < 0.1 ? 2 : 1) + "°", cx + 3, 22);
  }

  // Latitude lines (horizontal)
  const startLat = Math.ceil(grid.minLat / interval) * interval;
  for (let lat = startLat; lat <= grid.maxLat + interval * 0.01; lat += interval) {
    const [, cy] = lonLatToCanvas(grid.minLon, lat, grid, t);
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(canvasW, cy);
    ctx.stroke();
    ctx.textBaseline = "bottom";
    ctx.fillText(lat.toFixed(interval < 0.1 ? 2 : 1) + "°", 4, cy - 2);
  }

  ctx.restore();
}

/** Draw coloured dots + labels for each marker. */
export function renderMarkers(
  ctx: CanvasRenderingContext2D,
  markers: Marker[],
  grid: TerrainData,
  t: OverviewTransform,
  canvasW: number,
  canvasH: number,
): void {
  for (const m of markers) {
    const [cx, cy] = lonLatToCanvas(m.lon, m.lat, grid, t);
    if (cx < -12 || cx > canvasW + 12 || cy < -12 || cy > canvasH + 12) continue;

    const color = MARKER_COLOR[m.type] ?? "#e2e8f0";
    const radius = Math.max(3, Math.min(9, t.scale * 1.8));

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (t.scale >= 3) {
      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText(m.label, cx + radius + 4, cy);
    }
  }
}

/** Draw a directional arrow at the camera's geographic position. */
export function renderCameraArrow(
  ctx: CanvasRenderingContext2D,
  lon: number,
  lat: number,
  headingDeg: number,
  grid: TerrainData,
  t: OverviewTransform,
): void {
  const [cx, cy] = lonLatToCanvas(lon, lat, grid, t);
  const size = 11;
  const rad = (headingDeg - 90) * (Math.PI / 180);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);

  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.6, size * 0.65);
  ctx.lineTo(0, 0);
  ctx.lineTo(-size * 0.6, size * 0.65);
  ctx.closePath();

  ctx.fillStyle = "#00e5ff";
  ctx.shadowColor = "#00e5ff";
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Habitat overlay
// ---------------------------------------------------------------------------

/**
 * Draw a 64×64 downsampled amber habitat heatmap on the overview canvas.
 * Drawn at proportional alpha matching the terrain shader (score × 0.4 opacity).
 */
export function renderHabitatOverlay(
  ctx: CanvasRenderingContext2D,
  scores: Float32Array,
  grid: TerrainData,
  t: OverviewTransform,
): void {
  const N = Math.round(Math.sqrt(scores.length));
  if (N === 0) return;

  const lonRange = grid.maxLon - grid.minLon || 1;
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;

  // Downsample to 64×64 for the offscreen pass
  const DS = 64;
  const offscreen = document.createElement("canvas");
  offscreen.width = DS;
  offscreen.height = DS;
  const octx = offscreen.getContext("2d")!;
  const imageData = octx.createImageData(DS, DS);

  for (let row = 0; row < DS; row++) {
    for (let col = 0; col < DS; col++) {
      // Map DS pixel → source grid cell
      const srcRow = Math.min(N - 1, Math.round((row / DS) * N));
      const srcCol = Math.min(N - 1, Math.round((col / DS) * N));
      const score = scores[srcRow * N + srcCol] ?? 0;
      const i = (row * DS + col) * 4;
      // Amber: rgb(251,146,60) at alpha = score × 0.4
      imageData.data[i]     = 251;
      imageData.data[i + 1] = 146;
      imageData.data[i + 2] = 60;
      imageData.data[i + 3] = Math.round(score * 0.4 * 255);
    }
  }
  octx.putImageData(imageData, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offscreen, t.offsetX, t.offsetY, terrainW, terrainH);
  ctx.restore();
}

/** Draw a "100 px = X km" scale bar in the bottom-left corner. */
export function renderScaleBar(
  ctx: CanvasRenderingContext2D,
  grid: TerrainData,
  t: OverviewTransform,
  canvasH: number,
): void {
  const latCenter = (grid.minLat + grid.maxLat) / 2;
  const kmPerDeg = 111.32 * Math.cos((latCenter * Math.PI) / 180);
  const degsPerPx = 1 / (t.pxPerDeg * t.scale);
  const kmPer100px = 100 * degsPerPx * kmPerDeg;

  const barX = 16;
  const barY = canvasH - 24;
  const barW = 100;

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.5;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "9px 'JetBrains Mono', monospace";

  ctx.beginPath();
  ctx.moveTo(barX, barY - 4);
  ctx.lineTo(barX, barY);
  ctx.lineTo(barX + barW, barY);
  ctx.lineTo(barX + barW, barY - 4);
  ctx.stroke();

  const label = kmPer100px >= 10
    ? `${Math.round(kmPer100px)} km`
    : `${kmPer100px.toFixed(1)} km`;
  ctx.textBaseline = "bottom";
  ctx.fillText(label, barX + barW / 2 - 16, barY - 6);

  ctx.restore();
}
