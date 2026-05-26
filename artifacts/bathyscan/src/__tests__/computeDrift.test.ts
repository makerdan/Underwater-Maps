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

  it("applies 70% tidal + 30% wind-leeway (3% of wind) blend on known vectors", () => {
    // Tide pushing due north at 2 kt; wind pushing due north at 10 kt.
    // Wind leeway = 10 * 0.03 = 0.3 kt also due north.
    // Resultant dLat/hour = 0.7 * 2 + 0.3 * 0.3 = 1.49 kt = 1.49 * 1.852 km/h
    // dLat (deg) per hour = 1.49 * 1.852 / 111
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
    const expectedDLatPerHour =
      (0.7 * 2 + 0.3 * 0.3) * KM_PER_KNOT_HOUR / KM_PER_DEG_LAT;
    // Hour-1 waypoint shows position at the start of hour 1 == after 1 hour of drift.
    expect(path[1]!.lat - 0.5).toBeCloseTo(expectedDLatPerHour, 10);
    expect(path[1]!.lon).toBeCloseTo(0.5, 10);
    // Heading should be ~0° (north).
    expect(path[0]!.headingDeg).toBeCloseTo(0, 6);
    // Drift speed (rounded to 1 dp in output) should be 1.5 kt.
    expect(path[0]!.driftSpeedKnots).toBeCloseTo(1.5, 6);
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
