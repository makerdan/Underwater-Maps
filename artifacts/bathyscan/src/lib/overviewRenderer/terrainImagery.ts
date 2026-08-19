/**
 * overviewRenderer/terrainImagery.ts — depth-grid hillshade + coloured heatmap
 * bitmap generation and the scaled heatmap draw calls.
 */
import type { TerrainData } from "@workspace/api-client-react";
import type { ColormapTheme } from "../settingsStore";
import * as THREE from "three";
import { getColormap, getColormapDepthDomain, isAbsoluteDepthTheme } from "../colormap";
import { usePaletteStore } from "../paletteStore";
import { NO_DATA_COLOR } from "../terrain";
import { lonRangeOf, lonLatToCanvas, type OverviewTransform } from "./transforms";

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
// Hillshade lighting layer
// ---------------------------------------------------------------------------

// Mirror the 3D shader lighting constants from terrainShader.ts:
//   float ambient = 0.55;
//   float diffuse = max(0.0, dot(normal, sunDir)) * 0.45;
//   float lighting = min(ambient + diffuse, 1.2);
const HS_AMBIENT = 0.55;
const HS_DIFFUSE = 0.45;

// Frozen sun direction — same as `uSunDir: new THREE.Vector3(0.5, 1.0, 0.7).normalize()`
// in createTerrainShaderMaterial (terrainShader.ts).
const _HS_SUN_MAG = Math.sqrt(0.5 * 0.5 + 1.0 * 1.0 + 0.7 * 0.7);
const HS_SUN_X = 0.5 / _HS_SUN_MAG;
const HS_SUN_Y = 1.0 / _HS_SUN_MAG;
const HS_SUN_Z = 0.7 / _HS_SUN_MAG;

// 3D mesh scale constants (mirrored from terrain.ts) used to convert
// depth-per-cell slopes to world-space slopes matching the 3D viewer.
const _HS_WORLD_SIZE = 100;
const _HS_MAX_DEPTH_WORLD = 50;

/**
 * Compute per-cell hillshade lighting multipliers for the Overview Map heatmap.
 *
 * Replicates the Blinn-Phong ambient+diffuse lighting from terrainShader.ts
 * (ambient=0.55, diffuse=0.45, sun=normalize(0.5,1.0,0.7)) entirely in CPU
 * space so the 2D bitmap matches the shaded appearance of the 3D view.
 *
 * Returns a Float32Array of length W×H (one multiplier per canvas pixel,
 * row-major with the same Y-flip as buildHeatmapBitmap: index 0 = top-left =
 * northernmost data cell). Values lie in [HS_AMBIENT, 1.2].
 *
 * Null/NaN depth cells return HS_AMBIENT (no additional darkening).
 * Finite-difference neighbours that are null/NaN fall back to the cell's own
 * depth so slope estimation degrades gracefully at data boundaries.
 */
export function buildHillshadeLayer(grid: TerrainData): Float32Array {
  const { width: W, height: H, depths, minDepth, maxDepth } = grid;
  const depthRange = (maxDepth - minDepth) || 1;
  const result = new Float32Array(W * H);

  // World-space horizontal step per grid column / row (matches buildTerrainGeometry).
  const worldStepX = _HS_WORLD_SIZE / Math.max(1, W - 1);
  const worldStepZ = _HS_WORLD_SIZE / Math.max(1, H - 1);
  // Factor converting depth-metres to world-Y displacement magnitude.
  const depthToWorld = _HS_MAX_DEPTH_WORLD / depthRange;

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const pixelIdx = row * W + col;
      // Y-flip: canvas row 0 = northernmost = data row H-1.
      const dataRow = H - 1 - row;

      const rawDepth = depths[dataRow * W + col];

      // Null / NaN cells → ambient floor (no shape cue, no extra darkening).
      if (rawDepth === null || rawDepth === undefined || Number.isNaN(rawDepth as number)) {
        result[pixelIdx] = HS_AMBIENT;
        continue;
      }
      const selfDepth = rawDepth as number;

      // Central-difference neighbours in data space, clamped at borders.
      const r0 = Math.max(0, dataRow - 1);
      const r1 = Math.min(H - 1, dataRow + 1);
      const c0 = Math.max(0, col - 1);
      const c1 = Math.min(W - 1, col + 1);
      const dCols = c1 - c0; // 1 at left/right edges, 2 in interior
      const dRows = r1 - r0; // 1 at top/bottom edges, 2 in interior

      /** Read depth at data (r, c); fall back to selfDepth on null/NaN. */
      const d = (r: number, c: number): number => {
        const v = depths[r * W + c];
        return (v === null || v === undefined || Number.isNaN(v as number))
          ? selfDepth
          : (v as number);
      };

      // Finite differences: depth change per grid step.
      // Guard against degenerate 1-pixel dimensions (dCols/dRows = 0) by
      // treating flat slopes in that direction (no shading contribution).
      const ddCol = dCols > 0 ? (d(dataRow, c1) - d(dataRow, c0)) / dCols : 0; // m per col
      const ddRow = dRows > 0 ? (d(r1, col)    - d(r0, col))    / dRows   : 0; // m per row

      // Convert to world-space normal.
      // In the 3D mesh (Y-up, XZ horizontal):
      //   world Y = -(depth / depthRange) * MAX_DEPTH_WORLD
      //   dY/dX = -(depthToWorld * ddCol) / worldStepX
      //   N = normalize(-dY/dX,  1,  -dY/dZ)
      //     = normalize(+depthToWorld*ddCol/worldStepX,  1,  +depthToWorld*ddRow/worldStepZ)
      const nx = (depthToWorld * ddCol) / worldStepX;
      const ny = 1.0;
      const nz = (depthToWorld * ddRow) / worldStepZ;

      const mag = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const dot = (nx / mag) * HS_SUN_X + (ny / mag) * HS_SUN_Y + (nz / mag) * HS_SUN_Z;

      const rawIntensity = Math.min(HS_AMBIENT + HS_DIFFUSE * Math.max(0, dot), 1.2);
      // Slope-magnitude darkening: steep terrain slopes receive a subtle dark-ink
      // edge on top of the existing directional hillshade, giving ridges and drop-offs
      // stronger visual definition.  The horizontal gradient magnitude in world space
      // (unnormalised nx, nz) is clamped to [0, 1] so very steep terrain does not
      // over-darken.  Flat areas (nx = nz = 0) are unaffected.
      const slopeMag = Math.min(1, Math.sqrt(nx * nx + nz * nz));
      result[pixelIdx] = rawIntensity * (1 - 0.18 * slopeMag);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Heatmap bitmap
// ---------------------------------------------------------------------------

/**
 * Pre-render the depth grid as a coloured, hillshaded bitmap (one pixel per
 * data cell). Result is an offscreen HTMLCanvasElement that can be scaled via
 * drawImage.
 *
 * @param grid           Terrain data grid.
 * @param colormapTheme  Active colormap theme (default "ocean").
 * @param topography     Optional elevation array for land-cell detection.
 * @param stretchContrast
 *   When true (default), the depth domain is stretched to the grid's actual
 *   [minDepth, maxDepth] whenever the survey's real depth range spans less
 *   than 15% of the absolute colormap domain (e.g. an ocean/custom theme
 *   whose 0–2000 ft scale far exceeds a shallow 20–80 ft lake).  This ensures
 *   the full palette gradient is visible across the actual data range.
 *
 *   This is a bitmap-level decision only — it does NOT affect contour-line
 *   depth values, the legend strip, or the 3D terrain view.
 */
export function buildHeatmapBitmap(
  grid: TerrainData,
  colormapTheme: ColormapTheme = "ocean",
  topography?: number[] | null,
  stretchContrast = true,
): HTMLCanvasElement {
  const { width: W, height: H, depths, minDepth, maxDepth } = grid;

  // Resolve the effective domain (may be stretched for narrow surveys).
  const absoluteDomain = getColormapDepthDomain(colormapTheme, minDepth, maxDepth);
  let domain = absoluteDomain;
  if (stretchContrast) {
    const actualRange = maxDepth - minDepth;
    const absDomainRange = absoluteDomain.max - absoluteDomain.min || 1;
    if (actualRange > 0 && actualRange / absDomainRange < 0.15) {
      // Survey spans < 15% of the absolute palette scale — use actual extents
      // so the full gradient maps across the real depth range.
      domain = { min: minDepth, max: maxDepth };
    }
  }

  const domainRange = domain.max - domain.min || 1;
  const toColor = getColormap(colormapTheme);

  // Pre-compute per-cell hillshade multipliers.  Applied to the linear-space
  // palette colour before sRGB conversion so the lighting is physically correct,
  // mirroring the GLSL `fragColor = paletteColor * lighting` in terrainShader.ts.
  const hillshade = buildHillshadeLayer(grid);

  // Depth-band hypsometric tinting: blend each pixel's palette band colour at
  // 0.28 alpha before hillshade multiplication so depth zones have a subtle
  // tonal fill baked into every dataset bitmap.  Only active for ocean/custom
  // absolute-depth themes; preset themes have no named band colours.
  const _isBandFill = isAbsoluteDepthTheme(colormapTheme);
  const _paletteSnap = _isBandFill ? usePaletteStore.getState() : null;
  const _bandColorsArr = (_paletteSnap?.bandColors ?? []) as readonly string[];
  const _bandBoundariesM: number[] =
    _isBandFill && (_paletteSnap?.bandBoundaries?.length ?? 0) > 1
      ? (_paletteSnap!.bandBoundaries as readonly number[]).map((ft) => ft * 0.3048)
      : [];
  const BAND_BLEND_ALPHA = 0.28;

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
      const pixelIdx = row * W + col;
      const i = pixelIdx * 4;

      // Null / NaN depth → survey gap: render as the NO_DATA_COLOR light-gray
      // so coverage boundaries are visible at a glance, matching the 3D
      // terrain mesh which places null-depth vertices at the water surface
      // with the same muted colour (see buildTerrainGeometry in terrain.ts).
      if (rawDepth === null || rawDepth === undefined || Number.isNaN(rawDepth as number)) {
        imageData.data[i]     = NO_DATA_CANVAS_R;
        imageData.data[i + 1] = NO_DATA_CANVAS_G;
        imageData.data[i + 2] = NO_DATA_CANVAS_B;
        // Fully transparent so a later-drawn dataset's real depth pixels are
        // not obscured by this survey's gap/padding region.  When only one
        // dataset is loaded the transparent pixels simply show the dark canvas
        // background — visually identical to the previous opaque behaviour.
        imageData.data[i + 3] = 0;
        continue;
      }

      const hs = hillshade[pixelIdx]!;

      // Land cell (above-water elevation > 0 in topography): render as fully
      // transparent so a later-drawn dataset's real depth pixels are not
      // obscured by this dataset's land region.  In single-dataset view the
      // transparent pixels simply show the dark canvas background — visually
      // equivalent to the previous opaque-gray behaviour from the user's
      // perspective, since no other dataset is drawn underneath.
      if (topography && (topography[dataIdx] ?? 0) > 0) {
        imageData.data[i]     = 0;
        imageData.data[i + 1] = 0;
        imageData.data[i + 2] = 0;
        imageData.data[i + 3] = 0;
        continue;
      }

      const t = Math.max(0, Math.min(1, (rawDepth - domain.min) / domainRange));
      // Get the palette colour in linear-sRGB space (THREE.Color with
      // ColorManagement enabled stores values in linear space).
      const lin = toColor(t);

      // Depth-band hypsometric fill: blend the palette band colour at ~0.28 alpha
      // before hillshade so depth zones have subtle tonal separation.
      if (_isBandFill && _bandBoundariesM.length > 1 && _bandColorsArr.length > 0) {
        const depth = rawDepth as number;
        let bandIdx = _bandColorsArr.length - 1;
        for (let bi = 0; bi < _bandBoundariesM.length - 1; bi++) {
          if (depth < (_bandBoundariesM[bi + 1] ?? Infinity)) {
            bandIdx = Math.min(bi, _bandColorsArr.length - 1);
            break;
          }
        }
        const bandHex = (_bandColorsArr[bandIdx] ?? _bandColorsArr[_bandColorsArr.length - 1]) as string;
        const bandLin = new THREE.Color(bandHex);
        lin.r = lin.r * (1 - BAND_BLEND_ALPHA) + bandLin.r * BAND_BLEND_ALPHA;
        lin.g = lin.g * (1 - BAND_BLEND_ALPHA) + bandLin.g * BAND_BLEND_ALPHA;
        lin.b = lin.b * (1 - BAND_BLEND_ALPHA) + bandLin.b * BAND_BLEND_ALPHA;
      }

      // Multiply by the hillshade factor BEFORE sRGB conversion so the
      // lighting is physically correct, exactly matching the GLSL path:
      //   finalColor = paletteColor * lighting
      lin.r *= hs;
      lin.g *= hs;
      lin.b *= hs;
      // Convert THREE.Color (linear-sRGB) to display-space sRGB bytes for the
      // 2D canvas, matching the legend strip and colormapCanvas helper in colormap.ts.
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
