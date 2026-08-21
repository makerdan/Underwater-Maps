/**
 * Settings shell regression tests — sync-status indicator, unmount flush
 * guard, tab URL round-trip, back-button navigation, and tab ARIA semantics.
 *
 * The server-sync hook module is mocked with a controllable external store so
 * the indicator's three states (saving / synced / error) can be driven
 * directly, and `flushServerSync` is a spy so flush behaviour on unmount and
 * tab switches can be asserted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

// ---- Heavy module mocks (Clerk, react-query, API hooks, wouter, idb) ----
vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat();
});

const mockSetLocation = vi.hoisted(() => vi.fn());
vi.mock("wouter", () => ({
  useLocation: () => ["/settings", mockSetLocation],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// Controllable stand-in for the sync hook's external sync-status store.
const syncControl = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    snapshot: { syncing: false, lastSyncFailed: false },
  };
  const flushServerSync = vi.fn(() => Promise.resolve());
  const setStatus = (next: { syncing: boolean; lastSyncFailed: boolean }) => {
    state.snapshot = next;
    for (const l of Array.from(listeners)) l();
  };
  return { listeners, state, flushServerSync, setStatus };
});

vi.mock("@/hooks/useServerSettingsSync", () => ({
  flushServerSync: syncControl.flushServerSync,
  subscribeSettingsSyncStatus: (listener: () => void) => {
    syncControl.listeners.add(listener);
    return () => syncControl.listeners.delete(listener);
  },
  getSettingsSyncStatus: () => syncControl.state.snapshot,
}));

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetSettings: () => ({ data: null }),
  }),
);

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { activeGrid: null }) => unknown) => sel({ activeGrid: null }),
}));

vi.mock("idb-keyval", () => ({
  keys: () => Promise.resolve([]),
  clear: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  del: () => Promise.resolve(),
}));

vi.mock("@/hooks/useUpscaledHeatmap", () => ({
  clearUpscaleCache: vi.fn(() => Promise.resolve()),
  getUpscaleCacheInfo: vi.fn(() => Promise.resolve({ count: 0, bytes: 0 })),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ---- Imports under test ----
import { Settings } from "@/pages/Settings";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { NAV_TABS, type Tab } from "@/pages/settings/constants";
const tabLabel = (id: Tab) => NAV_TABS.find((t) => t.id === id)!.label;

/** Make the settings store dirty relative to its synced snapshot. */
function makeDirty() {
  act(() => {
    useSettingsStore.getState().setMouseZoomSensitivity(2.5);
  });
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
  syncControl.state.snapshot = { syncing: false, lastSyncFailed: false };
  syncControl.flushServerSync.mockClear();
  mockSetLocation.mockClear();
  // Reset the URL so ?tab params never leak between tests.
  window.history.replaceState(null, "", "/settings");
});

afterEach(() => {
  window.history.replaceState(null, "", "/settings");
});

describe("Settings sync-status indicator", () => {
  it("shows 'synced to cloud' when clean and the last sync succeeded", () => {
    render(<Settings />);
    const el = screen.getByTestId("topbar-sync-status");
    expect(el).toHaveAttribute("data-sync-state", "synced");
    expect(el).toHaveTextContent(/synced to cloud/i);
  });

  it("shows 'save failed' on the first render when a previous save failed", () => {
    syncControl.state.snapshot = { syncing: false, lastSyncFailed: true };
    render(<Settings />);
    const el = screen.getByTestId("topbar-sync-status");
    expect(el).toHaveAttribute("data-sync-state", "error");
    expect(el).toHaveTextContent(/save failed/i);
  });

  it("shows 'saving…' when the store is dirty", () => {
    render(<Settings />);
    makeDirty();
    const el = screen.getByTestId("topbar-sync-status");
    expect(el).toHaveAttribute("data-sync-state", "saving");
  });

  it("shows 'saving…' while a sync is pending or in flight even when clean", () => {
    render(<Settings />);
    act(() => syncControl.setStatus({ syncing: true, lastSyncFailed: false }));
    expect(screen.getByTestId("topbar-sync-status")).toHaveAttribute(
      "data-sync-state",
      "saving",
    );
  });

  it("shows 'save failed' with a retry control when the last sync errored", () => {
    render(<Settings />);
    act(() => syncControl.setStatus({ syncing: false, lastSyncFailed: true }));
    const el = screen.getByTestId("topbar-sync-status");
    expect(el).toHaveAttribute("data-sync-state", "error");
    expect(el).toHaveTextContent(/save failed/i);
    // Retry triggers an immediate flush.
    fireEvent.click(screen.getByTestId("topbar-sync-retry"));
    expect(syncControl.flushServerSync).toHaveBeenCalledTimes(1);
  });

  it("error state takes priority over dirty, and a new in-flight sync returns to 'saving…'", () => {
    render(<Settings />);
    makeDirty();
    act(() => syncControl.setStatus({ syncing: false, lastSyncFailed: true }));
    expect(screen.getByTestId("topbar-sync-status")).toHaveAttribute(
      "data-sync-state",
      "error",
    );
    // Retry in flight → back to saving even though the last attempt failed.
    act(() => syncControl.setStatus({ syncing: true, lastSyncFailed: true }));
    expect(screen.getByTestId("topbar-sync-status")).toHaveAttribute(
      "data-sync-state",
      "saving",
    );
  });
});

describe("Settings unmount flush guard", () => {
  it("does NOT flush on unmount when there are no unsaved changes", () => {
    const { unmount } = render(<Settings />);
    unmount();
    expect(syncControl.flushServerSync).not.toHaveBeenCalled();
  });

  it("flushes on unmount when there are unsaved changes", () => {
    const { unmount } = render(<Settings />);
    makeDirty();
    unmount();
    expect(syncControl.flushServerSync).toHaveBeenCalledTimes(1);
  });
});

describe("Settings tab URL round-trip", () => {
  it("opens the section named by ?tab= on mount", () => {
    window.history.replaceState(null, "", "/settings?tab=navigation");
    render(<Settings />);
    expect(screen.getByText("Mouse Wheel Zoom Sensitivity")).toBeInTheDocument();
    expect(screen.getByText(tabLabel("navigation"))).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("writes the tab to the URL when switching sections", () => {
    render(<Settings />);
    fireEvent.click(screen.getByText(tabLabel("accessibility")));
    expect(window.location.search).toContain("tab=accessibility");
    expect(screen.getByText(tabLabel("accessibility"))).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("falls back to the visuals default for unknown ?tab= values", () => {
    window.history.replaceState(null, "", "/settings?tab=not-a-real-tab");
    render(<Settings />);
    expect(screen.getByText("QUALITY PRESET")).toBeInTheDocument();
    expect(screen.getByText(tabLabel("visuals"))).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("auto-flushes unsaved changes when switching tabs while dirty", () => {
    render(<Settings />);
    makeDirty();
    fireEvent.click(screen.getByText(tabLabel("navigation")));
    expect(syncControl.flushServerSync).toHaveBeenCalledTimes(1);
    // Switch still happens optimistically.
    expect(screen.getByText("Mouse Wheel Zoom Sensitivity")).toBeInTheDocument();
  });

  it("does not flush when switching tabs while clean", () => {
    render(<Settings />);
    fireEvent.click(screen.getByText(tabLabel("navigation")));
    expect(syncControl.flushServerSync).not.toHaveBeenCalled();
  });
});

describe("Settings back-button navigation", () => {
  it("uses history.back() when there is a previous history entry", async () => {
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    // Grow the history stack past the initial entry.
    window.history.pushState(null, "", "/settings");
    render(<Settings />);
    fireEvent.click(screen.getByTestId("settings-back-btn"));
    await waitFor(() => expect(backSpy).toHaveBeenCalledTimes(1));
    expect(mockSetLocation).not.toHaveBeenCalled();
    backSpy.mockRestore();
    // Restore stack depth for subsequent tests (jsdom shares the history).
    window.history.back();
  });
});

describe("Settings nav accessibility", () => {
  it("the nav has an accessible label and exactly one aria-current tab", () => {
    render(<Settings />);
    expect(
      screen.getByRole("navigation", { name: "Settings sections" }),
    ).toBeInTheDocument();
    const current = document.querySelectorAll("[aria-current='page']");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(tabLabel("visuals"));
  });
});
