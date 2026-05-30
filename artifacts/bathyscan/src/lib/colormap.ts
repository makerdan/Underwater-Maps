import * as THREE from "three";
import type { ColormapTheme } from "./settingsStore";
import { usePaletteStore, DEFAULT_CUSTOM_STOPS } from "./paletteStore";

interface ColorStop {
  t: number;
  color: THREE.Color;
}

/**
 * Canonical depth band boundaries in feet. These define 10 visually distinct
 * bands from near-surface through deep water (0–2000 ft total range).
 * Used by DepthScaleBar and DepthLegend to position tick labels.
 */
export const DEPTH_BAND_BOUNDARIES_FT = [
  0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000,
] as const;

/** Maximum depth of the ocean colormap scale in feet. */
export const OCEAN_MAX_DEPTH_FT = 2000;

/**
 * Fixed interior colour stops for the 10-band ocean gradient.
 * t values are normalised to [0, 1] relative to OCEAN_MAX_DEPTH_FT.
 * Endpoints (t=0, t=1) come from the user's palette store.
 */
const OCEAN_INTERIOR_STOPS: ReadonlyArray<{ t: number; hex: string }> = [
  { t: 50 / 2000,  hex: "#00c8de" }, //  50 ft — cyan-teal
  { t: 100 / 2000, hex: "#00a8d0" }, // 100 ft — sky blue
  { t: 150 / 2000, hex: "#0288d1" }, // 150 ft — ocean blue
  { t: 200 / 2000, hex: "#0277bd" }, // 200 ft — medium blue
  { t: 250 / 2000, hex: "#1565c0" }, // 250 ft — cobalt blue
  { t: 300 / 2000, hex: "#0d47a1" }, // 300 ft — royal blue
  { t: 350 / 2000, hex: "#1a237e" }, // 350 ft — indigo navy
  { t: 450 / 2000, hex: "#283593" }, // 450 ft — deep navy
  { t: 600 / 2000, hex: "#1e2b6e" }, // 600 ft — dark navy
];

/**
 * Build the ocean theme stops using the user-customised shallow and deep
 * endpoints from paletteStore. Nine fixed interior stops provide a
 * 10-band gradient aligned to DEPTH_BAND_BOUNDARIES_FT.
 */
function getOceanStops(): ColorStop[] {
  const { shallow, deep } = usePaletteStore.getState();
  return [
    { t: 0.00, color: new THREE.Color(shallow) },
    ...OCEAN_INTERIOR_STOPS.map((s) => ({ t: s.t, color: new THREE.Color(s.hex) })),
    { t: 1.00, color: new THREE.Color(deep) },
  ];
}

/**
 * Build the user's Custom palette stops from paletteStore. Endpoints are
 * pinned to t=0 and t=1 if the persisted stops don't already span the full
 * range, and identical positions are nudged apart so the interpolator never
 * divides by zero. Returns the Default Ocean stops if the persisted data
 * has fewer than 2 usable entries.
 */
function getCustomStops(): ColorStop[] {
  const raw = usePaletteStore.getState().customStops;
  const source = raw.length >= 2 ? raw : DEFAULT_CUSTOM_STOPS;
  // Defensive copy + sort (store already normalises, but be safe for callers
  // that may have mutated state outside the setter).
  const sorted = [...source].sort((a, b) => a.position - b.position);
  const stops: ColorStop[] = sorted.map((s) => ({
    t: Math.max(0, Math.min(1, s.position)),
    color: new THREE.Color(s.hex),
  }));
  // Clamp endpoints to 0 / 1 so the gradient covers the full depth range.
  if (stops[0]!.t > 0) {
    stops.unshift({ t: 0, color: stops[0]!.color.clone() });
  }
  if (stops[stops.length - 1]!.t < 1) {
    stops.push({ t: 1, color: stops[stops.length - 1]!.color.clone() });
  }
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

function stopsForTheme(theme: ColormapTheme): ColorStop[] {
  if (theme === "ocean") return getOceanStops();
  if (theme === "custom") return getCustomStops();
  return FIXED_THEME_STOPS[theme];
}

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
 * Map a normalised depth t ∈ [0, 1] to a THREE.Color using the ocean theme
 * with the user's current shallow/deep palette overrides.
 * t = 0 → shallowest, t = 1 → deepest.
 *
 * @deprecated Prefer getColormap(theme)(t) for theme-aware colouring.
 */
export function depthToColor(t: number): THREE.Color {
  return interpolateStops(getOceanStops(), t);
}

/**
 * Returns a colour function for the given colormap theme.
 * The returned function maps t ∈ [0, 1] to a THREE.Color.
 *
 * The "ocean" theme reflects the user's customised shallow/deep palette
 * (paletteStore); other themes are fixed presets.
 *
 * @example
 *   const toColor = getColormap('thermal');
 *   mesh.material.color = toColor(normalizedDepth);
 */
export function getColormap(theme: ColormapTheme): (t: number) => THREE.Color {
  const stops = stopsForTheme(theme);
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
 */
export function colormapCssGradient(
  theme: ColormapTheme,
  direction: string = "to right",
  samples: number = 12,
): string {
  const n = Math.max(2, samples);
  const toColor = getColormap(theme);
  const stops: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const { r, g, b } = colorToSrgbBytes(toColor(t));
    stops.push(`rgb(${r},${g},${b}) ${(t * 100).toFixed(2)}%`);
  }
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

/**
 * Render the depth-to-colour gradient into an HTMLCanvasElement.
 * Used by the HUD scale bar.
 */
export function colormapCanvas(
  width: number,
  height: number,
  theme: ColormapTheme = "ocean",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const toColor = getColormap(theme);

  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const { r, g, b } = colorToSrgbBytes(toColor(t));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, width, 1);
  }

  return canvas;
}
