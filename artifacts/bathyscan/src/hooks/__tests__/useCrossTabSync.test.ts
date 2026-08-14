/**
 * useCrossTabSync — unit tests
 *
 * Covers:
 *   - A storage event for "bathyscan:settings" triggers useSettingsStore.persist.rehydrate()
 *   - A storage event for "bathyscan:palette" triggers usePaletteStore.persist.rehydrate()
 *   - A storage event for "bathyscan:panel-collapse" triggers usePanelCollapseStore.persist.rehydrate()
 *   - A storage event for "bathyscan-help-window" triggers useHelpStore.persist.rehydrate()
 *   - A storage event for "bathyscan:savedDriftPlans" calls useDriftStore.reloadSavedPlans()
 *     and the store's in-memory savedDriftPlans updates from the new localStorage value
 *   - A storage event for "bathyscan:zoneOverlaySlots:saltwater" calls
 *     useZoneOverlayStore.reloadFromStorage() and slot colors update from localStorage
 *   - A storage event for "bathyscan:zoneOverlaySlots:freshwater" also triggers reloadFromStorage()
 *   - Events with newValue === null (key removal) are ignored — no rehydration
 *   - Events for unrelated keys are ignored
 *   - The listener is removed on cleanup (unmount)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCrossTabSync } from "@/hooks/useCrossTabSync";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { useDriftStore } from "@/lib/driftStore";
import { useZoneOverlayStore } from "@/lib/zoneOverlayStore";

// ── Hoisted mocks (must precede vi.mock calls) ────────────────────────────────

const { settingsRehydrate, paletteRehydrate, helpRehydrate } = vi.hoisted(() => {
  const settingsRehydrate = vi.fn();
  const paletteRehydrate = vi.fn();
  const helpRehydrate = vi.fn();
  return { settingsRehydrate, paletteRehydrate, helpRehydrate };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: {
    persist: { rehydrate: settingsRehydrate, hasHydrated: () => true },
    getState: () => ({}),
    setState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock("@/lib/paletteStore", () => ({
  usePaletteStore: {
    persist: { rehydrate: paletteRehydrate, hasHydrated: () => true },
    getState: () => ({}),
    setState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock("@/lib/helpStore", () => ({
  useHelpStore: {
    persist: { rehydrate: helpRehydrate, hasHydrated: () => true },
    getState: () => ({}),
    setState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Dispatch a synthetic StorageEvent on the window. This is the standard way to
 * simulate a cross-tab storage write in jsdom — browsers only fire the native
 * event in OTHER tabs; we simulate that here.
 */
function fireStorageEvent(key: string, newValue: string | null, oldValue: string | null = null) {
  window.dispatchEvent(
    new StorageEvent("storage", { key, newValue, oldValue, storageArea: localStorage }),
  );
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe("useCrossTabSync — persist store rehydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls useSettingsStore.persist.rehydrate() when the settings key changes", () => {
    const { unmount } = renderHook(() => useCrossTabSync());
    fireStorageEvent("bathyscan:settings", JSON.stringify({ schemaVersion: 35 }));
    expect(settingsRehydrate).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("calls usePaletteStore.persist.rehydrate() when the palette key changes", () => {
    const { unmount } = renderHook(() => useCrossTabSync());
    fireStorageEvent("bathyscan:palette", JSON.stringify({ bandColors: ["#ff0000"] }));
    expect(paletteRehydrate).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("calls usePanelCollapseStore.persist.rehydrate() when the panel-collapse key changes", () => {
    const rehydrateSpy = vi.spyOn(usePanelCollapseStore.persist, "rehydrate");
    const { unmount } = renderHook(() => useCrossTabSync());
    fireStorageEvent("bathyscan:panel-collapse", JSON.stringify({ collapsed: {} }));
    expect(rehydrateSpy).toHaveBeenCalledTimes(1);
    unmount();
    rehydrateSpy.mockRestore();
  });

  it("calls useHelpStore.persist.rehydrate() when the help-window key changes", () => {
    const { unmount } = renderHook(() => useCrossTabSync());
    fireStorageEvent("bathyscan-help-window", JSON.stringify({ minimized: true }));
    expect(helpRehydrate).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("useCrossTabSync — driftStore savedDriftPlans cross-tab update", () => {
  const SAVED_PLANS_KEY = "bathyscan:savedDriftPlans";

  const fakePlan = {
    id: "plan_test_001",
    name: "Test Plan",
    savedAt: "2026-01-01T00:00:00.000Z",
    lineLengthM: 150,
    lineWeightG: 300,
    driftMode: "drift" as const,
    boatHeadingDeg: 90,
    boatSpeedKnots: 2,
    waypoints: [],
    startLat: null,
    startLon: null,
  };

  beforeEach(() => {
    // Clear localStorage and reset driftStore's savedDriftPlans to empty
    localStorage.clear();
    useDriftStore.setState({ savedDriftPlans: [], skippedPlanCount: 0 });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("updates savedDriftPlans in-memory when the savedDriftPlans key fires a storage event", () => {
    const { unmount } = renderHook(() => useCrossTabSync());

    // Simulate another tab writing a new plan to localStorage
    const payload = JSON.stringify([fakePlan]);
    localStorage.setItem(SAVED_PLANS_KEY, payload);

    // Dispatch the storage event (browsers fire this in OTHER tabs only)
    fireStorageEvent(SAVED_PLANS_KEY, payload);

    const plans = useDriftStore.getState().savedDriftPlans;
    expect(plans).toHaveLength(1);
    expect(plans[0]!.id).toBe("plan_test_001");
    expect(plans[0]!.name).toBe("Test Plan");

    unmount();
  });

  it("clears savedDriftPlans when another tab deletes all plans", () => {
    // Start with one plan in memory
    useDriftStore.setState({ savedDriftPlans: [fakePlan as never], skippedPlanCount: 0 });

    const { unmount } = renderHook(() => useCrossTabSync());

    // Another tab wrote an empty array
    const payload = JSON.stringify([]);
    localStorage.setItem(SAVED_PLANS_KEY, payload);
    fireStorageEvent(SAVED_PLANS_KEY, payload);

    expect(useDriftStore.getState().savedDriftPlans).toHaveLength(0);

    unmount();
  });

  it("skips corrupt plans and reports skippedPlanCount", () => {
    const { unmount } = renderHook(() => useCrossTabSync());

    // One valid, one corrupt
    const payload = JSON.stringify([fakePlan, { broken: true }]);
    localStorage.setItem(SAVED_PLANS_KEY, payload);
    fireStorageEvent(SAVED_PLANS_KEY, payload);

    const state = useDriftStore.getState();
    expect(state.savedDriftPlans).toHaveLength(1);
    expect(state.skippedPlanCount).toBe(1);

    unmount();
  });
});

describe("useCrossTabSync — zoneOverlayStore cross-tab update", () => {
  const LS_KEY_SW = "bathyscan:zoneOverlaySlots:saltwater";
  const LS_KEY_FW = "bathyscan:zoneOverlaySlots:freshwater";

  beforeEach(() => {
    localStorage.clear();
    // Reset store to defaults
    useZoneOverlayStore.setState({
      saltwater: [
        { color: "#f5d58a", visible: true },
        { color: "#c49a6c", visible: true },
        { color: "#8ab4d0", visible: true },
        { color: "#b06060", visible: true },
      ],
      freshwater: [
        { color: "#f5d58a", visible: true },
        { color: "#c49a6c", visible: true },
        { color: "#8ab4d0", visible: true },
        { color: "#b06060", visible: true },
      ],
      activeWaterType: "saltwater",
      slots: [
        { color: "#f5d58a", visible: true },
        { color: "#c49a6c", visible: true },
        { color: "#8ab4d0", visible: true },
        { color: "#b06060", visible: true },
      ],
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("updates saltwater slot colors when the saltwater key fires a storage event", () => {
    const { unmount } = renderHook(() => useCrossTabSync());

    const newSlots = [
      { color: "#aabbcc", visible: true },
      { color: "#112233", visible: true },
      { color: "#445566", visible: true },
      { color: "#778899", visible: true },
    ];
    const payload = JSON.stringify(newSlots);
    localStorage.setItem(LS_KEY_SW, payload);
    fireStorageEvent(LS_KEY_SW, payload);

    const state = useZoneOverlayStore.getState();
    expect(state.saltwater[0]!.color).toBe("#aabbcc");
    expect(state.saltwater[3]!.color).toBe("#778899");
    // slots mirrors the active (saltwater) set
    expect(state.slots[0]!.color).toBe("#aabbcc");

    unmount();
  });

  it("updates freshwater slot colors when the freshwater key fires a storage event", () => {
    const { unmount } = renderHook(() => useCrossTabSync());

    const newSlots = [
      { color: "#001122", visible: true },
      { color: "#334455", visible: false },
      { color: "#667788", visible: true },
      { color: "#99aabb", visible: true },
    ];
    const payload = JSON.stringify(newSlots);
    localStorage.setItem(LS_KEY_FW, payload);
    fireStorageEvent(LS_KEY_FW, payload);

    const state = useZoneOverlayStore.getState();
    expect(state.freshwater[0]!.color).toBe("#001122");
    expect(state.freshwater[1]!.visible).toBe(false);

    unmount();
  });
});

describe("useCrossTabSync — driftStore driftPlannerActive cross-tab update", () => {
  beforeEach(() => {
    useDriftStore.setState({ driftPlannerActive: false });
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("sets driftPlannerActive to true when another tab writes 'true'", () => {
    const { unmount } = renderHook(() => useCrossTabSync());

    localStorage.setItem("bathyscan:driftPlannerActive", "true");
    fireStorageEvent("bathyscan:driftPlannerActive", "true");

    expect(useDriftStore.getState().driftPlannerActive).toBe(true);
    unmount();
  });

  it("sets driftPlannerActive to false when another tab writes 'false'", () => {
    useDriftStore.setState({ driftPlannerActive: true });
    const { unmount } = renderHook(() => useCrossTabSync());

    localStorage.setItem("bathyscan:driftPlannerActive", "false");
    fireStorageEvent("bathyscan:driftPlannerActive", "false");

    expect(useDriftStore.getState().driftPlannerActive).toBe(false);
    unmount();
  });
});

describe("useCrossTabSync — driftStore boatProfileId cross-tab update", () => {
  const DEFAULT_ID = "open-skiff";

  beforeEach(() => {
    useDriftStore.setState({ boatProfileId: DEFAULT_ID });
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("updates boatProfileId when another tab writes a new profile id", () => {
    const { unmount } = renderHook(() => useCrossTabSync());

    localStorage.setItem("bathyscan:boatProfileId", "center-console");
    fireStorageEvent("bathyscan:boatProfileId", "center-console");

    expect(useDriftStore.getState().boatProfileId).toBe("center-console");
    unmount();
  });

  it("does not change boatProfileId when newValue is null (key removal)", () => {
    const { unmount } = renderHook(() => useCrossTabSync());

    fireStorageEvent("bathyscan:boatProfileId", null);

    expect(useDriftStore.getState().boatProfileId).toBe(DEFAULT_ID);
    unmount();
  });
});

describe("useCrossTabSync — guard: null newValue is ignored", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not call rehydrate when newValue is null (key removal)", () => {
    const { unmount } = renderHook(() => useCrossTabSync());

    fireStorageEvent("bathyscan:settings", null);
    fireStorageEvent("bathyscan:palette", null);
    fireStorageEvent("bathyscan:savedDriftPlans", null);

    expect(settingsRehydrate).not.toHaveBeenCalled();
    expect(paletteRehydrate).not.toHaveBeenCalled();

    unmount();
  });
});

describe("useCrossTabSync — guard: unrelated keys are ignored", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not call any store method for an unrelated key", () => {
    const rehydrateSpy = vi.spyOn(usePanelCollapseStore.persist, "rehydrate");
    const { unmount } = renderHook(() => useCrossTabSync());

    fireStorageEvent("some-other-app:token", "abc123");
    fireStorageEvent("bathyscan:unrelated", "{}");

    expect(settingsRehydrate).not.toHaveBeenCalled();
    expect(paletteRehydrate).not.toHaveBeenCalled();
    expect(helpRehydrate).not.toHaveBeenCalled();
    expect(rehydrateSpy).not.toHaveBeenCalled();

    unmount();
    rehydrateSpy.mockRestore();
  });
});

describe("useCrossTabSync — listener cleanup on unmount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not call rehydrate after the hook is unmounted", () => {
    const { unmount } = renderHook(() => useCrossTabSync());
    unmount();

    // Fire event AFTER unmount — should be a no-op
    fireStorageEvent("bathyscan:settings", JSON.stringify({ schemaVersion: 35 }));
    expect(settingsRehydrate).not.toHaveBeenCalled();
  });
});
