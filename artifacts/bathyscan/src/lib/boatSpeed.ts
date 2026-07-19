import type { TerrainData } from "@workspace/api-client-react";
import { WORLD_SIZE } from "./terrain";

export const BOAT_MIN_MPH = 3;
export const BOAT_MAX_MPH = 55;
export const BOAT_DEFAULT_MPH = 15;

const MPH_TO_MS = 0.44704;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Hydrodynamic drag penalty for backtrolling (stern-first).
 *
 * A conventional planing hull has roughly 40% more frictional resistance
 * when driven stern-first due to the absence of a streamlined bow entry,
 * increased stern cross-section presented to the flow, and propeller
 * efficiency losses in reverse.  The coefficient is intentionally a
 * constant approximation; real drag is speed- and hull-form-dependent,
 * but 1.4 is a practical mid-range value calibrated for Alaska salmon/
 * halibut boats (18–24 ft) at trolling speeds (1–4 kt).
 *
 * Usage in physics:
 *   effectiveReverseSpeed = boatSpeedKnots / BACKTROLL_DRAG_COEFFICIENT
 *   stallBoatSetting      = currentSpeedKnots * BACKTROLL_DRAG_COEFFICIENT
 *   stallEffectiveSpeed   = currentSpeedKnots / BACKTROLL_DRAG_COEFFICIENT
 */
export const BACKTROLL_DRAG_COEFFICIENT = 1.4;

/**
 * Leeway scaling for backtrolling.
 *
 * Stern-first attitude exposes a larger lateral profile to the wind,
 * so wind-driven leeway is proportionally higher.  1.6× is an empirical
 * approximation (vs. the 3% of wind speed used in forward trolling).
 */
export const BACKTROLL_LEEWAY_COEFFICIENT = 0.048; // 4.8% of wind speed

function haversineMeters(
  lon1: number, lat1: number,
  lon2: number, lat2: number,
): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shortArcLonDelta(minLon: number, maxLon: number): number {
  let d = (maxLon - minLon) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function computeMetersPerWorldUnit(grid: TerrainData): number {
  const centerLat = (grid.minLat + grid.maxLat) / 2;
  const dLon = shortArcLonDelta(grid.minLon, grid.maxLon);
  const widthM = haversineMeters(0, centerLat, dLon, centerLat);
  const mpu = widthM / WORLD_SIZE;
  return mpu > 0 ? mpu : 1;
}

export function boatMphToWorldUnitsPerSecond(mph: number, metersPerWorldUnit: number): number {
  const ms = mph * MPH_TO_MS;
  return ms / metersPerWorldUnit;
}

export function mphToKnots(mph: number): number {
  return mph * 0.868976;
}

export const BOAT_TICK_SPEEDS = [3, 10, 20, 30, 40, 55] as const;

/**
 * Real-world fly-camera speed tiers in mph (one per speed-index slot).
 * Defined here alongside the unit-conversion helpers so `computeFlyScaledSpeed`
 * can use it without any circular import.  `context.tsx` re-exports this name
 * so existing callers that import from `@/lib/context` continue to work.
 */
export const FLY_SPEEDS_MPH = [30, 100, 250, 700, 2000] as const;

/**
 * Fallback meters-per-world-unit used when no dataset is loaded or the
 * computed mpu is degenerate (≤ 0, NaN, Infinity).
 * 200 m/wu ≈ a mid-sized lake filling the 100-wu world.
 */
export const FLY_FALLBACK_MPU = 200;

/**
 * Hard per-frame world-unit cap for fly mode.  Ensures that a tiny dataset
 * (very small mpu) cannot teleport the camera across the world in one frame.
 */
export const FLY_MAX_FRAME_WU = 20;

/**
 * Fly-mode MPU derivation helper.
 *
 * Unlike `computeMetersPerWorldUnit`, which returns `1` as a sentinel for a
 * zero-extent (point) terrain, this helper returns `FLY_FALLBACK_MPU` for any
 * grid that is null, undefined, or degenerate.  Real survey datasets are always
 * at least several hundred metres wide (mpu >> 1), so `mpu ≤ 1` unambiguously
 * indicates the `computeMetersPerWorldUnit` sentinel, not a genuine physical
 * scale.  Using `FLY_FALLBACK_MPU` instead prevents unintended ultra-fast
 * camera movement when no valid dataset is loaded.
 */
export function computeFlyMpu(grid: TerrainData | null | undefined): number {
  if (!grid) return FLY_FALLBACK_MPU;
  const mpu = computeMetersPerWorldUnit(grid);
  return mpu > 1 ? mpu : FLY_FALLBACK_MPU;
}

/**
 * Lerp rate for the per-frame MPU smoother (per second).
 *
 * Uses framerate-independent exponential decay so the convergence speed is the
 * same at 30 fps and 120 fps.  At this rate, ~98% of the gap closes within
 * ~1 second, giving a smooth transition when the camera crosses a dataset
 * boundary without making the camera feel sluggish at normal speeds.
 */
export const FLY_MPU_LERP_RATE = 4.0;

/**
 * Advance the smoothed MPU one frame toward `targetMpu`.
 *
 * Uses framerate-independent exponential decay so the blend is identical at
 * 30 fps and 120 fps.  Initialise `current` to `FLY_FALLBACK_MPU` (or the
 * first valid target) before the first call; never pass 0.
 *
 * This prevents mpu step-changes at dataset boundaries from producing a single
 * oversized camera jump before `FLY_MAX_FRAME_WU` can clamp it.
 */
export function smoothMpuStep(current: number, targetMpu: number, delta: number): number {
  const t = 1 - Math.exp(-FLY_MPU_LERP_RATE * delta);
  return current + (targetMpu - current) * t;
}

/**
 * Pure helper that converts a fly-mode speed-tier index + meters-per-world-unit
 * into a frame-scaled world-unit displacement.
 *
 * Guards:
 *  - speedIndex is clamped to [0, FLY_SPEEDS_MPH.length - 1] so out-of-range
 *    values never throw or produce undefined.
 *  - mpu ≤ 0 or non-finite falls back to FLY_FALLBACK_MPU.
 *  - result is capped at FLY_MAX_FRAME_WU so a tiny-dataset mpu can never
 *    teleport the camera.
 */
export function computeFlyScaledSpeed(speedIndex: number, mpu: number, delta: number): number {
  const clampedIndex = Math.max(0, Math.min(FLY_SPEEDS_MPH.length - 1, Math.trunc(speedIndex)));
  const mph = FLY_SPEEDS_MPH[clampedIndex] ?? FLY_SPEEDS_MPH[0]!;
  const safeMpu = mpu > 0 && isFinite(mpu) ? mpu : FLY_FALLBACK_MPU;
  const wups = boatMphToWorldUnitsPerSecond(mph, safeMpu);
  return Math.min(wups * delta, FLY_MAX_FRAME_WU);
}
