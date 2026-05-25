/**
 * computeDrift.test.ts — Unit tests for the Drift Planner physics model.
 *
 * Uses a synthetic 4×4 terrain grid centred on a known lat/lon so results
 * can be checked analytically.
 */

import { describe, it, expect } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import { computeDrift } from "@/lib/computeDrift";
import type { HourlySurfaceCondition } from "@/lib/driftStore";

function makeGrid(depth = 50): TerrainData {
  const N = 4;
  const depths = new Float32Array(N * N).fill(depth);
  return {
    resolution: N,
    minLat: 55.0,
    maxLat: 55.1,
    minLon: -131.0,
    maxLon: -130.9,
    minDepth: depth,
    maxDepth: depth,
    depths,
    datasetId: "test",
  };
}

function makeCondition(
  windSpeedKnots = 0,
  windDegrees = 0,
  tidalSpeedKnots = 1,
  tidalDegrees = 0,
  waveHeightM = 0.2,
  hour = 0,
  isSlack?: boolean,
): HourlySurfaceCondition {
  return { hour, windSpeedKnots, windDegrees, tidalSpeedKnots, tidalDegrees, waveHeightM, isSlack };
}

const terrain = makeGrid(50);

describe("computeDrift", () => {
  it("returns 24 waypoints for 24-hour conditions", () => {
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 1, 0, 0.2, h));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
    });
    expect(path).toHaveLength(24);
  });

  it("first waypoint equals start position", () => {
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 1, 0, 0.2, h));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
    });
    expect(path[0]!.lat).toBeCloseTo(55.05, 5);
    expect(path[0]!.lon).toBeCloseTo(-130.95, 5);
  });

  it("northward tidal current moves boat northward", () => {
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 1.5, 0, 0.2, h));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
    });
    // After 1 hour at 1.5 kt north, lat should increase
    expect(path[1]!.lat).toBeGreaterThan(path[0]!.lat);
    expect(path[1]!.lon).toBeCloseTo(path[0]!.lon, 3);
  });

  it("eastward current (90°) moves boat eastward", () => {
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 1.0, 90, 0.2, h));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
    });
    expect(path[1]!.lon).toBeGreaterThan(path[0]!.lon);
    expect(path[1]!.lat).toBeCloseTo(path[0]!.lat, 3);
  });

  it("zero current keeps boat stationary", () => {
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 0, 0, 0.2, h));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
    });
    for (const wp of path) {
      expect(wp.lat).toBeCloseTo(55.05, 4);
      expect(wp.lon).toBeCloseTo(-130.95, 4);
    }
  });

  it("lineAngleDeg is 0 at zero drift speed", () => {
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 0, 0, 0.2, h));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
    });
    expect(path[0]!.lineAngleDeg).toBeCloseTo(0, 1);
  });

  it("lineAngleDeg increases with current speed", () => {
    const cond_slow = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 0.5, 0, 0.2, h));
    const cond_fast = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 2.0, 0, 0.2, h));
    const opts = { startLat: 55.05, startLon: -130.95, lineLengthM: 200, lineWeightG: 500, terrain };
    const slow = computeDrift({ conditions: cond_slow, ...opts });
    const fast = computeDrift({ conditions: cond_fast, ...opts });
    expect(fast[0]!.lineAngleDeg).toBeGreaterThan(slow[0]!.lineAngleDeg);
  });

  it("hookDepthM = lineLengthM * cos(lineAngleDeg) at each waypoint", () => {
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(5, 180, 1.2, 90, 0.3, h));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 150,
      lineWeightG: 500,
      terrain,
    });
    for (const wp of path) {
      const expected = 150 * Math.cos((wp.lineAngleDeg * Math.PI) / 180);
      expect(wp.hookDepthM).toBeCloseTo(expected, 3);
    }
  });

  it("bottomReached when hookDepthM is within 5m of terrain depth", () => {
    // Shallow grid: 30m depth
    const shallowTerrain = makeGrid(30);
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 0, 0, 0.2, h));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain: shallowTerrain,
    });
    // hookDepthM = 200m (no angle), terrain = 30m → bottomReached = 200 >= 25 → true
    expect(path[0]!.bottomReached).toBe(true);
  });

  it("bottomReached is false when hookDepth is way above bottom", () => {
    // Very deep grid: 500m depth
    const deepTerrain = makeGrid(500);
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 0, 0, 0.2, h));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: deepTerrain,
    });
    // hookDepthM = 50, terrain = 500 → not in reach (50 < 495)
    expect(path[0]!.bottomReached).toBe(false);
  });

  it("a slack hour (tidal=0) produces ~0 tidal displacement; wind leeway still applies", () => {
    const cond: HourlySurfaceCondition[] = [];
    // Hour 0: wind only, tidal 0 with isSlack flag
    cond.push(makeCondition(8, 0, 0, 0, 0.2, 0, true));
    for (let h = 1; h < 24; h++) cond.push(makeCondition(8, 0, 0, 0, 0.2, h, true));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
    });
    expect(path[0]!.isSlack).toBe(true);
    // Drift after the slack hour: wind leeway only (8 kt × 3% × 30% weight)
    const dLat = path[1]!.lat - path[0]!.lat;
    // 8 kt wind north → 0.24 kt leeway × 0.3 weight ≈ 0.072 kt ≈ 0.13 km ≈ 0.0012°
    expect(dLat).toBeGreaterThan(0);
    expect(dLat).toBeLessThan(0.005);
  });

  it("a slack hour with no wind produces zero displacement", () => {
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 0, 0, 0.2, h, true));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
    });
    expect(path[0]!.isSlack).toBe(true);
    expect(path[1]!.lat).toBeCloseTo(path[0]!.lat, 6);
    expect(path[1]!.lon).toBeCloseTo(path[0]!.lon, 6);
  });

  it("trolling with waypoints follows the leg toward the first waypoint", () => {
    // Calm water, no wind/tide — boat motion is purely from troll vector.
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 0, 0, 0.2, h));
    const startLat = 55.05;
    const startLon = -130.95;
    // Waypoint due north of start, ~20 km away (well beyond 1 h of travel at 3 kt).
    const wpLat = startLat + 20 / 111;
    const wpLon = startLon;
    const path = computeDrift({
      conditions: cond,
      startLat,
      startLon,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
      mode: "trolling",
      boatSpeedKnots: 3,
      trollWaypoints: [{ lat: wpLat, lon: wpLon }],
    });
    // First leg should be northward
    expect(path[1]!.lat).toBeGreaterThan(path[0]!.lat);
    expect(path[1]!.lon).toBeCloseTo(path[0]!.lon, 3);
    // Heading during hour 0 should be close to 0° (north)
    expect(path[0]!.headingDeg).toBeLessThan(5);
    // Leg metadata is populated
    expect(path[0]!.activeLegIndex).toBeDefined();
    expect(path[0]!.targetWaypointIndex).toBe(0);
    expect(typeof path[0]!.legRemainingKm).toBe("number");
  });

  it("trolling with waypoints turns at the waypoint and loops back to start", () => {
    // Boat fast enough to do multiple legs within 24h on a tight course.
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 0, 0, 0.2, h));
    const startLat = 55.05;
    const startLon = -130.95;
    // Waypoint 1 km north — at 5 kt boat travels ~9.26 km/h, so each leg = ~6.5 min.
    const wpLat = startLat + 1 / 111;
    const path = computeDrift({
      conditions: cond,
      startLat,
      startLon,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
      mode: "trolling",
      boatSpeedKnots: 5,
      trollWaypoints: [{ lat: wpLat, lon: startLon }],
    });
    // Over 24 hours the target index should cycle between 0 (WP1) and -1 (start).
    const targets = new Set(path.map((p) => p.targetWaypointIndex));
    expect(targets.has(0)).toBe(true);
    expect(targets.has(-1)).toBe(true);
    // Boat should never drift far from the line (stays near start lon)
    for (const wp of path) {
      expect(Math.abs(wp.lon - startLon)).toBeLessThan(0.01);
    }
  });

  it("trolling with empty waypoints uses constant heading (back-compat)", () => {
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(0, 0, 0, 0, 0.2, h));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
      mode: "trolling",
      boatHeadingDeg: 90,
      boatSpeedKnots: 3,
      trollWaypoints: [],
    });
    // Constant east heading → lon increases, lat unchanged
    expect(path[1]!.lon).toBeGreaterThan(path[0]!.lon);
    expect(path[1]!.lat).toBeCloseTo(path[0]!.lat, 3);
    expect(path[0]!.activeLegIndex).toBeUndefined();
  });

  it("wind leeway at 3% contributes to resultant current", () => {
    // Only wind, no tidal
    const cond = Array.from({ length: 24 }, (_, h) => makeCondition(10, 0, 0, 0, 0.2, h));
    const path = computeDrift({
      conditions: cond,
      startLat: 55.05,
      startLon: -130.95,
      lineLengthM: 200,
      lineWeightG: 500,
      terrain,
    });
    // Wind 10kt north → leeway 0.3kt north → boat moves north
    expect(path[1]!.lat).toBeGreaterThan(path[0]!.lat);
  });
});
