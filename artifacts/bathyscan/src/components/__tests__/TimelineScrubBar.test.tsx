/**
 * TimelineScrubBar — regression tests for the global timeline scrubber.
 *
 * Covers (matching the task spec):
 *   1. Scrubber appears when a time-sensitive overlay is activated; disappears
 *      when all overlays are deactivated.
 *   2. Deactivating the tide overlay mid-play stops the interval (isPlaying → false)
 *      and hides the scrubber.
 *   3. Depth-profile panel active while scrubber is visible — scrubber shifts up
 *      (DEPTH_PROFILE_CLEARANCE offset) so the two panels don't overlap.
 *   4. No forecast data / fallback range — scrubber renders without crashing.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useTimelineStore } from "@/lib/timelineStore";
import { useDepthProfileStore, type DepthProfileResult } from "@/lib/depthProfileStore";
import { useTidalStore } from "@/lib/tidalStore";
import type { TideSample } from "@/lib/tidePrediction";

// ── settingsStore mock (required by uiStore module-init call) ─────────────────
vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = { ...actual.DEFAULT_SETTINGS };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState: (patch: Partial<typeof storeState>) => Object.assign(storeState, patch),
      subscribe: () => () => {},
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
    },
  );
  return { ...actual, useSettingsStore };
});

// ── Import component after mocks ──────────────────────────────────────────────
import { TimelineScrubBar, DEPTH_PROFILE_CLEARANCE } from "@/components/TimelineScrubBar";
import { useUiStore } from "@/lib/uiStore";

// ── Helpers ───────────────────────────────────────────────────────────────────

const T0 = new Date("2024-06-01T00:00:00Z");
const T12 = new Date("2024-06-01T12:00:00Z");
const T24 = new Date("2024-06-02T00:00:00Z");

function resetAllOverlays() {
  useUiStore.setState({
    tideOverlayActive: false,
    currentOverlayActive: false,
    windOverlayActive: false,
    weatherStationsActive: false,
    rawsOverlayActive: false,
  });
}

function resetTimeline() {
  useTimelineStore.setState({
    currentTime: T12,
    timeRange: { start: T0, end: T24 },
    isPlaying: false,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TimelineScrubBar — scrubber visibility (overlay gate)", () => {
  beforeEach(() => {
    resetAllOverlays();
    resetTimeline();
  });

  it("scrubber is hidden (translateY 100%) when no overlay is active", () => {
    const { getByTestId } = render(<TimelineScrubBar />);
    const bar = getByTestId("timeline-scrub-bar");
    expect(bar.style.transform).toBe("translateY(100%)");
    expect(bar.style.opacity).toBe("0");
    expect(bar.getAttribute("aria-hidden")).toBe("true");
  });

  it("scrubber is visible (translateY 0) when tideOverlayActive is true", () => {
    useUiStore.setState({ tideOverlayActive: true });
    const { getByTestId } = render(<TimelineScrubBar />);
    const bar = getByTestId("timeline-scrub-bar");
    expect(bar.style.transform).toBe("translateY(0)");
    expect(bar.style.opacity).toBe("1");
    expect(bar.getAttribute("aria-hidden")).toBe("false");
  });

  it("scrubber is visible when currentOverlayActive is true", () => {
    useUiStore.setState({ currentOverlayActive: true });
    const { getByTestId } = render(<TimelineScrubBar />);
    expect(getByTestId("timeline-scrub-bar").style.transform).toBe("translateY(0)");
  });

  it("scrubber is visible when windOverlayActive is true", () => {
    useUiStore.setState({ windOverlayActive: true });
    const { getByTestId } = render(<TimelineScrubBar />);
    expect(getByTestId("timeline-scrub-bar").style.transform).toBe("translateY(0)");
  });

  it("scrubber is visible when weatherStationsActive is true", () => {
    useUiStore.setState({ weatherStationsActive: true });
    const { getByTestId } = render(<TimelineScrubBar />);
    expect(getByTestId("timeline-scrub-bar").style.transform).toBe("translateY(0)");
  });

  it("scrubber is visible when rawsOverlayActive is true", () => {
    useUiStore.setState({ rawsOverlayActive: true });
    const { getByTestId } = render(<TimelineScrubBar />);
    expect(getByTestId("timeline-scrub-bar").style.transform).toBe("translateY(0)");
  });

  it("scrubber hides again after tide overlay is deactivated (all overlays off)", () => {
    useUiStore.setState({ tideOverlayActive: true });
    const { getByTestId, rerender } = render(<TimelineScrubBar />);
    expect(getByTestId("timeline-scrub-bar").style.transform).toBe("translateY(0)");

    act(() => {
      useUiStore.setState({ tideOverlayActive: false });
    });
    rerender(<TimelineScrubBar />);
    expect(getByTestId("timeline-scrub-bar").style.transform).toBe("translateY(100%)");
  });
});

describe("TimelineScrubBar — deactivate mid-play stops interval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAllOverlays();
    resetTimeline();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("setting isPlaying to false clears the interval (time no longer advances)", () => {
    useUiStore.setState({ tideOverlayActive: true });
    useTimelineStore.setState({ isPlaying: true });

    render(<TimelineScrubBar />);
    const timeBefore = useTimelineStore.getState().currentTime.getTime();

    act(() => {
      useTimelineStore.getState().setPlaying(false);
    });
    // Advance timers AFTER the act() so the effect cleanup (clearInterval) has run first
    vi.advanceTimersByTime(500);

    expect(useTimelineStore.getState().currentTime.getTime()).toBe(timeBefore);
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("deactivating tide overlay mid-play resets isPlaying to false", () => {
    useUiStore.setState({ tideOverlayActive: true });
    useTimelineStore.setState({ isPlaying: true });

    render(<TimelineScrubBar />);
    expect(useTimelineStore.getState().isPlaying).toBe(true);

    act(() => {
      useUiStore.setState({ tideOverlayActive: false });
    });

    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("scrubber is hidden after tide overlay is deactivated mid-play", () => {
    useUiStore.setState({ tideOverlayActive: true });
    useTimelineStore.setState({ isPlaying: true });

    const { getByTestId, rerender } = render(<TimelineScrubBar />);
    expect(getByTestId("timeline-scrub-bar").style.transform).toBe("translateY(0)");

    act(() => {
      useUiStore.setState({ tideOverlayActive: false });
    });
    rerender(<TimelineScrubBar />);

    expect(getByTestId("timeline-scrub-bar").style.transform).toBe("translateY(100%)");
    expect(getByTestId("timeline-scrub-bar").getAttribute("aria-hidden")).toBe("true");
  });

  it("unmounting while playing clears the interval (no further time advancement)", () => {
    useUiStore.setState({ tideOverlayActive: true });
    useTimelineStore.setState({ isPlaying: true });

    const { unmount } = render(<TimelineScrubBar />);
    const timeBefore = useTimelineStore.getState().currentTime.getTime();

    // Unmount flushes all effect cleanups synchronously inside act()
    act(() => { unmount(); });
    // Interval was cleared during cleanup; advancing fake timers should not advance currentTime
    vi.advanceTimersByTime(500);

    expect(useTimelineStore.getState().currentTime.getTime()).toBe(timeBefore);
  });

  it("play interval advances currentTime and stops at range end", () => {
    useUiStore.setState({ tideOverlayActive: true });

    // Place currentTime 200 ms (wall-clock) of ticks from range end.
    // MS_PER_TICK = 6000 ms per 100 ms wall-clock tick.
    // 2 ticks = 200 ms wall, 12 000 ms timeline advancement.
    const nearEnd = new Date(T24.getTime() - 12_000 - 1);
    useTimelineStore.setState({ currentTime: nearEnd, isPlaying: true });

    render(<TimelineScrubBar />);

    act(() => {
      vi.advanceTimersByTime(300); // 3 ticks — enough to reach or pass end
    });

    const s = useTimelineStore.getState();
    expect(s.currentTime.getTime()).toBe(T24.getTime());
    expect(s.isPlaying).toBe(false);
  });
});

describe("TimelineScrubBar — layout: depth-profile clearance", () => {
  beforeEach(() => {
    resetAllOverlays();
    resetTimeline();
    // Reset profile state to no profile
    useDepthProfileStore.setState({ profile: null });
  });

  it("scrubber sits at bottom: 0 when no depth profile is active", () => {
    useUiStore.setState({ tideOverlayActive: true });
    const { getByTestId } = render(<TimelineScrubBar />);
    const bar = getByTestId("timeline-scrub-bar");
    expect(bar.style.bottom).toBe("0px");
  });

  it(`scrubber shifts up by ${DEPTH_PROFILE_CLEARANCE}px when depth profile is active`, () => {
    useUiStore.setState({ tideOverlayActive: true });
    // Inject a dummy profile object to make profile !== null
    useDepthProfileStore.setState({
      profile: {} as unknown as DepthProfileResult,
    });

    const { getByTestId } = render(<TimelineScrubBar />);
    const bar = getByTestId("timeline-scrub-bar");
    expect(bar.style.bottom).toBe(`${DEPTH_PROFILE_CLEARANCE}px`);
  });

  it("scrubber and depth profile don't overlap: scrubber bottom >= DEPTH_PROFILE_CLEARANCE when profile active", () => {
    useUiStore.setState({ tideOverlayActive: true });
    useDepthProfileStore.setState({
      profile: {} as unknown as DepthProfileResult,
    });

    const { getByTestId } = render(<TimelineScrubBar />);
    const bar = getByTestId("timeline-scrub-bar");
    const bottomPx = parseInt(bar.style.bottom, 10);
    expect(bottomPx).toBeGreaterThanOrEqual(DEPTH_PROFILE_CLEARANCE);
  });
});

describe("TimelineScrubBar — no-forecast fallback range", () => {
  beforeEach(() => {
    resetAllOverlays();
    resetTimeline();
  });

  it("renders without crashing when using the default fallback range", () => {
    useUiStore.setState({ tideOverlayActive: true });
    // Use the store as-is with default/reset range — this simulates no forecast data loaded
    expect(() => render(<TimelineScrubBar />)).not.toThrow();
  });

  it("scrubber is visible and shows a time label with the default range", () => {
    useUiStore.setState({ tideOverlayActive: true });
    const { getByTestId } = render(<TimelineScrubBar />);
    const bar = getByTestId("timeline-scrub-bar");
    expect(bar.style.transform).toBe("translateY(0)");
    // The input range element must be present
    expect(getByTestId("timeline-scrubber")).toBeInTheDocument();
  });

  it("scrubber input range value is within [0, 10000] when using fallback range", () => {
    useUiStore.setState({ tideOverlayActive: true });
    const { getByTestId } = render(<TimelineScrubBar />);
    const input = getByTestId("timeline-scrubber") as HTMLInputElement;
    const val = parseInt(input.value, 10);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(10_000);
  });

  it("scrubber renders correctly when currentTime equals range start (position 0)", () => {
    useUiStore.setState({ tideOverlayActive: true });
    useTimelineStore.setState({ currentTime: T0 });
    const { getByTestId } = render(<TimelineScrubBar />);
    const input = getByTestId("timeline-scrubber") as HTMLInputElement;
    expect(parseInt(input.value, 10)).toBe(0);
  });

  it("scrubber renders correctly when currentTime equals range end (position 10000)", () => {
    useUiStore.setState({ tideOverlayActive: true });
    useTimelineStore.setState({ currentTime: T24 });
    const { getByTestId } = render(<TimelineScrubBar />);
    const input = getByTestId("timeline-scrubber") as HTMLInputElement;
    expect(parseInt(input.value, 10)).toBe(10_000);
  });
});

describe("TimelineScrubBar — high/low tide markers on the trip window", () => {
  /** Build 6-minute samples over [T0, T24] from an hourly height function. */
  function buildSamples(heightAtHour: (h: number) => number): TideSample[] {
    const out: TideSample[] = [];
    for (let m = 0; m <= 24 * 60; m += 6) {
      out.push({
        tMs: T0.getTime() + m * 60_000,
        v: heightAtHour(m / 60),
      });
    }
    return out;
  }

  beforeEach(() => {
    resetAllOverlays();
    resetTimeline();
    useTidalStore.setState({ samples: null });
    useUiStore.setState({ tideOverlayActive: true });
  });

  afterEach(() => {
    useTidalStore.setState({ samples: null });
  });

  it("renders no markers when no tide samples are loaded", () => {
    const { queryAllByTestId } = render(<TimelineScrubBar />);
    expect(queryAllByTestId("timeline-tide-marker-high")).toHaveLength(0);
    expect(queryAllByTestId("timeline-tide-marker-low")).toHaveLength(0);
  });

  it("renders green high and amber low markers inside the trip window", () => {
    // Sinusoid with a high near hour 6 and a low near hour 18.
    useTidalStore.setState({
      samples: buildSamples((h) => Math.sin(((h - 0) / 12) * Math.PI) * 5),
    });
    const { getAllByTestId } = render(<TimelineScrubBar />);
    const highs = getAllByTestId("timeline-tide-marker-high");
    const lows = getAllByTestId("timeline-tide-marker-low");
    expect(highs.length).toBeGreaterThanOrEqual(1);
    expect(lows.length).toBeGreaterThanOrEqual(1);
    // Colours match the tide-station panel: green high, amber low.
    expect(highs[0]!.style.background).toBe("rgb(74, 222, 128)");
    expect(lows[0]!.style.background).toBe("rgb(251, 191, 36)");
  });

  it("positions a marker proportionally along the window", () => {
    // High exactly at hour 12 → 50% of the 24 h window.
    useTidalStore.setState({
      samples: buildSamples((h) => -Math.abs(h - 12)),
    });
    const { getAllByTestId } = render(<TimelineScrubBar />);
    const highs = getAllByTestId("timeline-tide-marker-high");
    expect(highs).toHaveLength(1);
    expect(parseFloat(highs[0]!.style.left)).toBeCloseTo(50, 0);
  });

  it("excludes extremes outside the trip window", () => {
    // Narrow the window to hours 0–6; the high at hour 12 must not appear.
    useTimelineStore.setState({
      timeRange: { start: T0, end: new Date(T0.getTime() + 6 * 3_600_000) },
      currentTime: T0,
    });
    useTidalStore.setState({
      samples: buildSamples((h) => -Math.abs(h - 12)),
    });
    const { queryAllByTestId } = render(<TimelineScrubBar />);
    expect(queryAllByTestId("timeline-tide-marker-high")).toHaveLength(0);
  });

  it("marker exposes an accessible high/low label with time and height", () => {
    useTidalStore.setState({
      samples: buildSamples((h) => -Math.abs(h - 12)),
    });
    const { getAllByTestId } = render(<TimelineScrubBar />);
    const label = getAllByTestId("timeline-tide-marker-high")[0]!.getAttribute("aria-label")!;
    expect(label).toMatch(/^High tide /);
    expect(label).toMatch(/ft\)$/);
  });
});

describe("TimelineScrubBar — scrub input interaction", () => {
  beforeEach(() => {
    resetAllOverlays();
    resetTimeline();
  });

  it("play/pause button is present when scrubber is visible", () => {
    useUiStore.setState({ tideOverlayActive: true });
    render(<TimelineScrubBar />);
    expect(screen.getByTestId("timeline-play-pause")).toBeInTheDocument();
  });

  it("play button shows ▶ when not playing", () => {
    useUiStore.setState({ tideOverlayActive: true });
    useTimelineStore.setState({ isPlaying: false });
    render(<TimelineScrubBar />);
    expect(screen.getByTestId("timeline-play-pause").textContent).toBe("▶");
  });

  it("play button shows ⏸ when playing", () => {
    useUiStore.setState({ tideOverlayActive: true });
    useTimelineStore.setState({ isPlaying: true });
    render(<TimelineScrubBar />);
    expect(screen.getByTestId("timeline-play-pause").textContent).toBe("⏸");
  });
});
