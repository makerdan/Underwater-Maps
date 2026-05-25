import * as THREE from "three";
import type { ColormapTheme } from "./settingsStore";

interface ColorStop {
  t: number;
  color: THREE.Color;
}

const THEME_STOPS: Record<ColormapTheme, ColorStop[]> = {
  ocean: [
    { t: 0.00, color: new THREE.Color("#00e5ff") },
    { t: 0.30, color: new THREE.Color("#0d47a1") },
    { t: 0.65, color: new THREE.Color("#1a237e") },
    { t: 1.00, color: new THREE.Color("#283593") },
  ],
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
 * Map a normalised depth t ∈ [0, 1] to a THREE.Color using the ocean theme.
 * t = 0 → shallowest, t = 1 → deepest.
 * @deprecated Prefer getColormap(theme)(t) for theme-aware colouring.
 */
export function depthToColor(t: number): THREE.Color {
  return interpolateStops(THEME_STOPS.ocean, t);
}

/**
 * Returns a colour function for the given colormap theme.
 * The returned function maps t ∈ [0, 1] to a THREE.Color.
 *
 * @example
 *   const toColor = getColormap('thermal');
 *   mesh.material.color = toColor(normalizedDepth);
 */
export function getColormap(theme: ColormapTheme): (t: number) => THREE.Color {
  const stops = THEME_STOPS[theme];
  return (t: number) => interpolateStops(stops, t);
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
