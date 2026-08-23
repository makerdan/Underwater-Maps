import { describe, expect, it } from "vitest";
import { driftGeometryFromPath, isDriftMarker, sampleDriftWaypoints } from "@/lib/driftMarker";
import type { DriftWaypoint } from "@/lib/driftStore";

const wp = (hour: number, lat: number, lon: number, depth: number): DriftWaypoint => ({
  hour, lat, lon, worldX: 0, worldZ: 0, lineAngleDeg: 10, hookDepthM: depth,
  lineScopeM: 1, bottomReached: false, bottomContact: false, driftSpeedKnots: 1,
  headingDeg: 90, isSlack: false,
});

describe("saved drift marker snapshots", () => {
  it("serializes ordered path points and summary without mutating planner waypoints", () => {
    const path = [wp(0, 57, -135, 40), wp(1, 57.01, -134.99, 55), wp(5, 57.02, -134.98, 25)];
    const snapshot = driftGeometryFromPath(path, new Date("2026-08-22T00:00:00Z"));
    expect(snapshot?.waypoints.map((p) => [p.lat, p.lon])).toEqual([
      [57, -135], [57.01, -134.99], [57.02, -134.98],
    ]);
    expect(snapshot?.summary).toMatchObject({
      startAt: "2026-08-22T00:00:00.000Z",
      endAt: "2026-08-22T06:00:00.000Z",
      minDepth: 25,
      maxDepth: 55,
    });
    expect(path[0]?.worldX).toBe(0);
  });

  it("rejects empty and degenerate paths instead of creating a crashable marker", () => {
    expect(driftGeometryFromPath([])).toBeNull();
    expect(driftGeometryFromPath([wp(0, Number.NaN, -135, 10), wp(1, 57, -135, 10)])).toBeNull();
    expect(isDriftMarker({ geometry: { version: 1, kind: "drift", waypoints: [], summary: {
      distanceM: 0, durationS: 0, startAt: "", endAt: "", minDepth: 0, maxDepth: 0,
    } } })).toBe(false);
  });

  it("samples dense paths while preserving both endpoints", () => {
    const path = Array.from({ length: 240 }, (_, hour) => wp(hour, 57 + hour / 10000, -135, 20));
    const snapshot = driftGeometryFromPath(path)!;
    const sampled = sampleDriftWaypoints(snapshot, 24);
    expect(sampled).toHaveLength(24);
    expect(sampled[0]).toEqual(snapshot.waypoints[0]);
    expect(sampled.at(-1)).toEqual(snapshot.waypoints.at(-1));
  });
});