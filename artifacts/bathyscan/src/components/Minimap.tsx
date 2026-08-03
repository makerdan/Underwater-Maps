import React, { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useAppState } from "@/lib/context";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { useGetMarkers, getGetMarkersQueryKey } from "@workspace/api-client-react";
import type { Marker } from "@workspace/api-client-react";
import { getColormap, getColormapDepthDomain, colormapCssGradient, getColormapTRange, getColormapStops } from "@/lib/colormap";
import { usePaletteStore } from "@/lib/paletteStore";
import { useSettingsStore } from "@/lib/settingsStore";
import type { ColormapTheme } from "@/lib/settingsStore";
import { WORLD_SIZE, NO_DATA_COLOR } from "@/lib/terrain";
import type { DepthsArray } from "@workspace/api-client-react";
import type { TerrainData } from "@workspace/api-client-react";
import { buildHillshadeLayer, buildHeatmapBitmap } from "@/lib/overviewRenderer";
import { useTerrainStore } from "@/lib/terrainStore";
import type { VisibleDataset } from "@/lib/terrainStore";
import { MARKER_COLOR } from "@/lib/markerConstants";
import { loadMarkerIconImage, peekMarkerIconImage } from "@/lib/markerIcons";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useSatelliteTileStore } from "@/lib/satelliteTileStore";

const W = 180;
const H = 180;

// sRGB-gamma byte for a linear-light channel value — keeps NO_DATA_COLOR on
// the same perceptual path as the colormapped tiles.
function linToSRGBByte(c: number): number {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

const ND_R = linToSRGBByte(NO_DATA_COLOR.r);
const ND_G = linToSRGBByte(NO_DATA_COLOR.g);
const ND_B = linToSRGBByte(NO_DATA_COLOR.b);

const MINIMAP_FT_TO_M = 0.3048;

// ---------------------------------------------------------------------------
// Union-bbox helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Compute the union bounding box of all visible datasets that have a loaded
 * `overviewGrid`, always seeded with `primaryTerrain`'s bbox so the primary
 * survey is never excluded even when its overview grid hasn't loaded yet.
 *
 * This prevents a race where the primary entry's `overviewGrid` is still null
 * (loading lag / overview fetch failure) while a secondary entry has already
 * loaded: without the seed, the union would omit the primary bbox entirely,
 * misplacing the heatmap and invalidating camera-arrow and click mapping.
 *
 * Returns null only when `primaryTerrain` is null/undefined and no
 * `visibleDatasets` entry has a loaded overviewGrid.
 */
export function computeMinimapUnionBbox(
  visibleDatasets: VisibleDataset[],
  primaryTerrain: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null | undefined,
): { minLon: number; maxLon: number; minLat: number; maxLat: number } | null {
  // Always start from the primary terrain's bbox if available, so the primary
  // heatmap is never clipped out of the canvas during secondary overview loading.
  let minLon = primaryTerrain ? primaryTerrain.minLon : Infinity;
  let maxLon = primaryTerrain ? primaryTerrain.maxLon : -Infinity;
  let minLat = primaryTerrain ? primaryTerrain.minLat : Infinity;
  let maxLat = primaryTerrain ? primaryTerrain.maxLat : -Infinity;

  // Expand the bbox with any secondary (or primary) overviewGrid extents.
  for (const v of visibleDatasets) {
    const g = v.overviewGrid;
    if (!g) continue;
    if (g.minLon < minLon) minLon = g.minLon;
    if (g.maxLon > maxLon) maxLon = g.maxLon;
    if (g.minLat < minLat) minLat = g.minLat;
    if (g.maxLat > maxLat) maxLat = g.maxLat;
  }

  if (!isFinite(minLon) || !isFinite(maxLon) || !isFinite(minLat) || !isFinite(maxLat)) {
    return null;
  }
  return { minLon, maxLon, minLat, maxLat };
}

/**
 * Compute the sub-rectangle of the 180×180 minimap canvas that a given dataset
 * bbox occupies within the union bbox (North-up, linear scaling).
 */
function datasetCanvasRect(
  dataBbox: { minLon: number; maxLon: number; minLat: number; maxLat: number },
  unionBbox: { minLon: number; maxLon: number; minLat: number; maxLat: number },
): { x: number; y: number; w: number; h: number } {
  const lonRange = unionBbox.maxLon - unionBbox.minLon || 1;
  const latRange = unionBbox.maxLat - unionBbox.minLat || 1;
  const x0 = ((dataBbox.minLon - unionBbox.minLon) / lonRange) * W;
  const x1 = ((dataBbox.maxLon - unionBbox.minLon) / lonRange) * W;
  // North-up: maxLat maps to small y (top), minLat maps to large y (bottom)
  const y0 = H - ((dataBbox.maxLat - unionBbox.minLat) / latRange) * H;
  const y1 = H - ((dataBbox.minLat - unionBbox.minLat) / latRange) * H;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Draw depth-band contour lines on the minimap canvas at each band boundary.
 *
 * For ocean/custom themes the boundaries come from `paletteStore.bandBoundaries`
 * (in feet) and are colored with the adjacent band's color. For fixed preset
 * themes the color-stop positions are used as t-values and converted to depths.
 *
 * Skips degenerate grids (< 4 cells in either dimension or flat depth range)
 * to avoid visual noise on placeholder/loading states.
 */
export function drawMinimapContours(
  ctx: CanvasRenderingContext2D,
  depths: DepthsArray,
  width: number,
  height: number,
  minDepth: number,
  maxDepth: number,
  colormapTheme: ColormapTheme,
  bandBoundaries: readonly number[],
  bandColors: readonly string[],
): void {
  if (width < 4 || height < 4 || maxDepth === minDepth) return;

  const depthRange = maxDepth - minDepth;

  // Build contour list: each entry is a depth value (metres, positive-down)
  // at which to draw an isoline, plus the display color for that line.
  const contours: Array<{ depthM: number; colorHex: string }> = [];

  if (colormapTheme === "ocean" || colormapTheme === "custom") {
    // bandBoundaries are in feet; skip the first (0 ft) and last boundary —
    // interior boundaries are where the visible band edges sit.
    for (let i = 1; i < bandBoundaries.length - 1; i++) {
      const depthM = bandBoundaries[i]! * MINIMAP_FT_TO_M;
      if (depthM <= minDepth || depthM >= maxDepth) continue;
      // Color: the band *above* this boundary (band index i, which runs from
      // boundaries[i] down to boundaries[i+1]).
      const colorHex = (bandColors[i] ?? bandColors[bandColors.length - 1])!;
      contours.push({ depthM, colorHex });
    }
  } else {
    // Fixed preset themes: derive contour depths from the t-positions of the
    // interior color stops.
    const stops = getColormapStops(colormapTheme);
    for (let i = 1; i < stops.length - 1; i++) {
      const stop = stops[i]!;
      const depthM = minDepth + stop.t * depthRange;
      if (depthM <= minDepth || depthM >= maxDepth) continue;
      // Convert THREE.Color (linear-sRGB) to a display-space hex string.
      const c = stop.color.clone().convertLinearToSRGB();
      const r = Math.max(0, Math.min(255, Math.round(c.r * 255)));
      const g = Math.max(0, Math.min(255, Math.round(c.g * 255)));
      const b = Math.max(0, Math.min(255, Math.round(c.b * 255)));
      const colorHex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      contours.push({ depthM, colorHex });
    }
  }

  if (contours.length === 0) return;

  // Canvas cell size (one grid cell → these many canvas pixels).
  const cellW = W / width;
  const cellH = H / height;

  ctx.save();
  ctx.lineWidth = 1;

  for (const { depthM, colorHex } of contours) {
    ctx.strokeStyle = colorHex;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();

    // --- Horizontal edges: between grid rows gy and gy+1 ---
    // Y-flip convention (matching drawHeatmap): gy=0 is the southernmost
    // (bottom) row, which maps to canvas py ≈ H. gy=height-1 is northernmost
    // (top), mapping to canvas py ≈ 0. The canvas y of the shared edge between
    // rows gy and gy+1 is (height - 1 - gy) * cellH.
    for (let gy = 0; gy < height - 1; gy++) {
      const edgeCy = (height - 1 - gy) * cellH;
      for (let gx = 0; gx < width; gx++) {
        const d1 = depths[gy * width + gx];
        const d2 = depths[(gy + 1) * width + gx];
        if (d1 == null || d2 == null) continue;
        if ((d1 < depthM) !== (d2 < depthM)) {
          const cx = gx * cellW;
          ctx.moveTo(cx, edgeCy);
          ctx.lineTo(cx + cellW, edgeCy);
        }
      }
    }

    // --- Vertical edges: between grid columns gx and gx+1 ---
    // The canvas x of the shared edge between columns gx and gx+1 is
    // (gx + 1) * cellW. Each row gy spans canvas y from (height-1-gy)*cellH
    // to (height-gy)*cellH.
    for (let gx = 0; gx < width - 1; gx++) {
      const edgeCx = (gx + 1) * cellW;
      for (let gy = 0; gy < height; gy++) {
        const d1 = depths[gy * width + gx];
        const d2 = depths[gy * width + (gx + 1)];
        if (d1 == null || d2 == null) continue;
        if ((d1 < depthM) !== (d2 < depthM)) {
          const cy = (height - 1 - gy) * cellH;
          ctx.moveTo(edgeCx, cy);
          ctx.lineTo(edgeCx, cy + cellH);
        }
      }
    }

    ctx.stroke();
  }

  ctx.globalAlpha = 1.0;
  ctx.restore();
}

export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  depths: DepthsArray,
  width: number,
  height: number,
  minDepth: number,
  maxDepth: number,
  colormapTheme: ColormapTheme = "ocean",
  topography?: number[] | null,
  grid?: TerrainData,
) {
  const domain = getColormapDepthDomain(colormapTheme, minDepth, maxDepth);
  const domainRange = domain.max - domain.min || 1;
  const toColor = getColormap(colormapTheme);
  const imageData = ctx.createImageData(W, H);

  // Pre-compute per-cell hillshade multipliers when a grid is supplied.
  // Applied in linear-sRGB space before gamma conversion, mirroring
  // buildHeatmapBitmap in overviewRenderer.ts and the GLSL path in terrainShader.ts.
  // buildHillshadeLayer indexes its output as (canvasRow * width + col) where
  // canvasRow 0 = northernmost (Y-flipped, same convention as this loop).
  const hillshade = grid ? buildHillshadeLayer(grid) : null;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const gx = Math.min(width - 1, Math.floor((px / W) * width));
      // Flip y so that py=0 (top) maps to high-latitude rows (North-up).
      // hillshadeRow is the Y-flipped grid row (same axis as buildHillshadeLayer).
      const hillshadeRow = Math.min(height - 1, Math.floor((py / H) * height));
      const gy = (height - 1) - hillshadeRow;
      const idx = gy * width + gx;
      const rawDepth = depths[idx];
      const i = (py * W + px) * 4;

      // Null/undefined depth → survey gap: render as NO_DATA_COLOR light-gray,
      // matching overviewRenderer.ts and the 3D terrain mesh behaviour.
      if (rawDepth === null || rawDepth === undefined) {
        imageData.data[i]     = ND_R;
        imageData.data[i + 1] = ND_G;
        imageData.data[i + 2] = ND_B;
        imageData.data[i + 3] = 255;
        continue;
      }

      // Hillshade multiplier for this grid cell (defaults to 1.0 if no grid).
      const hs = hillshade ? (hillshade[hillshadeRow * width + gx] ?? 1.0) : 1.0;

      // Land cell (above-water elevation > 0 in topography): render as
      // hillshaded gray matching overviewRenderer.ts and the 3D shader land colour.
      if (topography && (topography[idx] ?? 0) > 0) {
        // Base land gray is (120,120,120) in display-sRGB. Apply hillshade in
        // sRGB space (acceptable for neutral gray where gamma error is minimal),
        // mirroring the same approach in buildHeatmapBitmap.
        const v = Math.max(0, Math.min(255, Math.round(120 * hs)));
        imageData.data[i]     = v;
        imageData.data[i + 1] = v;
        imageData.data[i + 2] = v;
        imageData.data[i + 3] = 255;
        continue;
      }

      const t = Math.max(0, Math.min(1, (rawDepth - domain.min) / domainRange));
      // Multiply by the hillshade factor in linear-sRGB space BEFORE gamma
      // conversion so the lighting is physically correct, matching the GLSL path
      //   finalColor = paletteColor * lighting
      // in terrainShader.ts and the same approach in buildHeatmapBitmap.
      const lin = toColor(t);
      lin.r *= hs;
      lin.g *= hs;
      lin.b *= hs;
      // Convert THREE.Color (linear-sRGB when ColorManagement is enabled) to
      // display-space sRGB bytes for 2D canvas, matching the legend overlay
      // and the colormapCanvas helper in colormap.ts.
      const c = lin.clone().convertLinearToSRGB();
      imageData.data[i]     = Math.max(0, Math.min(255, Math.round(c.r * 255)));
      imageData.data[i + 1] = Math.max(0, Math.min(255, Math.round(c.g * 255)));
      imageData.data[i + 2] = Math.max(0, Math.min(255, Math.round(c.b * 255)));
      imageData.data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  heading: number,
) {
  // North-up convention: heading 0° = North = top of canvas = rotate(0).
  // Axis convention: +X = East, +Z = North. Heading 0° directly maps to 0 radians (up).
  const rad = heading * (Math.PI / 180);
  const size = 7;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(rad);

  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.6, size * 0.6);
  ctx.lineTo(0, 0);
  ctx.lineTo(-size * 0.6, size * 0.6);
  ctx.closePath();

  ctx.fillStyle = "#d4ac0d";
  ctx.shadowColor = "#d4ac0d";
  ctx.shadowBlur = 6;
  ctx.fill();

  ctx.restore();
}

/** Rasterised marker-icon size used on the minimap (source px / drawn px). */
const MARKER_ICON_SRC_PX = 32;
const MARKER_ICON_DRAW_PX = 12;

function drawMarkerDots(
  ctx: CanvasRenderingContext2D,
  markers: Marker[],
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  onIconReady?: () => void,
) {
  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;

  for (const m of markers) {
    const px = ((m.lon - minLon) / lonRange) * W;
    // North-up: invert y so high-lat (North) is at top.
    const py = H - ((m.lat - minLat) / latRange) * H;
    if (px < 0 || px > W || py < 0 || py > H) continue;

    const color = MARKER_COLOR[m.type] ?? "#e2e8f0";
    const icon = peekMarkerIconImage(m.type, color, MARKER_ICON_SRC_PX);

    if (icon) {
      // Custom SVG symbol on a dark backing disc for contrast.
      ctx.beginPath();
      ctx.arc(px, py, MARKER_ICON_DRAW_PX / 2 + 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(2,8,24,0.8)";
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.drawImage(
        icon,
        px - MARKER_ICON_DRAW_PX / 2,
        py - MARKER_ICON_DRAW_PX / 2,
        MARKER_ICON_DRAW_PX,
        MARKER_ICON_DRAW_PX,
      );
    } else {
      // Fallback dot until the icon image finishes loading.
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
      ctx.fill();
      ctx.shadowBlur = 0;
      if (onIconReady) {
        void loadMarkerIconImage(m.type, color, MARKER_ICON_SRC_PX).then((img) => {
          if (img) onIconReady();
        });
      }
    }
  }
}

const tileImageCache = new Map<string, HTMLImageElement>();

export const Minimap: React.FC = () => {
  const { terrain } = useAppState();
  const visibleDatasets = useTerrainStore((s) => s.visibleDatasets);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Coalesces marker-icon load completions into a single static-layer rebuild.
  const iconRebuildScheduledRef = useRef(false);
  // Stored as an offscreen canvas so we can drawImage with globalAlpha for
  // satellite compositing (putImageData ignores globalAlpha).
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Pre-built bitmaps for secondary (non-primary) datasets keyed by datasetId.
  const secondaryBitmapsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  // Current union bbox — kept in a ref so click/hover handlers always read the
  // latest value without needing to be re-created on every render.
  const unionBboxRef = useRef<{ minLon: number; maxLon: number; minLat: number; maxLat: number } | null>(null);
  // Static layer: bg + satellite + heatmap + marker dots. Rebuilt only when
  // data changes so the camera-tick path only composites this + the arrow.
  const staticLayerRef = useRef<HTMLCanvasElement | null>(null);
  const satelliteImgRef = useRef<HTMLImageElement | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const setOverviewOpen = useUiStore((s) => s.setOverviewOpen);
  const showNodataBoundary = useUiStore((s) => s.showNodataBoundary);
  const setShowNodataBoundary = useUiStore((s) => s.setShowNodataBoundary);
  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const overviewHillshading = useSettingsStore((s) => s.overviewHillshading);
  const units = useSettingsStore((s) => s.units);
  const shallow = usePaletteStore((s) => s.shallow);
  const deep = usePaletteStore((s) => s.deep);
  const bandColors = usePaletteStore((s) => s.bandColors);
  const customStops = usePaletteStore((s) => s.customStops);
  const bandBoundaries = usePaletteStore((s) => s.bandBoundaries);
  const blendBands = usePaletteStore((s) => s.blendBands);

  // Build the CSS gradient for the legend strip.  Re-computed only when the
  // theme or palette changes — same dependencies that rebuild the heatmap.
  const legendGradient = useMemo(
    () => {
      // Crop the legend strip to the dataset's absolute depth slice so it
      // matches the heatmap colours. For ocean/custom themes, band boundaries
      // are on the absolute 0–2000 ft scale; fixed themes always return
      // tMin=0/tMax=1 (full ramp — same as before).
      const tRange = terrain
        ? getColormapTRange(colormapTheme, terrain.minDepth, terrain.maxDepth)
        : undefined;
      return colormapCssGradient(colormapTheme, "to bottom", 16, undefined, tRange);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paletteVersion fingerprint covers all palette state; colormapCssGradient is a pure function
    [colormapTheme, shallow, deep, bandColors, customStops, bandBoundaries, blendBands, terrain],
  );

  // Depth labels for the legend (shallow top, deep bottom)
  const legendLabels = useMemo(() => {
    if (!terrain) return { top: "", mid: "", bot: "" };
    const { minDepth, maxDepth } = terrain;
    const fmt = (m: number) => {
      const d = Math.abs(Math.round(m));
      return units !== "metric" ? `${Math.round(d * 3.28084)}ft` : `${d}m`;
    };
    return {
      top: fmt(minDepth),
      mid: fmt((minDepth + maxDepth) / 2),
      bot: fmt(maxDepth),
    };
  }, [terrain, units]);

  const tileUrl = useSatelliteTileStore((s) => s.tileUrl);

  // Load satellite image whenever the tile URL changes. Trigger an immediate
  // redraw on load so the background appears without waiting for the next
  // camera movement (Minimap has no continuous rAF loop unlike OverviewMap).
  useEffect(() => {
    if (!tileUrl) {
      satelliteImgRef.current = null;
      return;
    }
    const cached = tileImageCache.get(tileUrl);
    if (cached) {
      satelliteImgRef.current = cached;
      // Redraw immediately with the cached image.
      const canvas = canvasRef.current;
      if (canvas && terrain) {
        const ctx = canvas.getContext("2d");
        if (ctx && heatmapCanvasRef.current) {
          rebuildStaticLayer(terrain);
          const camState = useCameraStore.getState();
          const cpos0 = camState.cameraPosition;
          compositeFrame(ctx, cpos0.known ? cpos0.lon : null, cpos0.known ? cpos0.lat : null, camState.heading, terrain);
        }
      }
      return;
    }
    const img = new Image();
    img.onload = () => {
      tileImageCache.set(tileUrl, img);
      satelliteImgRef.current = img;
      // Redraw immediately so satellite background appears on load.
      const canvas = canvasRef.current;
      if (!canvas || !terrain) return;
      const ctx = canvas.getContext("2d");
      if (!ctx || !heatmapCanvasRef.current) return;
      rebuildStaticLayer(terrain);
      const camState = useCameraStore.getState();
      const cposLoad = camState.cameraPosition;
      compositeFrame(ctx, cposLoad.known ? cposLoad.lon : null, cposLoad.known ? cposLoad.lat : null, camState.heading, terrain);
    };
    img.onerror = () => {
      satelliteImgRef.current = null;
    };
    img.src = tileUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildStaticLayer and compositeFrame are render-scope helpers; including them would re-run the effect every render
  }, [tileUrl]);

  const datasetId = terrain?.datasetId ?? "";
  const { data: markers } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  // Keep markers ref in sync
  useEffect(() => {
    markersRef.current = markers ?? [];
  }, [markers]);

  // Rebuild the static layer (bg + satellite + heatmap + marker dots) onto an
  // offscreen canvas. Called whenever data changes. The camera-tick path just
  // drawImage's this + the arrow, avoiding a full repaint every camera frame.
  const rebuildStaticLayer = (currentTerrain: typeof terrain) => {
    if (!currentTerrain) return;

    // Compute the union bbox from all visible datasets with loaded overview
    // grids, falling back to the primary terrain's bbox when no grid is ready.
    const unionBbox = computeMinimapUnionBbox(visibleDatasets, currentTerrain);
    if (!unionBbox) return;
    // Store for use in click/hover handlers (which are closures over the ref).
    unionBboxRef.current = unionBbox;

    // Allocate or reuse the offscreen static canvas.
    if (!staticLayerRef.current) {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      staticLayerRef.current = c;
    }
    const sc = staticLayerRef.current;
    const sCtx = sc.getContext("2d");
    if (!sCtx) return;

    // 1. Dark background
    sCtx.fillStyle = "#020818";
    sCtx.fillRect(0, 0, W, H);

    // 2. Satellite imagery background
    if (satelliteImgRef.current) {
      sCtx.drawImage(satelliteImgRef.current, 0, 0, W, H);
    }

    // 3. Depth heatmap bitmaps — one per dataset, each positioned at its
    //    sub-rectangle within the union bbox. Semi-transparent over satellite.
    const alpha = satelliteImgRef.current ? 0.65 : 1.0;
    sCtx.globalAlpha = alpha;

    // 3a. Primary heatmap (always uses currentTerrain's bbox as its data bbox)
    if (heatmapCanvasRef.current) {
      const rect = datasetCanvasRect(currentTerrain, unionBbox);
      sCtx.drawImage(heatmapCanvasRef.current, rect.x, rect.y, rect.w, rect.h);
    }

    // 3b. Secondary dataset bitmaps
    for (const [datasetId, bitmap] of secondaryBitmapsRef.current.entries()) {
      // Find this dataset's overviewGrid to get its geographic bbox.
      const entry = visibleDatasets.find((v) => v.datasetId === datasetId);
      const grid = entry?.overviewGrid;
      if (!grid) continue;
      const rect = datasetCanvasRect(grid, unionBbox);
      sCtx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h);
    }

    sCtx.globalAlpha = 1.0;

    // 4. Marker symbols — positioned using the union bbox so they land in the
    //    correct spot even when the primary terrain is offset within the canvas.
    drawMarkerDots(
      sCtx,
      markersRef.current,
      unionBbox.minLon,
      unionBbox.maxLon,
      unionBbox.minLat,
      unionBbox.maxLat,
      handleMarkerIconReady,
    );
  };

  // Coalesce many icon-load completions into a single static-layer rebuild.
  const handleMarkerIconReady = () => {
    if (iconRebuildScheduledRef.current) return;
    iconRebuildScheduledRef.current = true;
    setTimeout(() => {
      iconRebuildScheduledRef.current = false;
      const currentTerrain = terrain;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!currentTerrain || !ctx) return;
      rebuildStaticLayer(currentTerrain);
      const camState = useCameraStore.getState();
      const cpos = camState.cameraPosition;
      compositeFrame(ctx, cpos.known ? cpos.lon : null, cpos.known ? cpos.lat : null, camState.heading, currentTerrain);
    }, 50);
  };

  // Composite the minimap onto the visible canvas: static layer + camera arrow.
  // The heavy drawing (heatmap, satellite, markers) lives in rebuildStaticLayer
  // so this function only touches the arrow on each camera tick.
  const compositeFrame = (
    ctx: CanvasRenderingContext2D,
    camLon: number | null,
    camLat: number | null,
    heading: number,
    currentTerrain: typeof terrain,
  ) => {
    if (!currentTerrain) return;

    // 1. Paint the pre-built static layer (bg + satellite + heatmap + markers)
    if (staticLayerRef.current) {
      ctx.drawImage(staticLayerRef.current, 0, 0);
    } else {
      // Fallback: bare background until the static layer is built
      ctx.fillStyle = "#020818";
      ctx.fillRect(0, 0, W, H);
    }

    // 2. Camera arrow — the only element that changes on every camera tick.
    //    Use the union bbox for positioning so the arrow is correct even when
    //    the primary terrain is offset within the canvas.
    if (camLon !== null && camLat !== null) {
      const bbox = unionBboxRef.current ?? currentTerrain;
      const lonRange = bbox.maxLon - bbox.minLon || 1;
      const latRange = bbox.maxLat - bbox.minLat || 1;
      const px = ((camLon - bbox.minLon) / lonRange) * W;
      // North-up: invert y so high-lat (North) is at top.
      const py = H - ((camLat - bbox.minLat) / latRange) * H;
      if (px >= 0 && px <= W && py >= 0 && py <= H) {
        drawArrow(ctx, px, py, heading);
      }
    }
  };

  // Rebuild heatmap offscreen canvas when terrain, colormap theme, palette, or
  // visibleDatasets changes (new dataset added / removed / grids loaded).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Build offscreen heatmap canvas for the primary terrain so it can be
    // drawImage'd with globalAlpha onto the static layer.
    const offscreen = document.createElement("canvas");
    offscreen.width = W;
    offscreen.height = H;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;
    drawHeatmap(
      offCtx,
      terrain.depths,
      terrain.width,
      terrain.height,
      terrain.minDepth,
      terrain.maxDepth,
      colormapTheme,
      terrain.topography,
      overviewHillshading ? terrain : undefined,
    );
    // Overlay contour lines at each depth-band boundary, colored by the
    // adjacent band's color. Drawn on the same offscreen canvas immediately
    // after the heatmap so satellite compositing (globalAlpha) applies to both.
    drawMinimapContours(
      offCtx,
      terrain.depths,
      terrain.width,
      terrain.height,
      terrain.minDepth,
      terrain.maxDepth,
      colormapTheme,
      bandBoundaries,
      bandColors,
    );
    heatmapCanvasRef.current = offscreen;

    // Rebuild bitmaps for secondary datasets (all visibleDatasets entries whose
    // datasetId != primary terrain's datasetId and whose overviewGrid is loaded).
    const primaryId = terrain.datasetId;
    const nextBitmaps = new Map<string, HTMLCanvasElement>();
    for (const v of visibleDatasets) {
      if (v.datasetId === primaryId) continue;
      if (!v.overviewGrid) continue;
      nextBitmaps.set(
        v.datasetId,
        buildHeatmapBitmap(v.overviewGrid, colormapTheme),
      );
    }
    // Evict stale entries from the previous render by replacing the whole map.
    secondaryBitmapsRef.current = nextBitmaps;

    rebuildStaticLayer(terrain);
    const camState = useCameraStore.getState();
    const cp0 = camState.cameraPosition;
    compositeFrame(ctx, cp0.known ? cp0.lon : null, cp0.known ? cp0.lat : null, camState.heading, terrain);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildStaticLayer and compositeFrame are render-scope helpers that change every render; data deps are listed explicitly
  }, [terrain, colormapTheme, overviewHillshading, shallow, deep, bandColors, customStops, bandBoundaries, visibleDatasets]);

  // Re-composite when satellite image loads (tileUrl changed)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain || !heatmapCanvasRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    rebuildStaticLayer(terrain);
    const camState = useCameraStore.getState();
    const cp1 = camState.cameraPosition;
    compositeFrame(ctx, cp1.known ? cp1.lon : null, cp1.known ? cp1.lat : null, camState.heading, terrain);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildStaticLayer and compositeFrame are render-scope helpers; terrain is captured from outer scope (current at call time)
  }, [tileUrl]);

  // Subscribe to cameraStore and update arrow only — static layer is pre-built.
  useEffect(() => {
    const unsub = useCameraStore.subscribe((state) => {
      const canvas = canvasRef.current;
      if (!canvas || !terrain) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cp2 = state.cameraPosition;
      compositeFrame(ctx, cp2.known ? cp2.lon : null, cp2.known ? cp2.lat : null, state.heading, terrain);
    });

    return () => { unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- compositeFrame is a render-scope helper; re-subscribing only on terrain change is intentional
  }, [terrain]);

  // Rebuild static layer whenever markers change (new dots without camera move)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    rebuildStaticLayer(terrain);
    const camState = useCameraStore.getState();
    const cp3 = camState.cameraPosition;
    compositeFrame(ctx, cp3.known ? cp3.lon : null, cp3.known ? cp3.lat : null, camState.heading, terrain);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildStaticLayer and compositeFrame are render-scope helpers; data deps (markers, terrain) are listed explicitly
  }, [markers, terrain]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!terrain) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Two-step conversion: canvas px/py → lon/lat via union bbox, then
    // lon/lat → world coords via the primary terrain bbox so teleport targets
    // always land within the loaded 3D mesh.
    const bbox = unionBboxRef.current ?? terrain;
    const bboxLonRange = bbox.maxLon - bbox.minLon || 1;
    const bboxLatRange = bbox.maxLat - bbox.minLat || 1;
    const lon = bbox.minLon + (px / W) * bboxLonRange;
    // North-up: py=0 → maxLat (North), py=H → minLat (South)
    const lat = bbox.minLat + (1 - py / H) * bboxLatRange;

    // Clamp lon/lat to the primary terrain's geographic extent so clicks on
    // secondary-only regions of the union bbox still teleport within the loaded
    // 3D mesh rather than producing out-of-range world coordinates.
    const clampedLon = Math.max(terrain.minLon, Math.min(terrain.maxLon, lon));
    const clampedLat = Math.max(terrain.minLat, Math.min(terrain.maxLat, lat));

    const terrLonRange = terrain.maxLon - terrain.minLon || 1;
    const terrLatRange = terrain.maxLat - terrain.minLat || 1;
    const worldX = ((clampedLon - terrain.minLon) / terrLonRange) * WORLD_SIZE - WORLD_SIZE / 2;
    const worldZ = ((clampedLat - terrain.minLat) / terrLatRange) * WORLD_SIZE - WORLD_SIZE / 2;
    useUiStore.getState().setPendingDropIn({ worldX, worldZ });
  };

  /**
   * Tooltip label for the minimap canvas.
   * Shows "Survey gap" when the cursor is over a null-depth cell and the
   * nodata boundary overlay is enabled; otherwise shows the drop-in hint.
   */
  const [canvasTooltip, setCanvasTooltip] = useState("Click to teleport here");

  const handleMinimapMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!terrain || !showNodataBoundary) {
        setCanvasTooltip("Click to teleport here");
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      // Scale from CSS pixels to canvas logical pixels.
      const scaleX = W / rect.width;
      const scaleY = H / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;

      // Map canvas px/py → lon/lat via union bbox, then lon/lat → primary
      // terrain grid coordinates so the survey-gap check is accurate even
      // when the primary terrain is offset within the union-bbox canvas.
      const bbox = unionBboxRef.current ?? terrain;
      const bboxLonRange = bbox.maxLon - bbox.minLon || 1;
      const bboxLatRange = bbox.maxLat - bbox.minLat || 1;
      const lon = bbox.minLon + (px / W) * bboxLonRange;
      const lat = bbox.minLat + (1 - py / H) * bboxLatRange;

      // Only show "Survey gap" when the cursor is inside the primary terrain.
      if (
        lon < terrain.minLon || lon > terrain.maxLon ||
        lat < terrain.minLat || lat > terrain.maxLat
      ) {
        setCanvasTooltip("Click to teleport here");
        return;
      }

      const terrLonRange = terrain.maxLon - terrain.minLon || 1;
      const terrLatRange = terrain.maxLat - terrain.minLat || 1;
      const gx = Math.min(terrain.width - 1, Math.floor(((lon - terrain.minLon) / terrLonRange) * terrain.width));
      const gy = Math.min(terrain.height - 1, Math.floor(((lat - terrain.minLat) / terrLatRange) * terrain.height));
      const depth = terrain.depths[gy * terrain.width + gx];
      const isNull = depth === null || depth === undefined || isNaN(depth as number);

      setCanvasTooltip(isNull ? "Survey gap" : "Click to teleport here");
    },
    [terrain, showNodataBoundary],
  );

  const handleMinimapMouseLeave = useCallback(() => {
    setCanvasTooltip("Click to teleport here");
  }, []);

  if (!terrain) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4,
        pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <ViewscreenTooltip
          label={showNodataBoundary ? "Hide survey-gap rings" : "Show survey-gap rings"}
          side="left"
        >
          <button
            data-testid="nodata-boundary-toggle"
            onClick={() => setShowNodataBoundary(!showNodataBoundary)}
            aria-pressed={showNodataBoundary}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(12px * var(--bs-font-scale, 1))",
              color: showNodataBoundary ? "#00e5ff" : "#475569",
              background: "rgba(0,10,20,0.75)",
              border: `1px solid ${showNodataBoundary ? "rgba(0,229,255,0.35)" : "rgba(100,116,139,0.25)"}`,
              borderRadius: 3,
              padding: "3px 6px",
              cursor: "pointer",
            }}
            className="transition-colors"
          >
            ⊘
          </button>
        </ViewscreenTooltip>
        <ViewscreenTooltip label="Open the full overview map" side="left">
          <button
            onClick={() => setOverviewOpen(true)}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.15em",
              color: "#94a3b8",
              background: "rgba(0,10,20,0.75)",
              border: "1px solid rgba(0,229,255,0.15)",
              borderRadius: 3,
              padding: "3px 8px",
              cursor: "pointer",
            }}
            className="hover:text-cyan-400 transition-colors"
          >
            ▲ OVERVIEW
          </button>
        </ViewscreenTooltip>
      </div>


      <div
        style={{
          position: "relative",
          border: "1px solid rgba(0,229,255,0.25)",
          borderRadius: 4,
          overflow: "hidden",
          boxShadow: "0 0 12px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,229,255,0.1)",
        }}
      >
        <ViewscreenTooltip label={canvasTooltip} side="left">
          <canvas
            ref={canvasRef}
            data-testid="minimap-canvas"
            width={W}
            height={H}
            onClick={handleClick}
            onMouseMove={handleMinimapMouseMove}
            onMouseLeave={handleMinimapMouseLeave}
            style={{ display: "block", cursor: "crosshair" }}
          />
        </ViewscreenTooltip>
        {/* Corner label */}
        <div
          style={{
            position: "absolute",
            top: 3,
            left: 5,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            color: "rgba(0,229,255,0.4)",
            letterSpacing: "0.1em",
            pointerEvents: "none",
          }}
        >
          MINIMAP
        </div>
        {/* North indicator — top-center so N is unambiguously at the top edge */}
        <div
          data-testid="minimap-north"
          style={{
            position: "absolute",
            top: 3,
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            fontWeight: 700,
            color: "rgba(0,229,255,0.6)",
            pointerEvents: "none",
          }}
        >
          N
        </div>
        {/* South indicator — bottom-center */}
        <div
          data-testid="minimap-south"
          style={{
            position: "absolute",
            bottom: 3,
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            fontWeight: 700,
            color: "rgba(0,229,255,0.35)",
            pointerEvents: "none",
          }}
        >
          S
        </div>
        {/* East indicator */}
        <div
          data-testid="minimap-east"
          style={{
            position: "absolute",
            top: "50%",
            right: 5,
            transform: "translateY(-50%)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            fontWeight: 700,
            color: "rgba(0,229,255,0.45)",
            pointerEvents: "none",
          }}
        >
          E
        </div>
        {/* West indicator */}
        <div
          data-testid="minimap-west"
          style={{
            position: "absolute",
            top: "50%",
            left: 5,
            transform: "translateY(-50%)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            fontWeight: 700,
            color: "rgba(0,229,255,0.45)",
            pointerEvents: "none",
          }}
        >
          W
        </div>
        {/* Colormap legend strip — bottom-left, shallow top → deep bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: 5,
            display: "flex",
            flexDirection: "row",
            alignItems: "stretch",
            gap: 3,
            pointerEvents: "none",
          }}
        >
          {/* Gradient strip */}
          <div
            style={{
              width: 6,
              height: 72,
              background: legendGradient,
              border: "0.5px solid rgba(255,255,255,0.2)",
              flexShrink: 0,
            }}
          />
          {/* Depth labels: top / mid / bottom */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
              color: "rgba(255,255,255,0.65)",
              lineHeight: 1,
            }}
          >
            <span>{legendLabels.top}</span>
            <span>{legendLabels.mid}</span>
            <span>{legendLabels.bot}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
