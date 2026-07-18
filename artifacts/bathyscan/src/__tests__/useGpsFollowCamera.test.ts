/**
 * useGpsFollowCamera — bounds-exit behaviour.
 *
 * Verifies that when GPS follow mode is active and the live GPS position
 * drifts outside the active dataset grid:
 *  - setGpsFollowMode(false) is called on cameraStore.
 *  - The out-of-bounds handoff (dataset suggestion search + toast) fires.
 *  - The handoff is only fired once per exit event (de-duplication).
 *
 * Also verifies that no side-effects fire when the position stays in bounds,
 * and that follow mode is disabled when GPS becomes inactive mid-follow.
 *
 * Note on mount order: the hook has a useEffect that fires on mount and
 * resets gpsFollowMode to false (to clear stale follow state when the
 * dataset changes). Therefore all tests must call mountHook() first, then
 * set the desired store state, then call runFrame().
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as THREE from "three";

// ── Hoist spy so it is available inside the vi.mock factory ───────────────
const handoffSpy = vi.hoisted(() => vi.fn(async () => {}));

// ── Capture the useFrame callback so we can drive it manually ─────────────
let capturedFrameCallback: (() => void) | null = null;

vi.mock("@react-three/fiber", () => ({
  useThree: () => ({ camera: new THREE.PerspectiveCamera() }),
  useFrame: (cb: () => void) => {
    capturedFrameCallback = cb;
  },
}));

// ── Spy on the out-of-bounds handoff (owns both toast variants) ────────────
vi.mock("@/lib/datasetHandoff", () => ({
  handleFollowOutOfBounds: (...args: unknown[]) => handoffSpy(...args),
}));

// ── Stub terrain helpers so the in-bounds render path doesn't throw ───────
vi.mock("@/lib/terrain", () => ({
  lonLatToWorldXZ: () => ({ x: 0, z: 0 }),
  getTerrainSurfaceY: () => 0,
}));

// ── Imports after mocks ───────────────────────────────────────────────────
import { useGpsFollowCamera } from "@/hooks/useGpsFollowCamera";
import { useCameraStore } from "@/lib/cameraStore";
import { useGpsStore } from "@/lib/gpsStore";
import { useTerrainStore } from "@/lib/terrainStore";

/** Minimal grid covering lat 0–10, lon 0–10. */
const ACTIVE_GRID = {
  datasetId: "test-ds",
  minLat: 0,
  maxLat: 10,
  minLon: 0,
  maxLon: 10,
  resolution: 2,
  width: 2,
  height: 2,
  depths: [0, -1, -1, -2],
  minDepth: -2,
  maxDepth: 0,
  centerLat: 5,
  centerLon: 5,
} as unknown as import("@workspace/api-client-react").TerrainData;

/** GPS position inside ACTIVE_GRID bounds. */
const POS_IN = { longitude: 5, latitude: 5, accuracy: 5, timestamp: 0, speed: null, heading: null };

/** GPS position outside ACTIVE_GRID bounds. */
const POS_OUT = { longitude: 50, latitude: 50, accuracy: 5, timestamp: 0, speed: null, heading: null };

function mountHook() {
  return renderHook(() => useGpsFollowCamera());
}

/** Invoke the captured useFrame callback (simulates one animation frame). */
function runFrame() {
  if (!capturedFrameCallback) throw new Error("useFrame callback was not captured");
  act(() => {
    capturedFrameCallback!();
  });
}

describe("useGpsFollowCamera — bounds-exit behaviour", () => {
  beforeEach(() => {
    capturedFrameCallback = null;
    handoffSpy.mockClear();

    // Reset stores to a known baseline.
    useCameraStore.setState({ gpsFollowMode: false });
    useGpsStore.setState({ active: false, position: null, error: null, watchId: null });
    useTerrainStore.setState({
      visibleDatasets: [],
      primaryDatasetId: null,
      activeGrid: null,
      overviewGrid: null,
    });
  });

  it("calls setGpsFollowMode(false) when GPS drifts outside the active grid", () => {
    // Mount first — the hook's on-mount useEffect resets gpsFollowMode.
    const { unmount } = mountHook();

    // Now configure the state that the frame callback will read.
    act(() => {
      useCameraStore.setState({ gpsFollowMode: true });
      useGpsStore.setState({ active: true, position: POS_OUT });
      useTerrainStore.setState({ activeGrid: ACTIVE_GRID });
    });

    runFrame();

    expect(useCameraStore.getState().gpsFollowMode).toBe(false);
    unmount();
  });

  it("triggers the out-of-bounds handoff with the exit lon/lat", () => {
    const { unmount } = mountHook();

    act(() => {
      useCameraStore.setState({ gpsFollowMode: true });
      useGpsStore.setState({ active: true, position: POS_OUT });
      useTerrainStore.setState({ activeGrid: ACTIVE_GRID });
    });

    runFrame();

    expect(handoffSpy).toHaveBeenCalledTimes(1);
    expect(handoffSpy).toHaveBeenCalledWith(POS_OUT.longitude, POS_OUT.latitude);
    unmount();
  });

  it("fires the out-of-bounds handoff only once per exit event", () => {
    const { unmount } = mountHook();

    act(() => {
      useCameraStore.setState({ gpsFollowMode: true });
      useGpsStore.setState({ active: true, position: POS_OUT });
      useTerrainStore.setState({ activeGrid: ACTIVE_GRID });
    });

    // First frame: exits bounds, handoff fires once, follow mode disabled.
    runFrame();
    // Subsequent frames: follow mode is false, callback returns early.
    runFrame();
    runFrame();

    expect(handoffSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does NOT disable follow mode or trigger the handoff when position is inside bounds", () => {
    const { unmount } = mountHook();

    act(() => {
      useCameraStore.setState({ gpsFollowMode: true });
      useGpsStore.setState({ active: true, position: POS_IN });
      useTerrainStore.setState({ activeGrid: ACTIVE_GRID });
    });

    runFrame();

    expect(useCameraStore.getState().gpsFollowMode).toBe(true);
    expect(handoffSpy).not.toHaveBeenCalled();
    unmount();
  });

  it("disables follow mode when GPS becomes inactive mid-follow (no handoff)", () => {
    const { unmount } = mountHook();

    act(() => {
      useCameraStore.setState({ gpsFollowMode: true });
      useGpsStore.setState({ active: false, position: null });
      useTerrainStore.setState({ activeGrid: ACTIVE_GRID });
    });

    runFrame();

    expect(useCameraStore.getState().gpsFollowMode).toBe(false);
    expect(handoffSpy).not.toHaveBeenCalled();
    unmount();
  });

  it("is a no-op when follow mode is already off", () => {
    const { unmount } = mountHook();

    // follow mode is already false — the frame callback should return early.
    act(() => {
      useCameraStore.setState({ gpsFollowMode: false });
      useGpsStore.setState({ active: true, position: POS_OUT });
      useTerrainStore.setState({ activeGrid: ACTIVE_GRID });
    });

    runFrame();

    expect(useCameraStore.getState().gpsFollowMode).toBe(false);
    expect(handoffSpy).not.toHaveBeenCalled();
    unmount();
  });
});
