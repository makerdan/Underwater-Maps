/**
 * overviewRenderer.ts — pure canvas drawing functions for the OverviewMap.
 *
 * No React dependencies. All functions accept a 2D canvas context plus
 * data params and draw directly. Called every rAF frame.
 */
import type {
  TerrainData,
  EfhFeature,
  SubstrateFeature,
} from "@workspace/api-client-react";
import type { Marker } from "@workspace/api-client-react";
import type { UnitsSystem } from "./settingsStore";
import { depthToColor } from "./colormap";
import { MARKER_COLOR } from "./markerConstants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

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

// ---------------------------------------------------------------------------
// EFH overlay
// ---------------------------------------------------------------------------

/**
 * Draw EFH polygon outlines and semi-transparent fills on the overview canvas.
 * Each feature is stroked + filled using its species `color` property.
 */
export function renderEfhOverlay(
  ctx: CanvasRenderingContext2D,
  features: EfhFeature[],
  grid: TerrainData,
  t: OverviewTransform,
  hiddenSpecies: ReadonlySet<string> = new Set(),
): void {
  if (!features.length) return;

  ctx.save();

  for (const feature of features) {
    if (hiddenSpecies.has(feature.properties.commonName ?? "")) continue;
    const geom = feature.geometry as { type?: string; coordinates?: number[][][] };
    if (geom.type !== "Polygon" || !geom.coordinates?.[0]) continue;

    const ring = geom.coordinates[0];
    const color = feature.properties.color ?? "#00e5ff";

    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const pt = ring[i]!;
      const lon = pt[0] ?? 0;
      const lat = pt[1] ?? 0;
      const [cx, cy] = lonLatToCanvas(lon, lat, grid, t);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.closePath();

    ctx.fillStyle = hexToRgba(color, 0.07);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(color, 0.7);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

/**
 * Ray-casting point-in-polygon test against a single ring (lon/lat space).
 */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0] ?? 0;
    const yi = ring[i]?.[1] ?? 0;
    const xj = ring[j]?.[0] ?? 0;
    const yj = ring[j]?.[1] ?? 0;
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Hit-test a lon/lat point against a list of EFH polygon features.
 *
 * Returns the topmost (last-drawn) feature whose polygon contains the point,
 * or null if the point falls outside all features. Iterating in reverse so
 * features rendered on top of others are returned first.
 */
export function hitTestEfh(
  lon: number,
  lat: number,
  features: EfhFeature[],
): EfhFeature | null {
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (!f) continue;
    const geom = f.geometry as { type?: string; coordinates?: number[][][] };
    if (geom.type !== "Polygon" || !geom.coordinates?.[0]) continue;
    if (pointInRing(lon, lat, geom.coordinates[0])) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// EFH legend (interactive, per-species toggle)
// ---------------------------------------------------------------------------

/**
 * One row of the EFH species legend used for click hit-testing.
 */
export interface EfhLegendRow {
  /** `commonName` as stored in feature.properties — used as the toggle key. */
  key: string;
  /** Display label. */
  label: string;
  /** Species hex color. */
  color: string;
  /** Click hit-rect in canvas pixels: [x, y, w, h]. */
  rect: [number, number, number, number];
}

export interface EfhLegendLayout {
  box: [number, number, number, number];
  rows: EfhLegendRow[];
}

/**
 * Draw a compact per-species toggle legend in the bottom-right corner of the
 * canvas. Unique species are derived from the features array; each row can be
 * toggled on/off via `hiddenSpecies`. Hidden rows are dimmed and struck-through.
 *
 * Returns the layout so callers can hit-test clicks and call
 * `uiStore.toggleEfhSpecies(key)`.
 */
export function renderEfhLegend(
  ctx: CanvasRenderingContext2D,
  features: EfhFeature[],
  cW: number,
  cH: number,
  hiddenSpecies: ReadonlySet<string> = new Set(),
): EfhLegendLayout | null {
  if (!features.length) return null;

  // Collect unique (commonName, color) pairs in first-seen order.
  const seen = new Map<string, string>();
  for (const f of features) {
    const name = f.properties.commonName ?? f.properties.species ?? "";
    if (name && !seen.has(name)) seen.set(name, f.properties.color ?? "#00e5ff");
  }
  const entries = Array.from(seen.entries());
  if (!entries.length) return null;

  const FONT = "'JetBrains Mono', monospace";
  const SWATCH = 9;
  const ROW_H = 14;
  const PAD = 8;
  const FONT_SIZE = 9;
  const HEADER_H = 14;

  ctx.save();
  ctx.font = `${FONT_SIZE}px ${FONT}`;

  const labels = entries.map(([name]) => name);
  const maxW = labels.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const headerW = ctx.measureText("EFH SPECIES").width;
  const boxW = PAD * 2 + SWATCH + 6 + Math.max(maxW, headerW);
  const boxH = PAD * 2 + HEADER_H + entries.length * ROW_H;
  const x = cW - boxW - 8;
  const y = cH - boxH - 30;

  ctx.fillStyle = "rgba(2,8,24,0.85)";
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(34,197,94,0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#475569";
  ctx.fillText("EFH SPECIES", x + PAD, y + PAD + FONT_SIZE);

  const rows: EfhLegendRow[] = entries.map(([name, color], i) => {
    const rowY = y + PAD + HEADER_H + i * ROW_H;
    const hidden = hiddenSpecies.has(name);
    const alpha = hidden ? 0.32 : 1.0;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x + PAD, rowY + 1, SWATCH, SWATCH);
    ctx.strokeStyle = hexToRgba(color, 0.95);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + PAD + 0.5, rowY + 1.5, SWATCH, SWATCH);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(name, x + PAD + SWATCH + 6, rowY + FONT_SIZE);

    if (hidden) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const lineY = rowY + 1 + SWATCH / 2 + 0.5;
      ctx.moveTo(x + PAD, lineY);
      ctx.lineTo(x + boxW - PAD, lineY);
      ctx.stroke();
    }

    ctx.globalAlpha = 1.0;

    return {
      key: name,
      label: name,
      color,
      rect: [x + 2, rowY, boxW - 4, ROW_H],
    };
  });

  ctx.restore();

  return { box: [x, y, boxW, boxH], rows };
}

/**
 * Hit-test a canvas-pixel click against an EFH legend layout. Returns the
 * commonName key whose row was clicked, or null if outside any row.
 */
export function hitTestEfhLegend(
  cx: number,
  cy: number,
  layout: EfhLegendLayout | null,
): string | null {
  if (!layout) return null;
  for (const r of layout.rows) {
    const [x, y, w, h] = r.rect;
    if (cx >= x && cx <= x + w && cy >= y && cy <= y + h) return r.key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Substrate overlay (ShoreZone / ENC / TPWD lake polygons)
// ---------------------------------------------------------------------------

/**
 * Draw substrate polygons (Polygon + MultiPolygon) on the overview canvas.
 * Each polygon is filled at low opacity and outlined using its CMECS color.
 */
export function renderSubstrateOverlay(
  ctx: CanvasRenderingContext2D,
  features: SubstrateFeature[],
  grid: TerrainData,
  t: OverviewTransform,
  selectedUnitId: string | null = null,
  hiddenClasses: ReadonlySet<string> = new Set(),
): void {
  if (!features.length) return;
  ctx.save();

  const drawRing = (ring: number[][]) => {
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const pt = ring[i]!;
      const [cx, cy] = lonLatToCanvas(pt[0] ?? 0, pt[1] ?? 0, grid, t);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.closePath();
  };

  for (const feature of features) {
    if (hiddenClasses.has(feature.properties.substrate.toLowerCase())) continue;
    const geom = feature.geometry as
      | { type: "Polygon"; coordinates: number[][][] }
      | { type: "MultiPolygon"; coordinates: number[][][][] }
      | { type?: string };
    const color = feature.properties.color ?? "#e2d5a0";
    const selected = selectedUnitId === feature.properties.unitId;
    const fillAlpha = selected ? 0.45 : 0.25;
    const strokeAlpha = selected ? 1.0 : 0.8;

    const ringsList: number[][][][] = [];
    if (geom.type === "Polygon" && Array.isArray((geom as { coordinates?: unknown }).coordinates)) {
      ringsList.push((geom as { coordinates: number[][][] }).coordinates);
    } else if (
      geom.type === "MultiPolygon" &&
      Array.isArray((geom as { coordinates?: unknown }).coordinates)
    ) {
      for (const rings of (geom as { coordinates: number[][][][] }).coordinates) {
        ringsList.push(rings);
      }
    } else {
      continue;
    }

    for (const rings of ringsList) {
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      drawRing(outer);
      ctx.fillStyle = hexToRgba(color, fillAlpha);
      ctx.fill("evenodd");
      ctx.lineWidth = selected ? 2 : 1.25;
      ctx.strokeStyle = hexToRgba(color, strokeAlpha);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Hit-test a lon/lat point against substrate polygon features. Returns the
 * topmost (last-drawn) feature whose outer ring contains the point, or null.
 */
export function hitTestSubstrate(
  lon: number,
  lat: number,
  features: SubstrateFeature[],
  hiddenClasses: ReadonlySet<string> = new Set(),
): SubstrateFeature | null {
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (!f) continue;
    if (hiddenClasses.has(f.properties.substrate.toLowerCase())) continue;
    const geom = f.geometry as
      | { type: "Polygon"; coordinates: number[][][] }
      | { type: "MultiPolygon"; coordinates: number[][][][] }
      | { type?: string };
    if (geom.type === "Polygon" && Array.isArray((geom as { coordinates?: unknown }).coordinates)) {
      const outer = (geom as { coordinates: number[][][] }).coordinates[0];
      if (outer && pointInRing(lon, lat, outer)) return f;
    } else if (
      geom.type === "MultiPolygon" &&
      Array.isArray((geom as { coordinates?: unknown }).coordinates)
    ) {
      for (const rings of (geom as { coordinates: number[][][][] }).coordinates) {
        const outer = rings[0];
        if (outer && pointInRing(lon, lat, outer)) return f;
      }
    }
  }
  return null;
}

/**
 * One row of the substrate legend, with the canvas-pixel bounding box used
 * for click hit-testing the row to toggle visibility.
 */
export interface SubstrateLegendRow {
  /** Lower-cased substrate key, matches `feature.properties.substrate`. */
  key: string;
  /** Display label (upper-cased substrate name). */
  label: string;
  /** CMECS swatch color (hex). */
  color: string;
  /** Click hit-rect in canvas pixels: [x, y, w, h]. */
  rect: [number, number, number, number];
}

export interface SubstrateLegendLayout {
  /** Box bounds: [x, y, w, h]. */
  box: [number, number, number, number];
  rows: SubstrateLegendRow[];
}

/**
 * Draw a compact substrate legend (CMECS classes present in the current
 * feature set) in the bottom-left corner. The 3D scene's substrate legend
 * lives in the Overlays & Tools side panel; this is the 2D equivalent.
 *
 * Rows whose substrate key is in `hiddenClasses` are rendered dimmed to
 * signal they're filtered out. Returns the layout so callers can hit-test
 * legend clicks against `rows[i].rect` and toggle the class.
 */
export function renderSubstrateLegend(
  ctx: CanvasRenderingContext2D,
  features: SubstrateFeature[],
  cH: number,
  hiddenClasses: ReadonlySet<string> = new Set(),
): SubstrateLegendLayout | null {
  if (!features.length) return null;

  // Collect unique (substrate, color) pairs, preserving first-seen order.
  const seen = new Map<string, string>();
  for (const f of features) {
    const key = f.properties.substrate;
    if (!seen.has(key)) seen.set(key, f.properties.color ?? "#e2d5a0");
  }
  const entries = Array.from(seen.entries());
  if (!entries.length) return null;

  const FONT = "'JetBrains Mono', monospace";
  const SWATCH = 9;
  const ROW_H = 14;
  const PAD = 8;
  const FONT_SIZE = 9;
  const HEADER_H = 14;

  ctx.save();
  ctx.font = `${FONT_SIZE}px ${FONT}`;
  const labels = entries.map(([s]) => s.toUpperCase());
  const maxW = labels.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const headerW = ctx.measureText("SUBSTRATE").width;
  const boxW = PAD * 2 + SWATCH + 6 + Math.max(maxW, headerW);
  const boxH = PAD * 2 + HEADER_H + entries.length * ROW_H;
  const x = 12;
  const y = cH - boxH - 40;

  ctx.fillStyle = "rgba(2,8,24,0.85)";
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,229,255,0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#475569";
  ctx.fillText("SUBSTRATE", x + PAD, y + PAD + FONT_SIZE);

  const rows: SubstrateLegendRow[] = entries.map(([label, color], i) => {
    const rowY = y + PAD + HEADER_H + i * ROW_H;
    const key = label.toLowerCase();
    const hidden = hiddenClasses.has(key);
    const alpha = hidden ? 0.32 : 1.0;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x + PAD, rowY + 1, SWATCH, SWATCH);
    ctx.strokeStyle = hexToRgba(color, 0.95);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + PAD + 0.5, rowY + 1.5, SWATCH, SWATCH);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(labels[i] ?? label.toUpperCase(), x + PAD + SWATCH + 6, rowY + FONT_SIZE);

    // Strike-through hidden rows so the dimming reads as "filtered out".
    if (hidden) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const lineY = rowY + 1 + SWATCH / 2 + 0.5;
      ctx.moveTo(x + PAD, lineY);
      ctx.lineTo(x + boxW - PAD, lineY);
      ctx.stroke();
    }

    ctx.globalAlpha = 1.0;

    return {
      key,
      label: labels[i] ?? label.toUpperCase(),
      color,
      rect: [x + 2, rowY, boxW - 4, ROW_H],
    };
  });

  ctx.restore();

  return { box: [x, y, boxW, boxH], rows };
}

/**
 * Hit-test a canvas-pixel click against a substrate legend layout. Returns
 * the substrate key (lower-cased) whose row was clicked, or null if the
 * click was outside any row. Used by OverviewMap to toggle legend filters.
 */
export function hitTestSubstrateLegend(
  cx: number,
  cy: number,
  layout: SubstrateLegendLayout | null,
): string | null {
  if (!layout) return null;
  for (const r of layout.rows) {
    const [x, y, w, h] = r.rect;
    if (cx >= x && cx <= x + w && cy >= y && cy <= y + h) return r.key;
  }
  return null;
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
  units: UnitsSystem = "metric",
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
    const depthTxt = units !== "metric"
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
  units: UnitsSystem = "metric",
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
    if (units !== "metric") {
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
  units: UnitsSystem = "metric",
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
  if (units !== "metric") {
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

/**
 * Draw the user's box-select rectangle on top of the overview.
 *
 * Inputs are canvas-pixel coords (post-transform). We render a translucent
 * cyan fill with a dashed border and the bbox dimensions in degrees so the
 * user has a quick read on how big the area is.
 */
export function drawSelectionRect(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bboxDeg?: { width: number; height: number },
): void {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (w < 1 || h < 1) return;

  ctx.save();
  ctx.fillStyle = "rgba(0,229,255,0.10)";
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = "rgba(0,229,255,0.9)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.setLineDash([]);

  if (bboxDeg && w > 60 && h > 24) {
    const label = `${bboxDeg.width.toFixed(3)}° × ${bboxDeg.height.toFixed(3)}°`;
    ctx.font = "10px 'JetBrains Mono', monospace";
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(0,10,20,0.85)";
    ctx.fillRect(x + 4, y + 4, tw + 8, 16);
    ctx.fillStyle = "#00e5ff";
    ctx.textBaseline = "top";
    ctx.fillText(label, x + 8, y + 7);
  }
  ctx.restore();
}
