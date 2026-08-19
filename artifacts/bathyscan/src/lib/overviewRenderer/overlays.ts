/**
 * overviewRenderer/overlays.ts — geographic overlays drawn over the heatmap:
 * grid lines, LOD gating, habitat scores, EFH + substrate polygons and their
 * hit-tests, scale bar, selection rect, synthetic-data hatch, intertidal band,
 * plus pin-descriptor types and the intertidal hotspot pin builder.
 */
import type {
  TerrainData,
  EfhFeature,
  SubstrateFeature,
} from "@workspace/api-client-react";
import type { UnitsSystem } from "../settingsStore";
import type { SelectedHotspot } from "../uiStore";
import { lonRangeOf, lonLatToCanvas, type OverviewTransform } from "./transforms";
import { hexToRgba } from "./internal";

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
