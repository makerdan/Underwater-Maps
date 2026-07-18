/**
 * useGpsFollowCamera — interaction pause / auto-resume behaviour (Follow Me).
 *
 * Verifies:
 *  - pauseFollowForInteraction() pauses camera tracking without turning
 *    gpsFollowMode off, and the frame loop stops moving the camera.
 *  - Follow resumes automatically once followResumeDelaySec of inactivity
 *    has elapsed (default 20 s).
 *  - A fresh interaction mid-countdown resets the inactivity timer.
 *  - Changing the followResumeDelaySec setting changes the resume delay.
 *  - Explicit toggle-off (setGpsFollowMode(false)) clears the paused state
 *    and does NOT auto-resume.
 *  - GPS loss and out-of-bounds while paused fully disable follow mode.
 *
 * Time is controlled by spying on Date.now (not fake timers — see the
 * project note about fake-timer clock resets leaking across files).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as THREE from "three";

const toastSpy = vi.hoisted(() => vi.fn());
const handoffSpy = vi.hoisted(() => vi.fn(async () => {}));

let capturedFrameCallback: (() => void) | null = null;
let camera: THREE.PerspectiveCamera;

vi.mock("@react-three/fiber", () => ({
  useThree: () => ({ camera }),
  useFrame: (cb: () => void) => {
    capturedFrameCallback = cb;
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
}));

// The out-of-bounds toast (pause or dataset suggestion) is now owned by the
// datasetHandoff module; the hook just fires handleFollowOutOfBounds.
vi.mock("@/lib/datasetHandoff", () => ({
  handleFollowOutOfBounds: (...args: unknown[]) => handoffSpy(...args),
}));

// GPS target maps to world (100, 0, 100) so a lerp visibly moves the camera
// away from the origin.
vi.mock("@/lib/terrain", () => ({
  lonLatToWorldXZ: () => ({ x: 100, z: 100 }),
  getTerrainSurfaceY: () => 0,
}));

import { useGpsFollowCamera } from "@/hooks/useGpsFollowCamera";
import { useCameraStore } from "@/lib/cameraStore";
import { useGpsStore } from "@/lib/gpsStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useTerrainStore } from "@/lib/terrainStore";

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

const POS_IN = { longitude: 5, latitude: 5, accuracy: 5, timestamp: 0 };
const POS_OUT = { longitude: 50, latitude: 50, accuracy: 5, timestamp: 0 };

let nowMs = 1_000_000;
let dateNowSpy: ReturnType<typeof vi.spyOn>;

function advanceTime(ms: number) {
  nowMs += ms;
}

function mountHook() {
  return renderHook(() => useGpsFollowCamera());
}

function runFrame() {
  if (!capturedFrameCallback) throw new Error("useFrame callback was not captured");
  act(() => {
    capturedFrameCallback!();
  });
}

/** Enter active follow mode with an in-bounds GPS fix. */
function startFollowing() {
  act(() => {
    useCameraStore.setState({ gpsFollowMode: true });
    useGpsStore.setState({ active: true, position: POS_IN });
    useTerrainStore.setState({ activeGrid: ACTIVE_GRID });
  });
}

describe("useGpsFollowCamera — interaction pause / auto-resume", () => {
  beforeEach(() => {
    capturedFrameCallback = null;
    toastSpy.mockClear();
    handoffSpy.mockClear();
    camera = new THREE.PerspectiveCamera();
    nowMs = 1_000_000;
    dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);

    useCameraStore.setState({
      gpsFollowMode: false,
      followPausedByInteraction: false,
      followLastInteractionAt: 0,
    });
    useGpsStore.setState({ active: false, position: null, error: null, watchId: null });
    useTerrainStore.setState({
      visibleDatasets: [],
      primaryDatasetId: null,
      activeGrid: null,
      overviewGrid: null,
    });
    useSettingsStore.setState({ followResumeDelaySec: 20 });
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it("pauses camera tracking on interaction without exiting follow mode", () => {
    const { unmount } = mountHook();
    startFollowing();

    act(() => {
      useCameraStore.getState().pauseFollowForInteraction();
    });

    const before = camera.position.clone();
    runFrame();

    expect(useCameraStore.getState().gpsFollowMode).toBe(true);
    expect(useCameraStore.getState().followPausedByInteraction).toBe(true);
    expect(camera.position.equals(before)).toBe(true);
    unmount();
  });

  it("resumes tracking after the configured inactivity delay elapses", () => {
    const { unmount } = mountHook();
    startFollowing();

    act(() => {
      useCameraStore.getState().pauseFollowForInteraction();
    });

    // 19s later — still paused, camera untouched.
    advanceTime(19_000);
    const before = camera.position.clone();
    runFrame();
    expect(useCameraStore.getState().followPausedByInteraction).toBe(true);
    expect(camera.position.equals(before)).toBe(true);

    // 20s total elapsed — pause clears and the lerp moves the camera.
    advanceTime(1_000);
    runFrame();
    expect(useCameraStore.getState().followPausedByInteraction).toBe(false);
    expect(useCameraStore.getState().gpsFollowMode).toBe(true);
    expect(camera.position.equals(before)).toBe(false);
    unmount();
  });

  it("a new interaction mid-countdown resets the inactivity timer", () => {
    const { unmount } = mountHook();
    startFollowing();

    act(() => {
      useCameraStore.getState().pauseFollowForInteraction();
    });

    // 15s in, user interacts again → timer restarts.
    advanceTime(15_000);
    act(() => {
      useCameraStore.getState().pauseFollowForInteraction();
    });

    // 15s after the second interaction (30s after the first) — still paused.
    advanceTime(15_000);
    runFrame();
    expect(useCameraStore.getState().followPausedByInteraction).toBe(true);

    // 20s after the second interaction — resumes.
    advanceTime(5_000);
    runFrame();
    expect(useCameraStore.getState().followPausedByInteraction).toBe(false);
    unmount();
  });

  it("honours a changed followResumeDelaySec setting", () => {
    const { unmount } = mountHook();
    startFollowing();

    act(() => {
      useSettingsStore.setState({ followResumeDelaySec: 5 });
      useCameraStore.getState().pauseFollowForInteraction();
    });

    advanceTime(4_000);
    runFrame();
    expect(useCameraStore.getState().followPausedByInteraction).toBe(true);

    advanceTime(1_000);
    runFrame();
    expect(useCameraStore.getState().followPausedByInteraction).toBe(false);
    unmount();
  });

  it("explicit toggle-off clears the pause and does not auto-resume", () => {
    const { unmount } = mountHook();
    startFollowing();

    act(() => {
      useCameraStore.getState().pauseFollowForInteraction();
      useCameraStore.getState().setGpsFollowMode(false);
    });

    expect(useCameraStore.getState().followPausedByInteraction).toBe(false);
    expect(useCameraStore.getState().followLastInteractionAt).toBe(0);

    // Even after the delay elapses, follow stays off.
    advanceTime(60_000);
    const before = camera.position.clone();
    runFrame();
    expect(useCameraStore.getState().gpsFollowMode).toBe(false);
    expect(camera.position.equals(before)).toBe(true);
    unmount();
  });

  it("GPS loss while paused fully disables follow mode (no auto-resume)", () => {
    const { unmount } = mountHook();
    startFollowing();

    act(() => {
      useCameraStore.getState().pauseFollowForInteraction();
      useGpsStore.setState({ active: false, position: null });
    });

    runFrame();
    expect(useCameraStore.getState().gpsFollowMode).toBe(false);
    expect(useCameraStore.getState().followPausedByInteraction).toBe(false);
    unmount();
  });

  it("out-of-bounds while paused fully disables follow mode (no auto-resume)", () => {
    const { unmount } = mountHook();
    startFollowing();

    act(() => {
      useCameraStore.getState().pauseFollowForInteraction();
      useGpsStore.setState({ active: true, position: POS_OUT });
    });

    runFrame();
    expect(useCameraStore.getState().gpsFollowMode).toBe(false);
    expect(useCameraStore.getState().followPausedByInteraction).toBe(false);
    expect(handoffSpy).toHaveBeenCalledWith(
      POS_OUT.longitude,
      POS_OUT.latitude,
    );

    // Delay elapsing later must not re-enable follow mode.
    advanceTime(60_000);
    runFrame();
    expect(useCameraStore.getState().gpsFollowMode).toBe(false);
    unmount();
  });

  it("pauseFollowForInteraction is a no-op when follow mode is off", () => {
    const { unmount } = mountHook();

    act(() => {
      useCameraStore.getState().pauseFollowForInteraction();
    });

    expect(useCameraStore.getState().followPausedByInteraction).toBe(false);
    unmount();
  });
});
