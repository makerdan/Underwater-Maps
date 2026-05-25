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

import type { HourlySurfaceCondition, DriftWaypoint, TrollWaypoint } from "./driftStore";
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
  /** When "trolling", a boat propulsion vector is added to the wind+tide drift. */
  mode?: "drift" | "trolling";
  /** Boat heading in degrees (0=N, 90=E). Used only when mode === "trolling" without waypoints. */
  boatHeadingDeg?: number;
  /** Boat speed through water in knots. Used only when mode === "trolling". */
  boatSpeedKnots?: number;
  /**
   * Optional bathymetry-modified flow sampler (Task #136). When provided,
   * the tidal component is sampled at the boat's current world-space
   * position so flow accelerates over shallows and deflects around land,
   * instead of using a single ambient value for the whole region. Returning
   * null falls back to the per-hour ambient `tidalSpeedKnots/tidalDegrees`.
   * The 70/30 tidal/wind blend is preserved either way.
   */
  sampleFlowAt?: (lat: number, lon: number) => { speedKt: number; directionDeg: number } | null;
  /**
   * Ordered list of trolling turn points. When provided (and mode === "trolling"
   * with boatSpeedKnots > 0) the boat steers toward each waypoint in order,
   * turning at each one and looping back to the start to repeat the circuit.
   */
  trollWaypoints?: TrollWaypoint[];
}

/** Approximate great-circle distance in km using equirectangular projection (good for small scales). */
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const meanLat = (lat1 + lat2) / 2;
  const dLatKm = (lat2 - lat1) * KM_PER_DEG_LAT;
  const dLonKm = (lon2 - lon1) * KM_PER_DEG_LAT * Math.cos(degToRad(meanLat));
  return Math.sqrt(dLatKm * dLatKm + dLonKm * dLonKm);
}

export function computeDrift(opts: ComputeDriftOptions): DriftWaypoint[] {
  const {
    conditions, startLat, startLon, lineLengthM, terrain,
    mode = "drift", boatHeadingDeg = 0, boatSpeedKnots = 0,
    sampleFlowAt,
    trollWaypoints = [],
  } = opts;

  // Build the leg target sequence for waypoint-following trolling: the user's
  // ordered waypoints, then back to the start, repeated forever. This produces
  // realistic back-and-forth passes over a hump when 1+ waypoints are placed.
  const useWaypoints =
    mode === "trolling" && boatSpeedKnots > 0 && trollWaypoints.length > 0;
  const circuit: Array<{ lat: number; lon: number; userIndex: number }> = [];
  if (useWaypoints) {
    for (let i = 0; i < trollWaypoints.length; i++) {
      const w = trollWaypoints[i]!;
      circuit.push({ lat: w.lat, lon: w.lon, userIndex: i });
    }
    // Return-to-start leg (userIndex = -1) closes the loop.
    circuit.push({ lat: startLat, lon: startLon, userIndex: -1 });
  }
  let legIndex = 0;

  const waypoints: DriftWaypoint[] = [];
  let curLat = startLat;
  let curLon = startLon;

  for (let h = 0; h < 24; h++) {
    const cond = conditions[h % conditions.length]!;
    const hourStartLat = curLat;
    const hourStartLon = curLon;

    if (useWaypoints) {
      // Sub-step the hour: travel toward the current leg target at boat speed,
      // advancing to the next leg when we reach the target, while wind+tide
      // drift is applied uniformly across the full hour at the end.
      let timeRemaining = 1; // hours
      const boatKmH = boatSpeedKnots * KM_PER_KNOT_HOUR;
      // Bound iterations to avoid pathological loops (e.g. waypoints stacked).
      let guard = 0;
      while (timeRemaining > 1e-6 && guard < 50) {
        guard++;
        const tgt = circuit[legIndex % circuit.length]!;
        const distKm = distanceKm(curLat, curLon, tgt.lat, tgt.lon);
        if (distKm < 1e-4 || boatKmH < 1e-6) {
          legIndex = (legIndex + 1) % circuit.length;
          continue;
        }
        const timeToTarget = distKm / boatKmH;
        const t = Math.min(timeRemaining, timeToTarget);
        const frac = t / timeToTarget; // 0..1 along the leg this sub-step
        curLat = curLat + (tgt.lat - curLat) * frac;
        curLon = curLon + (tgt.lon - curLon) * frac;
        timeRemaining -= t;
        if (frac >= 1 - 1e-6) {
          legIndex = (legIndex + 1) % circuit.length;
        }
      }
      // Apply wind+tide drift integrated over the hour. Sample bathymetry-
      // shaped flow at the hour-start position when available (Task #136);
      // fall back to the per-hour ambient otherwise.
      let tidalSpeed = cond.tidalSpeedKnots;
      let tidalDir = cond.tidalDegrees;
      if (sampleFlowAt) {
        const sampled = sampleFlowAt(hourStartLat, hourStartLon);
        if (sampled) {
          tidalSpeed = sampled.speedKt;
          tidalDir = sampled.directionDeg;
        }
      }
      const tidalVec = currentVector(tidalSpeed, tidalDir, hourStartLat);
      const windLeewaySpeed = cond.windSpeedKnots * 0.03;
      const windVec = currentVector(windLeewaySpeed, cond.windDegrees, hourStartLat);
      curLat += 0.7 * tidalVec.dLat + 0.3 * windVec.dLat;
      curLon += 0.7 * tidalVec.dLon + 0.3 * windVec.dLon;
    } else {
      // Tidal component: prefer the bathymetry-shaped sampler when supplied
      // (Task #136); otherwise fall back to the per-hour ambient.
      let tidalSpeed = cond.tidalSpeedKnots;
      let tidalDir = cond.tidalDegrees;
      if (sampleFlowAt) {
        const sampled = sampleFlowAt(curLat, curLon);
        if (sampled) {
          tidalSpeed = sampled.speedKt;
          tidalDir = sampled.directionDeg;
        }
      }
      const tidalVec = currentVector(tidalSpeed, tidalDir, curLat);
      const windLeewaySpeed = cond.windSpeedKnots * 0.03;
      const windVec = currentVector(windLeewaySpeed, cond.windDegrees, curLat);

      let resultantDLat = 0.7 * tidalVec.dLat + 0.3 * windVec.dLat;
      let resultantDLon = 0.7 * tidalVec.dLon + 0.3 * windVec.dLon;

      if (mode === "trolling" && boatSpeedKnots > 0) {
        const boatVec = currentVector(boatSpeedKnots, boatHeadingDeg, curLat);
        resultantDLat += boatVec.dLat;
        resultantDLon += boatVec.dLon;
      }
      curLat = curLat + resultantDLat;
      curLon = curLon + resultantDLon;
    }

    const dLatTotal = curLat - hourStartLat;
    const dLonTotal = curLon - hourStartLon;
    const resultantKmH = Math.sqrt(
      (dLatTotal * KM_PER_DEG_LAT) ** 2 +
      (dLonTotal * KM_PER_DEG_LAT * Math.cos(degToRad(hourStartLat))) ** 2,
    );
    const resultantKnots = resultantKmH / KM_PER_KNOT_HOUR;

    const headingDeg = (Math.abs(dLatTotal) < 1e-12 && Math.abs(dLonTotal) < 1e-12)
      ? 0
      : bearing(hourStartLat, hourStartLon, curLat, curLon);

    const angle = lineAngle(resultantKnots);
    const hookDepthM = lineLengthM * Math.cos(degToRad(angle));
    const depth = getDepthAt(hourStartLat, hourStartLon, terrain);
    const bottomReached = hookDepthM >= depth - 5;

    const worldPos = lonLatToWorldXZ(hourStartLon, hourStartLat, terrain);
    const isSlack = !!cond.isSlack || cond.tidalSpeedKnots < 0.1;

    let activeLegIndex: number | undefined;
    let legRemainingKm: number | undefined;
    let targetWaypointIndex: number | undefined;
    if (useWaypoints) {
      activeLegIndex = legIndex % circuit.length;
      const tgt = circuit[activeLegIndex]!;
      legRemainingKm = distanceKm(curLat, curLon, tgt.lat, tgt.lon);
      targetWaypointIndex = tgt.userIndex;
    }

    waypoints.push({
      hour: h,
      lat: hourStartLat,
      lon: hourStartLon,
      worldX: worldPos.x,
      worldZ: worldPos.z,
      lineAngleDeg: angle,
      hookDepthM,
      bottomReached,
      driftSpeedKnots: Math.round(resultantKnots * 10) / 10,
      headingDeg,
      isSlack,
      phase: cond.phase,
      activeLegIndex,
      legRemainingKm,
      targetWaypointIndex,
    });
  }

  return waypoints;
}
