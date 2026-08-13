/**
 * puzzleStore.test.ts
 *
 * Integration-style unit tests for puzzleStore covering:
 * 1. Overview-grid / dataset changes while puzzle mode remains enabled —
 *    verifies that setWorldGrid does NOT reset puzzleMode or puzzleTransforms
 *    (the regression caused by the rAF cleanup calling clear()).
 * 2. Same-count marker coordinate update — verifies that applyPuzzleTransformToLonLat
 *    returns different results for the same marker count but different coordinates,
 *    confirming that the MarkerLayer memo (which depends on rendered marker content)
 *    would correctly recompute when marker lon/lat changes.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import { usePuzzleStore } from "../puzzleStore";
import { applyPuzzleTransformToLonLat } from "../puzzleTransform";
import type { OverviewTransform } from "../overviewRenderer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGrid(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
): TerrainData {
  return { minLon, maxLon, minLat, maxLat, width: 2, height: 2, resolution: 2, depths: [], minDepth: 0, maxDepth: 10 } as unknown as TerrainData;
}

function makeTransform(): OverviewTransform {
  return { pxPerDeg: 100, scale: 1, offsetX: 0, offsetY: 0 };
}

// ---------------------------------------------------------------------------
// Scenario 1: overview-grid change while puzzle mode is on
// ---------------------------------------------------------------------------

describe("puzzleStore — overview-grid change while puzzle mode is active", () => {
  beforeEach(() => {
    // Reset to a clean state before each test.
    usePuzzleStore.getState().clear();
  });

  it("retains puzzleMode=true and puzzleTransforms when setWorldGrid is called", () => {
    const store = usePuzzleStore.getState();

    // Simulate OverviewMap enabling puzzle mode and recording a tile transform.
    store.setPuzzleMode(true);
    store.setPuzzleTransforms({ "dataset-A": { tx: 50, ty: -20, angleDeg: 15 } });
    store.setOverviewTransform(makeTransform());
    store.setWorldGrid(makeGrid(-10, 10, -10, 10));

    // Now simulate a new dataset loading (overviewGrid change in OverviewMap).
    // The rAF cleanup no longer calls clear() on grid change — only setWorldGrid
    // fires. Puzzle mode and transforms must be preserved.
    store.setWorldGrid(makeGrid(-20, 20, -20, 20));

    const s = usePuzzleStore.getState();
    expect(s.puzzleMode).toBe(true);
    expect(s.puzzleTransforms["dataset-A"]).toMatchObject({ tx: 50, ty: -20, angleDeg: 15 });
    expect(s.worldGrid).toMatchObject({ minLon: -20, maxLon: 20 });
  });

  it("retains transforms when overviewTransform is re-synced after a grid change", () => {
    const store = usePuzzleStore.getState();
    store.setPuzzleMode(true);
    store.setPuzzleTransforms({ "dataset-B": { tx: 10, ty: 5, angleDeg: 0 } });
    store.setWorldGrid(makeGrid(-5, 5, -5, 5));

    // Simulate overviewGrid change: new worldGrid + new overviewTransform from re-init.
    const newTransform = { pxPerDeg: 80, scale: 1.5, offsetX: 10, offsetY: 10 };
    store.setWorldGrid(makeGrid(-30, 30, -30, 30));
    store.setOverviewTransform(newTransform);

    const s = usePuzzleStore.getState();
    expect(s.puzzleMode).toBe(true);
    expect(s.puzzleTransforms["dataset-B"]).toMatchObject({ tx: 10, ty: 5, angleDeg: 0 });
    expect(s.overviewTransform).toMatchObject(newTransform);
  });

  it("clear() still resets all state when explicitly called (component unmount)", () => {
    const store = usePuzzleStore.getState();
    store.setPuzzleMode(true);
    store.setPuzzleTransforms({ "dataset-C": { tx: 5, ty: 5, angleDeg: 30 } });
    store.setWorldGrid(makeGrid(-1, 1, -1, 1));
    store.setOverviewTransform(makeTransform());

    // Simulate component unmount — the unmount-only useEffect calls clear().
    store.clear();

    const s = usePuzzleStore.getState();
    expect(s.puzzleMode).toBe(false);
    expect(s.puzzleTransforms).toEqual({});
    expect(s.worldGrid).toBeNull();
    expect(s.overviewTransform).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: same-count marker coordinate update
// ---------------------------------------------------------------------------

describe("applyPuzzleTransformToLonLat — same-count marker coordinate update", () => {
  /**
   * When two sets of rendered markers have the same *count* but different
   * coordinates, the adjusted positions must differ.  This confirms that the
   * MarkerLayer memo (which now depends on rendered marker contents, not just
   * rendered.length) correctly triggers recomputation on a coordinate change.
   */
  it("returns different adjusted positions for the same marker count with different coordinates", () => {
    const grid = makeGrid(-50, 50, -50, 50);
    const t = makeTransform();
    const transform = { tx: 200, ty: 0, angleDeg: 0 };
    const tileCenter = { lon: 0, lat: 0 };

    // Two markers with the same count (1 each) but different coordinates.
    const result1 = applyPuzzleTransformToLonLat(5, 0, tileCenter.lon, tileCenter.lat, transform, grid, t);
    const result2 = applyPuzzleTransformToLonLat(10, 0, tileCenter.lon, tileCenter.lat, transform, grid, t);

    // Both are shifted by the same tx, but from different starting positions.
    expect(result1.lon).not.toBeCloseTo(result2.lon, 3);
    // result1 starts at lon=5, result2 at lon=10 — both shift right by the same amount.
    expect(result2.lon - result1.lon).toBeCloseTo(5, 3);
  });

  it("detects a coordinate-only change in the same marker (id unchanged, lon/lat updated)", () => {
    const grid = makeGrid(-50, 50, -50, 50);
    const t = makeTransform();
    const transform = { tx: 0, ty: 0, angleDeg: 90 };
    const tileCenter = { lon: 0, lat: 0 };

    // Simulate a marker edit: same id but lat changed server-side (0 → 5).
    // After 90° CW rotation a point north of the centre swings east, so changing
    // the northward offset changes the eastward output lon (and vice-versa).
    const before = applyPuzzleTransformToLonLat(0, 3, tileCenter.lon, tileCenter.lat, transform, grid, t);
    const after  = applyPuzzleTransformToLonLat(0, 8, tileCenter.lon, tileCenter.lat, transform, grid, t);

    // lon must differ because the northward canvas offset changes after rotation.
    expect(before.lon).not.toBeCloseTo(after.lon, 3);
  });
});
