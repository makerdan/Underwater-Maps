/**
 * computeDrift.ts — Pure drift physics model for the Drift Planner feature.
 *
 * For each hour, computes:
 *   - Resultant surface current vector (70% tidal + 30% wind leeway at 3% of wind speed)
 *   - Boat lat/lon position after drifting for one hour
 *   - Fishing line angle from vertical (simplified drag model)
 *   - Estimated hook depth and whether bottom is in reach
 *
 * Returns an array of 24 DriftWaypoints starting from (startLat, startLon).
 *
 * Coordinate conventions:
 *   - Degrees (lat/lon) for geographic positions
 *   - World-space XZ is computed by lonLatToWorldXZ() using terrain bounds
 *   - 1 knot = 1.852 km/h; 1° lat ≈ 111 km; 1° lon ≈ 111 km × cos(lat)
 */

import type { HourlySurfaceCondition, DriftWaypoint } from "./driftStore";
import { lonLatToWorldXZ } from "./terrain";
import type { TerrainData } from "@workspace/api-client-react";

const DEG2RAD = Math.PI / 180;
const KM_PER_KNOT_HOUR = 1.852;
const KM_PER_DEG_LAT = 111.0;

function degToRad(deg: number): number {
  return deg * DEG2RAD;
}

function radToDeg(rad: number): number {
  return rad / DEG2RAD;
}

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Convert a bearing (meteorological "from" convention, 0=N) + speed (knots)
 * into a velocity vector (km/h) in (dLat, dLon) per hour.
 * Bearing is direction the current is GOING TO (oceanographic convention used here).
 */
function currentVector(speedKnots: number, bearingDeg: number, refLat: number): { dLat: number; dLon: number } {
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

/**
 * Fishing line angle from vertical (degrees) given the water current speed.
 *
 * Empirical model calibrated for a typical halibut rig:
 *   - 500 g lead sinker on 50 lb monofilament
 *   - angle ≈ atan(currentSpeedKnots × drag_factor) × scale
 *
 * Results:
 *   0.0 kt → 0°   (straight down)
 *   0.5 kt → 10°
 *   1.0 kt → 20°
 *   2.0 kt → 38°
 *   3.0 kt → 52°
 *   4.0 kt → 63°  (near horizontal — unfishable)
 */
function lineAngle(resultantSpeedKnots: number): number {
  const rad = Math.atan(resultantSpeedKnots * 0.42);
  return Math.min(85, radToDeg(rad) * 2.1);
}

/**
 * Interpolate depth at a lat/lon from the terrain grid.
 * Uses bilinear interpolation across the grid cells.
 */
function getDepthAt(lat: number, lon: number, terrain: TerrainData): number {
  const { minLon, maxLon, minLat, maxLat, resolution: N, depths } = terrain;
  const u = Math.max(0, Math.min(1, (lon - minLon) / ((maxLon - minLon) || 1)));
  const v = Math.max(0, Math.min(1, (lat - minLat) / ((maxLat - minLat) || 1)));
  const col = u * (N - 1);
  const row = v * (N - 1);
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(N - 1, c0 + 1);
  const r1 = Math.min(N - 1, r0 + 1);
  const fc = col - c0;
  const fr = row - r0;
  const d00 = depths[r0 * N + c0] ?? 0;
  const d10 = depths[r0 * N + c1] ?? 0;
  const d01 = depths[r1 * N + c0] ?? 0;
  const d11 = depths[r1 * N + c1] ?? 0;
  return (
    d00 * (1 - fc) * (1 - fr) +
    d10 * fc * (1 - fr) +
    d01 * (1 - fc) * fr +
    d11 * fc * fr
  );
}

/**
 * Compute heading from current position to next position.
 */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = degToRad(lon2 - lon1);
  const lat1r = degToRad(lat1);
  const lat2r = degToRad(lat2);
  const y = Math.sin(dLon) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
  return normalizeAngle(radToDeg(Math.atan2(y, x)));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface ComputeDriftOptions {
  conditions: HourlySurfaceCondition[];
  startLat: number;
  startLon: number;
  lineLengthM: number;
  lineWeightG: number;
  terrain: TerrainData;
}

export function computeDrift(opts: ComputeDriftOptions): DriftWaypoint[] {
  const { conditions, startLat, startLon, lineLengthM, terrain } = opts;

  const waypoints: DriftWaypoint[] = [];
  let curLat = startLat;
  let curLon = startLon;

  for (let h = 0; h < 24; h++) {
    const cond = conditions[h % conditions.length]!;

    const tidalVec = currentVector(cond.tidalSpeedKnots, cond.tidalDegrees, curLat);
    const windLeewaySpeed = cond.windSpeedKnots * 0.03;
    const windVec = currentVector(windLeewaySpeed, cond.windDegrees, curLat);

    const resultantDLat = 0.7 * tidalVec.dLat + 0.3 * windVec.dLat;
    const resultantDLon = 0.7 * tidalVec.dLon + 0.3 * windVec.dLon;

    const resultantKmH = Math.sqrt(
      (resultantDLat * KM_PER_DEG_LAT) ** 2 +
      (resultantDLon * KM_PER_DEG_LAT * Math.cos(degToRad(curLat))) ** 2,
    );
    const resultantKnots = resultantKmH / KM_PER_KNOT_HOUR;

    const nextLat = curLat + resultantDLat;
    const nextLon = curLon + resultantDLon;

    const headingDeg = (resultantDLat === 0 && resultantDLon === 0)
      ? 0
      : bearing(curLat, curLon, nextLat, nextLon);

    const angle = lineAngle(resultantKnots);
    const hookDepthM = lineLengthM * Math.cos(degToRad(angle));
    const depth = getDepthAt(curLat, curLon, terrain);
    const bottomReached = hookDepthM >= depth - 5;

    const worldPos = lonLatToWorldXZ(curLon, curLat, terrain);

    const isSlack = !!cond.isSlack || cond.tidalSpeedKnots < 0.1;
    waypoints.push({
      hour: h,
      lat: curLat,
      lon: curLon,
      worldX: worldPos.x,
      worldZ: worldPos.z,
      lineAngleDeg: angle,
      hookDepthM,
      bottomReached,
      driftSpeedKnots: Math.round(resultantKnots * 10) / 10,
      headingDeg,
      isSlack,
      phase: cond.phase,
    });

    curLat = nextLat;
    curLon = nextLon;
  }

  return waypoints;
}
