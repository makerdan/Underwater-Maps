/**
 * Unit tests for lib/liveMode.ts — Live sidebar-mode orchestration.
 *
 * Covers:
 * - Entering Live starts the GPS watch AND auto-starts trail recording at
 *   the user's configured sampling interval.
 * - Re-entering Live with points from a paused session resumes (preserves
 *   points) instead of starting a fresh recording.
 * - Follow Me is enabled only after the first GPS fix arrives.
 * - Follow Me is enabled immediately when GPS is already active.
 * - GPS errors surface a toast and never enable follow.
 * - Exiting Live disables follow and pauses a Live-started recording while
 *   preserving its points.
 * - A recording the user started BEFORE entering Live survives Live exit.
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
  useLiveModeStore,
  getLocationHelpUrl,
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
  useGpsStore.setState({ active: false, position: null, error: null, errorCode: null, watchId: null });
  const trail = useTrailStore.getState();
  if (trail.recording) trail.stopRecording();
  useTrailStore.getState().clearPoints();
  useCameraStore.setState({ gpsFollowState: "off" });
  useSettingsStore.setState({ gpsRecordingInterval: 1000, autoStartTrailRecording: true });
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

  it("auto-starts trail recording at the configured interval", () => {
    useSettingsStore.setState({ gpsRecordingInterval: 5000 });
    enterLiveMode();
    expect(useTrailStore.getState().recording).toBe(true);
  });

  it("resumes (preserves points) when a paused session has points", () => {
    // Simulate a previously paused session with one point.
    useTrailStore.getState().startRecording(1000);
    useTrailStore.getState().addPoint({
      longitude: 142, latitude: 11, accuracy: 5, timestamp: Date.now(),
    });
    useTrailStore.getState().stopRecording();
    const count = useTrailStore.getState().currentPoints.length;
    expect(count).toBeGreaterThan(0);

    enterLiveMode();
    expect(useTrailStore.getState().recording).toBe(true);
    expect(useTrailStore.getState().currentPoints.length).toBeGreaterThanOrEqual(count);
  });

  it("does not restart a recording session that is already running", () => {
    useTrailStore.getState().startRecording(1000);
    useTrailStore.getState().addPoint({
      longitude: 142, latitude: 11, accuracy: 5, timestamp: Date.now(),
    });
    const count = useTrailStore.getState().currentPoints.length;
    enterLiveMode();
    expect(useTrailStore.getState().recording).toBe(true);
    expect(useTrailStore.getState().currentPoints.length).toBeGreaterThanOrEqual(count);
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

  it("permission-denied toast includes a 'How to enable' action element", () => {
    enterLiveMode();
    errorCb?.({ code: 1 });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "GPS unavailable",
        action: expect.objectContaining({ type: expect.anything() }),
      }),
    );
  });

  it("permission-denied toast description tells the user to enable location in browser settings", () => {
    enterLiveMode();
    errorCb?.({ code: 1 });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("browser settings"),
      }),
    );
  });

  it("non-permission-denied errors (code 2) do NOT include an action element", () => {
    enterLiveMode();
    errorCb?.({ code: 2 });
    expect(toast).toHaveBeenCalledWith(
      expect.not.objectContaining({ action: expect.anything() }),
    );
  });
});

describe("getLocationHelpUrl — browser detection", () => {
  function withUserAgent(ua: string, fn: () => void) {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "userAgent");
    Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
    try {
      fn();
    } finally {
      if (descriptor) {
        Object.defineProperty(navigator, "userAgent", descriptor);
      }
    }
  }

  it("returns Firefox help URL when user agent contains 'Firefox/'", () => {
    withUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
      () => {
        expect(getLocationHelpUrl()).toContain("mozilla.org");
      },
    );
  });

  it("returns Safari help URL when user agent contains 'Safari/' but not 'Chrome/'", () => {
    withUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      () => {
        expect(getLocationHelpUrl()).toContain("apple.com");
      },
    );
  });

  it("returns Chrome help URL for Chrome user agents", () => {
    withUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      () => {
        expect(getLocationHelpUrl()).toContain("google.com");
      },
    );
  });

  it("returns Chrome help URL as fallback for unrecognised browsers", () => {
    withUserAgent("SomeFutureBot/1.0", () => {
      expect(getLocationHelpUrl()).toContain("google.com");
    });
  });
});

describe("liveMode — GPS auto-retry on error", () => {
  it("schedules a GPS restart 5 s after an error fires in Live mode", () => {
    vi.useFakeTimers();
    try {
      enterLiveMode();
      // watchPosition has been called once to start the watch.
      expect(watchPosition).toHaveBeenCalledTimes(1);

      // Simulate the GPS error: gpsStore clears watchId and sets error.
      useGpsStore.setState({ active: false, error: "GPS timed out. Move to an area with better signal.", errorCode: 3, watchId: null, position: null });

      // Before the delay elapses, no retry yet.
      vi.advanceTimersByTime(4_999);
      expect(watchPosition).toHaveBeenCalledTimes(1);

      // After 5 s the retry fires and starts a new watch.
      vi.advanceTimersByTime(1);
      expect(watchPosition).toHaveBeenCalledTimes(2);
      expect(useGpsStore.getState().watchId).toBe(42);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry when Live mode was exited before the delay elapses", () => {
    vi.useFakeTimers();
    try {
      enterLiveMode();
      useGpsStore.setState({ active: false, error: "GPS position unavailable. Check that location services are enabled.", errorCode: 2, watchId: null, position: null });

      // Exit Live mode — retry timer must be cancelled.
      exitLiveMode();

      vi.advanceTimersByTime(10_000);
      // Only the initial watchPosition call; no retry.
      expect(watchPosition).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps retries at 3 and stops scheduling after the limit", () => {
    vi.useFakeTimers();
    try {
      enterLiveMode();
      expect(watchPosition).toHaveBeenCalledTimes(1);

      // Fire 4 consecutive errors and advance the timer after each.
      for (let i = 0; i < 4; i++) {
        // Each retry starts a new watch — the error handler fires again.
        useGpsStore.setState({ active: false, error: "GPS timed out. Move to an area with better signal.", errorCode: 3, watchId: null, position: null });
        vi.advanceTimersByTime(5_000);
      }

      // Only 3 retries on top of the initial call = 4 total watchPosition calls.
      expect(watchPosition).toHaveBeenCalledTimes(4);

      // A 5th error should not schedule another retry.
      useGpsStore.setState({ active: false, error: "GPS timed out. Move to an area with better signal.", errorCode: 3, watchId: null, position: null });
      vi.advanceTimersByTime(5_000);
      expect(watchPosition).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT schedule a retry when the error is PERMISSION_DENIED (code 1)", () => {
    vi.useFakeTimers();
    try {
      enterLiveMode();
      expect(watchPosition).toHaveBeenCalledTimes(1);

      // Simulate a permission-denied error (permanent failure).
      useGpsStore.setState({
        active: false,
        error: "GPS permission denied. Please enable location access in your browser settings.",
        errorCode: 1,
        watchId: null,
        position: null,
      });

      // Advance well past the retry delay — no retry must be scheduled.
      vi.advanceTimersByTime(15_000);
      expect(watchPosition).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets the retry counter after a successful GPS fix", () => {
    vi.useFakeTimers();
    try {
      enterLiveMode();

      // Use up 3 retries.
      for (let i = 0; i < 3; i++) {
        useGpsStore.setState({ active: false, error: "GPS timed out. Move to an area with better signal.", errorCode: 3, watchId: null, position: null });
        vi.advanceTimersByTime(5_000);
      }
      // 3 retries on top of initial = 4 total.
      expect(watchPosition).toHaveBeenCalledTimes(4);

      // Now a successful fix arrives.
      fireFix();
      expect(useGpsStore.getState().active).toBe(true);

      // Another error fires — the counter was reset, so a new retry is allowed.
      useGpsStore.setState({ active: false, error: "GPS timed out. Move to an area with better signal.", errorCode: 3, watchId: null, position: null });
      vi.advanceTimersByTime(5_000);
      expect(watchPosition).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
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

  it("pauses a Live-started recording on exit, preserving points", () => {
    enterLiveMode();
    expect(useTrailStore.getState().recording).toBe(true);
    useTrailStore.getState().addPoint({
      longitude: 142, latitude: 11, accuracy: 5, timestamp: Date.now(),
    });
    const count = useTrailStore.getState().currentPoints.length;
    expect(count).toBeGreaterThan(0);

    exitLiveMode();
    expect(useTrailStore.getState().recording).toBe(false);
    expect(useTrailStore.getState().currentPoints.length).toBe(count);
  });

  it("re-entering Live resumes the paused session without losing points", () => {
    enterLiveMode();
    useTrailStore.getState().addPoint({
      longitude: 142, latitude: 11, accuracy: 5, timestamp: Date.now(),
    });
    const count = useTrailStore.getState().currentPoints.length;

    exitLiveMode();
    expect(useTrailStore.getState().recording).toBe(false);

    enterLiveMode();
    expect(useTrailStore.getState().recording).toBe(true);
    expect(useTrailStore.getState().currentPoints.length).toBeGreaterThanOrEqual(count);
  });

  it("does NOT stop a user-started recording session on exit", () => {
    useTrailStore.getState().startRecording(1000);
    expect(useTrailStore.getState().recording).toBe(true);
    enterLiveMode();
    exitLiveMode();
    expect(useTrailStore.getState().recording).toBe(true);
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

describe("liveMode — autoStartTrailRecording=false", () => {
  it("does NOT start trail recording when auto-start is disabled", () => {
    useSettingsStore.setState({ autoStartTrailRecording: false });
    enterLiveMode();
    expect(useTrailStore.getState().recording).toBe(false);
  });

  it("still starts the GPS watch even when auto-start is disabled", () => {
    useSettingsStore.setState({ autoStartTrailRecording: false });
    enterLiveMode();
    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(useGpsStore.getState().watchId).toBe(42);
  });

  it("still enables Follow Me when GPS arrives and auto-start is disabled", () => {
    useSettingsStore.setState({ autoStartTrailRecording: false });
    enterLiveMode();
    fireFix();
    expect(useCameraStore.getState().gpsFollowState).not.toBe("off");
  });

  it("exiting Live does not pause a non-existent Live-started recording", () => {
    useSettingsStore.setState({ autoStartTrailRecording: false });
    enterLiveMode();
    expect(useTrailStore.getState().recording).toBe(false);
    exitLiveMode();
    expect(useTrailStore.getState().recording).toBe(false);
  });

  it("a recording the user starts manually in Live mode survives Live exit when auto-start is off", () => {
    useSettingsStore.setState({ autoStartTrailRecording: false });
    enterLiveMode();
    useTrailStore.getState().startRecording(1000);
    expect(useTrailStore.getState().recording).toBe(true);
    exitLiveMode();
    // Live did not start the recording, so it must not stop it
    expect(useTrailStore.getState().recording).toBe(true);
  });
});

describe("liveMode — autoStartTrailRecording=true", () => {
  it("starts trail recording when auto-start is enabled", () => {
    useSettingsStore.setState({ autoStartTrailRecording: true });
    enterLiveMode();
    expect(useTrailStore.getState().recording).toBe(true);
  });

  it("pauses a Live-started recording on exit when auto-start is enabled", () => {
    useSettingsStore.setState({ autoStartTrailRecording: true });
    enterLiveMode();
    expect(useTrailStore.getState().recording).toBe(true);
    exitLiveMode();
    expect(useTrailStore.getState().recording).toBe(false);
  });
});

describe("liveMode — GPS retry HUD store", () => {
  it("gpsRetryAttempt is 0 before any error", () => {
    enterLiveMode();
    expect(useLiveModeStore.getState().gpsRetryAttempt).toBe(0);
  });

  it("increments gpsRetryAttempt to 1 after the first GPS error", () => {
    enterLiveMode();
    useGpsStore.setState({ active: false, error: "GPS timed out. Move to an area with better signal.", watchId: null, position: null });
    expect(useLiveModeStore.getState().gpsRetryAttempt).toBe(1);
  });

  it("increments gpsRetryAttempt on each successive error up to the cap", () => {
    vi.useFakeTimers();
    try {
      enterLiveMode();

      for (let i = 1; i <= 3; i++) {
        useGpsStore.setState({ active: false, error: "GPS timed out. Move to an area with better signal.", watchId: null, position: null });
        expect(useLiveModeStore.getState().gpsRetryAttempt).toBe(i);
        vi.advanceTimersByTime(5_000);
      }

      // A 4th error is beyond the cap — attempt count must stay at 3.
      useGpsStore.setState({ active: false, error: "GPS timed out. Move to an area with better signal.", watchId: null, position: null });
      expect(useLiveModeStore.getState().gpsRetryAttempt).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears gpsRetryAttempt to 0 after a successful GPS fix", () => {
    enterLiveMode();
    useGpsStore.setState({ active: false, error: "GPS timed out. Move to an area with better signal.", watchId: null, position: null });
    expect(useLiveModeStore.getState().gpsRetryAttempt).toBe(1);

    // After the error the old watchId is cleared, so fireFix() (which calls the
    // original watchPosition success callback) hits the stale-watchId guard and
    // is a no-op. Simulate a successful reconnect by writing GPS state directly —
    // the liveMode subscription observes the active: false → true transition and
    // must clear the retry counter.
    useGpsStore.setState({
      active: true,
      error: null,
      watchId: 42,
      position: { longitude: 142.1951, latitude: 11.3733, accuracy: 8, timestamp: 0, speed: null, heading: null },
    });
    expect(useGpsStore.getState().active).toBe(true);
    expect(useLiveModeStore.getState().gpsRetryAttempt).toBe(0);
  });

  it("clears gpsRetryAttempt to 0 when Live mode is exited", () => {
    enterLiveMode();
    useGpsStore.setState({ active: false, error: "GPS timed out. Move to an area with better signal.", watchId: null, position: null });
    expect(useLiveModeStore.getState().gpsRetryAttempt).toBe(1);

    exitLiveMode();
    expect(useLiveModeStore.getState().gpsRetryAttempt).toBe(0);
  });

  it("gpsMaxRetries matches MAX_GPS_RETRIES (3)", () => {
    expect(useLiveModeStore.getState().gpsMaxRetries).toBe(3);
  });
});

describe("liveMode — onSidebarModeChange routing", () => {
  it("explore → live enters live mode", () => {
    onSidebarModeChange("explore", "live");
    expect(isLiveModeActive()).toBe(true);
    expect(useTrailStore.getState().recording).toBe(true);
  });

  it("live → explore exits live mode", () => {
    onSidebarModeChange("explore", "live");
    onSidebarModeChange("live", "explore");
    expect(isLiveModeActive()).toBe(false);
    expect(useTrailStore.getState().recording).toBe(false);
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
