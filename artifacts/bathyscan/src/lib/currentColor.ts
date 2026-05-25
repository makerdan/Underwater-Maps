/**
 * currentColor.ts — Shared speed-to-color ramp used by every current
 * visualization layer (particles, arrows, streamlines) and the HUD legend.
 *
 * Cool teal at low speeds → warm amber at high speeds, matching the
 * BathyScan HUD palette. Returns sRGB components in [0, 1].
 */

import * as THREE from "three";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const CURRENT_RAMP_STOPS: { t: number; color: string }[] = [
  { t: 0.00, color: "#06314a" },  // very deep teal
  { t: 0.20, color: "#0ea5e9" },  // sky
  { t: 0.45, color: "#22d3ee" },  // cyan
  { t: 0.70, color: "#facc15" },  // amber
  { t: 1.00, color: "#f97316" },  // orange
];

function hexToRgb(hex: string): RGB {
  const m = hex.replace("#", "");
  const n = parseInt(m, 16);
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
}

const RAMP = CURRENT_RAMP_STOPS.map((s) => ({ t: s.t, rgb: hexToRgb(s.color) }));

/** Map a normalized speed in [0, 1] to a colour ramp value. */
export function speedToColor(t: number): RGB {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RAMP.length; i++) {
    const a = RAMP[i - 1]!;
    const b = RAMP[i]!;
    if (x <= b.t) {
      const u = (x - a.t) / Math.max(1e-6, b.t - a.t);
      return {
        r: a.rgb.r + (b.rgb.r - a.rgb.r) * u,
        g: a.rgb.g + (b.rgb.g - a.rgb.g) * u,
        b: a.rgb.b + (b.rgb.b - a.rgb.b) * u,
      };
    }
  }
  return RAMP[RAMP.length - 1]!.rgb;
}

export function speedToThreeColor(t: number, out?: THREE.Color): THREE.Color {
  const c = speedToColor(t);
  if (out) return out.setRGB(c.r, c.g, c.b);
  return new THREE.Color(c.r, c.g, c.b);
}
