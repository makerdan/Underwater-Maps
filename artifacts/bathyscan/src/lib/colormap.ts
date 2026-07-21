import * as THREE from "three";
import type { ColormapTheme } from "./settingsStore";
import { usePaletteStore, DEFAULT_BAND_COLORS, DEFAULT_BAND_BOUNDARIES } from "./paletteStore";

interface ColorStop {
  t: number;
  color: THREE.Color;
}

/**
 * Canonical default depth band boundaries in feet (the default 10-band
 * scale). Retained for consumers that need the historical default layout;
 * the live user-configured boundaries come from paletteStore.
 */
export const DEPTH_BAND_BOUNDARIES_FT = [
  0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000,
] as const;

/** Default maximum depth of the ocean colormap scale in feet. */
export const OCEAN_MAX_DEPTH_FT = 2000;

const FT_TO_M = 0.3048;

/** Maximum depth of the ocean colormap scale in metres (~609.6 m). */
export const OCEAN_MAX_DEPTH_M = OCEAN_MAX_DEPTH_FT * FT_TO_M;

/**
 * True when the theme's colour stops are positioned on the absolute
 * 0–2000 ft depth scale (band boundaries carry labelled depths). Fixed
 * preset themes have no labelled depths and remain grid-relative.
 */
export function isAbsoluteDepthTheme(theme: ColormapTheme): boolean {
  return theme === "ocean" || theme === "custom";
}

/**
 * Depth domain (in metres) that vertex colouring must normalise against for
 * a given theme and grid depth range.
 *
 * - Ocean/Custom themes: absolute [0, OCEAN_MAX_DEPTH_M] so a vertex at a
 *   band's labelled depth always renders that band's colour, and shallow
 *   lakes only use the shallow bands (never the near-black deep endpoint).
 * - Fixed themes: the grid's own [minDepth, maxDepth] (relative stretch).
 */
export function getColormapDepthDomain(
  theme: ColormapTheme,
  gridMinDepth: number,
  gridMaxDepth: number,
): { min: number; max: number } {
  if (isAbsoluteDepthTheme(theme)) {
    return { min: 0, max: OCEAN_MAX_DEPTH_M };
  }
  return { min: gridMinDepth, max: gridMaxDepth };
}

/**
 * The [tMin, tMax] slice of the colormap that a dataset's depth range
 * occupies. Legends crop their gradient to this range so grid-relative
 * tick positions line up with the colours actually painted on the terrain.
 *
 * For fixed (grid-relative) themes the dataset always spans the full ramp.
 */
export function getColormapTRange(
  theme: ColormapTheme,
  gridMinDepth: number,
  gridMaxDepth: number,
): { tMin: number; tMax: number } {
  if (!isAbsoluteDepthTheme(theme)) return { tMin: 0, tMax: 1 };
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const tMin = clamp01(gridMinDepth / OCEAN_MAX_DEPTH_M);
  const tMax = clamp01(gridMaxDepth / OCEAN_MAX_DEPTH_M);
  if (!(tMax > tMin)) return { tMin: 0, tMax: 1 };
  return { tMin, tMax };
}

/**
 * Optional dataset depth range (metres, positive-down) used to anchor the
 * user's depth bands to real depths. When supplied, a band whose boundaries
 * are 0–5 ft colours exactly the 0–5 ft slice of the dataset rather than a
 * normalised fraction of a fixed scale.
 */
export interface DepthRangeM {
  /** Shallowest depth of the dataset in metres. */
  min: number;
  /** Deepest depth of the dataset in metres. */
  max: number;
}

const OCEAN_HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Read + validate the live band arrays from paletteStore (variable length). */
function getValidatedBands(): { colors: string[]; boundariesFt: number[]; blend: boolean } {
  const { bandColors, bandBoundaries, blendBands } = usePaletteStore.getState();
  let colors =
    Array.isArray(bandColors) && bandColors.length >= 2
      ? bandColors
      : [...DEFAULT_BAND_COLORS];
  let boundariesFt =
    Array.isArray(bandBoundaries) && bandBoundaries.length === colors.length + 1
      ? bandBoundaries
      : null;
  if (!boundariesFt) {
    colors = [...DEFAULT_BAND_COLORS];
    boundariesFt = [...DEFAULT_BAND_BOUNDARIES];
  }
  const safeColors = colors.map((hex, i) =>
    typeof hex === "string" && OCEAN_HEX_RE.test(hex)
      ? hex
      : DEFAULT_BAND_COLORS[Math.min(i, DEFAULT_BAND_COLORS.length - 1)]!,
  );
  return { colors: safeColors, boundariesFt, blend: blendBands !== false };
}

/**
 * Normalise each band boundary (feet) to a t ∈ [0, 1] position.
 *
 * With a dataset `range` (metres): t is the boundary's real position within
 * the dataset's depth span, clamped to [0, 1] — bands map to actual depths
 * with no fixed 2000 ft cap.
 *
 * Without a range: boundaries are normalised by the deepest boundary, so the
 * full band scale is shown edge-to-edge (settings preview, generic swatches).
 */
function boundaryPositions(boundariesFt: number[], range?: DepthRangeM): number[] {
  if (range && range.max > range.min) {
    const span = range.max - range.min;
    return boundariesFt.map((ft) =>
      Math.max(0, Math.min(1, (ft * FT_TO_M - range.min) / span)),
    );
  }
  const maxFt = boundariesFt[boundariesFt.length - 1] || 1;
  return boundariesFt.map((ft) => ft / maxFt);
}

/**
 * Build the user-band colour stops (used by both the "ocean" and "custom"
 * themes). Colours sit at each band's lower boundary; the deepest band's
 * colour also holds at t=1 so depths beyond the last boundary stay stable.
 */
function getBandStops(range?: DepthRangeM): ColorStop[] {
  const { colors, boundariesFt } = getValidatedBands();
  const pos = boundaryPositions(boundariesFt, range);
  const stops: ColorStop[] = colors.map((hex, i) => ({
    t: pos[i]!,
    color: new THREE.Color(hex),
  }));
  stops.push({ t: 1.0, color: new THREE.Color(colors[colors.length - 1]!) });
  return stops;
}

const FIXED_THEME_STOPS: Record<Exclude<ColormapTheme, "ocean" | "custom">, ColorStop[]> = {
  thermal: [
    { t: 0.00, color: new THREE.Color("#0d0221") },
    { t: 0.25, color: new THREE.Color("#7b2d8b") },
    { t: 0.55, color: new THREE.Color("#e8553e") },
    { t: 0.80, color: new THREE.Color("#f9c74f") },
    { t: 1.00, color: new THREE.Color("#ffffff") },
  ],
  grayscale: [
    { t: 0.00, color: new THREE.Color("#050505") },
    { t: 1.00, color: new THREE.Color("#e0e0e0") },
  ],
  viridis: [
    { t: 0.00, color: new THREE.Color("#440154") },
    { t: 0.25, color: new THREE.Color("#31688e") },
    { t: 0.50, color: new THREE.Color("#35b779") },
    { t: 0.75, color: new THREE.Color("#90d743") },
    { t: 1.00, color: new THREE.Color("#fde725") },
  ],
  freshwater: [
    { t: 0.00, color: new THREE.Color("#e8f5e9") },
    { t: 0.20, color: new THREE.Color("#80cbc4") },
    { t: 0.50, color: new THREE.Color("#26a69a") },
    { t: 0.75, color: new THREE.Color("#00695c") },
    { t: 1.00, color: new THREE.Color("#1a2f2b") },
  ],
};

function interpolateStops(stops: ColorStop[], t: number): THREE.Color {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i]!;
    const hi = stops[i + 1]!;
    if (clamped <= hi.t) {
      const span = hi.t - lo.t;
      const alpha = span === 0 ? 0 : (clamped - lo.t) / span;
      return new THREE.Color().lerpColors(lo.color, hi.color, alpha);
    }
  }
  return stops[stops.length - 1]!.color.clone();
}

/**
 * Build a discrete (step-function) colour lookup for the user bands: every
 * t inside band i returns exactly bandColors[i] with no blending.
 */
function makeDiscreteBandLookup(range?: DepthRangeM): (t: number) => THREE.Color {
  const { colors, boundariesFt } = getValidatedBands();
  const pos = boundaryPositions(boundariesFt, range);
  const threeColors = colors.map((hex) => new THREE.Color(hex));
  return (t: number) => {
    const clamped = Math.max(0, Math.min(1, t));
    // Band i covers [pos[i], pos[i+1]). The final band is closed at the top
    // so t=1 (and anything past the last boundary) takes the deepest colour.
    for (let i = 0; i < threeColors.length - 1; i++) {
      if (clamped < pos[i + 1]!) return threeColors[i]!.clone();
    }
    return threeColors[threeColors.length - 1]!.clone();
  };
}

/**
 * Returns a colour function for the given colormap theme.
 * The returned function maps t ∈ [0, 1] to a THREE.Color, where t is the
 * normalised position within the dataset's [minDepth, maxDepth] span.
 *
 * The "ocean" and "custom" themes reflect the user's configured depth bands
 * (paletteStore): variable band count, editable boundaries, and either
 * smooth blending or crisp discrete steps (blendBands). When `range` (the
 * dataset's depth range in metres) is provided, band boundaries anchor to
 * real depths; other themes are fixed presets and ignore `range`.
 *
 * @example
 *   const toColor = getColormap('ocean', { min: grid.minDepth, max: grid.maxDepth });
 *   mesh.material.color = toColor(normalizedDepth);
 */
export function getColormap(
  theme: ColormapTheme,
  range?: DepthRangeM,
): (t: number) => THREE.Color {
  if (theme === "ocean" || theme === "custom") {
    const { blend } = getValidatedBands();
    if (!blend) return makeDiscreteBandLookup(range);
    const stops = getBandStops(range);
    return (t: number) => interpolateStops(stops, t);
  }
  const stops = FIXED_THEME_STOPS[theme];
  return (t: number) => interpolateStops(stops, t);
}

/**
 * Convert a THREE.Color (which, with ColorManagement enabled, stores its
 * components in linear-sRGB space) into 8-bit display-space sRGB bytes
 * suitable for CSS / 2D canvas. Reading `.r * 255` directly would paint
 * the linear values onto the screen and the gradient would look much
 * darker than the source hex codes.
 */
function colorToSrgbBytes(c: THREE.Color): { r: number; g: number; b: number } {
  const srgb = c.clone().convertLinearToSRGB();
  return {
    r: Math.max(0, Math.min(255, Math.round(srgb.r * 255))),
    g: Math.max(0, Math.min(255, Math.round(srgb.g * 255))),
    b: Math.max(0, Math.min(255, Math.round(srgb.b * 255))),
  };
}

/**
 * Build a CSS `linear-gradient(...)` string for a colormap theme.
 * Samples the theme at `samples` evenly-spaced points so the gradient
 * approximates the same curve used by the renderer.
 *
 * @param theme   Colormap theme to sample.
 * @param direction CSS direction (e.g. "to right", "to bottom"). Defaults to "to right".
 * @param samples Number of colour stops; clamped to >= 2. Defaults to 12.
 * @param range   Optional dataset depth range (metres) to anchor user bands.
 */
export function colormapCssGradient(
  theme: ColormapTheme,
  direction: string = "to right",
  samples: number = 12,
  range?: DepthRangeM,
): string {
  const n = Math.max(2, samples);
  const toColor = getColormap(theme, range);
  const stops: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const t = f;
    const { r, g, b } = colorToSrgbBytes(toColor(t));
    stops.push(`rgb(${r},${g},${b}) ${(f * 100).toFixed(2)}%`);
  }
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

/**
 * Render the depth-to-colour gradient into an HTMLCanvasElement.
 * Used by the HUD scale bar and the Settings preview strip.
 *
 * @param range Optional dataset depth range (metres) to anchor user bands.
 */
export function colormapCanvas(
  width: number,
  height: number,
  theme: ColormapTheme = "ocean",
  range?: DepthRangeM,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const toColor = getColormap(theme, range);

  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const { r, g, b } = colorToSrgbBytes(toColor(t));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, width, 1);
  }

  return canvas;
}
