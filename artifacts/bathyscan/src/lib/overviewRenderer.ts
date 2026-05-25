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

/**
 * Draw depth poles as vertical lines + disc circles on the 2D overview.
 *
 * Each pole is rendered as a vertical line (from centre of canvas up by ~12 px)
 * topped with a pulsing circle, using the colour stored in marker.notes.
 */
export function renderDepthPoles(
  ctx: CanvasRenderingContext2D,
  markers: Marker[],
  grid: TerrainData,
  t: OverviewTransform,
  units: "metric" | "imperial" = "metric",
): void {
  const poles = markers.filter((m) => m.type === "depth_pole");
  if (!poles.length) return;

  ctx.save();
  for (const m of poles) {
    let colour = "#00ffee";
    try {
      const parsed = JSON.parse(m.notes ?? "{}") as Record<string, unknown>;
      if (typeof parsed["colour"] === "string") colour = parsed["colour"];
    } catch { /* ignored */ }

    const [cx, cy] = lonLatToCanvas(m.lon, m.lat, grid, t);

    // Vertical pole line
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - 14);
    ctx.stroke();

    // Disc at top
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy - 14, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Label beside pole
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = colour;
    ctx.font = "8px 'JetBrains Mono', monospace";
    ctx.textBaseline = "middle";
    const depthM = Math.abs(Math.round(m.depth));
    const depthTxt = units === "imperial"
      ? `${Math.round(depthM * 3.28084)}ft`
      : `${depthM}m`;
    ctx.fillText(`\u2212${depthTxt}`, cx + 5, cy - 14);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// GPS Position dot
// ---------------------------------------------------------------------------

/**
 * Draw the user's real GPS position on the overview map.
 * Shows a pulsing blue dot, a dashed accuracy ring, and an edge arrow if
 * the position is outside the terrain's bounding box.
 */
export function renderGpsPosition(
  ctx: CanvasRenderingContext2D,
  lon: number,
  lat: number,
  accuracy: number,
  grid: TerrainData,
  t: OverviewTransform,
  canvasW: number,
  canvasH: number,
  pulse: number,
  units: "metric" | "imperial" = "metric",
): void {
  const inBounds =
    lon >= grid.minLon && lon <= grid.maxLon &&
    lat >= grid.minLat && lat <= grid.maxLat;

  const [cx, cy] = lonLatToCanvas(lon, lat, grid, t);

  if (inBounds) {
    // Accuracy ring (dashed)
    const lonRange = grid.maxLon - grid.minLon || 1;
    const terrainW = t.pxPerDeg * lonRange * t.scale;
    const mPerPx = ((lonRange * 111_320) / terrainW);
    const accuracyR = accuracy / mPerPx;

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(59,130,246,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(6, accuracyR), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pulsing outer ring
    const outerR = 10 + 6 * pulse;
    ctx.strokeStyle = `rgba(59,130,246,${0.5 - 0.4 * pulse})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.stroke();

    // Solid inner dot
    ctx.fillStyle = "#3b82f6";
    ctx.shadowColor = "#3b82f6";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // "GPS" label
    ctx.fillStyle = "#93c5fd";
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textBaseline = "bottom";
    ctx.fillText("GPS", cx + 8, cy - 2);
    ctx.restore();
  } else {
    // Out-of-bounds: draw edge arrow pointing toward the position
    const centerX = canvasW / 2;
    const centerY = canvasH / 2;
    const angle = Math.atan2(cy - centerY, cx - centerX);
    const MARGIN = 18;
    const edgeX = Math.max(MARGIN, Math.min(canvasW - MARGIN, canvasW / 2 + Math.cos(angle) * (canvasW / 2 - MARGIN)));
    const edgeY = Math.max(MARGIN, Math.min(canvasH - MARGIN, canvasH / 2 + Math.sin(angle) * (canvasH / 2 - MARGIN)));

    // Distance in km
    const latCenter = (grid.minLat + grid.maxLat) / 2;
    const kmPerDegLon = 111.32 * Math.cos((latCenter * Math.PI) / 180);
    const dLon = (lon - (grid.minLon + grid.maxLon) / 2) * kmPerDegLon;
    const dLat = (lat - (grid.minLat + grid.maxLat) / 2) * 110.57;
    const distKm = Math.sqrt(dLon * dLon + dLat * dLat);

    ctx.save();
    ctx.fillStyle = "#3b82f6";
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1.5;

    // Arrowhead
    ctx.translate(edgeX, edgeY);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-4, 5);
    ctx.lineTo(-4, -5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#93c5fd";
    ctx.font = "8px 'JetBrains Mono', monospace";
    ctx.textBaseline = "middle";
    ctx.rotate(-angle);
    let distLabel: string;
    if (units === "imperial") {
      const mi = distKm * 0.621371;
      distLabel = mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
    } else {
      distLabel = distKm >= 10 ? `${Math.round(distKm)} km` : `${distKm.toFixed(1)} km`;
    }
    ctx.fillText(distLabel, 14, 0);

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Trail rendering
// ---------------------------------------------------------------------------

export interface CanvasTrailPoint { lon: number; lat: number; }
export interface CanvasSavedTrail { points: CanvasTrailPoint[]; colour: string; id: string; }

/**
 * Draw the live-recording trail polyline in orange.
 */
export function renderLiveTrail(
  ctx: CanvasRenderingContext2D,
  points: CanvasTrailPoint[],
  grid: TerrainData,
  t: OverviewTransform,
  pulse: number,
): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = "#f97316";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = "#f97316";
  ctx.shadowBlur = 3;

  ctx.beginPath();
  const [x0, y0] = lonLatToCanvas(points[0]!.lon, points[0]!.lat, grid, t);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < points.length; i++) {
    const [x, y] = lonLatToCanvas(points[i]!.lon, points[i]!.lat, grid, t);
    ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Pulsing tip dot
  const last = points[points.length - 1]!;
  const [lx, ly] = lonLatToCanvas(last.lon, last.lat, grid, t);
  const r = 4 + 3 * pulse;
  ctx.beginPath();
  ctx.fillStyle = `rgba(249,115,22,${0.7 - 0.5 * pulse})`;
  ctx.arc(lx, ly, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f97316";
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(lx, ly, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
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

/** Draw a "100 px = X km" scale bar in the bottom-left corner. */
export function renderScaleBar(
  ctx: CanvasRenderingContext2D,
  grid: TerrainData,
  t: OverviewTransform,
  canvasH: number,
  units: "metric" | "imperial" = "metric",
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

  let label: string;
  if (units === "imperial") {
    const miPer100px = kmPer100px * 0.621371;
    if (miPer100px >= 1) {
      label = miPer100px >= 10 ? `${Math.round(miPer100px)} mi` : `${miPer100px.toFixed(1)} mi`;
    } else {
      const ftPer100px = kmPer100px * 1000 * 3.28084;
      label = `${Math.round(ftPer100px)} ft`;
    }
  } else {
    label = kmPer100px >= 10
      ? `${Math.round(kmPer100px)} km`
      : `${kmPer100px.toFixed(1)} km`;
  }
  ctx.textBaseline = "bottom";
  ctx.fillText(label, barX + barW / 2 - 16, barY - 6);

  ctx.restore();
}
