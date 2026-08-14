/**
 * Unit tests for gpsStore bug-fixes:
 *
 *  1. Error callback clears watchId → startWatching() can create a fresh watch.
 *  2. Error callback clears position → stale coords are not visible post-error.
 *  3. Trail sampler respects gps.active → no point appended while GPS is off.
 *  4. Incoming fixes with invalid coordinates are silently discarded.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useGpsStore } from "../gpsStore";
import { useTrailStore } from "../trailStore";

// ---------------------------------------------------------------------------
// Geolocation mock
// ---------------------------------------------------------------------------
let successCb: ((pos: unknown) => void) | null = null;
let errorCb: ((err: { code: number }) => void) | null = null;
let watchIdCounter = 100;

const watchPosition = vi.fn((onOk: typeof successCb, onErr: typeof errorCb) => {
  successCb = onOk;
  errorCb = onErr as typeof errorCb;
  return ++watchIdCounter;
});
const clearWatch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  successCb = null;
  errorCb = null;
  watchIdCounter = 100;
  Object.defineProperty(globalThis.navigator, "geolocation", {
    value: { watchPosition, clearWatch },
    configurable: true,
  });
  // Reset both stores to a known baseline.
  useGpsStore.setState({ active: false, position: null, error: null, watchId: null });
  useTrailStore.setState({
    recording: false,
    currentPoints: [],
    startedAt: null,
    intervalId: null,
    beforeUnloadCleanup: null,
    isOverflowing: false,
  });
});

// ---------------------------------------------------------------------------
// 1 & 2. Error callback: watchId and position cleared
// ---------------------------------------------------------------------------
describe("gpsStore — error callback resets watchId and position", () => {
  it("clears watchId to null so startWatching can restart the watch", () => {
    useGpsStore.getState().startWatching();
    const firstId = useGpsStore.getState().watchId;
    expect(firstId).not.toBeNull();

    // Fire the geolocation error.
    errorCb?.({ code: 1 });

    // watchId must be null so the guard in startWatching() does not block.
    expect(useGpsStore.getState().watchId).toBeNull();
    expect(useGpsStore.getState().active).toBe(false);

    // startWatching must now succeed and register a brand-new watch.
    useGpsStore.getState().startWatching();
    const secondId = useGpsStore.getState().watchId;
    expect(secondId).not.toBeNull();
    expect(secondId).not.toBe(firstId);
    expect(watchPosition).toHaveBeenCalledTimes(2);
  });

  it("calls clearWatch on the active watchId when the error fires", () => {
    useGpsStore.getState().startWatching();
    const activeId = useGpsStore.getState().watchId;
    errorCb?.({ code: 2 });
    expect(clearWatch).toHaveBeenCalledWith(activeId);
  });

  it("clears position to null so stale coordinates are not readable", () => {
    useGpsStore.getState().startWatching();
    // Simulate a valid fix first.
    successCb?.({
      coords: { latitude: 45.0, longitude: -93.0, accuracy: 10, speed: null, heading: null },
      timestamp: Date.now(),
    });
    expect(useGpsStore.getState().position).not.toBeNull();

    // Now fire an error.
    errorCb?.({ code: 3 });
    expect(useGpsStore.getState().position).toBeNull();
    expect(useGpsStore.getState().active).toBe(false);
  });

  it("sets the appropriate error message for each error code", () => {
    for (const code of [1, 2, 3] as const) {
      useGpsStore.setState({ watchId: null });
      useGpsStore.getState().startWatching();
      errorCb?.({ code });
      expect(useGpsStore.getState().error).toBeTypeOf("string");
      expect(useGpsStore.getState().error!.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Trail sampler skips when GPS active=false
// ---------------------------------------------------------------------------
describe("trailStore sampler — skips appending when GPS is inactive", () => {
  it("does not add a point when active=false, even if position is set", () => {
    // Manually set a stale position but active=false (simulating post-error state).
    useGpsStore.setState({
      active: false,
      position: { longitude: -93.0, latitude: 45.0, accuracy: 5, timestamp: Date.now(), speed: null, heading: null },
    });

    // Put the trail into recording state, then call the sampler via
    // startRecording + immediate sample (the store calls sample() once at
    // start). We check that nothing was appended despite position being set.
    vi.useFakeTimers();
    try {
      useTrailStore.getState().startRecording(10_000);
      // The immediate sample runs synchronously inside startRecording.
      expect(useTrailStore.getState().currentPoints).toHaveLength(0);

      // Advance clock so the interval fires too — still nothing should appear.
      vi.advanceTimersByTime(10_000);
      expect(useTrailStore.getState().currentPoints).toHaveLength(0);
    } finally {
      useTrailStore.getState().stopRecording();
      vi.useRealTimers();
    }
  });

  it("resumes appending once GPS becomes active again", () => {
    vi.useFakeTimers();
    try {
      // Start with active GPS.
      useGpsStore.setState({
        active: true,
        position: { longitude: -93.0, latitude: 45.0, accuracy: 5, timestamp: Date.now(), speed: null, heading: null },
      });
      useTrailStore.getState().startRecording(5_000);
      // Immediate sample should have added one point.
      expect(useTrailStore.getState().currentPoints).toHaveLength(1);

      // GPS goes offline.
      useGpsStore.setState({ active: false, position: null });
      vi.advanceTimersByTime(5_000);
      // No new point — GPS was inactive.
      expect(useTrailStore.getState().currentPoints).toHaveLength(1);

      // GPS comes back.
      useGpsStore.setState({
        active: true,
        position: { longitude: -93.1, latitude: 45.1, accuracy: 8, timestamp: Date.now(), speed: null, heading: null },
      });
      vi.advanceTimersByTime(5_000);
      // One new point added.
      expect(useTrailStore.getState().currentPoints).toHaveLength(2);
    } finally {
      useTrailStore.getState().stopRecording();
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// 3b. Watch-ownership race: delayed error from a superseded watch must not
//     clear the new watch's state.
// ---------------------------------------------------------------------------
describe("gpsStore — watch identity guard (stale error callback)", () => {
  it("ignores an error callback from a superseded watch after a new watch starts", () => {
    // Start first watch — capture its error callback.
    useGpsStore.getState().startWatching();
    const firstErrorCb = errorCb;
    const firstWatchId = useGpsStore.getState().watchId;
    expect(firstWatchId).not.toBeNull();

    // Simulate a GPS error clearing watchId.
    firstErrorCb?.({ code: 1 });
    expect(useGpsStore.getState().watchId).toBeNull();

    // User retries: start a second watch.
    useGpsStore.getState().startWatching();
    const secondWatchId = useGpsStore.getState().watchId;
    expect(secondWatchId).not.toBeNull();
    expect(secondWatchId).not.toBe(firstWatchId);

    // A delayed error callback from the OLD (first) watch arrives now.
    // It must NOT clear the second watch's state.
    firstErrorCb?.({ code: 2 });

    // State of the new watch must be untouched.
    expect(useGpsStore.getState().watchId).toBe(secondWatchId);
    expect(useGpsStore.getState().active).toBe(false); // still waiting for a fix on the new watch
  });

  it("ignores a success callback from a superseded watch", () => {
    useGpsStore.getState().startWatching();
    const firstSuccessCb = successCb;

    // Trigger an error to clear the first watch, then start a new one.
    errorCb?.({ code: 1 });
    useGpsStore.getState().startWatching();
    const secondWatchId = useGpsStore.getState().watchId;

    // A delayed success from the OLD watch must not update state.
    firstSuccessCb?.({
      coords: { latitude: 45.0, longitude: -93.0, accuracy: 10, speed: null, heading: null },
      timestamp: Date.now(),
    });

    // The new watch has not yet received a fix, so active must remain false.
    expect(useGpsStore.getState().active).toBe(false);
    expect(useGpsStore.getState().position).toBeNull();
    expect(useGpsStore.getState().watchId).toBe(secondWatchId);
  });
});

// ---------------------------------------------------------------------------
// 4. Coordinate validation
// ---------------------------------------------------------------------------
describe("gpsStore — coordinate validation discards bad fixes", () => {
  function fireFix(overrides: {
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    timestamp?: number;
  }): void {
    const defaults = { latitude: 45.0, longitude: -93.0, accuracy: 10, speed: null, heading: null };
    successCb?.({
      coords: { ...defaults, ...overrides },
      timestamp: overrides.timestamp ?? Date.now(),
    });
  }

  beforeEach(() => {
    useGpsStore.getState().startWatching();
  });

  it("accepts a normal valid fix", () => {
    fireFix({});
    expect(useGpsStore.getState().position).not.toBeNull();
    expect(useGpsStore.getState().active).toBe(true);
  });

  it("rejects NaN latitude", () => {
    fireFix({ latitude: NaN });
    expect(useGpsStore.getState().position).toBeNull();
    expect(useGpsStore.getState().active).toBe(false);
  });

  it("rejects Infinity longitude", () => {
    fireFix({ longitude: Infinity });
    expect(useGpsStore.getState().position).toBeNull();
    expect(useGpsStore.getState().active).toBe(false);
  });

  it("rejects latitude > 90", () => {
    fireFix({ latitude: 91 });
    expect(useGpsStore.getState().position).toBeNull();
    expect(useGpsStore.getState().active).toBe(false);
  });

  it("rejects latitude < -90", () => {
    fireFix({ latitude: -91 });
    expect(useGpsStore.getState().position).toBeNull();
  });

  it("rejects longitude > 180", () => {
    fireFix({ longitude: 181 });
    expect(useGpsStore.getState().position).toBeNull();
  });

  it("rejects longitude < -180", () => {
    fireFix({ longitude: -181 });
    expect(useGpsStore.getState().position).toBeNull();
  });

  it("rejects negative accuracy", () => {
    fireFix({ accuracy: -1 });
    expect(useGpsStore.getState().position).toBeNull();
  });

  it("rejects NaN timestamp", () => {
    fireFix({ timestamp: NaN });
    expect(useGpsStore.getState().position).toBeNull();
  });

  it("does not clobber a prior valid fix when a bad fix arrives", () => {
    fireFix({});
    const good = useGpsStore.getState().position;
    expect(good).not.toBeNull();

    fireFix({ latitude: NaN });
    expect(useGpsStore.getState().position).toEqual(good);
  });
});
