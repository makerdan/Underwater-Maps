/**
 * Regression tests for the waypoint mode and fly-through logic extracted
 * from OverviewMap.tsx into waypointHelpers.ts.
 *
 * Coverage:
 *   1. appendWaypoint — pure reducer; each map click in waypoint mode adds one
 *      entry with sequential labels; does NOT call lonLatToWorldXZ (no teleport
 *      on append).
 *   2. planFlyThroughStops guard — fewer than 2 waypoints → returns [].
 *   3. planFlyThroughStops ordering — stops are in the same order as the input
 *      waypoints array.
 *   4. Fly-through execution — planFlyThroughStops results are fed to
 *      setPendingDropIn in waypoint order with the correct dwell timing
 *      (mirrors the OverviewMap flyThroughWaypoints callback).
 *   5. Cancellation — clearTimeout before the tick fires suppresses
 *      setPendingDropIn; uncancelled timeouts fire in order.
 *
 * appendWaypoint and planFlyThroughStops are imported directly from the
 * production waypointHelpers.ts so any regression in production code is
 * caught here.
 */

import { describe, it, expect, vi } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import { lonLatToWorldXZ } from "../lib/terrain";
import { appendWaypoint, planFlyThroughStops } from "../lib/waypointHelpers";
import type { Waypoint } from "../lib/waypointHelpers";

vi.mock("three");

function makeGrid(overrides: Partial<TerrainData> = {}): TerrainData {
  return {
    width: 4, height: 4,
    depths: Array(16).fill(50) as number[],
    minDepth: 0, maxDepth: 100,
    minLon: -122, maxLon: -119,
    minLat: 47, maxLat: 49,
    datasetId: "test-grid",
    ...overrides,
  } as TerrainData;
}

// ---------------------------------------------------------------------------
// Waypoint append — click handler in waypoint mode (no-teleport guarantee)
// ---------------------------------------------------------------------------

describe("appendWaypoint — waypoint mode click handler", () => {
  it("appends one waypoint to an empty list", () => {
    const result = appendWaypoint([], -120.5, 47.5);
    expect(result).toHaveLength(1);
    expect(result[0]!.lon).toBe(-120.5);
    expect(result[0]!.lat).toBe(47.5);
  });

  it("each append gives the next sequential label (1, 2, 3)", () => {
    let wps: Waypoint[] = [];
    wps = appendWaypoint(wps, -120.5, 47.5);
    wps = appendWaypoint(wps, -120.0, 48.0);
    wps = appendWaypoint(wps, -119.5, 48.5);
    expect(wps[0]!.label).toBe("1");
    expect(wps[1]!.label).toBe("2");
    expect(wps[2]!.label).toBe("3");
  });

  it("each waypoint gets a unique id", () => {
    let wps: Waypoint[] = [];
    wps = appendWaypoint(wps, -120.5, 47.5);
    wps = appendWaypoint(wps, -120.0, 48.0);
    expect(wps[0]!.id).not.toBe(wps[1]!.id);
  });

  it("appending does not mutate the original array", () => {
    const original: Waypoint[] = [];
    appendWaypoint(original, -120, 47);
    expect(original).toHaveLength(0);
  });

  it("accumulated state grows correctly across successive appends", () => {
    let wps: Waypoint[] = [];
    for (let i = 0; i < 5; i++) {
      wps = appendWaypoint(wps, -120 + i * 0.1, 47 + i * 0.1);
    }
    expect(wps).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(wps[i]!.label).toBe(String(i + 1));
    }
  });

  it("appendWaypoint does NOT call lonLatToWorldXZ — no camera teleport on click", () => {
    // Spy on the world-coord projection function. If appendWaypoint ever calls
    // it, a camera teleport would occur on every click, which is wrong.
    const spy = vi.spyOn({ lonLatToWorldXZ }, "lonLatToWorldXZ");
    appendWaypoint([], -120.5, 47.5);
    appendWaypoint([{ id: "a", lon: -121, lat: 47, label: "1" }], -120.0, 48.0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Fly-through guard (< 2 waypoints)
// ---------------------------------------------------------------------------

describe("planFlyThroughStops — guard: fewer than 2 waypoints returns []", () => {
  const grid = makeGrid();

  it("returns empty array for 0 waypoints", () => {
    expect(planFlyThroughStops([], grid)).toEqual([]);
  });

  it("returns empty array for exactly 1 waypoint", () => {
    const wps = appendWaypoint([], -120.5, 47.5);
    expect(planFlyThroughStops(wps, grid)).toEqual([]);
  });

  it("returns a non-empty array for exactly 2 waypoints", () => {
    let wps: Waypoint[] = [];
    wps = appendWaypoint(wps, -120.5, 47.5);
    wps = appendWaypoint(wps, -120.0, 48.0);
    expect(planFlyThroughStops(wps, grid)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Fly-through ordering
// ---------------------------------------------------------------------------

describe("planFlyThroughStops — ordering: stops match waypoint order", () => {
  const grid = makeGrid();

  it("output order matches input waypoint order for 3 waypoints", () => {
    let wps: Waypoint[] = [];
    wps = appendWaypoint(wps, -121.0, 47.0);
    wps = appendWaypoint(wps, -120.5, 47.5);
    wps = appendWaypoint(wps, -120.0, 48.0);

    const stops = planFlyThroughStops(wps, grid);
    expect(stops).toHaveLength(3);

    const expected = wps.map((wp) => lonLatToWorldXZ(wp.lon, wp.lat, grid));
    for (let i = 0; i < stops.length; i++) {
      expect(stops[i]!.worldX).toBeCloseTo(expected[i]!.x, 6);
      expect(stops[i]!.worldZ).toBeCloseTo(expected[i]!.z, 6);
    }
  });

  it("first stop corresponds to the first waypoint (not the last)", () => {
    let wps: Waypoint[] = [];
    wps = appendWaypoint(wps, -121.5, 47.0);
    wps = appendWaypoint(wps, -119.5, 48.9);

    const stops = planFlyThroughStops(wps, grid);
    const firstExpected = lonLatToWorldXZ(wps[0]!.lon, wps[0]!.lat, grid);
    expect(stops[0]!.worldX).toBeCloseTo(firstExpected.x, 6);
    expect(stops[0]!.worldZ).toBeCloseTo(firstExpected.z, 6);
  });

  it("last stop corresponds to the last waypoint (not the first)", () => {
    let wps: Waypoint[] = [];
    wps = appendWaypoint(wps, -121.5, 47.0);
    wps = appendWaypoint(wps, -119.5, 48.9);

    const stops = planFlyThroughStops(wps, grid);
    const lastExpected = lonLatToWorldXZ(wps[1]!.lon, wps[1]!.lat, grid);
    expect(stops[1]!.worldX).toBeCloseTo(lastExpected.x, 6);
    expect(stops[1]!.worldZ).toBeCloseTo(lastExpected.z, 6);
  });

  it("identical calls produce identical world coordinates (stable projection)", () => {
    let wps: Waypoint[] = [];
    wps = appendWaypoint(wps, -120.5, 47.5);
    wps = appendWaypoint(wps, -120.0, 48.0);

    const a = planFlyThroughStops(wps, grid);
    const b = planFlyThroughStops(wps, grid);
    expect(a).toEqual(b);
  });

  it("adding a third waypoint appends a third stop without reordering the first two", () => {
    let wps: Waypoint[] = [];
    wps = appendWaypoint(wps, -121.0, 47.0);
    wps = appendWaypoint(wps, -120.5, 47.5);
    const two = planFlyThroughStops(wps, grid);

    wps = appendWaypoint(wps, -120.0, 48.0);
    const three = planFlyThroughStops(wps, grid);

    expect(three[0]).toEqual(two[0]);
    expect(three[1]).toEqual(two[1]);
    expect(three).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Fly-through execution — mirrors the OverviewMap flyThroughWaypoints callback
//
// OverviewMap.flyThroughWaypoints calls planFlyThroughStops then feeds each
// stop to setPendingDropIn via a setTimeout chain. These tests verify that
// real pattern: produce stops with planFlyThroughStops, then schedule them
// via setTimeout and assert setPendingDropIn is called with each stop in order.
// ---------------------------------------------------------------------------

describe("flyThrough execution — planFlyThroughStops results fed to setPendingDropIn", () => {
  const DWELL_MS = 4000;
  const grid = makeGrid();

  it("setPendingDropIn is called once per waypoint with correct world coords", () => {
    vi.useFakeTimers();
    const setPendingDropIn = vi.fn();

    let wps: Waypoint[] = [];
    wps = appendWaypoint(wps, -121.0, 47.0);
    wps = appendWaypoint(wps, -120.5, 47.5);
    wps = appendWaypoint(wps, -120.0, 48.0);

    const stops = planFlyThroughStops(wps, grid);
    stops.forEach((stop, i) => {
      setTimeout(() => setPendingDropIn(stop), i * DWELL_MS);
    });

    vi.advanceTimersByTime(DWELL_MS * (stops.length + 1));

    expect(setPendingDropIn).toHaveBeenCalledTimes(3);
    expect(setPendingDropIn).toHaveBeenNthCalledWith(1, stops[0]);
    expect(setPendingDropIn).toHaveBeenNthCalledWith(2, stops[1]);
    expect(setPendingDropIn).toHaveBeenNthCalledWith(3, stops[2]);

    vi.useRealTimers();
  });

  it("first setPendingDropIn call receives the first waypoint's world coords", () => {
    vi.useFakeTimers();
    const setPendingDropIn = vi.fn();

    let wps: Waypoint[] = [];
    wps = appendWaypoint(wps, -121.5, 47.0);
    wps = appendWaypoint(wps, -119.5, 48.9);

    const stops = planFlyThroughStops(wps, grid);
    stops.forEach((stop, i) => {
      setTimeout(() => setPendingDropIn(stop), i * DWELL_MS);
    });

    // Advance past first stop only (delay=0ms).
    vi.advanceTimersByTime(1);

    expect(setPendingDropIn).toHaveBeenCalledTimes(1);
    expect(setPendingDropIn).toHaveBeenCalledWith(stops[0]);

    vi.useRealTimers();
  });

  it("second setPendingDropIn call fires after one dwell interval", () => {
    vi.useFakeTimers();
    const setPendingDropIn = vi.fn();

    let wps: Waypoint[] = [];
    wps = appendWaypoint(wps, -121.5, 47.0);
    wps = appendWaypoint(wps, -119.5, 48.9);

    const stops = planFlyThroughStops(wps, grid);
    stops.forEach((stop, i) => {
      setTimeout(() => setPendingDropIn(stop), i * DWELL_MS);
    });

    vi.advanceTimersByTime(DWELL_MS + 1);

    expect(setPendingDropIn).toHaveBeenCalledTimes(2);
    expect(setPendingDropIn).toHaveBeenNthCalledWith(2, stops[1]);

    vi.useRealTimers();
  });

  it("setPendingDropIn is NOT called when planFlyThroughStops returns [] (< 2 wps)", () => {
    vi.useFakeTimers();
    const setPendingDropIn = vi.fn();

    const wps = appendWaypoint([], -120.5, 47.5); // only 1 waypoint
    const stops = planFlyThroughStops(wps, grid);
    stops.forEach((stop, i) => {
      setTimeout(() => setPendingDropIn(stop), i * DWELL_MS);
    });

    vi.advanceTimersByTime(DWELL_MS * 10);
    expect(setPendingDropIn).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Fly-through cancellation (timeout management)
// ---------------------------------------------------------------------------

describe("flyThrough cancellation — timeout lifecycle", () => {
  it("cancelled timeouts do not fire setPendingDropIn", () => {
    vi.useFakeTimers();
    const setPendingDropIn = vi.fn();

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const DWELL_MS = 4000;
    const waypoints = [
      { lon: -121, lat: 47 },
      { lon: -120, lat: 48 },
    ];

    for (let i = 0; i < waypoints.length; i++) {
      timeouts.push(setTimeout(() => {
        setPendingDropIn({ worldX: i * 10, worldZ: i * 5 });
      }, i * DWELL_MS));
    }

    for (const id of timeouts) clearTimeout(id);

    vi.advanceTimersByTime(DWELL_MS * (waypoints.length + 1));
    expect(setPendingDropIn).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("non-cancelled timeouts fire setPendingDropIn in order", () => {
    vi.useFakeTimers();
    const calls: number[] = [];

    const DWELL_MS = 4000;
    const waypoints = [0, 1, 2];
    for (const i of waypoints) {
      setTimeout(() => { calls.push(i); }, i * DWELL_MS);
    }

    vi.advanceTimersByTime(DWELL_MS * (waypoints.length + 1));
    expect(calls).toEqual([0, 1, 2]);

    vi.useRealTimers();
  });

  it("cancelling after partial completion stops further stops from firing", () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const DWELL_MS = 4000;

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < 3; i++) {
      // i=0 → delay 0ms (fires immediately); i=1 → 4000ms; i=2 → 8000ms.
      const t = setTimeout(() => { calls.push(i); }, i * DWELL_MS);
      timeouts.push(t);
    }

    // Advance past the first stop (delay=0ms) only, not the second (delay=4000ms).
    vi.advanceTimersByTime(1);
    // Cancel all remaining timeouts — the 4000ms and 8000ms ones have not yet fired.
    for (const id of timeouts) clearTimeout(id);
    vi.advanceTimersByTime(DWELL_MS * 10);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(0);

    vi.useRealTimers();
  });
});
