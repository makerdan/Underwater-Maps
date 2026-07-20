/**
 * WhatsHereCard — auto-close timer and mount/unmount regression tests.
 *
 * Verifies:
 *   - Auto-close timer fires at exactly 8 s and calls setWhatsHereOpen(false).
 *   - clearTimeout is called on unmount (no timer leak).
 *   - Pinning the card cancels the auto-close timer.
 *   - Substrate row renders when substrateActive=true, disappears when false.
 *   - Tidal row absent when tidalActive=false.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";

// ── Hoisted shared state ───────────────────────────────────────────────────
// vi.hoisted() runs before vi.mock() factories, so variables here are safe
// to reference inside mock factories (unlike module-scope const declarations).
const uiState = vi.hoisted(() => ({
  pinned: false,
  open: true,
  setPinned: null as null | ReturnType<typeof vi.fn>,
  setOpen: null as null | ReturnType<typeof vi.fn>,
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = { units: "metric" as const };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      persist: { hasHydrated: () => true, onFinishHydration: vi.fn() },
    },
  );
  return { ...actual, useSettingsStore, DEFAULT_SETTINGS: actual.DEFAULT_SETTINGS };
});

vi.mock("@/hooks/use-mobile", () => ({
  useIsNarrow: () => false,
}));

vi.mock("@/lib/cameraStore", () => {
  let _sub: ((s: unknown, p: unknown) => void) | null = null;
  const store = {
    getState: () => ({ cameraPosition: { known: false }, cameraDepth: null, heading: 0 }),
    subscribe: vi.fn((cb: (s: unknown, p: unknown) => void) => {
      _sub = cb;
      return () => { _sub = null; };
    }),
    _triggerMove: (newState: object) => {
      if (_sub) _sub(newState, {});
    },
  };
  return { useCameraStore: store };
});

vi.mock("@/lib/uiStore", () => {
  const setPinned = vi.fn((v: boolean) => { uiState.pinned = v; });
  const setOpen = vi.fn((v: boolean) => { uiState.open = v; });
  uiState.setPinned = setPinned;
  uiState.setOpen = setOpen;

  const buildSel = () => ({
    whatsHerePinned: uiState.pinned,
    setWhatsHerePinned: setPinned,
    setWhatsHereOpen: setOpen,
  });
  const store = {
    getState: () => buildSel(),
    subscribe: vi.fn(() => () => {}),
  };
  const useUiStore = (sel: (s: ReturnType<typeof buildSel>) => unknown) =>
    sel(buildSel());
  return { useUiStore: Object.assign(useUiStore, store) };
});

// ── Imports under test ───────────────────────────────────────────────────────
import { useUiStore } from "@/lib/uiStore";
import { WhatsHereCard } from "@/components/WhatsHereCard";
import type { WhatsHereData } from "@/hooks/useWhatsHere";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeData(overrides: Partial<WhatsHereData> = {}): WhatsHereData {
  return {
    depth: 75,
    lat: 55.5,
    lon: -132.5,
    substrateActive: false,
    substrateName: null,
    habitatActive: false,
    habitatSpeciesLabel: null,
    habitatScore: null,
    tidalActive: false,
    tidalPhase: null,
    tidalHeight: null,
    tempC: 8.3,
    tempLive: false,
    hasAnyData: false,
    ...overrides,
  };
}

function getSetWhatsHereOpen(): ReturnType<typeof vi.fn> {
  return (useUiStore as unknown as { getState: () => { setWhatsHereOpen: ReturnType<typeof vi.fn> } })
    .getState().setWhatsHereOpen;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  uiState.pinned = false;
  uiState.open = true;
  // Re-wire after clearAllMocks so the vi.fn stubs still work.
  if (uiState.setPinned) uiState.setPinned.mockImplementation((v: boolean) => { uiState.pinned = v; });
  if (uiState.setOpen) uiState.setOpen.mockImplementation((v: boolean) => { uiState.open = v; });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WhatsHereCard — auto-close timer", () => {
  it("calls setWhatsHereOpen(false) after 8 seconds", () => {
    render(React.createElement(WhatsHereCard, { data: makeData() }));
    const setOpen = getSetWhatsHereOpen();

    expect(setOpen).not.toHaveBeenCalledWith(false);

    act(() => {
      vi.advanceTimersByTime(8_000);
    });

    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("does NOT auto-close before 8 seconds have elapsed", () => {
    render(React.createElement(WhatsHereCard, { data: makeData() }));
    const setOpen = getSetWhatsHereOpen();

    act(() => {
      vi.advanceTimersByTime(7_999);
    });

    expect(setOpen).not.toHaveBeenCalledWith(false);
  });

  it("clears the timer on unmount — no state update after unmount", () => {
    const { unmount } = render(React.createElement(WhatsHereCard, { data: makeData() }));
    const setOpen = getSetWhatsHereOpen();

    unmount();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(setOpen).not.toHaveBeenCalledWith(false);
  });
});

describe("WhatsHereCard — pin suppresses auto-close", () => {
  it("does not auto-close when the card is pinned", () => {
    uiState.pinned = true;

    render(React.createElement(WhatsHereCard, { data: makeData() }));
    const setOpen = getSetWhatsHereOpen();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(setOpen).not.toHaveBeenCalledWith(false);
  });
});

describe("WhatsHereCard — row visibility", () => {
  it("renders the substrate row when substrateActive=true", () => {
    render(React.createElement(WhatsHereCard, {
      data: makeData({ substrateActive: true, substrateName: "Rock" }),
    }));
    expect(screen.getByText("Substrate")).toBeTruthy();
    expect(screen.getByText("Rock")).toBeTruthy();
  });

  it("does NOT render the substrate row when substrateActive=false", () => {
    render(React.createElement(WhatsHereCard, {
      data: makeData({ substrateActive: false, substrateName: null }),
    }));
    expect(screen.queryByText("Substrate")).toBeNull();
  });

  it("renders the tidal row when tidalActive=true", () => {
    render(React.createElement(WhatsHereCard, {
      data: makeData({ tidalActive: true, tidalPhase: "Flooding", tidalHeight: 1.5, hasAnyData: true }),
    }));
    expect(screen.getByText(/tide/i)).toBeTruthy();
    expect(screen.getByText(/Flooding/i)).toBeTruthy();
  });

  it("does NOT render the tidal row when tidalActive=false", () => {
    render(React.createElement(WhatsHereCard, {
      data: makeData({ tidalActive: false }),
    }));
    expect(screen.queryByText(/^tide$/i)).toBeNull();
  });

  it("shows the no-data prompt when hasAnyData=false", () => {
    render(React.createElement(WhatsHereCard, { data: makeData({ hasAnyData: false }) }));
    expect(screen.getByText(/Enable Substrate or Habitat overlays/i)).toBeTruthy();
  });

  it("does NOT show no-data prompt when hasAnyData=true", () => {
    render(React.createElement(WhatsHereCard, {
      data: makeData({ hasAnyData: true, tidalActive: true, tidalPhase: "Ebbing", tidalHeight: 0.5 }),
    }));
    expect(screen.queryByText(/Enable Substrate or Habitat overlays/i)).toBeNull();
  });

  it("renders depth row when depth is non-null", () => {
    render(React.createElement(WhatsHereCard, { data: makeData({ depth: 75 }) }));
    expect(screen.getByText("Depth")).toBeTruthy();
  });
});

describe("WhatsHereCard — substrate row disappears when overlay toggled off", () => {
  it("substrate row absent after re-render with substrateActive=false", () => {
    const { rerender } = render(React.createElement(WhatsHereCard, {
      data: makeData({ substrateActive: true, substrateName: "Gravel", hasAnyData: true }),
    }));
    expect(screen.getByText("Substrate")).toBeTruthy();
    expect(screen.getByText("Gravel")).toBeTruthy();

    rerender(React.createElement(WhatsHereCard, {
      data: makeData({ substrateActive: false, substrateName: null, hasAnyData: false }),
    }));

    expect(screen.queryByText("Substrate")).toBeNull();
    expect(screen.queryByText("Gravel")).toBeNull();
    expect(screen.getByText(/Enable Substrate or Habitat overlays/i)).toBeTruthy();
  });
});
