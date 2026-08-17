/**
 * TideStationPanel — slider touch-drag regression tests.
 *
 * Verifies:
 *   1. The minute-scrubber <input type="range"> has touchAction:"none" so the
 *      MobileChartShell overflowY:"auto" scroll container cannot hijack the touch.
 *   2. The track-wrapper div also carries touchAction:"none".
 *   3. A change event on the slider calls onScrubChange (confirming the handler
 *      is correctly wired).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";

// ── Mocks (declared before component import) ──────────────────────────────────

vi.mock("@/lib/tidalStore", () => {
  const storeState = {
    station: { id: "TEST01", name: "Test Station", lat: 37.8, lon: -122.4, distanceMiles: 5 },
    stationStatus: "loaded" as const,
    // samples must be non-empty so daySamples.length > 0 and the scrubber renders
    samples: Array.from({ length: 48 }, (_, i) => ({
      tMs: Date.UTC(2026, 0, 2, 0, 0, 0) + i * 30 * 60_000,
      v: Math.sin((i / 48) * Math.PI * 2),
    })),
    predictionsStatus: "ready" as const,
    windowStartMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    windowEndMs: Date.UTC(2026, 0, 8, 0, 0, 0),
  };
  const useTidalStore = (sel: (s: typeof storeState) => unknown) =>
    sel(storeState);
  return { useTidalStore };
});

// ── Import component after mocks ──────────────────────────────────────────────
import { TideStationPanel } from "@/components/TideStationPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW_MS = Date.UTC(2026, 0, 2, 12, 0, 0); // 2026-01-02 noon UTC

function renderPanel(onScrubChange = vi.fn()) {
  return render(
    <TideStationPanel
      scrubDatetime={null}
      onScrubChange={onScrubChange}
      nowMs={NOW_MS}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TideStationPanel slider — touch-action CSS", () => {
  it("range input has touchAction:'none' so the scroll container cannot hijack the touch", () => {
    const { container } = renderPanel();
    const input = container.querySelector(
      "input[type='range']",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.style.touchAction).toBe("none");
  });

  it("track wrapper div also has touchAction:'none'", () => {
    const { container } = renderPanel();
    const input = container.querySelector(
      "input[type='range']",
    ) as HTMLInputElement;
    // The immediate parent of the <input> is the track wrapper div
    const wrapper = input?.parentElement as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.touchAction).toBe("none");
  });
});

describe("TideStationPanel slider — change handler", () => {
  it("changing the range input calls onScrubChange", () => {
    const onScrubChange = vi.fn();
    const { container } = renderPanel(onScrubChange);
    const input = container.querySelector(
      "input[type='range']",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();

    act(() => {
      fireEvent.change(input, { target: { value: "120" } });
    });

    expect(onScrubChange).toHaveBeenCalled();
    const arg = onScrubChange.mock.calls[0]?.[0];
    expect(arg).toBeInstanceOf(Date);
  });

  it("pointerdown → change → pointerup sequence calls onScrubChange", () => {
    const onScrubChange = vi.fn();
    const { container } = renderPanel(onScrubChange);
    const input = container.querySelector(
      "input[type='range']",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();

    act(() => {
      fireEvent.pointerDown(input, { pointerId: 1, clientX: 10, clientY: 9 });
      fireEvent.pointerMove(input, { pointerId: 1, clientX: 50, clientY: 9 });
      fireEvent.change(input, { target: { value: "360" } });
      fireEvent.pointerUp(input, { pointerId: 1 });
    });

    expect(onScrubChange).toHaveBeenCalled();
  });
});
