import * as THREE from "three";

interface ColorStop {
  t: number;
  color: THREE.Color;
}

const STOPS: ColorStop[] = [
  { t: 0.00, color: new THREE.Color("#00e5ff") },
  { t: 0.30, color: new THREE.Color("#0d47a1") },
  { t: 0.65, color: new THREE.Color("#1a237e") },
  { t: 1.00, color: new THREE.Color("#283593") },
];

/**
 * Map a normalised depth t ∈ [0, 1] to a THREE.Color.
 * t = 0 → shallowest, t = 1 → deepest.
 * The caller is responsible for normalising:
 *   t = (depth − minDepth) / (maxDepth − minDepth)
 */
export function depthToColor(t: number): THREE.Color {
  const clamped = Math.max(0, Math.min(1, t));

  for (let i = 0; i < STOPS.length - 1; i++) {
    const lo = STOPS[i]!;
    const hi = STOPS[i + 1]!;
    if (clamped <= hi.t) {
      const span = hi.t - lo.t;
      const alpha = span === 0 ? 0 : (clamped - lo.t) / span;
      return new THREE.Color().lerpColors(lo.color, hi.color, alpha);
    }
  }

  return STOPS[STOPS.length - 1]!.color.clone();
}

/**
 * Render the depth-to-colour gradient into an HTMLCanvasElement.
 * Used by the HUD scale bar.
 */
export function colormapCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const c = depthToColor(t);
    ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
    ctx.fillRect(0, y, width, 1);
  }

  return canvas;
}
