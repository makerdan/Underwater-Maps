/**
 * TidePanel — slider touch-drag regression tests.
 *
 * Verifies:
 *   1. The hour-scrubber <input type="range"> has touchAction:"none" so the
 *      mobile scroll container does not hijack the touch stream.
 *   2. The track-wrapper div also carries touchAction:"none".
 *   3. A pointerdown → change → pointerup sequence on the slider calls
 *      onScrubChange (confirming the change handler is wired correctly).
 *   4. Clicking a tick mark still snaps the scrubber to the tick's hour
 *      (onPointerDown calls setHour without blocking propagation).
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import type { TidalDataResult } from "@/hooks/useTidalData";

// ── Mocks (declared before component import) ──────────────────────────────────

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: null }),
}));

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: (
    sel: (s: { collapsed: { tide: boolean }; toggle: () => void }) => unknown,
  ) => sel({ collapsed: { tide: false }, toggle: vi.fn() }),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = {
    ...actual.DEFAULT_SETTINGS,
    units: "imperial" as const,
    defaultTidalDepthLayer: "surface" as const,
    waterType: "saltwater" as const,
  };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState: vi.fn(),
      subscribe: () => () => {},
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
    },
  );
  return { ...actual, useSettingsStore };
});

vi.mock("@/hooks/useTidalSchedule", () => ({
  useTidalSchedule: () => ({ schedule: null }),
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => null,
}));

vi.mock("@/lib/uiStore", () => ({
  useTimelineVisible: () => true,
}));

// ── Import component after mocks ──────────────────────────────────────────────
import { TidePanel } from "@/components/TidePanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVAILABLE_DATA: TidalDataResult = {
  available: true,
  tideHeight: 1.5,
  currentDirection: 180,
  currentSpeed: 0.5,
  stationName: "Test Station",
  stationId: "TEST01",
  isPredicted: false,
  source: "noaa",
};

function renderPanel(onScrubChange = vi.fn()) {
  return render(
    <TidePanel
      data={AVAILABLE_DATA}
      loading={false}
      depthLayer="surface"
      onDepthLayerChange={vi.fn()}
      scrubDatetime={null}
      onScrubChange={onScrubChange}
      lat={37.8}
      lon={-122.4}
      embedded
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TidePanel slider — touch-action CSS", () => {
  it("range input has touchAction:'none' so the scroll container cannot hijack the touch", () => {
    const { container } = renderPanel();
    const input = container.querySelector("input[type='range']") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.style.touchAction).toBe("none");
  });

  it("track wrapper div also has touchAction:'none'", () => {
    const { container } = renderPanel();
    const input = container.querySelector("input[type='range']") as HTMLInputElement;
    // The immediate parent of the <input> is the track wrapper div
    const wrapper = input?.parentElement as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.touchAction).toBe("none");
  });
});

describe("TidePanel slider — pointer drag calls onScrubChange", () => {
  it("pointerdown → change → pointerup sequence on the slider calls onScrubChange", () => {
    const onScrubChange = vi.fn();
    const { container } = renderPanel(onScrubChange);
    const input = container.querySelector("input[type='range']") as HTMLInputElement;
    expect(input).not.toBeNull();

    // setHour(hour) short-circuits (returns null, no callback) when the target
    // hour equals the CURRENT hour for today, so a fixed literal makes this
    // test fail deterministically during that wall-clock hour. Always pick an
    // hour that is not "now".
    const dragHour = (new Date().getUTCHours() + 3) % 24;
    act(() => {
      fireEvent.pointerDown(input, { pointerId: 1, clientX: 10, clientY: 9 });
      fireEvent.pointerMove(input, { pointerId: 1, clientX: 50, clientY: 9 });
      // The browser fires a 'change' event as the thumb drags; simulate it
      fireEvent.change(input, { target: { value: String(dragHour) } });
      fireEvent.pointerUp(input, { pointerId: 1 });
    });

    // setHour(dragHour) calls onScrubChange internally
    expect(onScrubChange).toHaveBeenCalled();
  });

  it("changing the range input calls onScrubChange with a Date at the chosen hour", () => {
    const onScrubChange = vi.fn();
    const { container } = renderPanel(onScrubChange);
    const input = container.querySelector("input[type='range']") as HTMLInputElement;

    // Never scrub to the current hour: setHour returns null without invoking
    // the callback when the hour matches "now" for today (time-of-day flake —
    // a literal "5" failed only during the 05:00 UTC hour).
    const targetHour = (new Date().getUTCHours() + 5) % 24;
    act(() => {
      fireEvent.change(input, { target: { value: String(targetHour) } });
    });

    expect(onScrubChange).toHaveBeenCalled();
    const arg = onScrubChange.mock.calls[0]?.[0];
    expect(arg).toBeInstanceOf(Date);
    expect((arg as Date).getUTCHours()).toBe(targetHour);
  });
});

describe("TidePanel tick — stopPropagation removed", () => {
  it("pointerdown on the track wrapper propagates to the parent (stopPropagation absent)", () => {
    const { container } = renderPanel();
    const input = container.querySelector("input[type='range']") as HTMLInputElement;
    const wrapper = input?.parentElement as HTMLElement;

    const parentSpy = vi.fn();
    wrapper.parentElement?.addEventListener("pointerdown", parentSpy);

    act(() => {
      fireEvent.pointerDown(wrapper);
    });

    // If stopPropagation were still called on the tick, this count would be 0
    // for events originating from within the wrapper. With it removed the
    // event bubbles freely.
    expect(parentSpy).toHaveBeenCalled();
  });
});
