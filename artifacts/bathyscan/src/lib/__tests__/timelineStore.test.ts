/**
 * timelineStore — unit tests.
 *
 * Covers (matching the task spec):
 *   - setTime: basic update, below-range clamp, above-range clamp, boundary
 *     values, does-not-touch isPlaying, persists clamped not raw value
 *   - setRange: basic update, time preservation, clamp-on-range-shrink below
 *     and above, does-not-touch isPlaying
 *   - setPlaying / isPlaying: set/clear, idempotency, does-not-touch currentTime
 *   - Play-to-end (inline interval mirror, fake timers): advances per tick,
 *     multi-tick, stops + marks isPlaying=false at range.end, no advance when
 *     not playing, stops after manual setPlaying(false)
 *   - Initial state invariants: isPlaying=false, currentTime within range,
 *     non-degenerate range (end > start)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useTimelineStore } from "../timelineStore";

// ---------------------------------------------------------------------------
// Mock settingsStore — timelineStore calls useSettingsStore.setState and
// useSettingsStore.getState at module-init; the mock must satisfy both.
// ---------------------------------------------------------------------------
vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = { ...actual.DEFAULT_SETTINGS };
  const setState = vi.fn((patch: Partial<typeof storeState>) => Object.assign(storeState, patch));
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState,
      subscribe: () => () => {},
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
    },
  );
  return { ...actual, useSettingsStore };
});

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const T0  = new Date("2024-06-01T00:00:00Z"); // range start
const T12 = new Date("2024-06-01T12:00:00Z"); // midpoint
const T24 = new Date("2024-06-02T00:00:00Z"); // range end

function resetStore() {
  useTimelineStore.setState({
    currentTime: T12,
    timeRange: { start: T0, end: T24 },
    isPlaying: false,
  });
}

// ---------------------------------------------------------------------------
// setTime
// ---------------------------------------------------------------------------

describe("timelineStore — setTime", () => {
  beforeEach(resetStore);

  it("updates currentTime to the given value", () => {
    const t = new Date("2024-06-01T06:00:00Z");
    useTimelineStore.getState().setTime(t);
    expect(useTimelineStore.getState().currentTime.getTime()).toBe(t.getTime());
  });

  it("clamps to range.start when t is before the range", () => {
    const before = new Date(T0.getTime() - 3_600_000);
    useTimelineStore.getState().setTime(before);
    expect(useTimelineStore.getState().currentTime.getTime()).toBe(T0.getTime());
  });

  it("clamps to range.end when t is after the range", () => {
    const after = new Date(T24.getTime() + 3_600_000);
    useTimelineStore.getState().setTime(after);
    expect(useTimelineStore.getState().currentTime.getTime()).toBe(T24.getTime());
  });

  it("accepts range.start exactly (inclusive lower boundary)", () => {
    useTimelineStore.getState().setTime(T0);
    expect(useTimelineStore.getState().currentTime.getTime()).toBe(T0.getTime());
  });

  it("accepts range.end exactly (inclusive upper boundary)", () => {
    useTimelineStore.getState().setTime(T24);
    expect(useTimelineStore.getState().currentTime.getTime()).toBe(T24.getTime());
  });

  it("does not change isPlaying", () => {
    useTimelineStore.setState({ isPlaying: true });
    useTimelineStore.getState().setTime(T12);
    expect(useTimelineStore.getState().isPlaying).toBe(true);
  });

  it("persists the clamped value to settingsStore, not the raw out-of-range value", async () => {
    const { useSettingsStore } = await import("@/lib/settingsStore");
    (useSettingsStore.setState as ReturnType<typeof vi.fn>).mockClear();
    const after = new Date(T24.getTime() + 3_600_000);
    useTimelineStore.getState().setTime(after);
    const persisted = (useSettingsStore.setState as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(persisted?.timelineCurrentTime).toBe(T24.toISOString());
  });
});

// ---------------------------------------------------------------------------
// setRange
// ---------------------------------------------------------------------------

describe("timelineStore — setRange", () => {
  beforeEach(resetStore);

  it("updates timeRange.start and timeRange.end", () => {
    const newRange = {
      start: new Date("2024-05-01T00:00:00Z"),
      end:   new Date("2024-05-31T00:00:00Z"),
    };
    useTimelineStore.getState().setRange(newRange);
    const { timeRange } = useTimelineStore.getState();
    expect(timeRange.start.getTime()).toBe(newRange.start.getTime());
    expect(timeRange.end.getTime()).toBe(newRange.end.getTime());
  });

  it("preserves currentTime when it is inside the new range", () => {
    const t = new Date("2024-06-01T06:00:00Z"); // within T0..T24
    useTimelineStore.setState({ currentTime: t });
    useTimelineStore.getState().setRange({ start: T0, end: T24 });
    expect(useTimelineStore.getState().currentTime.getTime()).toBe(t.getTime());
  });

  it("clamps currentTime to range.start when it falls below the new range", () => {
    const newStart = new Date("2024-06-01T10:00:00Z");
    useTimelineStore.setState({ currentTime: T0 }); // T0 < newStart
    useTimelineStore.getState().setRange({ start: newStart, end: T24 });
    expect(useTimelineStore.getState().currentTime.getTime()).toBe(newStart.getTime());
  });

  it("clamps currentTime to range.end when it falls above the new range", () => {
    const newEnd = new Date("2024-06-01T06:00:00Z");
    useTimelineStore.setState({ currentTime: T24 }); // T24 > newEnd
    useTimelineStore.getState().setRange({ start: T0, end: newEnd });
    expect(useTimelineStore.getState().currentTime.getTime()).toBe(newEnd.getTime());
  });

  it("does not change isPlaying", () => {
    useTimelineStore.setState({ isPlaying: true });
    useTimelineStore.getState().setRange({ start: T0, end: T24 });
    expect(useTimelineStore.getState().isPlaying).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setPlaying
// ---------------------------------------------------------------------------

describe("timelineStore — setPlaying", () => {
  beforeEach(resetStore);

  it("sets isPlaying to true", () => {
    useTimelineStore.getState().setPlaying(true);
    expect(useTimelineStore.getState().isPlaying).toBe(true);
  });

  it("sets isPlaying to false", () => {
    useTimelineStore.setState({ isPlaying: true });
    useTimelineStore.getState().setPlaying(false);
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("is idempotent: true → true", () => {
    useTimelineStore.setState({ isPlaying: true });
    useTimelineStore.getState().setPlaying(true);
    expect(useTimelineStore.getState().isPlaying).toBe(true);
  });

  it("is idempotent: false → false", () => {
    useTimelineStore.getState().setPlaying(false);
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("does not change currentTime", () => {
    const before = useTimelineStore.getState().currentTime.getTime();
    useTimelineStore.getState().setPlaying(true);
    expect(useTimelineStore.getState().currentTime.getTime()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Play-to-end (inline interval mirror, fake timers)
//
// The real play interval lives in TimelineScrubBar; this suite mirrors the
// same logic inline so we can test pure store behaviour (setTime clamping and
// the isPlaying → false transition at range.end) without mounting a component.
// ---------------------------------------------------------------------------

/** Mirrors the TimelineScrubBar tick: advance by MS_PER_TICK, stop at end. */
const TICK_INTERVAL_MS = 100;
const MS_PER_TICK      = 6_000; // 6 s of simulated time per 100 ms wall clock

function runPlayInterval(durationWallMs: number) {
  // Returns a cleanup function (like clearInterval would)
  const id = setInterval(() => {
    const { currentTime, timeRange, isPlaying, setTime, setPlaying } =
      useTimelineStore.getState();
    if (!isPlaying) { clearInterval(id); return; }
    const next = new Date(currentTime.getTime() + MS_PER_TICK);
    if (next.getTime() >= timeRange.end.getTime()) {
      setTime(timeRange.end);
      setPlaying(false);
      clearInterval(id);
    } else {
      setTime(next);
    }
  }, TICK_INTERVAL_MS);
  vi.advanceTimersByTime(durationWallMs);
  return id;
}

describe("timelineStore — play interval (inline mirror, fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances currentTime by MS_PER_TICK on each tick", () => {
    useTimelineStore.setState({ isPlaying: true });
    const before = useTimelineStore.getState().currentTime.getTime();
    runPlayInterval(TICK_INTERVAL_MS);
    const after = useTimelineStore.getState().currentTime.getTime();
    expect(after - before).toBe(MS_PER_TICK);
  });

  it("advances over multiple ticks", () => {
    useTimelineStore.setState({ isPlaying: true });
    const before = useTimelineStore.getState().currentTime.getTime();
    runPlayInterval(TICK_INTERVAL_MS * 5);
    const after = useTimelineStore.getState().currentTime.getTime();
    expect(after - before).toBe(MS_PER_TICK * 5);
  });

  it("stops at range.end and sets isPlaying to false", () => {
    // Use a short range so the interval reaches the end quickly
    const start = T12;
    const end   = new Date(T12.getTime() + MS_PER_TICK * 2); // 2 ticks to the end
    useTimelineStore.setState({ currentTime: start, timeRange: { start, end }, isPlaying: true });

    runPlayInterval(TICK_INTERVAL_MS * 3); // advance past the end

    expect(useTimelineStore.getState().currentTime.getTime()).toBe(end.getTime());
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("does not advance currentTime when isPlaying is false", () => {
    useTimelineStore.setState({ isPlaying: false });
    const before = useTimelineStore.getState().currentTime.getTime();
    runPlayInterval(TICK_INTERVAL_MS * 10);
    expect(useTimelineStore.getState().currentTime.getTime()).toBe(before);
  });

  it("stops advancing after setPlaying(false) is called mid-play", () => {
    useTimelineStore.setState({ isPlaying: true });
    const id = setInterval(() => {
      const { currentTime, timeRange, isPlaying, setTime, setPlaying } =
        useTimelineStore.getState();
      if (!isPlaying) { clearInterval(id); return; }
      const next = new Date(currentTime.getTime() + MS_PER_TICK);
      if (next.getTime() >= timeRange.end.getTime()) {
        setTime(timeRange.end);
        setPlaying(false);
        clearInterval(id);
      } else {
        setTime(next);
      }
    }, TICK_INTERVAL_MS);

    vi.advanceTimersByTime(TICK_INTERVAL_MS * 2);
    useTimelineStore.getState().setPlaying(false);
    const frozenTime = useTimelineStore.getState().currentTime.getTime();

    vi.advanceTimersByTime(TICK_INTERVAL_MS * 10);
    expect(useTimelineStore.getState().currentTime.getTime()).toBe(frozenTime);
    clearInterval(id);
  });
});

// ---------------------------------------------------------------------------
// Initial state invariants
// ---------------------------------------------------------------------------

describe("timelineStore — initial state", () => {
  it("has isPlaying false on init", () => {
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("has currentTime within timeRange on init", () => {
    const { currentTime, timeRange } = useTimelineStore.getState();
    expect(currentTime.getTime()).toBeGreaterThanOrEqual(timeRange.start.getTime());
    expect(currentTime.getTime()).toBeLessThanOrEqual(timeRange.end.getTime());
  });

  it("has a non-degenerate timeRange (end strictly after start)", () => {
    const { timeRange } = useTimelineStore.getState();
    expect(timeRange.end.getTime()).toBeGreaterThan(timeRange.start.getTime());
  });
});
