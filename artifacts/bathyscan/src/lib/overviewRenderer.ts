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
import type { UnitsSystem, ColormapTheme } from "./settingsStore";
import type { SelectedHotspot } from "./uiStore";
import { getColormap, getColormapDepthDomain, getColormapTRange } from "./colormap";
import { formatDepth } from "./units";
import { NO_DATA_COLOR } from "./terrain";

// Convert a linear-sRGB channel value (as used by THREE.js vertex colours and
// NO_DATA_COLOR) to a display-sRGB byte for the 2D canvas context.
// Mirrors the THREE.Color.convertLinearToSRGB() path used below for colormap
// colours so the no-data light-gray looks the same in the minimap as in the 3D
// terrain mesh.
function linearToSRGBByte(c: number): number {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

const NO_DATA_CANVAS_R = linearToSRGBByte(NO_DATA_COLOR.r);
const NO_DATA_CANVAS_G = linearToSRGBByte(NO_DATA_COLOR.g);
const NO_DATA_CANVAS_B = linearToSRGBByte(NO_DATA_COLOR.b);

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

/**
 * Return the effective longitude span for a bounding box, handling the case
 * where the box crosses the antimeridian (minLon > maxLon).
 * e.g. minLon=170, maxLon=-170  →  span = 20°
 */
export function lonRangeOf(grid: TerrainData): number {
  if (grid.minLon > grid.maxLon) {
    return grid.maxLon + 360 - grid.minLon;
  }
  return grid.maxLon - grid.minLon || 1;
}

/**
 * Normalise a longitude value so it lies on the same continuous number line as
 * grid.minLon when the bbox crosses the antimeridian.
 * e.g. with minLon=170: lon=-175 → 185 (so the fraction is (185-170)/20 = 0.75)
 */
export function normaliseLon(lon: number, grid: TerrainData): number {
  if (grid.minLon > grid.maxLon && lon < grid.minLon) {
    return lon + 360;
  }
  return lon;
}

/** Compute (offsetX, offsetY) for a lon/lat point given the transform. */
export function lonLatToCanvas(
  lon: number,
  lat: number,
  grid: TerrainData,
  t: OverviewTransform,
): [number, number] {
  const lonRange = lonRangeOf(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  const normLon = normaliseLon(lon, grid);
  return [
    t.offsetX + ((normLon - grid.minLon) / lonRange) * terrainW,
    // North-up: higher latitudes (North) map to smaller Y values (top of canvas).
    t.offsetY + (1 - (lat - grid.minLat) / latRange) * terrainH,
  ];
}

/** Convert a canvas pixel back to (lon, lat). */
export function canvasToLonLat(
  cx: number,
  cy: number,
  grid: TerrainData,
  t: OverviewTransform,
): { lon: number; lat: number } {
  const lonRange = lonRangeOf(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  let lon = grid.minLon + ((cx - t.offsetX) / terrainW) * lonRange;
  // Wrap back into [-180, 180] only for antimeridian-crossing bboxes where the
  // computed lon can legitimately exceed 180 (e.g. normalised 185 → -175).
  if (grid.minLon > grid.maxLon && lon > 180) lon -= 360;
  return {
    lon,
    // Inverse of the North-up Y formula in lonLatToCanvas.
    lat: grid.minLat + (1 - (cy - t.offsetY) / terrainH) * latRange,
  };
}

/** Build the initial transform so the terrain fits into the canvas at 88% fill. */
export function computeInitialTransform(
  grid: TerrainData,
  canvasW: number,
  canvasH: number,
): OverviewTransform {
  const lonRange = lonRangeOf(grid);
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
 * Compute a transform that centres and fills the canvas around an arbitrary
 * bounding box at 88% fill. Used by the "Fit to Data" button to frame the
 * union bbox of all visible datasets.
 *
 * Unlike `computeInitialTransform`, this accepts a plain bbox object rather
 * than a full TerrainData grid, and handles the antimeridian-crossing case
 * (minLon > maxLon) the same way `lonRangeOf` does.
 */
export function computeFitTransform(
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number },
  canvasW: number,
  canvasH: number,
): OverviewTransform {
  const lonRange =
    bbox.minLon > bbox.maxLon
      ? bbox.maxLon + 360 - bbox.minLon || 1
      : bbox.maxLon - bbox.minLon || 1;
  const latRange = bbox.maxLat - bbox.minLat || 1;
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
  const lonRange = lonRangeOf(grid);
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
export function buildHeatmapBitmap(
  grid: TerrainData,
  colormapTheme: ColormapTheme = "ocean",
  topography?: number[] | null,
): HTMLCanvasElement {
  const { width: W, height: H, depths, minDepth, maxDepth } = grid;
  // Match the 3D terrain: ocean/custom themes normalise against the absolute
  // 0–2000 ft scale; fixed themes stretch across the grid's own range.
  const domain = getColormapDepthDomain(colormapTheme, minDepth, maxDepth);
  const depthRange = domain.max - domain.min || 1;
  const toColor = getColormap(colormapTheme);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(W, H);

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      // Flip Y so row 0 (top of canvas) maps to the northernmost data row,
      // matching Minimap.tsx's North-up convention.
      const dataIdx = (H - 1 - row) * W + col;
      const rawDepth = depths[dataIdx];
      const i = (row * W + col) * 4;

      // Null / NaN depth → survey gap: render as the NO_DATA_COLOR light-gray
      // so coverage boundaries are visible at a glance, matching the 3D
      // terrain mesh which places null-depth vertices at the water surface
      // with the same muted colour (see buildTerrainGeometry in terrain.ts).
      if (rawDepth === null || rawDepth === undefined || Number.isNaN(rawDepth as number)) {
        imageData.data[i]     = NO_DATA_CANVAS_R;
        imageData.data[i + 1] = NO_DATA_CANVAS_G;
        imageData.data[i + 2] = NO_DATA_CANVAS_B;
        imageData.data[i + 3] = 255;
        continue;
      }

      // Land cell (above-water elevation > 0 in topography): render as flat
      // gray matching the 3D shader land colour so inland reservoirs like Lake
      // Ray Roberts show the surrounding land distinctly from the water.
      if (topography && (topography[dataIdx] ?? 0) > 0) {
        imageData.data[i]     = 120;
        imageData.data[i + 1] = 120;
        imageData.data[i + 2] = 120;
        imageData.data[i + 3] = 255;
        continue;
      }

      const t = Math.max(0, Math.min(1, (rawDepth - domain.min) / depthRange));
      // Convert THREE.Color (linear-sRGB when ColorManagement is enabled) to
      // display-space sRGB bytes for 2D canvas, matching the legend strip and
      // the colormapCanvas helper in colormap.ts.
      const lin = toColor(t);
      const c = lin.clone().convertLinearToSRGB();
      imageData.data[i]     = Math.max(0, Math.min(255, Math.round(c.r * 255)));
      imageData.data[i + 1] = Math.max(0, Math.min(255, Math.round(c.g * 255)));
      imageData.data[i + 2] = Math.max(0, Math.min(255, Math.round(c.b * 255)));
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
  const lonRange = lonRangeOf(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  ctx.imageSmoothingEnabled = t.scale < 4;
  ctx.drawImage(bitmap, t.offsetX, t.offsetY, terrainW, terrainH);
}

/**
 * Draw a heatmap bitmap for a dataset whose bounding box is `dataBbox`,
 * positioned within a world-space coordinate frame defined by `worldGrid` + `t`.
 *
 * Used in multi-dataset mode where the transform is derived from the combined
 * extent of all visible datasets rather than a single dataset's bbox.
 */
export function renderHeatmapAtBbox(
  ctx: CanvasRenderingContext2D,
  bitmap: HTMLCanvasElement,
  dataBbox: { minLon: number; maxLon: number; minLat: number; maxLat: number },
  worldGrid: TerrainData,
  t: OverviewTransform,
): void {
  // Top-left in canvas space = NW corner (minLon, maxLat)
  // Bottom-right           = SE corner (maxLon, minLat)
  const [x0, y0] = lonLatToCanvas(dataBbox.minLon, dataBbox.maxLat, worldGrid, t);
  const [x1, y1] = lonLatToCanvas(dataBbox.maxLon, dataBbox.minLat, worldGrid, t);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  ctx.imageSmoothingEnabled = t.scale < 4;
  ctx.drawImage(bitmap, x0, y0, w, h);
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


// ---------------------------------------------------------------------------
// LOD constants
// ---------------------------------------------------------------------------

/**
 * Minimum canvas scale at which EFH and substrate polygon layers are drawn.
 * Below this threshold the polygons are too small to be legible and are
 * suppressed to reduce draw noise and CPU cost.
 *
 * At scale=1 the terrain fills ~88% of the canvas.  Scale=1.5 corresponds to
 * roughly 1.5× zoom-in, which is the point where polygon shapes measuring
 * ~0.1° across become individually distinguishable (≥5–6 px wide).
 */
export const POLYGON_LOD_MIN_ZOOM = 1.5;

/**
 * Returns true when the current map scale is high enough to render polygon
 * overlays (EFH, Substrate). At lower zoom levels the polygons are too small
 * to read, so callers should skip the draw call entirely.
 *
 * Used by OverviewMap.tsx before every `renderEfhOverlay` /
 * `renderSubstrateOverlay` call so the gate is in one place and testable.
 */
export function shouldDrawOverlayAtScale(scale: number): boolean {
  return scale >= POLYGON_LOD_MIN_ZOOM;
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

  const lonRange = lonRangeOf(grid);
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

  ctx.fillStyle = "#94a3b8";
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
      | { type: "Point"; coordinates: [number, number] }
      | { type?: string };
    const color = feature.properties.color ?? "#e2d5a0";
    const selected = selectedUnitId === feature.properties.unitId;
    const fillAlpha = selected ? 0.45 : 0.25;
    const strokeAlpha = selected ? 1.0 : 0.8;

    if (geom.type === "Point") {
      const coords = (geom as { type: "Point"; coordinates: [number, number] }).coordinates;
      const [cx, cy] = lonLatToCanvas(coords[0] ?? 0, coords[1] ?? 0, grid, t);
      const radius = selected ? 5 : 3.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(color, selected ? 0.9 : 0.75);
      ctx.fill();
      ctx.lineWidth = selected ? 1.75 : 1;
      ctx.strokeStyle = hexToRgba(color, 1.0);
      ctx.stroke();
      continue;
    }

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
 * Approximate lon/lat proximity radius for hit-testing NOAA bottom-sample
 * Point features.  ~0.005° ≈ ~500 m, large enough to be tappable but tight
 * enough to avoid accidentally selecting distant points.
 */
const POINT_HIT_RADIUS_DEG = 0.005;

/**
 * Hit-test a lon/lat point against substrate features (Polygon, MultiPolygon,
 * and Point).  Returns the topmost matching feature, or null.
 *
 * Point features use a fixed lon/lat proximity radius instead of a
 * ring-containment test.
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
      | { type: "Point"; coordinates: [number, number] }
      | { type?: string };
    if (geom.type === "Point") {
      const [pLon, pLat] = (geom as { type: "Point"; coordinates: [number, number] }).coordinates;
      const dx = (lon - (pLon ?? 0));
      const dy = (lat - (pLat ?? 0));
      if (Math.sqrt(dx * dx + dy * dy) <= POINT_HIT_RADIUS_DEG) return f;
    } else if (geom.type === "Polygon" && Array.isArray((geom as { coordinates?: unknown }).coordinates)) {
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

  ctx.fillStyle = "#94a3b8";
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

/**
 * Render a depth-to-colour legend strip in the top-right corner of the
 * overview canvas. The strip runs from shallow (top, t=0) to deep (bottom,
 * t=1) using the active colormap theme, with depth labels at the top, middle,
 * and bottom tick marks. Matches the 3D HUD DepthScaleBar so both views
 * communicate the same colour scale.
 *
 * @param theme    Active colormap theme (read from settingsStore each frame).
 * @param minDepth Shallowest depth value in the grid (metres).
 * @param maxDepth Deepest depth value in the grid (metres).
 * @param canvasW  Canvas width in pixels.
 * @param canvasH  Canvas height in pixels.
 * @param units    Unit system for depth labels.
 */
export function renderColormapLegend(
  ctx: CanvasRenderingContext2D,
  theme: ColormapTheme,
  minDepth: number,
  maxDepth: number,
  canvasW: number,
  canvasH: number,
  units: UnitsSystem = "metric",
): void {
  const STRIP_W = 10;
  const STRIP_H = 120;
  const MARGIN_RIGHT = 16;
  const MARGIN_TOP = 16;
  const x = canvasW - MARGIN_RIGHT - STRIP_W;
  const y = MARGIN_TOP;
  const LABEL_X = x - 4;

  const toColor = getColormap(theme);
  // Crop the strip to the dataset's slice of the absolute depth scale
  // (ocean/custom themes) so it matches the heatmap colours.
  const { tMin, tMax } = getColormapTRange(theme, minDepth, maxDepth);
  ctx.save();

  // Draw the gradient strip row by row (top = shallow, bottom = deep).
  // Convert THREE.Color (linear-sRGB) to display-space sRGB bytes so the strip
  // matches the colour the renderer paints on screen.
  for (let py = 0; py < STRIP_H; py++) {
    const t = tMin + (py / (STRIP_H - 1)) * (tMax - tMin);
    const c = toColor(t).clone().convertLinearToSRGB();
    const r = Math.max(0, Math.min(255, Math.round(c.r * 255)));
    const g = Math.max(0, Math.min(255, Math.round(c.g * 255)));
    const b = Math.max(0, Math.min(255, Math.round(c.b * 255)));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y + py, STRIP_W, 1);
  }

  // Thin border around the strip
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.5, y + 0.5, STRIP_W - 1, STRIP_H - 1);

  // Tick marks at top, middle, and bottom, extending left from the strip
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1;
  for (const frac of [0, 0.5, 1]) {
    const ty = y + Math.round(frac * (STRIP_H - 1));
    ctx.beginPath();
    ctx.moveTo(x - 3, ty);
    ctx.lineTo(x, ty);
    ctx.stroke();
  }

  // Depth labels (metres or feet) right-aligned next to the tick marks
  ctx.font = "8px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.textAlign = "right";

  const depthToLabel = (metres: number): string => {
    const d = Math.abs(Math.round(metres));
    if (units !== "metric") {
      return `${Math.round(d * 3.28084)}ft`;
    }
    return `${d}m`;
  };

  ctx.textBaseline = "top";
  ctx.fillText(depthToLabel(minDepth), LABEL_X, y);

  ctx.textBaseline = "middle";
  ctx.fillText(depthToLabel((minDepth + maxDepth) / 2), LABEL_X, y + STRIP_H / 2);

  ctx.textBaseline = "bottom";
  ctx.fillText(depthToLabel(maxDepth), LABEL_X, y + STRIP_H);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Contour lines (marching squares)
// ---------------------------------------------------------------------------

/**
 * One line segment belonging to a depth contour.
 * Positions are in fractional grid coordinates (0 .. W-1 and 0 .. H-1).
 */
export interface ContourSegment {
  depth: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Marching-squares edge lookup table.
 * Index: 4-bit mask where bit3=TL, bit2=TR, bit1=BR, bit0=BL (1 = at/above iso).
 * Value: array of [edgeA, edgeB] pairs to connect.
 * Edges: 0=top, 1=right, 2=bottom, 3=left.
 */
const MARCHING_EDGES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [],                    // 0  0000
  [[3, 2]],             // 1  0001 BL
  [[2, 1]],             // 2  0010 BR
  [[3, 1]],             // 3  0011 BR+BL
  [[0, 1]],             // 4  0100 TR
  [[0, 3], [1, 2]],     // 5  0101 TR+BL saddle
  [[0, 2]],             // 6  0110 TR+BR
  [[0, 3]],             // 7  0111 TR+BR+BL
  [[0, 3]],             // 8  1000 TL
  [[0, 2]],             // 9  1001 TL+BL
  [[0, 1], [3, 2]],     // 10 1010 TL+BR saddle
  [[0, 1]],             // 11 1011 TL+BR+BL
  [[3, 1]],             // 12 1100 TL+TR
  [[2, 1]],             // 13 1101 TL+TR+BL
  [[3, 2]],             // 14 1110 TL+TR+BR
  [],                    // 15 1111
];

/** Linear interpolation factor for where the iso-depth crosses between a and b. */
function isoFrac(a: number, b: number, iso: number): number {
  const d = b - a;
  if (Math.abs(d) < 1e-10) return 0.5;
  return Math.max(0, Math.min(1, (iso - a) / d));
}

/**
 * Hard cap on the number of contour segments buildContourLines will emit.
 * Very fine intervals (e.g. 0.25 m on a deep, high-resolution grid) could
 * otherwise generate millions of segments and stall both the 2D overview
 * canvas and the 3D line geometry. When the cap is hit, generation stops —
 * the shallowest levels (built first) are kept, deeper levels are dropped.
 */
export const MAX_CONTOUR_SEGMENTS = 200_000;

/**
 * Run marching-squares on a depth grid and return all iso-depth line segments.
 * Output is capped at MAX_CONTOUR_SEGMENTS.
 *
 * @param grid      - The terrain data (depths in metres).
 * @param intervalMetres - Spacing between contour levels in metres.
 */
export function buildContourLines(
  grid: TerrainData,
  intervalMetres: number,
): ContourSegment[] {
  const { width: W, height: H, depths, minDepth, maxDepth } = grid;
  if (W < 2 || H < 2 || intervalMetres <= 0) return [];

  const firstLevel =
    Math.ceil((minDepth + 1e-6) / intervalMetres) * intervalMetres;
  const segments: ContourSegment[] = [];

  for (
    let isoDepth = firstLevel;
    isoDepth < maxDepth - 1e-6;
    isoDepth += intervalMetres
  ) {
    for (let row = 0; row < H - 1; row++) {
      for (let col = 0; col < W - 1; col++) {
        const tl = depths[row * W + col] ?? minDepth;
        const tr = depths[row * W + (col + 1)] ?? minDepth;
        const br = depths[(row + 1) * W + (col + 1)] ?? minDepth;
        const bl = depths[(row + 1) * W + col] ?? minDepth;

        const idx =
          ((tl >= isoDepth ? 1 : 0) << 3) |
          ((tr >= isoDepth ? 1 : 0) << 2) |
          ((br >= isoDepth ? 1 : 0) << 1) |
          (bl >= isoDepth ? 1 : 0);

        if (idx === 0 || idx === 15) continue;

        // Fractional grid coordinates of the four possible edge crossings
        const edgePts: readonly [number, number][] = [
          [col + isoFrac(tl, tr, isoDepth), row],           // top
          [col + 1,                         row + isoFrac(tr, br, isoDepth)], // right
          [col + isoFrac(bl, br, isoDepth), row + 1],       // bottom
          [col,                             row + isoFrac(tl, bl, isoDepth)], // left
        ];

        for (const [eA, eB] of MARCHING_EDGES[idx]!) {
          if (segments.length >= MAX_CONTOUR_SEGMENTS) return segments;
          const [x0, y0] = edgePts[eA]!;
          const [x1, y1] = edgePts[eB]!;
          segments.push({ depth: isoDepth, x0, y0, x1, y1 });
        }
      }
    }
  }

  return segments;
}

/**
 * Render contour lines on the 2D overview canvas.
 * Lines are coloured by sampling the active colormap at each depth, drawn at
 * ~60% opacity. Depth labels are placed at sparse intervals when zoom ≥ 3.
 */
export function renderContourLines(
  ctx: CanvasRenderingContext2D,
  segments: ContourSegment[],
  grid: TerrainData,
  t: OverviewTransform,
  units: UnitsSystem,
  colormapTheme: ColormapTheme,
): void {
  if (!segments.length) return;

  const { width: W, height: H, minDepth, maxDepth } = grid;
  // Match the 3D terrain colour convention (absolute scale for ocean/custom).
  const colorDomain = getColormapDepthDomain(colormapTheme, minDepth, maxDepth);
  const depthRange = colorDomain.max - colorDomain.min || 1;
  const lonRange = lonRangeOf(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const toColor = getColormap(colormapTheme);

  /** Convert fractional grid coords (col, row) to canvas pixel coords. */
  const toCanvas = (gx: number, gy: number): [number, number] => {
    const lon = grid.minLon + (gx / Math.max(W - 1, 1)) * lonRange;
    const lat = grid.minLat + (gy / Math.max(H - 1, 1)) * latRange;
    return lonLatToCanvas(lon, lat, grid, t);
  };

  const lineW = Math.max(0.5, Math.min(1.5, t.scale * 0.35));
  const showLabels = t.scale >= 3;
  const fontSize = Math.max(8, Math.min(11, 9 * t.scale * 0.35));

  ctx.save();
  ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;

  // Group by depth level so we can batch strokes and pick a label point per level.
  const byDepth = new Map<number, ContourSegment[]>();
  for (const seg of segments) {
    if (!byDepth.has(seg.depth)) byDepth.set(seg.depth, []);
    byDepth.get(seg.depth)!.push(seg);
  }

  // ---------------------------------------------------------------------------
  // Label placement helpers
  // ---------------------------------------------------------------------------
  // Minimum gap (px) between the edges of any two label boxes.
  const LABEL_PAD = 8;

  // Exclusion zones — labels must not overlap these UI elements.
  // Colormap legend: 10 px strip at top-right (x = cW-26, y = 16, h = 120).
  // Its depth labels extend ~55 px further left, so guard to cW-80.
  // Scale bar: 100 px wide at bottom-left (x=16, y=cH-24).
  const cW = ctx.canvas.width;
  const cH = ctx.canvas.height;
  const exclusionZones = [
    { x: cW - 80, y: 0,      w: 80,  h: 155 }, // colormap legend (top-right)
    { x: 0,       y: cH - 50, w: 135, h: 50  }, // scale bar (bottom-left)
  ];

  // Each placed label stores its centre and half-extents for AABB overlap detection.
  const placedLabels: Array<{ x: number; y: number; hw: number; hh: number }> = [];

  /** True if the candidate label rect (centred at lx, ly) overlaps an exclusion zone or the canvas edge. */
  const overlapsExclusion = (lx: number, ly: number, tw: number): boolean => {
    const hw = tw / 2 + 4;
    const hh = fontSize / 2 + 3;
    if (lx - hw < 0 || lx + hw > cW || ly - hh < 0 || ly + hh > cH) return true;
    for (const z of exclusionZones) {
      if (lx + hw > z.x && lx - hw < z.x + z.w &&
          ly + hh > z.y && ly - hh < z.y + z.h) return true;
    }
    return false;
  };

  /**
   * True if the candidate label box (centred at lx, ly, width tw) would overlap —
   * with LABEL_PAD margin — any already-placed label.
   * Uses axis-aligned bounding-box (AABB) intersection rather than centre distance,
   * so wide labels never visually collide regardless of font size or zoom level.
   */
  const overlapsPlaced = (lx: number, ly: number, tw: number): boolean => {
    const hw = tw / 2 + 3;
    const hh = fontSize / 2 + 2;
    for (const p of placedLabels) {
      if (lx + hw + LABEL_PAD > p.x - p.hw &&
          lx - hw - LABEL_PAD < p.x + p.hw &&
          ly + hh + LABEL_PAD > p.y - p.hh &&
          ly - hh - LABEL_PAD < p.y + p.hh) return true;
    }
    return false;
  };

  for (const [depth, segs] of byDepth) {
    const t01 = Math.max(0, Math.min(1, (depth - colorDomain.min) / depthRange));
    const col = toColor(t01).clone().convertLinearToSRGB();
    const r = Math.max(0, Math.min(255, Math.round(col.r * 255)));
    const g = Math.max(0, Math.min(255, Math.round(col.g * 255)));
    const b = Math.max(0, Math.min(255, Math.round(col.b * 255)));

    ctx.strokeStyle = `rgba(${r},${g},${b},0.60)`;
    ctx.lineWidth = lineW;

    // Draw all segments for this level in a single path batch
    ctx.beginPath();
    for (const seg of segs) {
      const [cx0, cy0] = toCanvas(seg.x0, seg.y0);
      const [cx1, cy1] = toCanvas(seg.x1, seg.y1);
      ctx.moveTo(cx0, cy0);
      ctx.lineTo(cx1, cy1);
    }
    ctx.stroke();

    if (!showLabels || segs.length === 0) continue;

    // Contour depths are stored in metres; labels are formatted in the active unit.
    // Nautical uses fathoms for contour intervals (1 fathom = 1.8288 m).
    const label =
      units === "nautical"
        ? `${Math.round(depth / 1.8288)} fm`
        : formatDepth(depth, { units, decimals: 0 });
    const tw = ctx.measureText(label).width;

    // A segment must be at least this long in canvas pixels to physically fit
    // the label text with comfortable padding on each side.
    const minSegPx = tw + 16;

    // Build candidates: midpoint + pixel length + angle for every long-enough segment.
    type Candidate = { cx: number; cy: number; px: number; angle: number };
    const candidates: Candidate[] = [];
    for (const seg of segs) {
      const [cx0, cy0] = toCanvas(seg.x0, seg.y0);
      const [cx1, cy1] = toCanvas(seg.x1, seg.y1);
      const dx = cx1 - cx0;
      const dy = cy1 - cy0;
      const px = Math.sqrt(dx * dx + dy * dy);
      if (px < minSegPx) continue;
      // Compute the angle of the segment; flip if it would render text upside-down.
      let angle = Math.atan2(dy, dx);
      if (Math.abs(angle) > Math.PI / 2) angle += Math.PI;
      candidates.push({ cx: (cx0 + cx1) / 2, cy: (cy0 + cy1) / 2, px, angle });
    }

    // Prefer longer segments (more stable, better visual weight).
    candidates.sort((a, b) => b.px - a.px);

    // How many labels to place for this depth level.
    // At higher zoom levels the contour can span the whole canvas, so allow
    // more repetitions — but cap to prevent clutter. One label fits every
    // ~(tw + LABEL_PAD * 2 + 16) px of canvas width; allow up to 3× that density.
    const labelSlotWidth = tw + LABEL_PAD * 2 + 16;
    const maxLabels = Math.max(1, Math.min(4, Math.floor(cW / labelSlotWidth)));

    let placed = 0;
    for (const c of candidates) {
      if (placed >= maxLabels) break;
      if (overlapsExclusion(c.cx, c.cy, tw)) continue;
      if (overlapsPlaced(c.cx, c.cy, tw)) continue;

      const hw = tw / 2 + 3;
      const hh = fontSize / 2 + 2;
      placedLabels.push({ x: c.cx, y: c.cy, hw, hh });

      // Draw the label rotated to follow the contour line angle.
      ctx.save();
      ctx.translate(c.cx, c.cy);
      ctx.rotate(c.angle);
      ctx.fillStyle = "rgba(2,8,24,0.65)";
      ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.90)`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(label, 0, 0);
      ctx.restore();

      placed++;
    }
  }

  ctx.restore();
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
  bboxDeg?: {
    width: number;
    height: number;
    /** Override fill colour (default: "rgba(0,229,255,0.10)") */
    fillColor?: string;
    /** Override stroke colour (default: "rgba(0,229,255,0.9)") */
    strokeColor?: string;
    /** Override label text colour (default: "#00e5ff") */
    labelColor?: string;
  },
): void {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (w < 1 || h < 1) return;

  const fillColor = bboxDeg?.fillColor ?? "rgba(0,229,255,0.10)";
  const strokeColor = bboxDeg?.strokeColor ?? "rgba(0,229,255,0.9)";
  const labelColor = bboxDeg?.labelColor ?? "#00e5ff";

  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = strokeColor;
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
    ctx.fillStyle = labelColor;
    ctx.textBaseline = "top";
    ctx.fillText(label, x + 8, y + 7);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// NOAA Weather Station pins
// ---------------------------------------------------------------------------

export interface WeatherStationPin {
  id: string;
  lat: number;
  lon: number;
}

/**
 * Pin descriptor for RAWS station canvas rendering.
 * Mirrors WeatherStationPin but uses `datasetId` instead of `id`.
 */
export interface RawsStationPin {
  datasetId: string;
  lat: number;
  lon: number;
}

// ---------------------------------------------------------------------------
// Intertidal Hotspot pin types (used by both overviewRenderer and OverviewMap SVG layer)
// ---------------------------------------------------------------------------

export interface IntertidalHotspotPin {
  unitId: string;
  lon: number;
  lat: number;
  /** Active-mode score (0–100). Drives pin radius and opacity. */
  score: number;
  /** Hex color: teal (#0d9488) for tidepool, amber (#d97706) for beachcombing. */
  color: string;
}

// ---------------------------------------------------------------------------
// Intertidal hotspot pin-building (pure, exported for unit tests)
// ---------------------------------------------------------------------------

export interface IntertidalSpotFeature {
  geometry: { type?: string; coordinates?: unknown };
  properties: {
    unitId?: string;
    substrate?: string;
    shoreZoneClass?: string;
    szMaterial?: string | null;
    szForm?: string | null;
    tidepoolScore?: number;
    beachcombingScore?: number;
    scoreSignals?: {
      tidepool?: { substrate?: string; bioband?: string | null; debris?: string | null; energy?: string | null; humanUse?: string | null; whySummary?: string };
      beachcombing?: { substrate?: string; bioband?: string | null; debris?: string | null; energy?: string | null; humanUse?: string | null; whySummary?: string };
    };
  };
}

/**
 * Build `IntertidalHotspotPin[]` and a `Map<unitId, SelectedHotspot>` from a
 * GeoJSON-style features array.  Pure function — no side-effects, no React —
 * so it can be exercised directly in unit tests without mounting OverviewMap.
 *
 * Color is teal (#0d9488) for `tidepool` mode, amber (#d97706) for
 * `beachcombing` mode.  Score is the active-mode score (tidepoolScore when
 * mode=tidepool, beachcombingScore when mode=beachcombing).  Features whose
 * active-mode score is < 1, or whose geometry has no valid outer ring, are
 * silently skipped.
 */
export function buildIntertidalHotspotDescriptors(
  features: IntertidalSpotFeature[],
  mode: 'tidepool' | 'beachcombing',
  sourceName: string,
  creditUrl: string,
): { pins: IntertidalHotspotPin[]; dataMap: Map<string, SelectedHotspot> } {
  const color = mode === 'tidepool' ? '#0d9488' : '#d97706';
  const pins: IntertidalHotspotPin[] = [];
  const dataMap = new Map<string, SelectedHotspot>();

  for (const feature of features) {
    const p = feature.properties;
    const tidepoolScore = p.tidepoolScore ?? 0;
    const beachcombingScore = p.beachcombingScore ?? 0;
    const activeScore = mode === 'tidepool' ? tidepoolScore : beachcombingScore;
    if (activeScore < 1) continue;

    const geom = feature.geometry;
    let outerRing: number[][] | null = null;
    if (geom.type === 'Polygon') {
      outerRing = (geom.coordinates as number[][][])?.[0] ?? null;
    } else if (geom.type === 'MultiPolygon') {
      outerRing = (geom.coordinates as number[][][][])?.[0]?.[0] ?? null;
    }
    if (!outerRing || outerRing.length === 0) continue;

    let sumLon = 0, sumLat = 0;
    for (const pt of outerRing) { sumLon += pt[0] ?? 0; sumLat += pt[1] ?? 0; }
    const lon = sumLon / outerRing.length;
    const lat = sumLat / outerRing.length;
    const unitId = p.unitId ?? `${lon.toFixed(5)}_${lat.toFixed(5)}`;

    const sig = p.scoreSignals ?? {};
    const hotspot: SelectedHotspot = {
      unitId,
      substrate: p.substrate ?? "",
      shoreZoneClass: p.shoreZoneClass ?? "",
      tidepoolScore,
      beachcombingScore,
      szMaterial: p.szMaterial ?? null,
      szForm: p.szForm ?? null,
      signals: {
        tidepool: {
          substrate: sig.tidepool?.substrate ?? p.shoreZoneClass ?? "",
          bioband: sig.tidepool?.bioband ?? null,
          debris: sig.tidepool?.debris ?? null,
          energy: sig.tidepool?.energy ?? null,
          humanUse: sig.tidepool?.humanUse ?? null,
          whySummary: sig.tidepool?.whySummary ?? "",
        },
        beachcombing: {
          substrate: sig.beachcombing?.substrate ?? p.shoreZoneClass ?? "",
          bioband: sig.beachcombing?.bioband ?? null,
          debris: sig.beachcombing?.debris ?? null,
          energy: sig.beachcombing?.energy ?? null,
          humanUse: sig.beachcombing?.humanUse ?? null,
          whySummary: sig.beachcombing?.whySummary ?? "",
        },
      },
      sourceName,
      creditUrl,
    };

    pins.push({ unitId, lon, lat, score: activeScore, color });
    dataMap.set(unitId, hotspot);
  }

  return { pins, dataMap };
}

// ---------------------------------------------------------------------------
// Simulated (synthetic) data overlay — rainbow hatch over affected areas
// ---------------------------------------------------------------------------

/** Rainbow stripe colours used for the synthetic-data hatch (display sRGB). */
export const SYNTHETIC_HATCH_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#3b82f6", // blue
  "#a855f7", // violet
] as const;

/**
 * Draw a diagonal rainbow hatch plus a "SIMULATED" caption over a dataset's
 * bounding box on the Overview Map. Called only for grids whose data source
 * is synthetic — real-data coverage is never touched.
 */
export function renderSyntheticHatch(
  ctx: CanvasRenderingContext2D,
  dataBbox: { minLon: number; maxLon: number; minLat: number; maxLat: number },
  worldGrid: TerrainData,
  t: OverviewTransform,
): void {
  const [x0, y0] = lonLatToCanvas(dataBbox.minLon, dataBbox.maxLat, worldGrid, t);
  const [x1, y1] = lonLatToCanvas(dataBbox.maxLon, dataBbox.minLat, worldGrid, t);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();

  // Diagonal rainbow stripes (45°), cycling through the six hatch colours.
  const stripe = Math.max(6, Math.min(14, Math.min(w, h) / 12));
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = stripe * 0.55;
  let colorIdx = 0;
  for (let d = -h; d < w + h; d += stripe) {
    ctx.strokeStyle = SYNTHETIC_HATCH_COLORS[colorIdx % SYNTHETIC_HATCH_COLORS.length]!;
    colorIdx++;
    ctx.beginPath();
    ctx.moveTo(x0 + d, y0);
    ctx.lineTo(x0 + d + h, y0 + h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;

  // Amber warning border around the simulated area.
  ctx.strokeStyle = "rgba(245,158,11,0.9)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0 + 0.75, y0 + 0.75, w - 1.5, h - 1.5);

  // Caption — only when the patch is large enough to keep it legible.
  if (w >= 60 && h >= 24) {
    const fontPx = Math.max(9, Math.min(14, w / 12));
    ctx.font = `700 ${fontPx}px 'JetBrains Mono', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    const label = "⚠ SIMULATED";
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(2,8,24,0.75)";
    ctx.fillRect(cx - tw / 2 - 6, cy - fontPx * 0.9, tw + 12, fontPx * 1.8);
    ctx.fillStyle = "#f59e0b";
    ctx.fillText(label, cx, cy);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Intertidal band depth fill
// ---------------------------------------------------------------------------

const FT_TO_M = 0.3048;

/**
 * Render the intertidal depth band on the 2D overview canvas, mirroring the
 * teal/amber tints drawn by the 3D terrain shader.
 *
 * Depth convention (same as the 3D shader and buildHeatmapBitmap):
 *   positive depth → below MLLW (open water)
 *   zero           → MLLW (sea surface / datum reference)
 *   negative depth → above MLLW (intertidal / supratidal terrain)
 *
 *  Teal  (rgb 46,200,158) — cells where -mhwM ≤ depth ≤ 0  (lower intertidal)
 *  Amber (rgb 224,165,51) — cells where -mhhwM ≤ depth < -mhwM (upper intertidal)
 *
 * Positioning uses lonLatToCanvas with `worldGrid` so the overlay is placed
 * correctly in both single-dataset and multi-dataset (bbox-aware) modes.
 * The grid's depth rows are sampled with a Y-flip (matching buildHeatmapBitmap)
 * so the filled mask aligns north-up with the base heatmap.
 *
 * @param grid      — primary dataset overview grid (depth values + bbox).
 * @param worldGrid — coordinate frame for lon/lat → canvas projection.
 *                    In single-dataset mode this equals `grid`.
 * @param mhwFt     — effective MHW datum in feet above MLLW, or null.
 * @param mhhwFt    — effective MHHW datum in feet above MLLW, or null.
 */
export function renderIntertidalBand(
  ctx: CanvasRenderingContext2D,
  grid: TerrainData,
  worldGrid: TerrainData,
  t: OverviewTransform,
  mhwFt: number | null,
  mhhwFt: number | null,
): void {
  if (mhwFt === null) return; // need at least MHW to define the lower band

  const mhwM = mhwFt * FT_TO_M;
  // Upper band only when MHHW is distinct from MHW
  const mhhwM =
    mhhwFt !== null && mhhwFt !== mhwFt ? mhhwFt * FT_TO_M : null;

  const { width: W, height: H, depths } = grid;
  if (W < 2 || H < 2) return;

  // Derive canvas placement via bbox corners, matching renderHeatmapAtBbox so
  // the overlay sits correctly in multi-dataset (worldGrid != grid) mode.
  const [x0, y0] = lonLatToCanvas(grid.minLon, grid.maxLat, worldGrid, t);
  const [x1, y1] = lonLatToCanvas(grid.maxLon, grid.minLat, worldGrid, t);
  const canvasW = x1 - x0;
  const canvasH = y1 - y0;
  if (canvasW <= 0 || canvasH <= 0) return;

  // Use a 128×128 offscreen raster — sufficient detail at overview-map scale
  // without expensive allocations for large grids.
  const DS = 128;
  const offscreen = document.createElement("canvas");
  offscreen.width = DS;
  offscreen.height = DS;
  const octx = offscreen.getContext("2d")!;
  const imageData = octx.createImageData(DS, DS);
  const px = imageData.data;

  for (let row = 0; row < DS; row++) {
    for (let col = 0; col < DS; col++) {
      // Map DS pixel → source grid cell.
      // Flip Y (H-1-srcRow) so row 0 = northernmost data, matching
      // buildHeatmapBitmap's North-up convention.
      const srcRowFlipped = Math.min(H - 1, Math.round((row / DS) * H));
      const srcRow = H - 1 - srcRowFlipped;
      const srcCol = Math.min(W - 1, Math.round((col / DS) * W));
      const depth = depths[srcRow * W + srcCol] ?? null;
      if (depth === null) continue; // no-data gap — leave transparent
      const i = (row * DS + col) * 4;

      if (depth <= 0 && depth >= -mhwM) {
        // Lower intertidal: MLLW (depth=0) down to –MHW (matches shader inLower)
        px[i]     = 46;
        px[i + 1] = 200;
        px[i + 2] = 158;
        px[i + 3] = 130; // ~51% opacity, matches 3D shader mix factor 0.32
      } else if (mhhwM !== null && depth < -mhwM && depth >= -mhhwM) {
        // Upper intertidal: –MHW to –MHHW (matches shader inUpper)
        px[i]     = 224;
        px[i + 1] = 165;
        px[i + 2] = 51;
        px[i + 3] = 130;
      }
      // otherwise fully transparent (default 0,0,0,0)
    }
  }

  octx.putImageData(imageData, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offscreen, x0, y0, canvasW, canvasH);
  ctx.restore();
}
