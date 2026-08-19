/**
 * Renderer-free display rules shared by the conditions HUD and 3D overlays.
 *
 * Keep this module free of Three.js / R3F imports: ConditionsLegend is part of
 * the initial app shell, while the renderers are loaded with TourScene.
 */
export type DepthLayer = "surface" | "mid" | "near-bottom";

/** Beaufort-style colour ramp for wind speed in knots. */
export function windColor(knots: number): string {
  if (knots < 4) return "#7dd3fc";
  if (knots < 11) return "#38bdf8";
  if (knots < 17) return "#a3e635";
  if (knots < 22) return "#facc15";
  if (knots < 28) return "#fb923c";
  if (knots < 34) return "#f87171";
  return "#e11d48";
}

export const LAYER_SPEED_ATTENUATE: Record<DepthLayer, number> = {
  surface: 1.0,
  mid: 0.6,
  "near-bottom": 0.25,
};

/** Distinguishable per-layer colours for the always-on Current overlay. */
export const LAYER_COLORS: Record<DepthLayer, string> = {
  surface: "#22d3ee",
  mid: "#38bdf8",
  "near-bottom": "#818cf8",
};

export const LAYER_LABEL: Record<DepthLayer, string> = {
  surface: "Surface",
  mid: "Mid",
  "near-bottom": "Near-bottom",
};