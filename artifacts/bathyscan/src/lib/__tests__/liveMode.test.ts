/**
 * Unit tests for lib/liveMode.ts — Live sidebar-mode orchestration.
 *
 * Covers:
 * - Entering Live starts the GPS watch but does NOT auto-start trail recording.
 * - Follow Me is enabled only after the first GPS fix arrives.
 * - Follow Me is enabled immediately when GPS is already active.
 * - GPS errors surface a toast and never enable follow.
 * - Exiting Live disables follow but does NOT touch an in-progress trail.
 * - Leaving and re-entering Live has no effect on user-controlled recording.
 * - onSidebarModeChange only orchestrates on live transitions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

import { toast } from "@/hooks/use-toast";
import {
  enterLiveMode,
  exitLiveMode,
  onSidebarModeChange,
  isLiveModeActive,
  __resetLiveModeForTests,
} from "../liveMode";
import { useGpsStore } from "../gpsStore";
import { useTrailStore } from "../trailStore";
import { useCameraStore } from "../cameraStore";
import { useSettingsStore } from "../settingsStore";

/** Captured watchPosition callbacks so tests can simulate fixes/errors. */
let successCb: ((pos: unknown) => void) | null = null;
let errorCb: ((err: { code: number }) => void) | null = null;
const watchPosition = vi.fn((onOk: typeof successCb, onErr: typeof errorCb) => {
  successCb = onOk;
  errorCb = onErr as typeof errorCb;
  return 42;
});
const clearWatch = vi.fn();

function fireFix(lon = 142.1951, lat = 11.3733, accuracy = 8): void {
  successCb?.({
    coords: { longitude: lon, latitude: lat, accuracy },
    timestamp: Date.now(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  successCb = null;
  errorCb = null;
  Object.defineProperty(globalThis.navigator, "geolocation", {
    value: { watchPosition, clearWatch },
    configurable: true,
  });
  __resetLiveModeForTests();
  useGpsStore.setState({ active: false, position: null, error: null, watchId: null });
  const trail = useTrailStore.getState();
  if (trail.recording) trail.stopRecording();
  useTrailStore.getState().clearPoints();
  useCameraStore.setState({ gpsFollowState: "off" });
  useSettingsStore.setState({ gpsRecordingInterval: 1000 });
});

afterEach(() => {
  __resetLiveModeForTests();
  const trail = useTrailStore.getState();
  if (trail.recording) trail.stopRecording();
});

describe("liveMode — entering", () => {
  it("starts the GPS watch", () => {
    enterLiveMode();
    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(useGpsStore.getState().watchId).toBe(42);
    expect(isLiveModeActive()).toBe(true);
  });

  it("does NOT auto-start trail recording", () => {
    useSettingsStore.setState({ gpsRecordingInterval: 5000 });
    enterLiveMode();
    expect(useTrailStore.getState().recording).toBe(false);
  });

  it("does NOT enable follow mode before the first GPS fix", () => {
    enterLiveMode();
    expect(useCameraStore.getState().gpsFollowState).toBe("off");
  });

  it("enables follow mode when the first GPS fix arrives", () => {
    enterLiveMode();
    fireFix();
    expect(useGpsStore.getState().active).toBe(true);
    expect(useCameraStore.getState().gpsFollowState).not.toBe("off");
  });

  it("enables follow mode immediately when GPS is already active", () => {
    useGpsStore.setState({
      active: true,
      watchId: 7,
      position: { longitude: 142, latitude: 11, accuracy: 5, timestamp: Date.now() },
    });
    enterLiveMode();
    expect(useCameraStore.getState().gpsFollowState).not.toBe("off");
  });

  it("is idempotent — a second enter does not restart the watch", () => {
    enterLiveMode();
    enterLiveMode();
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });
});

describe("liveMode — GPS errors", () => {
  it("surfaces a toast when the GPS watch errors", () => {
    enterLiveMode();
    errorCb?.({ code: 1 });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "GPS unavailable" }),
    );
    expect(useCameraStore.getState().gpsFollowState).toBe("off");
  });

  it("surfaces a toast when geolocation is unsupported", () => {
    Object.defineProperty(globalThis.navigator, "geolocation", {
      value: undefined,
      configurable: true,
    });
    enterLiveMode();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "GPS unavailable" }),
    );
  });
});

describe("liveMode — exiting", () => {
  it("disables follow mode", () => {
    enterLiveMode();
    fireFix();
    expect(useCameraStore.getState().gpsFollowState).not.toBe("off");
    exitLiveMode();
    expect(useCameraStore.getState().gpsFollowState).toBe("off");
    expect(isLiveModeActive()).toBe(false);
  });

  it("does NOT stop a user-started recording session on exit", () => {
    useTrailStore.getState().startRecording(1000);
    expect(useTrailStore.getState().recording).toBe(true);
    enterLiveMode();
    exitLiveMode();
    expect(useTrailStore.getState().recording).toBe(true);
  });

  it("preserves recorded trail points after live-mode exit", () => {
    useTrailStore.getState().startRecording(1000);
    fireFix();
    useTrailStore.getState().addPoint(useGpsStore.getState().position ?? {
      longitude: 142, latitude: 11, accuracy: 5, timestamp: Date.now(),
    });
    const count = useTrailStore.getState().currentPoints.length;
    expect(count).toBeGreaterThan(0);

    enterLiveMode();
    exitLiveMode();
    expect(useTrailStore.getState().currentPoints.length).toBe(count);
  });

  it("user-started recording survives leaving and re-entering Live", () => {
    useTrailStore.getState().startRecording(1000);
    fireFix();
    useTrailStore.getState().addPoint(useGpsStore.getState().position ?? {
      longitude: 142, latitude: 11, accuracy: 5, timestamp: Date.now(),
    });
    const count = useTrailStore.getState().currentPoints.length;
    expect(count).toBeGreaterThan(0);

    enterLiveMode();
    exitLiveMode();
    expect(useTrailStore.getState().recording).toBe(true);
    expect(useTrailStore.getState().currentPoints.length).toBe(count);

    enterLiveMode();
    expect(useTrailStore.getState().recording).toBe(true);
    expect(useTrailStore.getState().currentPoints.length).toBeGreaterThanOrEqual(count);
  });

  it("keeps the GPS watch running after exit", () => {
    enterLiveMode();
    exitLiveMode();
    expect(clearWatch).not.toHaveBeenCalled();
    expect(useGpsStore.getState().watchId).toBe(42);
  });

  it("a GPS fix arriving after exit does not re-enable follow", () => {
    enterLiveMode();
    exitLiveMode();
    fireFix();
    expect(useCameraStore.getState().gpsFollowState).toBe("off");
  });
});

describe("trailStore — setSamplingInterval", () => {
  it("is a no-op when not recording", () => {
    useTrailStore.getState().setSamplingInterval(5000);
    expect(useTrailStore.getState().recording).toBe(false);
    expect(useTrailStore.getState().intervalId).toBeNull();
  });

  it("retimes an active recording session in place", () => {
    vi.useFakeTimers();
    try {
      enterLiveMode();
      fireFix();
      // User explicitly starts recording (no auto-start any more).
      useTrailStore.getState().startRecording(1000);
      const before = useTrailStore.getState().currentPoints.length;

      // Switch to a 5 s interval and advance the clock: samples arrive at
      // the new cadence.
      useTrailStore.getState().setSamplingInterval(5000);
      vi.advanceTimersByTime(5000);
      expect(useTrailStore.getState().currentPoints.length).toBe(before + 1);
      expect(useTrailStore.getState().recording).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("liveMode — onSidebarModeChange routing", () => {
  it("explore → live enters live mode", () => {
    onSidebarModeChange("explore", "live");
    expect(isLiveModeActive()).toBe(true);
  });

  it("live → explore exits live mode", () => {
    onSidebarModeChange("explore", "live");
    onSidebarModeChange("live", "explore");
    expect(isLiveModeActive()).toBe(false);
  });

  it("non-live transitions do nothing", () => {
    onSidebarModeChange("explore", "plan");
    onSidebarModeChange("plan", "analyze");
    expect(isLiveModeActive()).toBe(false);
    expect(watchPosition).not.toHaveBeenCalled();
    expect(useTrailStore.getState().recording).toBe(false);
  });

  it("live → live does not re-enter", () => {
    onSidebarModeChange("explore", "live");
    onSidebarModeChange("live", "live");
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });
});
