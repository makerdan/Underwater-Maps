/**
 * Unit tests for lib/mobileMapFollow.ts — MOBILE-ONLY Live-tab wiring that
 * drives 2D chart centering from the SAME GpsFollowState machine the desktop
 * 3D camera uses.
 *
 * REGRESSION GUARD (task: Mobile Live tab on 2D chart): with the mobile path
 * active and NO 3D scene mounted, a new GPS fix while "following" must
 * recenter the chart transform — these tests fail if follow ever reverts to
 * the camera-only (useGpsFollowCamera) path, which no-ops on mobile and
 * leaves the chart frozen while the user moves.
 *
 * Covers:
 *   - computeFollowedTransform: lerp toward canvas centre, settled → null.
 *   - runMobileMapFollowTick: recenter while following; interaction pause →
 *     no recenter → auto-resume after followResumeDelaySec; signal-loss
 *     pause → recovery resume (all through cameraStore, no parallel state).
 *   - retargetPrimaryToGpsDataset: requests the EXISTING follow-handoff
 *     channel only when the fix left the primary grid AND sits inside
 *     another visible dataset's loaded grid; no re-request while pending.
 *   - depthAtGpsMetres: interpolated value, null out-of-bounds, null over
 *     survey gaps (all 4 corners no-data), value with partial nulls.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// followBoundsCheck (used by the tick) imports datasetHandoff, which pulls in
// toast/query machinery — mock it like the followBoundsCheck tests do.
vi.mock("../datasetHandoff", () => ({
  handleFollowOutOfBounds: vi.fn().mockResolvedValue(undefined),
}));

import {
  computeFollowedTransform,
  runMobileMapFollowTick,
  retargetPrimaryToGpsDataset,
  depthAtGpsMetres,
  startMobileGpsCameraMirror,
  type MobileFollowTransformPort,
} from "../mobileMapFollow";
import { useCameraStore } from "../cameraStore";
import { useGpsStore } from "../gpsStore";
import { useTerrainStore } from "../terrainStore";
import { useSettingsStore } from "../settingsStore";
import { useUiStore } from "../uiStore";
import type { OverviewTransform } from "../overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RES = 4;

function makeGrid(over: Record<string, unknown> = {}): TerrainData {
  return {
    datasetId: "primary",
    resolution: RES,
    depths: new Array(RES * RES).fill(12) as number[],
    minDepth: 12,
    maxDepth: 12,
    minLon: -97.2,
    maxLon: -96.8,
    minLat: 33.2,
    maxLat: 33.6,
    ...over,
  } as unknown as TerrainData;
}

const GRID = makeGrid();
/** Adjacent dataset to the east of GRID (shares the -96.8 edge). */
const OTHER_GRID = makeGrid({
  datasetId: "other",
  minLon: -96.8,
  maxLon: -96.4,
});

/** Fix at the exact centre of GRID. */
const FIX_INSIDE = { longitude: -97.0, latitude: 33.4, accuracy: 8, speed: null, heading: null, timestamp: 0 };
/** Fix inside OTHER_GRID, outside GRID. */
const FIX_IN_OTHER = { ...FIX_INSIDE, longitude: -96.6 };

const W = 400;
const H = 600;
/** scale 4 ⇒ terrainW/H = 1000 × 0.4 × 4 = 1600 px — plenty of pan room. */
const BASE_T: OverviewTransform = { scale: 4, offsetX: 0, offsetY: 0, pxPerDeg: 1000 };

function makePort(initial: OverviewTransform = BASE_T): MobileFollowTransformPort & {
  current: () => OverviewTransform;
} {
  let t: OverviewTransform = { ...initial };
  return {
    getTransform: () => t,
    setTransform: (next) => {
      t = next;
    },
    getSize: () => ({ w: W, h: H }),
    current: () => t,
  };
}

function seedVisible(entries: Array<{ id: string; grid: TerrainData | null }>) {
  useTerrainStore.setState({
    visibleDatasets: entries.map((e) => ({
      datasetId: e.id,
      source: "preset",
      activeGrid: e.grid,
      overviewGrid: e.grid,
    })),
    primaryDatasetId: entries[0]?.id ?? null,
    activeGrid: entries[0]?.grid ?? null,
    overviewGrid: entries[0]?.grid ?? null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  useCameraStore.setState({
    gpsFollowState: "off",
    pauseReason: null,
    followLastInteractionAt: 0,
    cameraPosition: { known: false },
  } as never);
  useGpsStore.setState({
    active: true,
    position: FIX_INSIDE,
    error: null,
    errorCode: null,
    watchId: 1,
  } as never);
  useUiStore.setState({ pendingFollowHandoff: null } as never);
  useSettingsStore.setState({ followResumeDelaySec: 20 } as never);
  seedVisible([{ id: "primary", grid: GRID }]);
});

// ---------------------------------------------------------------------------
// computeFollowedTransform (pure)
// ---------------------------------------------------------------------------

describe("computeFollowedTransform", () => {
  it("moves the transform one lerp step toward centering the fix", () => {
    const next = computeFollowedTransform(GRID, BASE_T, W, H, -97.0, 33.4, 0.15);
    expect(next).not.toBeNull();
    // Fix maps to canvas (800, 800); centre is (200, 300) ⇒ full delta is
    // (-600, -500); one 0.15 step ⇒ (-90, -75).
    expect(next!.offsetX).toBeCloseTo(-90, 5);
    expect(next!.offsetY).toBeCloseTo(-75, 5);
  });

  it("returns null once the fix is already centred (settled)", () => {
    const centred: OverviewTransform = { ...BASE_T, offsetX: -600, offsetY: -500 };
    expect(computeFollowedTransform(GRID, centred, W, H, -97.0, 33.4)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runMobileMapFollowTick — the per-frame follow step
// ---------------------------------------------------------------------------

describe("runMobileMapFollowTick", () => {
  it("recenters the chart on the GPS fix while following (no 3D scene)", () => {
    useCameraStore.getState().setGpsFollowMode(true);
    const port = makePort();
    const state = { toastFired: false };

    expect(runMobileMapFollowTick(state, port)).toBe(true);
    expect(port.current().offsetX).toBeCloseTo(-90, 5);
    expect(port.current().offsetY).toBeCloseTo(-75, 5);

    // Converges: after enough ticks the fix sits at the canvas centre.
    for (let i = 0; i < 300; i++) runMobileMapFollowTick(state, port);
    const t = port.current();
    // fix px = offsetX + 0.5 * 1600 → should be ≈ W/2 (±2 px: the tick's
    // 0.25 px settle deadband ÷ 0.15 lerp leaves ≤ ~1.7 px residual).
    expect(Math.abs(t.offsetX + 800 - W / 2)).toBeLessThan(2);
    expect(Math.abs(t.offsetY + 800 - H / 2)).toBeLessThan(2);
    // State machine stayed in 'following' the whole time.
    expect(useCameraStore.getState().gpsFollowState).toBe("following");
  });

  it("does nothing while follow is off", () => {
    const port = makePort();
    expect(runMobileMapFollowTick({ toastFired: false }, port)).toBe(false);
    expect(port.current()).toEqual(BASE_T);
  });

  it("interaction pause blocks recentering, then auto-resumes after followResumeDelaySec", () => {
    useCameraStore.getState().setGpsFollowMode(true);
    // User pans the chart → paused (reason: interaction), timestamp stamped.
    useCameraStore.getState().pauseFollowForInteraction();
    const stamped = useCameraStore.getState().followLastInteractionAt;
    expect(useCameraStore.getState().gpsFollowState).toBe("paused");
    expect(useCameraStore.getState().pauseReason).toBe("interaction");

    const port = makePort();
    const state = { toastFired: false };

    // 1 s after the interaction — inside the 20 s window: no movement.
    expect(runMobileMapFollowTick(state, port, () => stamped + 1_000)).toBe(false);
    expect(port.current()).toEqual(BASE_T);
    expect(useCameraStore.getState().gpsFollowState).toBe("paused");

    // Past the window: resumes AND recenters in the same tick.
    expect(runMobileMapFollowTick(state, port, () => stamped + 20_001)).toBe(true);
    expect(useCameraStore.getState().gpsFollowState).toBe("following");
    expect(port.current().offsetX).toBeCloseTo(-90, 5);
  });

  it("signal loss pauses; recovery resumes and recenters", () => {
    useCameraStore.getState().setGpsFollowMode(true);
    const port = makePort();
    const state = { toastFired: false };

    // Signal drops → shared bounds check pauses with reason 'signal-loss'.
    useGpsStore.setState({ active: false } as never);
    expect(runMobileMapFollowTick(state, port)).toBe(false);
    expect(useCameraStore.getState().gpsFollowState).toBe("paused");
    expect(useCameraStore.getState().pauseReason).toBe("signal-loss");
    expect(port.current()).toEqual(BASE_T);

    // Signal returns → tick resumes (inactivity window long elapsed) and
    // recenters again.
    useGpsStore.setState({ active: true, position: FIX_INSIDE } as never);
    const stamped = useCameraStore.getState().followLastInteractionAt;
    expect(runMobileMapFollowTick(state, port, () => stamped + 999_999)).toBe(true);
    expect(useCameraStore.getState().gpsFollowState).toBe("following");
    expect(port.current().offsetX).toBeCloseTo(-90, 5);
  });
});

// ---------------------------------------------------------------------------
// retargetPrimaryToGpsDataset — 2D dataset re-targeting via follow handoff
// ---------------------------------------------------------------------------

describe("retargetPrimaryToGpsDataset", () => {
  it("does nothing while the fix is inside the primary grid", () => {
    expect(retargetPrimaryToGpsDataset(FIX_INSIDE.longitude, FIX_INSIDE.latitude)).toBe(false);
    expect(useUiStore.getState().pendingFollowHandoff).toBeNull();
  });

  it("requests the existing follow handoff when the fix crosses onto another visible dataset", () => {
    seedVisible([
      { id: "primary", grid: GRID },
      { id: "other", grid: OTHER_GRID },
    ]);
    expect(retargetPrimaryToGpsDataset(FIX_IN_OTHER.longitude, FIX_IN_OTHER.latitude)).toBe(true);
    expect(useUiStore.getState().pendingFollowHandoff).toBe("other");
  });

  it("does not re-request while a handoff is already pending", () => {
    seedVisible([
      { id: "primary", grid: GRID },
      { id: "other", grid: OTHER_GRID },
    ]);
    useUiStore.setState({ pendingFollowHandoff: "already-in-flight" } as never);
    expect(retargetPrimaryToGpsDataset(FIX_IN_OTHER.longitude, FIX_IN_OTHER.latitude)).toBe(true);
    // Untouched — the in-flight handoff wins.
    expect(useUiStore.getState().pendingFollowHandoff).toBe("already-in-flight");
  });

  it("skips visible datasets whose grids have not loaded yet", () => {
    seedVisible([
      { id: "primary", grid: GRID },
      { id: "other", grid: null },
    ]);
    expect(retargetPrimaryToGpsDataset(FIX_IN_OTHER.longitude, FIX_IN_OTHER.latitude)).toBe(false);
    expect(useUiStore.getState().pendingFollowHandoff).toBeNull();
  });

  it("tick requests the handoff and skips centering that frame", () => {
    seedVisible([
      { id: "primary", grid: GRID },
      { id: "other", grid: OTHER_GRID },
    ]);
    useGpsStore.setState({ position: FIX_IN_OTHER } as never);
    useCameraStore.getState().setGpsFollowMode(true);
    const port = makePort();

    expect(runMobileMapFollowTick({ toastFired: false }, port)).toBe(false);
    expect(useUiStore.getState().pendingFollowHandoff).toBe("other");
    expect(port.current()).toEqual(BASE_T);
    // Follow stays engaged — the App.tsx handoff consumer completes the switch.
    expect(useCameraStore.getState().gpsFollowState).toBe("following");
  });
});

// ---------------------------------------------------------------------------
// depthAtGpsMetres — glanceable depth readout
// ---------------------------------------------------------------------------

describe("depthAtGpsMetres", () => {
  it("returns the grid depth under the fix (uniform grid roundtrip)", () => {
    expect(depthAtGpsMetres(GRID, -97.0, 33.4)).toBeCloseTo(12, 6);
  });

  it("interpolates at a grid node with varied depths", () => {
    const depths = new Array(RES * RES).fill(10) as number[];
    depths[1 * RES + 1] = 20; // node (col 1, row 1)
    const grid = makeGrid({ depths, minDepth: 10, maxDepth: 20 });
    // Node (1,1): lon = minLon + (1/3)·0.4, lat = minLat + (1/3)·0.4
    const lon = -97.2 + 0.4 / 3;
    const lat = 33.2 + 0.4 / 3;
    expect(depthAtGpsMetres(grid, lon, lat)).toBeCloseTo(20, 4);
  });

  it("returns null outside the grid bbox (never invents a depth)", () => {
    expect(depthAtGpsMetres(GRID, -96.6, 33.4)).toBeNull();
    expect(depthAtGpsMetres(GRID, -97.0, 34.0)).toBeNull();
    expect(depthAtGpsMetres(null, -97.0, 33.4)).toBeNull();
  });

  it("returns null over a survey gap (all four surrounding cells no-data)", () => {
    const depths: Array<number | null> = new Array(RES * RES).fill(10);
    // Fix at grid centre falls in the cell bounded by cols/rows 1–2.
    depths[1 * RES + 1] = null;
    depths[1 * RES + 2] = null;
    depths[2 * RES + 1] = null;
    depths[2 * RES + 2] = null;
    const grid = makeGrid({ depths, minDepth: 10, maxDepth: 10 });
    expect(depthAtGpsMetres(grid, -97.0, 33.4)).toBeNull();
  });

  it("still returns a value when only some surrounding cells are no-data", () => {
    const depths: Array<number | null> = new Array(RES * RES).fill(10);
    depths[1 * RES + 1] = null; // one corner missing
    const grid = makeGrid({ depths, minDepth: 10, maxDepth: 10 });
    expect(depthAtGpsMetres(grid, -97.0, 33.4)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// startMobileGpsCameraMirror — GPS fix → cameraPosition (proximity feed)
// ---------------------------------------------------------------------------

describe("startMobileGpsCameraMirror", () => {
  it("seeds cameraPosition from an existing fix and mirrors subsequent fixes", () => {
    const unsub = startMobileGpsCameraMirror();
    try {
      const seeded = useCameraStore.getState().cameraPosition;
      expect(seeded).toMatchObject({ known: true, lon: -97.0, lat: 33.4 });

      useGpsStore.setState({ position: { ...FIX_INSIDE, longitude: -96.95 } } as never);
      expect(useCameraStore.getState().cameraPosition).toMatchObject({
        known: true,
        lon: -96.95,
      });
    } finally {
      unsub();
    }
    // After unsubscribe, new fixes no longer mirror.
    useGpsStore.setState({ position: { ...FIX_INSIDE, longitude: -90 } } as never);
    expect(useCameraStore.getState().cameraPosition).toMatchObject({ lon: -96.95 });
  });
});
