/**
 * thermalColormap — temperature-to-color mapping for the water volume layer.
 *
 * Maps °C values to a perceptually distinct thermal gradient:
 *   ≥20°C → red/orange  (warm surface water)
 *   ~10°C → teal/green  (thermocline)
 *   ≤2°C  → deep blue/purple (cold deep water)
 */
import * as THREE from "three";

interface ThermalStop {
  t: number;
  color: THREE.Color;
}

/** Minimum temperature clamped to the cold end of the gradient (°C). */
export const THERMAL_MIN_C = 2;
/** Maximum temperature clamped to the warm end of the gradient (°C). */
export const THERMAL_MAX_C = 22;

const THERMAL_STOPS: ThermalStop[] = [
  { t: 0.00, color: new THREE.Color("#3d0c6e") }, // deep purple  — very cold (≤2°C)
  { t: 0.20, color: new THREE.Color("#0c3d8a") }, // deep blue    — ~6°C
  { t: 0.40, color: new THREE.Color("#0872b5") }, // steel blue   — ~10°C
  { t: 0.55, color: new THREE.Color("#1fb8a0") }, // teal-green   — ~13°C
  { t: 0.70, color: new THREE.Color("#f5d000") }, // amber/yellow  — ~16°C
  { t: 0.85, color: new THREE.Color("#f97316") }, // orange       — ~19°C
  { t: 1.00, color: new THREE.Color("#dc2626") }, // red          — ≥20°C
];

/**
 * Map a temperature (°C) to a THREE.Color using a thermal gradient.
 *
 * Safe for any finite input and never throws for out-of-range values
 * (values below THERMAL_MIN_C clamp to the cold end, values above
 * THERMAL_MAX_C clamp to the warm end).
 *
 * @example
 *   tempToColor(22)  // red/orange — very warm
 *   tempToColor(10)  // teal-green — mid thermocline
 *   tempToColor(-5)  // deep purple — clamps to cold end
 */
export function tempToColor(tempC: number): THREE.Color {
  const safeTempC = Number.isFinite(tempC) ? tempC : THERMAL_MIN_C;
  const t = Math.max(
    0,
    Math.min(1, (safeTempC - THERMAL_MIN_C) / (THERMAL_MAX_C - THERMAL_MIN_C)),
  );

  for (let i = 0; i < THERMAL_STOPS.length - 1; i++) {
    const lo = THERMAL_STOPS[i]!;
    const hi = THERMAL_STOPS[i + 1]!;
    if (t <= hi.t) {
      const span = hi.t - lo.t;
      const alpha = span === 0 ? 0 : (t - lo.t) / span;
      return new THREE.Color().lerpColors(lo.color, hi.color, alpha);
    }
  }
  return THERMAL_STOPS[THERMAL_STOPS.length - 1]!.color.clone();
}
