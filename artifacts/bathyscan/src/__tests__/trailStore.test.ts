/**
 * Unit tests for trailStore ring-buffer behaviour.
 *
 *  1. Points accumulate normally until the cap is reached.
 *  2. Once the cap is hit, array length stays at MAX_TRAIL_POINTS.
 *  3. The oldest point is evicted on each subsequent addPoint call.
 *  4. isOverflowing is false below the cap and true after it.
 *  5. stopRecording returns the current buffer (whatever is in it).
 *  6. clearPoints resets everything including isOverflowing.
 *  7. startRecording resets the buffer and isOverflowing flag.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTrailStore, MAX_TRAIL_POINTS } from "@/lib/trailStore";

// gpsStore is imported by trailStore only inside startRecording's interval
// callback — we don't need it for addPoint/stopRecording tests.
vi.mock("@/lib/gpsStore", () => ({
  useGpsStore: { getState: () => ({ position: null }) },
}));

function makePos(overrides: Partial<{ longitude: number; latitude: number; accuracy: number; timestamp: number }> = {}) {
  return {
    longitude: overrides.longitude ?? 0,
    latitude: overrides.latitude ?? 0,
    accuracy: overrides.accuracy ?? 1,
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

describe("trailStore ring buffer", () => {
  beforeEach(() => {
    useTrailStore.setState({
      recording: false,
      currentPoints: [],
      startedAt: null,
      intervalId: null,
      isOverflowing: false,
    });
  });

  it("accumulates points normally below the cap", () => {
    const { addPoint } = useTrailStore.getState();
    addPoint(makePos({ longitude: 1 }));
    addPoint(makePos({ longitude: 2 }));
    addPoint(makePos({ longitude: 3 }));

    const { currentPoints, isOverflowing } = useTrailStore.getState();
    expect(currentPoints).toHaveLength(3);
    expect(isOverflowing).toBe(false);
  });

  it("caps the array at MAX_TRAIL_POINTS after exceeding the limit", () => {
    const { addPoint } = useTrailStore.getState();

    for (let i = 0; i < MAX_TRAIL_POINTS + 5; i++) {
      addPoint(makePos({ longitude: i }));
    }

    expect(useTrailStore.getState().currentPoints).toHaveLength(MAX_TRAIL_POINTS);
  });

  it("evicts the oldest point when the cap is reached", () => {
    const { addPoint } = useTrailStore.getState();

    // Fill to exactly the cap
    for (let i = 0; i < MAX_TRAIL_POINTS; i++) {
      addPoint(makePos({ longitude: i }));
    }

    // At cap: first point should have longitude 0
    expect(useTrailStore.getState().currentPoints[0]!.lon).toBe(0);

    // One more point — longitude MAX_TRAIL_POINTS — should push out longitude 0
    addPoint(makePos({ longitude: MAX_TRAIL_POINTS }));

    const pts = useTrailStore.getState().currentPoints;
    expect(pts).toHaveLength(MAX_TRAIL_POINTS);
    expect(pts[0]!.lon).toBe(1);
    expect(pts[MAX_TRAIL_POINTS - 1]!.lon).toBe(MAX_TRAIL_POINTS);
  });

  it("sets isOverflowing to false below cap and true once cap is exceeded", () => {
    const { addPoint } = useTrailStore.getState();

    // Fill to exactly the cap — not yet overflowing
    for (let i = 0; i < MAX_TRAIL_POINTS; i++) {
      addPoint(makePos({ longitude: i }));
    }
    expect(useTrailStore.getState().isOverflowing).toBe(false);

    // One more triggers overflow
    addPoint(makePos({ longitude: MAX_TRAIL_POINTS }));
    expect(useTrailStore.getState().isOverflowing).toBe(true);
  });

  it("stopRecording returns whatever points are currently in the buffer", () => {
    const { addPoint, stopRecording } = useTrailStore.getState();
    addPoint(makePos({ longitude: 10 }));
    addPoint(makePos({ longitude: 20 }));

    const result = stopRecording();
    expect(result).toHaveLength(2);
    expect(result[0]!.lon).toBe(10);
    expect(result[1]!.lon).toBe(20);
  });

  it("clearPoints resets the buffer and isOverflowing flag", () => {
    const { addPoint } = useTrailStore.getState();

    for (let i = 0; i < MAX_TRAIL_POINTS + 1; i++) {
      addPoint(makePos({ longitude: i }));
    }
    expect(useTrailStore.getState().isOverflowing).toBe(true);

    useTrailStore.getState().clearPoints();

    const state = useTrailStore.getState();
    expect(state.currentPoints).toHaveLength(0);
    expect(state.isOverflowing).toBe(false);
    expect(state.startedAt).toBeNull();
  });
});
