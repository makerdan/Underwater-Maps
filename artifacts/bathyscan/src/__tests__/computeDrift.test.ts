/**
 * computeDrift.test.ts — Focused unit tests for the drift physics model.
 *
 * Exercises the pure math of `computeDrift()`:
 *   - Pure wind+tide drift with known vectors
 *   - Trolling at 0 kt matches pure drift
 *   - Trolling adds boat vector at the configured heading
 *   - Slack tide with no wind produces a vertical line (angle = 0)
 *   - Bottom-reach flag flips at the expected depths
 */

import { describe, it, expect } from "vitest";
import { computeDrift } from "@/lib/computeDrift";
import type { HourlySurfaceCondition } from "@/lib/driftStore";
import type { TerrainData } from "@workspace/api-client-react";

const KM_PER_KNOT_HOUR = 1.852;
const KM_PER_DEG_LAT = 111.0;

/** Flat all-water terrain at uniform depth. */
function makeFlatGrid(depth: number, N = 4): TerrainData {
  const depths = new Array(N * N).fill(depth);
  return {
    datasetId: "test-flat",
    resolution: N,
    minLat: 0,
    maxLat: 1,
    minLon: 0,
    maxLon: 1,
    minDepth: depth,
    maxDepth: depth,
    depths,
    waterType: "saltwater",
  } as unknown as TerrainData;
}

/** Build 24 hours of identical synthetic surface conditions. */
function makeConditions(
  partial: Partial<HourlySurfaceCondition>,
): HourlySurfaceCondition[] {
  const base: HourlySurfaceCondition = {
    hour: 0,
    windSpeedKnots: 0,
    windDegrees: 0,
    tidalSpeedKnots: 0,
    tidalDegrees: 0,
    waveHeightM: 0,
    isSlack: false,
  };
  return Array.from({ length: 24 }, (_, h) => ({
    ...base,
    ...partial,
    hour: h,
  }));
}

describe("computeDrift — pure drift physics", () => {
  it("returns 24 hourly waypoints starting at the origin", () => {
    const path = computeDrift({
      conditions: makeConditions({ tidalSpeedKnots: 1, tidalDegrees: 0 }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
    });
    expect(path).toHaveLength(24);
    expect(path[0]!.lat).toBeCloseTo(0.5, 10);
    expect(path[0]!.lon).toBeCloseTo(0.5, 10);
    expect(path[0]!.hour).toBe(0);
  });

  it("applies 70% tidal + 30% wind-leeway (3.5% of wind, open-skiff default) blend on known vectors", () => {
    // Tide pushing due north at 2 kt; wind pushing due north at 10 kt.
    // Open-skiff profile: leewayFactor=0.035, windageFactor=1.0
    // Wind leeway = 10 * 0.035 * 1.0 = 0.35 kt also due north.
    // Resultant = 0.7 * 2 + 0.3 * 0.35 = 1.505 kt = 1.505 * 1.852 km/h
    // dLat (deg) per hour = 1.505 * 1.852 / 111
    const path = computeDrift({
      conditions: makeConditions({
        tidalSpeedKnots: 2,
        tidalDegrees: 0, // 0° = north
        windSpeedKnots: 10,
        windDegrees: 0,
      }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
    });
    // leewayFactor * windageFactor for open-skiff = 0.035 * 1.0 = 0.035
    const LEEWAY = 0.035 * 1.0;
    const expectedDLatPerHour =
      (0.7 * 2 + 0.3 * (10 * LEEWAY)) * KM_PER_KNOT_HOUR / KM_PER_DEG_LAT;
    // Hour-1 waypoint shows position at the start of hour 1 == after 1 hour of drift.
    expect(path[1]!.lat - 0.5).toBeCloseTo(expectedDLatPerHour, 10);
    expect(path[1]!.lon).toBeCloseTo(0.5, 10);
    // Heading should be ~0° (north).
    expect(path[0]!.headingDeg).toBeCloseTo(0, 6);
    // Drift speed (rounded to 1 dp in output) should be 1.5 kt (1.505 → rounds to 1.5).
    expect(path[0]!.driftSpeedKnots).toBeCloseTo(1.5, 0);
  });

  it("trolling at 0 kt is identical to pure drift", () => {
    const conditions = makeConditions({
      tidalSpeedKnots: 1,
      tidalDegrees: 90,
      windSpeedKnots: 5,
      windDegrees: 180,
    });
    const drift = computeDrift({
      conditions,
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "drift",
    });
    const trolling = computeDrift({
      conditions,
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 0,
      boatHeadingDeg: 45,
    });
    for (let i = 0; i < 24; i++) {
      expect(trolling[i]!.lat).toBeCloseTo(drift[i]!.lat, 12);
      expect(trolling[i]!.lon).toBeCloseTo(drift[i]!.lon, 12);
      expect(trolling[i]!.driftSpeedKnots).toBeCloseTo(
        drift[i]!.driftSpeedKnots,
        6,
      );
    }
  });

  it("trolling adds the boat vector at the configured heading", () => {
    // No tide, no wind — only the boat moves. Heading 90° = due east.
    // 3 kt east => dLon per hour = 3 * 1.852 / (111 * cos(lat))
    const startLat = 0.5;
    const path = computeDrift({
      conditions: makeConditions({}),
      startLat,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 3,
      boatHeadingDeg: 90,
    });
    const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((startLat * Math.PI) / 180);
    const expectedDLonPerHour = (3 * KM_PER_KNOT_HOUR) / kmPerDegLon;
    expect(path[1]!.lat).toBeCloseTo(startLat, 10);
    expect(path[1]!.lon - 0.5).toBeCloseTo(expectedDLonPerHour, 10);
    expect(path[0]!.headingDeg).toBeCloseTo(90, 2);
    expect(path[0]!.driftSpeedKnots).toBeCloseTo(3.0, 6);
  });

  it("slack tide with no wind produces a vertical line (angle = 0, hook at full depth)", () => {
    const path = computeDrift({
      conditions: makeConditions({
        tidalSpeedKnots: 0,
        windSpeedKnots: 0,
        isSlack: true,
      }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 60,
      lineWeightG: 500,
      terrain: makeFlatGrid(200),
    });
    for (const wp of path) {
      expect(wp.lat).toBeCloseTo(0.5, 12);
      expect(wp.lon).toBeCloseTo(0.5, 12);
      expect(wp.driftSpeedKnots).toBe(0);
      expect(wp.lineAngleDeg).toBeCloseTo(0, 10);
      expect(wp.hookDepthM).toBeCloseTo(60, 10);
      expect(wp.isSlack).toBe(true);
    }
  });

  it("flags `isSlack` when tidal speed is below the 0.1 kt threshold", () => {
    const path = computeDrift({
      conditions: makeConditions({ tidalSpeedKnots: 0.05 }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
    });
    expect(path[0]!.isSlack).toBe(true);
  });
});

describe("computeDrift — bottom-reach flag", () => {
  it("reports bottomReached=true in shallow water where the hook hangs near the floor", () => {
    // Slack water: hook depth == line length == 30 m, terrain at 25 m.
    // bottomReached := hookDepthM >= depth - 5 => 30 >= 20 => true.
    const path = computeDrift({
      conditions: makeConditions({ isSlack: true }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 30,
      lineWeightG: 500,
      terrain: makeFlatGrid(25),
    });
    expect(path[0]!.hookDepthM).toBeCloseTo(30, 6);
    expect(path[0]!.bottomReached).toBe(true);
  });

  it("reports bottomReached=false when the hook is well above the floor", () => {
    // Slack water: hook at 30 m, terrain at 100 m => 30 >= 95 is false.
    const path = computeDrift({
      conditions: makeConditions({ isSlack: true }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 30,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
    });
    expect(path[0]!.bottomReached).toBe(false);
  });

  it("flips bottomReached as terrain depth crosses the hook-depth + 5 m threshold", () => {
    // Slack water => hook depth = 40 m exactly.
    // Threshold for bottomReached: depth <= hook + 5 = 45 m.
    const justReached = computeDrift({
      conditions: makeConditions({ isSlack: true }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 40,
      lineWeightG: 500,
      terrain: makeFlatGrid(45),
    });
    const justTooDeep = computeDrift({
      conditions: makeConditions({ isSlack: true }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 40,
      lineWeightG: 500,
      terrain: makeFlatGrid(45.001),
    });
    expect(justReached[0]!.bottomReached).toBe(true);
    expect(justTooDeep[0]!.bottomReached).toBe(false);
  });
});

describe("computeDrift — force-arrow bearings (boatHeadingDegSep, driftHeadingDeg)", () => {
  it("drift heading aligns with a pure-tide easterly flow (tide 90° → drift heading ≈ 90°)", () => {
    const path = computeDrift({
      conditions: makeConditions({
        tidalSpeedKnots: 1.5,
        tidalDegrees: 90, // due east (oceanographic "going to" convention)
        windSpeedKnots: 0,
        windDegrees: 0,
      }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
    });
    expect(path[0]!.driftHeadingDeg).toBeDefined();
    expect(path[0]!.driftHeadingDeg!).toBeCloseTo(90, 2);
    // Pure drift (no boat propulsion) — boat-arrow bearing is not emitted.
    expect(path[0]!.boatHeadingDegSep).toBeUndefined();
  });

  it("drift heading follows the tidal bearing for a southerly flow (tide 180° → drift heading ≈ 180°)", () => {
    const path = computeDrift({
      conditions: makeConditions({
        tidalSpeedKnots: 1,
        tidalDegrees: 180, // due south
      }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
    });
    expect(path[0]!.driftHeadingDeg!).toBeCloseTo(180, 2);
  });

  it("blends tide + wind-leeway: orthogonal tide (E) and wind (N) produce a NE-ish drift heading", () => {
    // Tide east at 1 kt (weight 0.7) vs wind north at 10 kt.
    // Open-skiff profile: leewayFactor=0.035, windageFactor=1.0
    // Wind leeway = 10 * 0.035 * 1.0 = 0.35 kt north (weight 0.3).
    // East component = 0.7 * 1 = 0.70; North component = 0.3 * 0.35 = 0.105.
    // Bearing = atan2(east, north) = atan2(0.70, 0.105) ≈ 81.5°.
    const path = computeDrift({
      conditions: makeConditions({
        tidalSpeedKnots: 1,
        tidalDegrees: 90,
        windSpeedKnots: 10,
        windDegrees: 0,
      }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
    });
    // leewayFactor * windageFactor for open-skiff = 0.035 * 1.0
    const windLeeway = 10 * 0.035 * 1.0;
    const northComponent = 0.3 * windLeeway; // 0.105
    const eastComponent = 0.7 * 1;           // 0.70
    const expected = (Math.atan2(eastComponent, northComponent) * 180) / Math.PI;
    expect(path[0]!.driftHeadingDeg!).toBeCloseTo(expected, 1);
  });

  it("boat heading equals the configured boatHeadingDeg in simple trolling mode (no waypoints)", () => {
    const path = computeDrift({
      conditions: makeConditions({
        tidalSpeedKnots: 1,
        tidalDegrees: 0,
        windSpeedKnots: 5,
        windDegrees: 90,
      }),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 2.5,
      boatHeadingDeg: 135,
    });
    for (const wp of path) {
      expect(wp.boatHeadingDegSep).toBeCloseTo(135, 6);
    }
  });

  it("normalizes negative configured boat headings into [0, 360)", () => {
    const path = computeDrift({
      conditions: makeConditions({}),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 2,
      boatHeadingDeg: -45, // == 315°
    });
    expect(path[0]!.boatHeadingDegSep).toBeCloseTo(315, 6);
  });

  it("with waypoints, hour-0 boat heading points toward the first leg target", () => {
    // Waypoint due east of start ⇒ bearing 90°.
    const eastPath = computeDrift({
      conditions: makeConditions({}),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 3,
      boatHeadingDeg: 0, // should be ignored when waypoints drive steering
      trollWaypoints: [{ lat: 0.5, lon: 0.6 }],
    });
    expect(eastPath[0]!.boatHeadingDegSep).toBeDefined();
    expect(eastPath[0]!.boatHeadingDegSep!).toBeCloseTo(90, 1);

    // Waypoint due north of start ⇒ bearing 0°.
    const northPath = computeDrift({
      conditions: makeConditions({}),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 3,
      boatHeadingDeg: 180, // ignored under waypoint steering
      trollWaypoints: [{ lat: 0.6, lon: 0.5 }],
    });
    expect(northPath[0]!.boatHeadingDegSep!).toBeCloseTo(0, 1);
  });

  it("boat heading flips toward the return-to-start leg after the first waypoint is reached", () => {
    // Waypoint east of start. Boat = 3 kt covers ~5.55 km in 1 h; the waypoint
    // is ~11.1 km away, so hour 0 still chases wp0 (bearing ≈ 90° east), and
    // by hour 2 the boat has rounded wp0 and is heading back west (bearing ≈ 270°).
    const path = computeDrift({
      conditions: makeConditions({}),
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 3,
      trollWaypoints: [{ lat: 0.5, lon: 0.6 }],
    });
    // Hour 0: still chasing wp0 (east).
    expect(path[0]!.targetWaypointIndex).toBe(0);
    expect(path[0]!.boatHeadingDegSep!).toBeCloseTo(90, 1);
    // Hour 2: well into the return-to-start leg (west).
    expect(path[2]!.targetWaypointIndex).toBe(-1);
    expect(path[2]!.boatHeadingDegSep!).toBeCloseTo(270, 1);
  });
});

describe("computeDrift — waypoint-following trolling circuit", () => {
  // Flat-water defaults: no tide, no wind. Boat motion is the only displacement
  // so the math is exact and easy to reason about.
  const calmConditions = makeConditions({});

  it("single downstream waypoint: targetWaypointIndex cycles 0 -> -1 as legs complete", () => {
    // Waypoint ~11.1 km east of start at lat=0.5 (0.1° lon * 111km/° * cos(0.5°)).
    // Boat = 3 kt = 5.556 km/h, so each leg out/back takes 2 hours.
    // Expected end-of-hour targetWaypointIndex sequence:
    //   h0: still heading to wp0  -> target = 0  (halfway, remaining ~5.55 km)
    //   h1: reaches wp0, flips    -> target = -1 (return-to-start, remaining ~11.1 km)
    //   h2: halfway back          -> target = -1
    //   h3: reaches start, flips  -> target = 0
    //   h4: halfway to wp0        -> target = 0
    //   ...
    const path = computeDrift({
      conditions: calmConditions,
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 3,
      trollWaypoints: [{ lat: 0.5, lon: 0.6 }],
    });

    expect(path).toHaveLength(24);
    // Hour 0 end: still chasing wp0.
    expect(path[0]!.targetWaypointIndex).toBe(0);
    expect(path[0]!.activeLegIndex).toBe(0);
    // Hour 1 end: just completed the outbound leg, now on the return leg.
    expect(path[1]!.targetWaypointIndex).toBe(-1);
    expect(path[1]!.activeLegIndex).toBe(1);
    // Hour 3 end: just completed the return leg, back chasing wp0.
    expect(path[3]!.targetWaypointIndex).toBe(0);
    expect(path[3]!.activeLegIndex).toBe(0);

    // Across the full 24 hours both userIndex values (0 and -1) appear.
    const targets = new Set(path.map((p) => p.targetWaypointIndex));
    expect(targets.has(0)).toBe(true);
    expect(targets.has(-1)).toBe(true);

    // Sanity: every hour reports both bookkeeping fields when on a circuit.
    for (const wp of path) {
      expect(wp.activeLegIndex).toBeDefined();
      expect(wp.legRemainingKm).toBeDefined();
      expect(wp.targetWaypointIndex).toBeDefined();
      expect(wp.legRemainingKm!).toBeGreaterThanOrEqual(0);
    }
  });

  it("two-waypoint circuit produces a back-and-forth pattern over 24 hours", () => {
    // Triangle circuit: start -> wp0 -> wp1 -> start, each leg ~5.55 km (and
    // the wp1->start diagonal a bit longer). Boat 3 kt => leg 0/1 take ~1 h
    // each, so many laps fit in 24 h and all three userIndex values appear.
    const path = computeDrift({
      conditions: calmConditions,
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 3,
      trollWaypoints: [
        { lat: 0.5, lon: 0.55 },
        { lat: 0.55, lon: 0.55 },
      ],
    });

    const targets = path.map((p) => p.targetWaypointIndex!);
    // All three userIndex values are visited across the day.
    expect(new Set(targets)).toEqual(new Set([0, 1, -1]));

    // The leg-target sequence must respect circuit order: each non-repeating
    // transition is one of 0->1, 1->-1, -1->0 (never e.g. 0->-1 directly).
    const allowed = new Set(["0->1", "1->-1", "-1->0"]);
    for (let i = 1; i < targets.length; i++) {
      if (targets[i] === targets[i - 1]) continue;
      expect(allowed.has(`${targets[i - 1]}->${targets[i]}`)).toBe(true);
    }
  });

  it("legRemainingKm decreases monotonically within a leg and resets when the leg flips", () => {
    // Long single-waypoint leg (~22.2 km east) at 3 kt => takes 4 hours.
    // Hours 0..2 share leg 0 (target=0) with strictly decreasing remaining;
    // hour 3 completes that leg and resets remaining to ~22.2 km on the
    // return-to-start leg (target=-1).
    const path = computeDrift({
      conditions: calmConditions,
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 3,
      trollWaypoints: [{ lat: 0.5, lon: 0.7 }],
    });

    // Group consecutive hours sharing the same (activeLegIndex, targetWaypointIndex)
    // and assert the remaining distance is strictly decreasing inside the run,
    // then jumps back up at the leg boundary.
    let runStart = 0;
    let sawMonotonicRun = false;
    let sawLegReset = false;
    for (let i = 1; i <= path.length; i++) {
      const prev = path[i - 1]!;
      const cur = i < path.length ? path[i]! : null;
      const sameLeg =
        cur !== null &&
        cur.activeLegIndex === prev.activeLegIndex &&
        cur.targetWaypointIndex === prev.targetWaypointIndex;
      if (sameLeg) continue;
      // Close out the run [runStart, i-1].
      if (i - runStart >= 2) {
        sawMonotonicRun = true;
        for (let j = runStart + 1; j <= i - 1; j++) {
          expect(path[j]!.legRemainingKm!).toBeLessThan(path[j - 1]!.legRemainingKm!);
        }
      }
      if (cur !== null) {
        // Leg flipped: the new leg's remaining distance should jump up
        // relative to the just-ended leg's last remaining.
        expect(cur.legRemainingKm!).toBeGreaterThan(prev.legRemainingKm!);
        sawLegReset = true;
      }
      runStart = i;
    }
    expect(sawMonotonicRun).toBe(true);
    expect(sawLegReset).toBe(true);
  });

  it("degenerate circuit (all waypoints stacked on the start) skips the waypoint branch", () => {
    // Two waypoints sitting exactly on the start point produce a circuit with
    // zero total perimeter. The per-hour sub-step loop used to silently burn
    // its 50-iteration safety guard every hour, producing a frozen path with
    // misleading bookkeeping (activeLegIndex/legRemainingKm populated as if a
    // real circuit were being followed). Up-front detection should drop the
    // waypoint branch so behaviour matches pure drift-with-boat-vector and
    // the circuit-only bookkeeping fields stay undefined.
    const conditions = makeConditions({
      tidalSpeedKnots: 0.5,
      tidalDegrees: 90,
      windSpeedKnots: 4,
      windDegrees: 180,
    });
    const stacked = computeDrift({
      conditions,
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 3,
      boatHeadingDeg: 45,
      trollWaypoints: [
        { lat: 0.5, lon: 0.5 },
        { lat: 0.5, lon: 0.5 },
      ],
    });
    const noWaypoints = computeDrift({
      conditions,
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 3,
      boatHeadingDeg: 45,
    });

    expect(stacked).toHaveLength(24);
    for (let i = 0; i < 24; i++) {
      // Positions must match the no-waypoints trolling path exactly: the
      // boat moves at its configured heading instead of being pinned at the
      // start by a frozen waypoint loop.
      expect(stacked[i]!.lat).toBeCloseTo(noWaypoints[i]!.lat, 12);
      expect(stacked[i]!.lon).toBeCloseTo(noWaypoints[i]!.lon, 12);
      // No circuit was actually followed, so leg bookkeeping must be absent.
      expect(stacked[i]!.activeLegIndex).toBeUndefined();
      expect(stacked[i]!.legRemainingKm).toBeUndefined();
      expect(stacked[i]!.targetWaypointIndex).toBeUndefined();
    }
    // The boat actually moves (it's not pinned at the start by guard
    // exhaustion) — pick any later hour and confirm displacement.
    const movedLat = Math.abs(stacked[5]!.lat - 0.5);
    const movedLon = Math.abs(stacked[5]!.lon - 0.5);
    expect(movedLat + movedLon).toBeGreaterThan(0);
  });

  it("trollWaypoints with boatSpeedKnots=0 falls back to pure drift (waypoints ignored)", () => {
    // With a real drift vector but zero boat propulsion, the waypoint branch
    // must NOT activate: positions should match the no-waypoints trolling
    // path, and the circuit-only fields should be undefined.
    const conditions = makeConditions({
      tidalSpeedKnots: 1,
      tidalDegrees: 45,
      windSpeedKnots: 6,
      windDegrees: 180,
    });
    const withWaypoints = computeDrift({
      conditions,
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 0,
      boatHeadingDeg: 270,
      trollWaypoints: [
        { lat: 0.6, lon: 0.6 },
        { lat: 0.4, lon: 0.4 },
      ],
    });
    const pureDrift = computeDrift({
      conditions,
      startLat: 0.5,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "drift",
    });

    expect(withWaypoints).toHaveLength(24);
    for (let i = 0; i < 24; i++) {
      expect(withWaypoints[i]!.lat).toBeCloseTo(pureDrift[i]!.lat, 12);
      expect(withWaypoints[i]!.lon).toBeCloseTo(pureDrift[i]!.lon, 12);
      // Circuit bookkeeping must be absent when the waypoint branch is off.
      expect(withWaypoints[i]!.activeLegIndex).toBeUndefined();
      expect(withWaypoints[i]!.legRemainingKm).toBeUndefined();
      expect(withWaypoints[i]!.targetWaypointIndex).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Backtroll physics
// ---------------------------------------------------------------------------

describe("computeDrift — backtroll physics", () => {
  it("backtroll negates thrust: net displacement opposes heading when current is zero", () => {
    // No tide, no wind — only the boat in backtroll. Heading 90° (east).
    // The stern-first thrust pushes the boat WEST (180° from heading).
    // effectiveReverseSpeed = 2 / 1.4 ≈ 1.429 kt west.
    // dLon/h = -1.429 * 1.852 / (111 * cos(0.5°))
    const startLat = 0.5;
    const path = computeDrift({
      conditions: makeConditions({}),
      startLat,
      startLon: 0.5,
      lineLengthM: 50,
      lineWeightG: 500,
      terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 2,
      boatHeadingDeg: 90, // facing east → backtroll pushes west
      backtroll: true,
    });
    // After hour 1 the boat should have moved WEST (negative dLon), not east.
    expect(path[1]!.lon).toBeLessThan(0.5);
    // Lat should not change (pure east/west motion).
    expect(path[1]!.lat).toBeCloseTo(startLat, 6);
  });

  it("backtroll with zero boat speed is identical to forward trolling at zero speed", () => {
    // Zero reverse thrust = no propulsion = same as pure drift either way.
    const conditions = makeConditions({ tidalSpeedKnots: 1.5, tidalDegrees: 270 });
    const forward = computeDrift({
      conditions, startLat: 0.5, startLon: 0.5,
      lineLengthM: 50, lineWeightG: 500, terrain: makeFlatGrid(100),
      mode: "trolling", boatSpeedKnots: 0, boatHeadingDeg: 45,
    });
    const back = computeDrift({
      conditions, startLat: 0.5, startLon: 0.5,
      lineLengthM: 50, lineWeightG: 500, terrain: makeFlatGrid(100),
      mode: "trolling", boatSpeedKnots: 0, boatHeadingDeg: 45, backtroll: true,
    });
    for (let i = 0; i < 24; i++) {
      expect(back[i]!.lat).toBeCloseTo(forward[i]!.lat, 12);
      expect(back[i]!.lon).toBeCloseTo(forward[i]!.lon, 12);
    }
  });

  it("stallSpeedKnots = currentMagnitude / BACKTROLL_DRAG_COEFFICIENT on every step", () => {
    // Tide 2 kt north, no wind. Blended drift contribution ≈ 0.7 * 2 = 1.4 kt north.
    // Drag = 1.4, so stallSpeedKnots ≈ 1.4 / 1.4 = 1.0 kt.
    const tidalSpeed = 2;
    const path = computeDrift({
      conditions: makeConditions({ tidalSpeedKnots: tidalSpeed, tidalDegrees: 0 }),
      startLat: 0.5, startLon: 0.5,
      lineLengthM: 50, lineWeightG: 500, terrain: makeFlatGrid(100),
      mode: "trolling", boatSpeedKnots: 1.5, boatHeadingDeg: 0, backtroll: true,
    });
    for (const wp of path) {
      expect(wp.stallSpeedKnots).toBeDefined();
      // driftContributionKnots is the blended current magnitude; stallSpeed = that / 1.4.
      const expected = (wp.driftContributionKnots ?? 0) / 1.4;
      expect(wp.stallSpeedKnots!).toBeCloseTo(expected, 8);
    }
  });

  it("isStalled when effectiveReverseSpeed ≈ current: resultant SOG < 0.05 kt", () => {
    // Pure tidal 2 kt north, no wind. Blended drift ≈ 0.7 * 2 = 1.4 kt.
    // effectiveReverseSpeed = boat / drag = 1.4 * 1.4 / 1.4 = 1.4 kt — exactly cancels.
    // Setting boatSpeed = currentContribution * drag = 1.4 * 1.4 = 1.96 kt gives
    // effectiveReverse = 1.96 / 1.4 = 1.4 kt → SOG ≈ 0 → isStalled = true.
    const path = computeDrift({
      conditions: makeConditions({ tidalSpeedKnots: 2, tidalDegrees: 0 }),
      startLat: 0.5, startLon: 0.5,
      lineLengthM: 50, lineWeightG: 500, terrain: makeFlatGrid(100),
      mode: "trolling",
      boatSpeedKnots: 1.96,   // ≈ blendedDrift * BACKTROLL_DRAG_COEFFICIENT
      boatHeadingDeg: 0,      // facing north → reverse pushes south
      backtroll: true,
    });
    // At stall the boat is nearly motionless; all hours should be stalled.
    for (const wp of path) {
      expect(wp.isStalled).toBe(true);
    }
  });

  it("isStalled is false and undefined when backtroll is off", () => {
    // Forward trolling should never set isStalled.
    const path = computeDrift({
      conditions: makeConditions({ tidalSpeedKnots: 2, tidalDegrees: 0 }),
      startLat: 0.5, startLon: 0.5,
      lineLengthM: 50, lineWeightG: 500, terrain: makeFlatGrid(100),
      mode: "trolling", boatSpeedKnots: 2, boatHeadingDeg: 90,
    });
    for (const wp of path) {
      expect(wp.isStalled).toBeUndefined();
      expect(wp.stallSpeedKnots).toBeUndefined();
    }
  });

  it("backtroll is ignored in drift mode (engine off)", () => {
    // Passing backtroll: true in drift mode must produce identical output to
    // backtroll: false because the boat propulsion is not active in drift mode.
    const conditions = makeConditions({ tidalSpeedKnots: 1, tidalDegrees: 45 });
    const driftNormal = computeDrift({
      conditions, startLat: 0.5, startLon: 0.5,
      lineLengthM: 50, lineWeightG: 500, terrain: makeFlatGrid(100),
      mode: "drift",
    });
    const driftBacktroll = computeDrift({
      conditions, startLat: 0.5, startLon: 0.5,
      lineLengthM: 50, lineWeightG: 500, terrain: makeFlatGrid(100),
      mode: "drift", backtroll: true,
    });
    for (let i = 0; i < 24; i++) {
      expect(driftBacktroll[i]!.lat).toBeCloseTo(driftNormal[i]!.lat, 12);
      expect(driftBacktroll[i]!.lon).toBeCloseTo(driftNormal[i]!.lon, 12);
      // Drift mode never sets stall fields.
      expect(driftBacktroll[i]!.isStalled).toBeUndefined();
      expect(driftBacktroll[i]!.stallSpeedKnots).toBeUndefined();
    }
  });

  it("backtroll fishing line angle uses current magnitude, not resultant SOG", () => {
    // At stall (SOG ≈ 0) the line should still show an angle driven by the
    // current flowing past the hull, not by the near-zero net displacement.
    // Pure tide 3 kt north, boatSpeed set to stall exactly.
    // lineAngle(currentMag) >> lineAngle(0) so the angle must be > 0.
    const tidalSpeed = 3;
    // Stall: boatSpeed = blendedDriftKt * drag ≈ (0.7 * 3) * 1.4 = 2.94 kt
    const stallBoatSpeed = 0.7 * tidalSpeed * 1.4;
    const path = computeDrift({
      conditions: makeConditions({ tidalSpeedKnots: tidalSpeed, tidalDegrees: 0 }),
      startLat: 0.5, startLon: 0.5,
      lineLengthM: 100, lineWeightG: 500, terrain: makeFlatGrid(200),
      mode: "trolling",
      boatSpeedKnots: stallBoatSpeed,
      boatHeadingDeg: 0,
      backtroll: true,
    });
    // At stall, SOG ≈ 0. Without backtroll-line-flip, lineAngleDeg would be 0.
    // With the flip, it should reflect the current magnitude (positive angle).
    for (const wp of path) {
      expect(wp.lineAngleDeg).toBeGreaterThan(5);
    }
  });
});
