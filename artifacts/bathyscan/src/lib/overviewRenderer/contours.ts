/**
 * overviewRenderer/contours.ts — marching-squares contour extraction +
 * labelled contour-line rendering (with MOBILE-ONLY index-contour emphasis).
 */
import type { TerrainData } from "@workspace/api-client-react";
import type { UnitsSystem, ColormapTheme } from "../settingsStore";
import { getColormap, getColormapDepthDomain, isAbsoluteDepthTheme } from "../colormap";
import { usePaletteStore } from "../paletteStore";
import { formatDepth } from "../units";
// MOBILE-ONLY import: index-contour classification for the mobile Chart View's
// density stepper. Only used when a caller passes ContourRenderOptions.
import { isIndexContourDepth } from "../contourDensity";
import { lonRangeOf, lonLatToCanvas, type OverviewTransform } from "./transforms";

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
        const tl = depths[row * W + col];
        const tr = depths[row * W + (col + 1)];
        const br = depths[(row + 1) * W + (col + 1)];
        const bl = depths[(row + 1) * W + col];

        // Skip quads that contain any no-data (null/undefined) corner — these
        // cells have no terrain surface, so drawing contour lines along their
        // edges would produce phantom lines over empty areas.
        if (tl == null || tr == null || br == null || bl == null) continue;

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
 * MOBILE-ONLY consumer: optional index-contour emphasis for the mobile Chart
 * View's 1×/2×/3× density stepper. When `indexIntervalMetres` is set, every
 * INDEX_CONTOUR_EVERY-th contour level (a whole multiple of
 * indexIntervalMetres × INDEX_CONTOUR_EVERY) is drawn heavier and is the ONLY
 * level that receives depth labels, so high densities stay readable on a
 * phone. Desktop callers omit the options bag entirely — behaviour is then
 * byte-identical to the legacy renderer.
 */
export interface ContourRenderOptions {
  /**
   * The effective contour interval in metres (base interval ÷ density).
   * Used solely to classify which depths are index contours.
   */
  indexIntervalMetres?: number;
}

/**
 * Render contour lines on the 2D overview canvas.
 * Lines are coloured by sampling the active colormap at each depth, drawn at
 * ~60% opacity. Depth labels are placed at sparse intervals when zoom ≥ 3.
 *
 * The trailing `opts` parameter is MOBILE-ONLY (index-contour emphasis for
 * the mobile Chart View); desktop callers never pass it and are unaffected.
 */
export function renderContourLines(
  ctx: CanvasRenderingContext2D,
  segments: ContourSegment[],
  grid: TerrainData,
  t: OverviewTransform,
  units: UnitsSystem,
  colormapTheme: ColormapTheme,
  worldGrid?: TerrainData,
  opts?: ContourRenderOptions,
): void {
  if (!segments.length) return;

  const { width: W, height: H, minDepth, maxDepth } = grid;
  const contourDomain = getColormapDepthDomain(colormapTheme, minDepth, maxDepth);
  const contourDomainRange = contourDomain.max - contourDomain.min || 1;
  const lonRange = lonRangeOf(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const toColor = getColormap(colormapTheme);

  /** Convert fractional grid coords (col, row) to canvas pixel coords. */
  const toCanvas = (gx: number, gy: number): [number, number] => {
    const lon = grid.minLon + (gx / Math.max(W - 1, 1)) * lonRange;
    const lat = grid.minLat + (gy / Math.max(H - 1, 1)) * latRange;
    return lonLatToCanvas(lon, lat, worldGrid ?? grid, t);
  };

  // At scale=1 (initial zoomed-out view) lines are drawn at minimum width so
  // terrain relief is visible without cluttering the overview.  Labels appear
  // at scale≥2 (one zoom step in) where individual depths are legible.
  const lineW = Math.max(0.5, Math.min(1.5, t.scale * 0.5));
  const showLabels = t.scale >= 2;
  const fontSize = Math.max(8, Math.min(11, 9 * t.scale * 0.35));

  // MOBILE-ONLY: index-contour emphasis. When enabled (mobile Chart View),
  // index levels are drawn heavier / more opaque and are the only labeled
  // levels — at any zoom, since only every 5th level qualifies. Desktop
  // callers never set opts, so indexEmphasis stays false and every value
  // below matches the legacy renderer exactly.
  const indexEmphasis =
    opts?.indexIntervalMetres !== undefined && opts.indexIntervalMetres > 0;
  const indexLineW = Math.min(3, lineW * 2);

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

  // Band-colour lookup for ocean/custom themes (mirrors drawMinimapContours in Minimap.tsx).
  // Pre-computed outside the loop so the store is only read once.
  const _rcIsBand = isAbsoluteDepthTheme(colormapTheme);
  const _rcPalette = _rcIsBand ? usePaletteStore.getState() : null;
  const _rcBandColorsArr = (_rcPalette?.bandColors ?? []) as readonly string[];
  const _rcBandBoundariesM: number[] =
    _rcIsBand && (_rcPalette?.bandBoundaries?.length ?? 0) > 1
      ? (_rcPalette!.bandBoundaries as readonly number[]).map((ft) => ft * 0.3048)
      : [];

  for (const [depth, segs] of byDepth) {
    // MOBILE-ONLY: classify this level as an index contour (every 5th level).
    // Always false on desktop (indexEmphasis is false without opts).
    const isIndex =
      indexEmphasis && isIndexContourDepth(depth, opts!.indexIntervalMetres!);

    // Colour source: band colour for ocean/custom (warm, palette-consistent look
    // matching the Minimap); colormap sample at t for fixed preset themes.
    let r: number;
    let g: number;
    let b: number;

    if (_rcIsBand && _rcBandBoundariesM.length > 1 && _rcBandColorsArr.length > 0) {
      // Ocean/custom: find the band containing this depth and use its palette colour.
      let bandIdx = _rcBandColorsArr.length - 1;
      for (let bi = 0; bi < _rcBandBoundariesM.length - 1; bi++) {
        if (depth < (_rcBandBoundariesM[bi + 1] ?? Infinity)) {
          bandIdx = Math.min(bi, _rcBandColorsArr.length - 1);
          break;
        }
      }
      const bandHex = (_rcBandColorsArr[bandIdx] ?? _rcBandColorsArr[_rcBandColorsArr.length - 1]) as string;
      r = parseInt(bandHex.slice(1, 3), 16);
      g = parseInt(bandHex.slice(3, 5), 16);
      b = parseInt(bandHex.slice(5, 7), 16);
    } else {
      // Preset themes: sample the colormap at this depth's t-position.
      const t01 = Math.max(0, Math.min(1, (depth - contourDomain.min) / contourDomainRange));
      const col = toColor(t01).clone().convertLinearToSRGB();
      r = Math.max(0, Math.min(255, Math.round(col.r * 255)));
      g = Math.max(0, Math.min(255, Math.round(col.g * 255)));
      b = Math.max(0, Math.min(255, Math.round(col.b * 255)));
    }

    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    // MOBILE-ONLY branch: index contours draw heavier and more opaque so the
    // 2×/3× densities stay readable. Desktop path (no opts) is the legacy
    // lineW / 0.65 pair, unchanged.
    ctx.lineWidth = isIndex ? indexLineW : lineW;
    // Soft alpha matches the Minimap's contour appearance (0.65 instead of the
    // previous higher-contrast value baked into the rgba stroke string).
    ctx.globalAlpha = isIndex ? 0.85 : 0.65;

    // Draw all segments for this level in a single path batch
    ctx.beginPath();
    for (const seg of segs) {
      const [cx0, cy0] = toCanvas(seg.x0, seg.y0);
      const [cx1, cy1] = toCanvas(seg.x1, seg.y1);
      ctx.moveTo(cx0, cy0);
      ctx.lineTo(cx1, cy1);
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0; // reset before label drawing

    // MOBILE-ONLY branch: with index emphasis active, ONLY index contours are
    // labeled (at any zoom — only every 5th level qualifies, so labels stay
    // sparse). Desktop keeps the legacy zoom-gated labels on every level.
    if (indexEmphasis ? !isIndex : !showLabels) continue;
    if (segs.length === 0) continue;

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
