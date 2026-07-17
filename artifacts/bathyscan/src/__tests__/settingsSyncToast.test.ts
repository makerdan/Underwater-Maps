/**
 * settingsSyncToast.test.ts
 *
 * Verifies that useServerSettingsSync fires a toast warning after
 * FLUSH_FAILURE_TOAST_THRESHOLD (3) consecutive debounce-triggered flush
 * failures, and resets the counter on a successful PUT so a fresh streak
 * of failures triggers the toast again.
 *
 * Strategy:
 * - Mount the hook via renderHook with fake timers.
 * - Mock useGetSettings to return isError:true so the hook sets
 *   _serverSettled = true immediately (via the settingsFetchError effect).
 * - Mock usePutSettings.mutateAsync to always reject, then resolve.
 * - Call requestSettingsSync() three times, advancing 400 ms past each
 *   debounce window, and assert toast fires on the third failure.
 * - Switch mock to resolve, call once, assert counter resets.
 * - Return mock to reject and confirm a fresh streak triggers toast again.
 *
 * Note: vi.resetModules() in afterEach is essential because the hook
 * exports module-level counters (_consecutiveFlushFailures etc.) that
 * must start from zero on each test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

const saveSettingsMock = vi.hoisted(() => ({
  mutateAsync: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({ isSignedIn: true, isLoaded: true }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetSettings: () => ({
    // isError:true causes the settingsFetchError effect to set _serverSettled = true
    // immediately after mount, unblocking flush() from its _serverSettled wait loop.
    data: undefined,
    isLoading: false,
    isError: true,
  }),
  getGetSettingsQueryKey: () => ["settings"],
  usePutSettings: () => ({
    mutateAsync: saveSettingsMock.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/lib/settingsStore", () => {
  const state = {
    waterType: "saltwater",
    units: "metric",
    bookmarks: [],
    markAllSaved: vi.fn(),
    hydrateFromServer: vi.fn(),
    clearForSignOut: vi.fn(),
    resetSection: vi.fn(),
    resetAll: vi.fn(),
    setDatasetHome: vi.fn(),
    clearDatasetHome: vi.fn(),
    datasetHomePositions: {},
    syncedSnapshot: null,
  };
  const useSettingsStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    {
      getState: () => state,
      subscribe: vi.fn(() => () => {}),
      setState: vi.fn(),
    },
  );
  return {
    useSettingsStore,
    getDataSnapshot: () => ({ waterType: "saltwater", units: "metric" }),
    hydrateFromServer: vi.fn(),
  };
});

vi.mock("@/lib/paletteStore", () => {
  const state = { rev: 0, hydrateFromServer: vi.fn(), reset: vi.fn() };
  const usePaletteStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    {
      getState: () => state,
      subscribe: vi.fn(() => () => {}),
    },
  );
  return { usePaletteStore };
});

vi.mock("@/lib/panelCollapseStore", () => {
  const state = { collapsed: {}, hydrateFromServer: vi.fn() };
  const usePanelCollapseStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    {
      getState: () => state,
      subscribe: vi.fn(() => () => {}),
      setState: vi.fn(),
    },
  );
  return { usePanelCollapseStore, DEFAULTS: {}, PanelId: undefined };
});

vi.mock("@/lib/zoneOverlayStore", () => {
  const state = { saltwater: false, freshwater: false };
  const useZoneOverlayStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    {
      getState: () => state,
      subscribe: vi.fn(() => () => {}),
    },
  );
  return { useZoneOverlayStore };
});

vi.mock("@/lib/uiStore", () => ({
  useUiStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) =>
      sel ? sel({}) : {},
    {
      getState: () => ({}),
      subscribe: vi.fn(() => () => {}),
    },
  ),
  CURRENT_DEPTH_LAYERS: [],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function triggerFlushAndAdvance() {
  const { requestSettingsSync } = await import("@/hooks/useServerSettingsSync");
  act(() => { requestSettingsSync(); });
  // Advance past the 300 ms debounce window and let the async flush settle.
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useServerSettingsSync — toast after 3 consecutive flush failures", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    mockToast.mockClear();
    saveSettingsMock.mutateAsync.mockReset();
    saveSettingsMock.mutateAsync.mockRejectedValue(new Error("Network Error"));

    // Mount the hook so _flush and _scheduleSync module refs are populated,
    // and so the useEffect for settingsFetchError fires to set _serverSettled.
    const { useServerSettingsSync } = await import("@/hooks/useServerSettingsSync");
    renderHook(() => useServerSettingsSync());

    // Allow the settingsFetchError effect (which sets _serverSettled = true)
    // to run. One tick of the fake timer loop is enough for useEffect to fire.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("fires toast with 'Settings not saving' title after exactly 3 consecutive failures", async () => {
    // First two failures — counter at 1, then 2. No toast yet.
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    expect(mockToast).not.toHaveBeenCalled();

    // Third failure — counter reaches 3, toast fires, counter resets.
    await triggerFlushAndAdvance();
    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Settings not saving" }),
    );
  });

  it("resets the counter on a successful PUT so a new streak triggers the toast again", async () => {
    // First streak: 3 failures → toast fires.
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    expect(mockToast).toHaveBeenCalledOnce();
    mockToast.mockClear();

    // Successful PUT — resets the counter.
    saveSettingsMock.mutateAsync.mockResolvedValueOnce({ __updatedAt: "2026-01-01T00:00:00Z" });
    await triggerFlushAndAdvance();
    expect(mockToast).not.toHaveBeenCalled();

    // Back to rejecting — new streak of 3 must fire the toast again.
    saveSettingsMock.mutateAsync.mockRejectedValue(new Error("Network Error"));
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    expect(mockToast).not.toHaveBeenCalled();
    await triggerFlushAndAdvance();
    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Settings not saving" }),
    );
  });

  it("does not fire toast after only 2 failures", async () => {
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    expect(mockToast).not.toHaveBeenCalled();
  });
});
