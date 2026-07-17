/**
 * settingsSyncToast.test.ts
 *
 * Verifies:
 *  1. useServerSettingsSync fires a toast (with a "Retry now" action) after
 *     FLUSH_FAILURE_TOAST_THRESHOLD (3) consecutive debounce-triggered flush
 *     failures, and resets the counter on a successful PUT so a fresh streak
 *     of failures triggers the toast again.
 *
 *  2. After 3 failures the sync loop enters exponential back-off (30 s first
 *     step). scheduleSync() is a no-op while backed off; the back-off timer
 *     fires a retry automatically; and the "Retry now" action bypasses the
 *     timer entirely.
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

const { mockToast, mockDismiss } = vi.hoisted(() => {
  const mockDismiss = vi.fn();
  const mockToast = vi.fn(() => ({ id: "test-toast", dismiss: mockDismiss, update: vi.fn() }));
  return { mockToast, mockDismiss };
});

const saveSettingsMock = vi.hoisted(() => ({
  mutateAsync: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/ui/toast", () => ({
  ToastAction: (props: Record<string, unknown>) => props,
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
      setState: vi.fn(),
    },
  ),
  CURRENT_DEPTH_LAYERS: [],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function triggerFlushAndAdvance(ms = 400) {
  const { requestSettingsSync } = await import("@/hooks/useServerSettingsSync");
  act(() => { requestSettingsSync(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Returns the onClick handler registered on the "Retry now" toast action element. */
function getRetryHandler(): (() => void) | undefined {
  const lastCall = mockToast.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
  if (!lastCall) return undefined;
  // toast({ action: createElement(ToastAction, { onClick, altText }) }) —
  // the action value is a React element; onClick lives in element.props.
  const action = lastCall.action as { props?: Record<string, unknown> } | undefined;
  return action?.props?.onClick as (() => void) | undefined;
}

// ── Suite 1: toast after 3 consecutive failures ───────────────────────────────

describe("useServerSettingsSync — toast after 3 consecutive flush failures", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    mockToast.mockClear();
    mockDismiss.mockClear();
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
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    expect(mockToast).not.toHaveBeenCalled();

    await triggerFlushAndAdvance();
    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Settings not saving" }),
    );
  });

  it("toast includes a 'Retry now' action element", async () => {
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();

    expect(mockToast).toHaveBeenCalledOnce();
    const toastArg = mockToast.mock.calls[0][0] as Record<string, unknown>;
    expect(toastArg.action).toBeDefined();
    // action is a React element created with createElement(ToastAction, props);
    // the handler lives in element.props, not at the top level.
    const action = toastArg.action as { props: Record<string, unknown> };
    expect(action.props.altText).toBe("Retry now");
    expect(typeof action.props.onClick).toBe("function");
  });

  it("resets the counter on a successful PUT so a new streak triggers the toast again", async () => {
    // First streak: 3 failures → toast fires.
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    expect(mockToast).toHaveBeenCalledOnce();
    // Capture handler before clearing the mock.
    const retryNow = getRetryHandler();
    expect(retryNow).toBeDefined();
    mockToast.mockClear();

    // Successful PUT via "Retry now" action — resets the counter and exits back-off.
    saveSettingsMock.mutateAsync.mockResolvedValueOnce({ __updatedAt: "2026-01-01T00:00:00Z" });
    await act(async () => { retryNow!(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
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

// ── Suite 2: back-off schedule ────────────────────────────────────────────────

describe("useServerSettingsSync — exponential back-off after threshold failures", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    mockToast.mockClear();
    mockDismiss.mockClear();
    saveSettingsMock.mutateAsync.mockReset();
    saveSettingsMock.mutateAsync.mockRejectedValue(new Error("Network Error"));

    const { useServerSettingsSync } = await import("@/hooks/useServerSettingsSync");
    renderHook(() => useServerSettingsSync());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("pauses the sync loop during back-off: extra scheduleSync calls don't trigger more flushes", async () => {
    // Enter back-off after 3 failures.
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    expect(mockToast).toHaveBeenCalledOnce();

    const callsAfterBackOff = saveSettingsMock.mutateAsync.mock.calls.length;

    // scheduleSync calls during back-off must not arm a new debounce.
    const { requestSettingsSync } = await import("@/hooks/useServerSettingsSync");
    act(() => { requestSettingsSync(); });
    act(() => { requestSettingsSync(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    // No additional PUT should have been attempted.
    expect(saveSettingsMock.mutateAsync.mock.calls.length).toBe(callsAfterBackOff);
  });

  it("fires automatic retry after the first back-off delay (30 s)", async () => {
    // Enter back-off.
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    expect(mockToast).toHaveBeenCalledOnce();
    mockToast.mockClear();

    const callsBefore = saveSettingsMock.mutateAsync.mock.calls.length;

    // Advance just under 30 s — no retry yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(saveSettingsMock.mutateAsync.mock.calls.length).toBe(callsBefore);

    // Advance the remaining 1 s — back-off timer fires and calls flush().
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(saveSettingsMock.mutateAsync.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("escalates the back-off delay to 60 s after a second failure streak", async () => {
    // First streak → 30 s back-off.
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    mockToast.mockClear();

    // Advance 30 s — auto-retry fires and fails again → enters 60 s back-off.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_100); });
    // A second toast should have fired for the second back-off entry.
    expect(mockToast).toHaveBeenCalledOnce();
    mockToast.mockClear();

    const callsBefore = saveSettingsMock.mutateAsync.mock.calls.length;

    // Only 45 s into the second back-off — no retry yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(saveSettingsMock.mutateAsync.mock.calls.length).toBe(callsBefore);

    // Advance past 60 s — retry fires.
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(saveSettingsMock.mutateAsync.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("Retry now bypasses back-off timer and immediately attempts a PUT", async () => {
    // Enter back-off.
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    expect(mockToast).toHaveBeenCalledOnce();

    const callsBefore = saveSettingsMock.mutateAsync.mock.calls.length;

    // Invoke the "Retry now" action without waiting 30 s.
    const retryNow = getRetryHandler();
    expect(retryNow).toBeDefined();
    await act(async () => { retryNow!(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    // A PUT should have been attempted immediately.
    expect(saveSettingsMock.mutateAsync.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("exits back-off on a successful 'Retry now' and allows normal debounced syncs again", async () => {
    // Enter back-off.
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    await triggerFlushAndAdvance();
    // Capture handler before clearing the mock.
    const retryNow = getRetryHandler();
    expect(retryNow).toBeDefined();
    mockToast.mockClear();

    // Successful retry via button.
    saveSettingsMock.mutateAsync.mockResolvedValueOnce({ __updatedAt: "2026-01-01T00:00:00Z" });
    await act(async () => { retryNow!(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    // Back-off should be cleared — a new scheduleSync call should proceed normally.
    saveSettingsMock.mutateAsync.mockRejectedValue(new Error("Network Error"));
    const callsBefore = saveSettingsMock.mutateAsync.mock.calls.length;
    const { requestSettingsSync } = await import("@/hooks/useServerSettingsSync");
    act(() => { requestSettingsSync(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    expect(saveSettingsMock.mutateAsync.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
