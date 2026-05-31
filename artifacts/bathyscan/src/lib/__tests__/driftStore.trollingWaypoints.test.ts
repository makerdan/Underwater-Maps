/**
 * driftStore — trolling waypoint CRUD unit tests.
 *
 * Covers the three store actions that back the click-to-drop / drag-to-move /
 * right-click-to-delete UX in the Drift Planner:
 *
 *   addDriftWaypoint    — appends a waypoint, preserving existing ones
 *   updateDriftWaypoint — repositions a waypoint by index
 *   removeDriftWaypoint — removes a waypoint by index, shifting the rest
 *
 * These are pure Zustand state transitions; no React or Three.js is involved.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useDriftStore } from "@/lib/driftStore";
import type { TrollWaypoint } from "@/lib/driftStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wp(lat: number, lon: number): TrollWaypoint {
  return { lat, lon };
}

function resetWaypoints(wps: TrollWaypoint[] = []) {
  useDriftStore.setState({ driftWaypoints: wps });
}

function getWaypoints(): TrollWaypoint[] {
  return useDriftStore.getState().driftWaypoints;
}

// ---------------------------------------------------------------------------
// addDriftWaypoint
// ---------------------------------------------------------------------------

describe("addDriftWaypoint", () => {
  beforeEach(() => resetWaypoints());

  it("appends the first waypoint to an empty list", () => {
    useDriftStore.getState().addDriftWaypoint(wp(47.6, -122.3));
    expect(getWaypoints()).toEqual([{ lat: 47.6, lon: -122.3 }]);
  });

  it("appends to the end without disturbing earlier waypoints", () => {
    useDriftStore.getState().addDriftWaypoint(wp(47.6, -122.3));
    useDriftStore.getState().addDriftWaypoint(wp(47.7, -122.4));
    useDriftStore.getState().addDriftWaypoint(wp(47.8, -122.5));

    const wps = getWaypoints();
    expect(wps).toHaveLength(3);
    expect(wps[0]).toEqual({ lat: 47.6, lon: -122.3 });
    expect(wps[1]).toEqual({ lat: 47.7, lon: -122.4 });
    expect(wps[2]).toEqual({ lat: 47.8, lon: -122.5 });
  });

  it("stores exact lat/lon values without rounding", () => {
    const precise = wp(47.123456789, -122.987654321);
    useDriftStore.getState().addDriftWaypoint(precise);
    const stored = getWaypoints()[0]!;
    expect(stored.lat).toBe(47.123456789);
    expect(stored.lon).toBe(-122.987654321);
  });
});

// ---------------------------------------------------------------------------
// updateDriftWaypoint — drag-to-reposition
// ---------------------------------------------------------------------------

describe("updateDriftWaypoint", () => {
  beforeEach(() =>
    resetWaypoints([
      wp(47.6, -122.3),
      wp(47.7, -122.4),
      wp(47.8, -122.5),
    ])
  );

  it("replaces the waypoint at the target index with the new lat/lon", () => {
    useDriftStore.getState().updateDriftWaypoint(1, wp(47.75, -122.45));

    const wps = getWaypoints();
    expect(wps[1]).toEqual({ lat: 47.75, lon: -122.45 });
  });

  it("leaves all other waypoints untouched when updating index 1", () => {
    useDriftStore.getState().updateDriftWaypoint(1, wp(47.75, -122.45));

    const wps = getWaypoints();
    expect(wps).toHaveLength(3);
    expect(wps[0]).toEqual({ lat: 47.6, lon: -122.3 });
    expect(wps[2]).toEqual({ lat: 47.8, lon: -122.5 });
  });

  it("updates the first waypoint (index 0) correctly", () => {
    useDriftStore.getState().updateDriftWaypoint(0, wp(47.61, -122.31));
    expect(getWaypoints()[0]).toEqual({ lat: 47.61, lon: -122.31 });
    expect(getWaypoints()[1]).toEqual({ lat: 47.7, lon: -122.4 });
  });

  it("updates the last waypoint (index N-1) correctly", () => {
    useDriftStore.getState().updateDriftWaypoint(2, wp(47.85, -122.55));
    expect(getWaypoints()[2]).toEqual({ lat: 47.85, lon: -122.55 });
    expect(getWaypoints()[1]).toEqual({ lat: 47.7, lon: -122.4 });
  });

  it("preserves array length after an update", () => {
    useDriftStore.getState().updateDriftWaypoint(0, wp(1, 2));
    expect(getWaypoints()).toHaveLength(3);
  });

  it("is a no-op when the index is out of bounds (negative)", () => {
    const before = getWaypoints().slice();
    useDriftStore.getState().updateDriftWaypoint(-1, wp(99, 99));
    expect(getWaypoints()).toEqual(before);
  });

  it("is a no-op when the index equals the array length", () => {
    const before = getWaypoints().slice();
    useDriftStore.getState().updateDriftWaypoint(3, wp(99, 99));
    expect(getWaypoints()).toEqual(before);
  });

  it("stores the new position with full floating-point precision", () => {
    const newLat = 47.123456789;
    const newLon = -122.987654321;
    useDriftStore.getState().updateDriftWaypoint(2, { lat: newLat, lon: newLon });
    const stored = getWaypoints()[2]!;
    expect(stored.lat).toBe(newLat);
    expect(stored.lon).toBe(newLon);
  });
});

// ---------------------------------------------------------------------------
// removeDriftWaypoint — right-click-to-delete
// ---------------------------------------------------------------------------

describe("removeDriftWaypoint", () => {
  beforeEach(() =>
    resetWaypoints([
      wp(47.6, -122.3),
      wp(47.7, -122.4),
      wp(47.8, -122.5),
    ])
  );

  it("removes the waypoint at index 0 and shifts the rest down", () => {
    useDriftStore.getState().removeDriftWaypoint(0);

    const wps = getWaypoints();
    expect(wps).toHaveLength(2);
    expect(wps[0]).toEqual({ lat: 47.7, lon: -122.4 });
    expect(wps[1]).toEqual({ lat: 47.8, lon: -122.5 });
  });

  it("removes a middle waypoint (index 1) leaving first and last intact", () => {
    useDriftStore.getState().removeDriftWaypoint(1);

    const wps = getWaypoints();
    expect(wps).toHaveLength(2);
    expect(wps[0]).toEqual({ lat: 47.6, lon: -122.3 });
    expect(wps[1]).toEqual({ lat: 47.8, lon: -122.5 });
  });

  it("removes the last waypoint (index N-1) without affecting the others", () => {
    useDriftStore.getState().removeDriftWaypoint(2);

    const wps = getWaypoints();
    expect(wps).toHaveLength(2);
    expect(wps[0]).toEqual({ lat: 47.6, lon: -122.3 });
    expect(wps[1]).toEqual({ lat: 47.7, lon: -122.4 });
  });

  it("reduces the array length by exactly 1", () => {
    useDriftStore.getState().removeDriftWaypoint(0);
    expect(getWaypoints()).toHaveLength(2);
  });

  it("produces an empty list when the sole remaining waypoint is removed", () => {
    resetWaypoints([wp(47.6, -122.3)]);
    useDriftStore.getState().removeDriftWaypoint(0);
    expect(getWaypoints()).toHaveLength(0);
  });

  it("is a no-op when the index is out of bounds (too large)", () => {
    useDriftStore.getState().removeDriftWaypoint(99);
    expect(getWaypoints()).toHaveLength(3);
  });

  it("sequential removes correctly compress the array", () => {
    useDriftStore.getState().removeDriftWaypoint(0);
    useDriftStore.getState().removeDriftWaypoint(0);

    const wps = getWaypoints();
    expect(wps).toHaveLength(1);
    expect(wps[0]).toEqual({ lat: 47.8, lon: -122.5 });
  });
});

// ---------------------------------------------------------------------------
// clearDriftWaypoints
// ---------------------------------------------------------------------------

describe("clearDriftWaypoints", () => {
  it("empties the waypoint list regardless of how many entries exist", () => {
    resetWaypoints([wp(1, 1), wp(2, 2), wp(3, 3)]);
    useDriftStore.getState().clearDriftWaypoints();
    expect(getWaypoints()).toHaveLength(0);
  });

  it("is a no-op on an already-empty list", () => {
    resetWaypoints([]);
    useDriftStore.getState().clearDriftWaypoints();
    expect(getWaypoints()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// moveDriftWaypoint — reorder
// ---------------------------------------------------------------------------

describe("moveDriftWaypoint", () => {
  beforeEach(() =>
    resetWaypoints([
      wp(47.6, -122.3),
      wp(47.7, -122.4),
      wp(47.8, -122.5),
    ])
  );

  it("swaps adjacent entries when direction = 1 (move down)", () => {
    useDriftStore.getState().moveDriftWaypoint(0, 1);

    const wps = getWaypoints();
    expect(wps[0]).toEqual({ lat: 47.7, lon: -122.4 });
    expect(wps[1]).toEqual({ lat: 47.6, lon: -122.3 });
    expect(wps[2]).toEqual({ lat: 47.8, lon: -122.5 });
  });

  it("swaps adjacent entries when direction = -1 (move up)", () => {
    useDriftStore.getState().moveDriftWaypoint(2, -1);

    const wps = getWaypoints();
    expect(wps[1]).toEqual({ lat: 47.8, lon: -122.5 });
    expect(wps[2]).toEqual({ lat: 47.7, lon: -122.4 });
    expect(wps[0]).toEqual({ lat: 47.6, lon: -122.3 });
  });

  it("is a no-op when moving the last entry down (out of bounds)", () => {
    const before = getWaypoints().slice();
    useDriftStore.getState().moveDriftWaypoint(2, 1);
    expect(getWaypoints()).toEqual(before);
  });

  it("is a no-op when moving the first entry up (out of bounds)", () => {
    const before = getWaypoints().slice();
    useDriftStore.getState().moveDriftWaypoint(0, -1);
    expect(getWaypoints()).toEqual(before);
  });
});
