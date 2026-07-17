/**
 * CurrentsPanel — Advanced section visibility guard tests.
 *
 * Covers the three scenarios called out in the task:
 *   1. Advanced section is ABSENT from the DOM when currentsEnabled=false.
 *   2. Advanced section is PRESENT (and correctly collapsed) when currentsEnabled=true.
 *   3. Toggle off → on while the section was expanded: the section is still expanded.
 *
 * DESIGN NOTE — AdvancedSection uses CSS clip (max-height / opacity), not DOM
 * unmount, to hide its contents when collapsed.  The toggle button
 * (data-testid="advanced-toggle-currentsPanelAdvanced") is the reliable
 * discriminator: it is only rendered by AdvancedSection itself, which is only
 * rendered by CurrentsPanel when currentsEnabled=true.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── vi.hoisted: variables available before mock factories AND before module init ──
//
// vi.mock() factories are hoisted before `let` declarations, so plain `let` vars
// are in the Temporal Dead Zone (TDZ) when getState() is called during module
// initialization (uiStore.ts:608 → settingsState()). vi.hoisted() runs first.

const h = vi.hoisted(() => {
  let currentsEnabled = true;
  let advancedCollapsed = true;
  const setCurrentsEnabled = vi.fn((v: boolean) => {
    currentsEnabled = v;
  });
  const panelToggle = vi.fn();

  return {
    get currentsEnabled() {
      return currentsEnabled;
    },
    set currentsEnabled(v: boolean) {
      currentsEnabled = v;
    },
    get advancedCollapsed() {
      return advancedCollapsed;
    },
    set advancedCollapsed(v: boolean) {
      advancedCollapsed = v;
    },
    setCurrentsEnabled,
    panelToggle,
  };
});

// ── Module-level mocks (hoisted) ──────────────────────────────────────────────

vi.mock("@/lib/settingsStore", () => {
  const settingsState = () => ({
    units: "nautical" as const,
    currentsEnabled: h.currentsEnabled,
    setCurrentsEnabled: h.setCurrentsEnabled,
    currentsSource: "manual" as const,
    setCurrentsSource: vi.fn(),
    currentsManualDirectionDeg: 90,
    setCurrentsManualDirectionDeg: vi.fn(),
    currentsManualSpeedKt: 1.5,
    setCurrentsManualSpeedKt: vi.fn(),
    currentsTidePhase: 0,
    setCurrentsTidePhase: vi.fn(),
    currentsAutoAdvance: false,
    setCurrentsAutoAdvance: vi.fn(),
    currentsShowParticles: true,
    setCurrentsShowParticles: vi.fn(),
    currentsShowArrows: false,
    setCurrentsShowArrows: vi.fn(),
    currentsShowStreamlines: false,
    setCurrentsShowStreamlines: vi.fn(),
  });

  const useSettingsStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof settingsState>) => T): T =>
      sel(settingsState()),
    {
      getState: () => settingsState(),
      setState: vi.fn(),
      persist: {
        hasHydrated: () => true,
        onFinishHydration: () => () => {},
      },
      subscribe: () => () => {},
    },
  );

  return {
    useSettingsStore,
    DEFAULT_SETTINGS: {} as Record<string, unknown>,
  };
});

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: (
    sel: (s: {
      collapsed: Record<string, boolean>;
      toggle: (id: string) => void;
    }) => unknown,
  ) =>
    sel({
      collapsed: new Proxy({} as Record<string, boolean>, {
        get(_target, prop) {
          if (prop === "currentsPanelAdvanced") return h.advancedCollapsed;
          return false;
        },
      }),
      toggle: h.panelToggle,
    }),
}));

vi.mock("@/lib/currentsStore", () => ({
  useCurrentsStore: (sel: (s: unknown) => unknown) =>
    sel({
      field: null,
      noaaAmbient: null,
      tidalStatus: "idle",
      retryTidal: vi.fn(),
    }),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/lib/currentColor", () => ({
  CURRENT_RAMP_STOPS: [{ t: 0 }, { t: 0.5 }, { t: 1 }],
  speedToColor: () => ({ r: 0, g: 0.9, b: 1 }),
}));

vi.mock("@/lib/units", () => ({
  formatSpeedFromKnots: (v: number) => `${v} kt`,
  speedSuffix: () => "kt",
  MPH_TO_KNOTS: 0.868976,
  MPH_TO_KPH: 1.609344,
  cardinal: (deg: number) => (deg < 180 ? "N" : "S"),
}));

vi.mock("@/lib/uiStore", () => ({
  useTimelineVisible: (sel?: (v: boolean) => unknown) =>
    sel ? sel(false) : false,
}));

vi.mock("@/lib/timelineStore", () => ({
  useTimelineStore: (
    sel: (s: { currentTime: null; isPlaying: boolean }) => unknown,
  ) => sel({ currentTime: null, isPlaying: false }),
}));

// ── Import under test (after all mocks are declared) ─────────────────────────

import { CurrentsPanel } from "@/components/CurrentsPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetMocks({
  currentsEnabled = true,
  advancedCollapsed = true,
}: {
  currentsEnabled?: boolean;
  advancedCollapsed?: boolean;
} = {}) {
  h.currentsEnabled = currentsEnabled;
  h.advancedCollapsed = advancedCollapsed;
  h.setCurrentsEnabled.mockClear();
  h.panelToggle.mockClear();
}

const ADV_TESTID = "advanced-toggle-currentsPanelAdvanced";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CurrentsPanel — Advanced section visibility guard", () => {
  beforeEach(() => resetMocks());

  // ── 1. Advanced absent when currents disabled ───────────────────────────────

  it("does NOT render the Advanced toggle when currentsEnabled=false", () => {
    resetMocks({ currentsEnabled: false });
    render(<CurrentsPanel />);
    expect(screen.queryByTestId(ADV_TESTID)).toBeNull();
  });

  it("renders the enable-currents button (not the Advanced toggle) when currentsEnabled=false", () => {
    resetMocks({ currentsEnabled: false });
    render(<CurrentsPanel />);
    expect(screen.getByTestId("currents-enable")).toBeInTheDocument();
    expect(screen.queryByTestId(ADV_TESTID)).toBeNull();
  });

  // ── 2. Advanced present and collapsed when currents enabled ────────────────

  it("renders the Advanced toggle when currentsEnabled=true", () => {
    resetMocks({ currentsEnabled: true, advancedCollapsed: true });
    render(<CurrentsPanel />);
    expect(screen.getByTestId(ADV_TESTID)).toBeInTheDocument();
  });

  it("Advanced toggle has aria-expanded='false' when store reports collapsed=true", () => {
    resetMocks({ currentsEnabled: true, advancedCollapsed: true });
    render(<CurrentsPanel />);
    expect(screen.getByTestId(ADV_TESTID)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("Advanced toggle has aria-expanded='true' when store reports collapsed=false (expanded)", () => {
    resetMocks({ currentsEnabled: true, advancedCollapsed: false });
    render(<CurrentsPanel />);
    expect(screen.getByTestId(ADV_TESTID)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  // ── 3. Toggle off → on preserves expanded state ────────────────────────────
  //
  // When currents are disabled the panelCollapseStore is not modified — the
  // Advanced collapse key retains whatever value it had.  When currents are
  // re-enabled the AdvancedSection reads the same store state and therefore
  // renders in the same expanded/collapsed position the user left it.

  it("Advanced section is still expanded after toggling currents off then on", () => {
    // Start: currents on, advanced expanded (collapsed=false in store).
    resetMocks({ currentsEnabled: true, advancedCollapsed: false });

    const { rerender } = render(<CurrentsPanel />);

    // Confirm expanded before toggling off.
    expect(screen.getByTestId(ADV_TESTID)).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Toggle currents off — Advanced toggle disappears.
    h.currentsEnabled = false;
    rerender(<CurrentsPanel />);
    expect(screen.queryByTestId(ADV_TESTID)).toBeNull();

    // Toggle currents on — store state is UNCHANGED (advancedCollapsed=false).
    h.currentsEnabled = true;
    rerender(<CurrentsPanel />);

    const advBtn = screen.getByTestId(ADV_TESTID);
    expect(advBtn).toBeInTheDocument();
    // The store still reports collapsed=false → expanded.
    expect(advBtn).toHaveAttribute("aria-expanded", "true");
  });

  it("Advanced section is still collapsed after toggling currents off then on", () => {
    // Mirror test: collapsed state is also preserved.
    resetMocks({ currentsEnabled: true, advancedCollapsed: true });

    const { rerender } = render(<CurrentsPanel />);
    expect(screen.getByTestId(ADV_TESTID)).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    h.currentsEnabled = false;
    rerender(<CurrentsPanel />);
    expect(screen.queryByTestId(ADV_TESTID)).toBeNull();

    h.currentsEnabled = true;
    rerender(<CurrentsPanel />);
    expect(screen.getByTestId(ADV_TESTID)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // ── 4. Store toggle wiring ─────────────────────────────────────────────────

  it("clicking the Advanced toggle calls panelCollapseStore.toggle('currentsPanelAdvanced')", () => {
    resetMocks({ currentsEnabled: true, advancedCollapsed: true });
    render(<CurrentsPanel />);
    fireEvent.click(screen.getByTestId(ADV_TESTID));
    expect(h.panelToggle).toHaveBeenCalledOnce();
    expect(h.panelToggle).toHaveBeenCalledWith("currentsPanelAdvanced");
  });
});
