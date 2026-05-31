/**
 * boatPhysics.ts — Shared physics engine for Drift Planner and Drive Boat.
 *
 * All exported functions are pure: no store reads, no React hooks, no side
 * effects. Both `computeDrift.ts` and `useFlyControls.ts` import from here so
 * every force-to-motion calculation stays in a single, testable module.
 *
 * Unit convention:
 *   - Positions in degrees (lat/lon)
 *   - Speeds in knots (nautical miles per hour) unless otherwise noted
 *   - Time step is implicitly 1 hour for displacement outputs (dLat/dLon)
 *   - World-space velocity in m/s where noted
 */

export const KM_PER_KNOT_HOUR = 1.852;
export const KM_PER_DEG_LAT = 111.0;
/** Knots → metres per second. */
export const KT_TO_MS = 0.514444;

const DEG2RAD = Math.PI / 180;

function degToRad(deg: number): number {
  return deg * DEG2RAD;
}

/**
 * Reference depth (m) used for shallow-water tidal-speed scaling.
 * Below this depth the scaling factor is effectively 1.0 (no amplification).
 */
const TIDAL_REFERENCE_DEPTH_M = 30;

/**
 * Maximum tidal amplification factor in very shallow water.
 * Prevents degenerate velocities when terrain depth approaches zero.
 */
const TIDAL_MAX_SCALE = 3.0;

// ---------------------------------------------------------------------------
// Core vector math
// ---------------------------------------------------------------------------

/**
 * Convert a bearing (oceanographic "going to" convention, 0=N, 90=E) and
 * speed (knots) into a displacement vector (degrees/hour) for lat and lon.
 *
 * @param speedKnots - Current or boat speed in knots
 * @param bearingDeg - Direction of travel (compass, 0=N)
 * @param refLat     - Reference latitude for longitude scaling (degrees)
 */
export function currentVector(
  speedKnots: number,
  bearingDeg: number,
  refLat: number,
): { dLat: number; dLon: number } {
  const speedKmH = speedKnots * KM_PER_KNOT_HOUR;
  const rad = degToRad(bearingDeg);
  const dLatKm = speedKmH * Math.cos(rad);
  const dLonKm = speedKmH * Math.sin(rad);
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos(degToRad(refLat));
  return {
    dLat: dLatKm / KM_PER_DEG_LAT,
    dLon: kmPerDegLon > 0 ? dLonKm / kmPerDegLon : 0,
  };
}

// ---------------------------------------------------------------------------
// Shallow-water scaling
// ---------------------------------------------------------------------------

/**
 * Shallow-water tidal speed scale factor.
 *
 * When tide height data is available, effective water depth =
 * terrainDepth + tideHeightM. By continuity (Q = A × v), tidal speed
 * scales inversely with depth relative to the reference depth:
 *   scale = TIDAL_REFERENCE_DEPTH_M / effectiveDepth  (capped at TIDAL_MAX_SCALE)
 *
 * At depths ≥ TIDAL_REFERENCE_DEPTH_M the factor is ≤ 1 (no amplification).
 */
export function shallowWaterTidalScale(terrainDepthM: number, tideHeightM: number): number {
  const effectiveDepth = Math.max(1, terrainDepthM + tideHeightM);
  if (effectiveDepth >= TIDAL_REFERENCE_DEPTH_M) return 1.0;
  return Math.min(TIDAL_MAX_SCALE, TIDAL_REFERENCE_DEPTH_M / effectiveDepth);
}

// ---------------------------------------------------------------------------
// Blended drift vector
// ---------------------------------------------------------------------------

export interface BlendedDriftInput {
  tidalSpeedKnots: number;
  tidalDegrees: number;
  windSpeedKnots: number;
  windDegrees: number;
  /**
   * Combined leeway × windage factor: fraction of wind speed that contributes
   * to lateral boat drift. Typical values:
   *   - Open skiff forward: profile.leewayFactor × profile.windageFactor ≈ 0.035
   *   - Backtroll: BACKTROLL_LEEWAY_COEFFICIENT ≈ 0.048
   */
  leewayFactor: number;
  /** Reference latitude for longitude-degree scaling. */
  refLat: number;
}

export interface BlendedDriftResult {
  /** Latitude displacement (degrees/hour). Positive = northward. */
  dLat: number;
  /** Longitude displacement (degrees/hour). Positive = eastward. */
  dLon: number;
  /** Magnitude of the blended drift vector (knots). */
  speedKnots: number;
}

/**
 * Compute the blended surface drift vector: 70% tidal current + 30% wind-driven leeway.
 *
 * This is the canonical formula used by both the Drift Planner (per-hour
 * position integration) and Drive Boat (per-frame tidal pushback). Any change
 * to the blend ratio or the leeway model should be made here only.
 */
export function computeBlendedDrift(input: BlendedDriftInput): BlendedDriftResult {
  const { tidalSpeedKnots, tidalDegrees, windSpeedKnots, windDegrees, leewayFactor, refLat } = input;
  const tidalVec = currentVector(tidalSpeedKnots, tidalDegrees, refLat);
  const windVec = currentVector(windSpeedKnots * leewayFactor, windDegrees, refLat);
  const dLat = 0.7 * tidalVec.dLat + 0.3 * windVec.dLat;
  const dLon = 0.7 * tidalVec.dLon + 0.3 * windVec.dLon;
  const driftKmH = Math.sqrt(
    (dLat * KM_PER_DEG_LAT) ** 2 +
    (dLon * KM_PER_DEG_LAT * Math.cos(degToRad(refLat))) ** 2,
  );
  return { dLat, dLon, speedKnots: driftKmH / KM_PER_KNOT_HOUR };
}

// ---------------------------------------------------------------------------
// World-space conversion for Drive Boat (per-frame tidal pushback)
// ---------------------------------------------------------------------------

export interface TidalWorldVelocity {
  /**
   * Eastward velocity (m/s), maps to +X world axis.
   * Standard compass: bearing 90° → pure east → +worldDX.
   */
  worldDX: number;
  /**
   * Northward velocity (m/s), maps to +Z world axis.
   * Standard compass: bearing 0° → pure north → +worldDZ.
   */
  worldDZ: number;
}

/**
 * Convert a tidal current (knots + compass bearing) to world-space velocity (m/s).
 *
 * Used by Drive Boat to compute the per-frame camera displacement due to
 * tidal pushback in realistic mode. The same formula that `computeBlendedDrift`
 * uses internally, but expressed in m/s so the frame loop can multiply by `delta`.
 *
 * @param speedKt      - Tidal speed in knots
 * @param directionDeg - Compass direction the current is flowing toward (0=N, 90=E)
 */
export function tidalToWorldVelocity(speedKt: number, directionDeg: number): TidalWorldVelocity {
  const dirRad = directionDeg * DEG2RAD;
  return {
    worldDX: Math.sin(dirRad) * speedKt * KT_TO_MS,
    worldDZ: Math.cos(dirRad) * speedKt * KT_TO_MS,
  };
}
