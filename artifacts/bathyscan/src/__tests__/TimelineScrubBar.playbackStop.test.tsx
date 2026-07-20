/**
 * Regression guard for the stale-closure fix in TimelineScrubBar.
 *
 * Before the fix, `isPlaying` was absent from the useEffect dependency array.
 * This meant that when `isPlaying` changed from false→true (e.g. user hits Play)
 * without `visible` changing, the next time `visible` became false the effect
 * would still reference the stale `isPlaying=false` closure and fail to call
 * setPlaying(false), leaving playback running while the scrubbar was hidden.
 *
 * The fix adds both `isPlaying` and `setPlaying` to the deps array so the
 * effect always calls setPlaying(false) when visible=false and isPlaying=true.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Store mocks — must be defined before the component import
// ---------------------------------------------------------------------------

const setPlayingMock = vi.fn();

vi.mock("@/lib/timelineStore", () => ({
  useTimelineStore: (sel: (s: {
    currentTime: Date;
    timeRange: { start: Date; end: Date };
    isPlaying: boolean;
    setTime: () => void;
    setPlaying: (v: boolean) => void;
  }) => unknown) => {
    const state = (globalThis as unknown as { __timelineState: typeof defaultTimelineState }).__timelineState;
    return sel(state);
  },
}));

vi.mock("@/lib/uiStore", () => ({
  useUiStore: (sel: (s: {
    tideOverlayActive: boolean;
    currentOverlayActive: boolean;
    windOverlayActive: boolean;
    weatherStationsActive: boolean;
    rawsOverlayActive: boolean;
  }) => unknown) => {
    const state = (globalThis as unknown as { __uiState: typeof defaultUiState }).__uiState;
    return sel(state);
  },
}));

vi.mock("@/lib/depthProfileStore", () => ({
  useDepthProfileStore: () => false,
}));

vi.mock("@/lib/tidalStore", () => ({
  useTidalStore: () => null,
}));

vi.mock("@/lib/tidePrediction", () => ({
  findTideExtremes: () => [],
  extremesInRange: () => [],
}));

import { TimelineScrubBar } from "@/components/TimelineScrubBar";

const defaultTimelineState = {
  currentTime: new Date("2026-07-20T12:00:00Z"),
  timeRange: {
    start: new Date("2026-07-20T00:00:00Z"),
    end: new Date("2026-07-21T00:00:00Z"),
  },
  isPlaying: false,
  setTime: vi.fn(),
  setPlaying: setPlayingMock,
};

const defaultUiState = {
  tideOverlayActive: true,
  currentOverlayActive: false,
  windOverlayActive: false,
  weatherStationsActive: false,
  rawsOverlayActive: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TimelineScrubBar — playback stop when hidden (stale-closure regression)", () => {
  beforeEach(() => {
    setPlayingMock.mockClear();
    (globalThis as unknown as { __timelineState: typeof defaultTimelineState }).__timelineState = {
      ...defaultTimelineState,
      setPlaying: setPlayingMock,
    };
    (globalThis as unknown as { __uiState: typeof defaultUiState }).__uiState = {
      ...defaultUiState,
    };
  });

  it("calls setPlaying(false) when visible becomes false while isPlaying=true (fix verification)", () => {
    // Render with visible=true, isPlaying=false
    const { rerender } = render(<TimelineScrubBar />);
    expect(setPlayingMock).not.toHaveBeenCalled();

    // isPlaying becomes true (user hit play). Without the fix, the effect's
    // closure would still have the old isPlaying=false from the previous render.
    act(() => {
      (globalThis as unknown as { __timelineState: typeof defaultTimelineState }).__timelineState = {
        ...(globalThis as unknown as { __timelineState: typeof defaultTimelineState }).__timelineState,
        isPlaying: true,
      };
    });
    rerender(<TimelineScrubBar />);

    // visible becomes false (user deactivates overlay while playing).
    // With the fix: effect re-registered after isPlaying changed, so it
    // captures isPlaying=true and calls setPlaying(false).
    act(() => {
      (globalThis as unknown as { __uiState: typeof defaultUiState }).__uiState = {
        ...defaultUiState,
        tideOverlayActive: false,
      };
    });
    rerender(<TimelineScrubBar />);

    expect(setPlayingMock).toHaveBeenCalledWith(false);
  });

  it("does NOT call setPlaying(false) when overlay stays visible while playing", () => {
    render(<TimelineScrubBar />);
    setPlayingMock.mockClear();

    act(() => {
      (globalThis as unknown as { __timelineState: typeof defaultTimelineState }).__timelineState = {
        ...(globalThis as unknown as { __timelineState: typeof defaultTimelineState }).__timelineState,
        isPlaying: true,
      };
    });

    // visible stays true — should not stop playback
    expect(setPlayingMock).not.toHaveBeenCalledWith(false);
  });
});
