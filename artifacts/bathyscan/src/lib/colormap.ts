import * as THREE from "three";
import type { ColormapTheme } from "./settingsStore";
import { usePaletteStore, MID1_HEX, MID2_HEX, DEFAULT_CUSTOM_STOPS } from "./paletteStore";

interface ColorStop {
  t: number;
  color: THREE.Color;
}

/**
 * Build the ocean theme stops using the user-customised shallow and deep
 * endpoints from paletteStore. The two interior stops are fixed so the
 * gradient keeps its characteristic shape.
 */
function getOceanStops(): ColorStop[] {
  const { shallow, deep } = usePaletteStore.getState();
  return [
    { t: 0.00, color: new THREE.Color(shallow) },
    { t: 0.30, color: new THREE.Color(MID1_HEX) },
    { t: 0.65, color: new THREE.Color(MID2_HEX) },
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
    const c = toColor(t);
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);
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
    const c = toColor(t);
    ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
    ctx.fillRect(0, y, width, 1);
  }

  return canvas;
}
