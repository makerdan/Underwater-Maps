/**
 * useServerSettingsSync.singletonGuard.test.ts
 *
 * Verifies the singleton mount guard added to useServerSettingsSync:
 *
 *   When the hook is mounted a second time while a first instance is still
 *   active, console.error is called with a message that contains
 *   "mounted twice" so the developer sees an immediate, actionable signal
 *   rather than a silent TOCTOU race on the module-level PUT state.
 *
 * Strategy: render the hook twice inside the same test using renderHook,
 * assert console.error fires, then unmount both so the counter is clean for
 * subsequent tests.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── Minimal mocks required for the hook to import cleanly ───────────────────

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({ isSignedIn: false, isLoaded: true }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetSettings: () => ({ data: undefined, isError: false }),
  usePutSettings: () => ({ mutateAsync: vi.fn() }),
  getGetSettingsQueryKey: () => ["settings"],
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        hydrateFromServer: vi.fn(),
        markAllSaved: vi.fn(),
        clearForSignOut: vi.fn(),
        lastSyncedAt: null,
        getDataSnapshot: vi.fn(),
      }),
    {
      getState: () => ({
        hydrateFromServer: vi.fn(),
        markAllSaved: vi.fn(),
        clearForSignOut: vi.fn(),
        lastSyncedAt: null,
      }),
      subscribe: vi.fn(() => vi.fn()),
      setState: vi.fn(),
      persist: { hasHydrated: () => true },
    },
  ),
  getDataSnapshot: vi.fn(() => ({})),
}));

vi.mock("@/lib/paletteStore", () => ({
  usePaletteStore: Object.assign(
    () => undefined,
    {
      getState: () => ({ rev: 0, reset: vi.fn(), hydrateFromServer: vi.fn() }),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: Object.assign(
    () => undefined,
    {
      getState: () => ({ collapsed: {}, setCollapsed: vi.fn() }),
      subscribe: vi.fn(() => vi.fn()),
      setState: vi.fn(),
    },
  ),
  DEFAULTS: {},
}));

vi.mock("@/lib/zoneOverlayStore", () => ({
  useZoneOverlayStore: Object.assign(
    () => undefined,
    {
      getState: () => ({
        saltwater: [],
        freshwater: [],
        hydrateFromServer: vi.fn(),
      }),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

vi.mock("@/lib/uiStore", () => ({
  useUiStore: Object.assign(
    () => undefined,
    { setState: vi.fn() },
  ),
  CURRENT_DEPTH_LAYERS: ["surface", "mid", "bottom"],
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

import { useServerSettingsSync } from "@/hooks/useServerSettingsSync";

describe("useServerSettingsSync — singleton mount guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not call console.error when only one instance is mounted", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { unmount } = renderHook(() => useServerSettingsSync());

    const singletonErrors = spy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("mounted twice"),
    );
    expect(singletonErrors).toHaveLength(0);

    act(() => { unmount(); });
  });

  it("calls console.error with 'mounted twice' when a second instance is mounted while the first is active", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { unmount: unmount1 } = renderHook(() => useServerSettingsSync());

    // Mount a second instance while the first is still alive.
    const { unmount: unmount2 } = renderHook(() => useServerSettingsSync());

    const singletonErrors = spy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("mounted twice"),
    );
    expect(singletonErrors.length).toBeGreaterThanOrEqual(1);

    // Clean up both instances so the mount counter returns to 0.
    act(() => {
      unmount1();
      unmount2();
    });
  });

  it("allows re-mounting after the first instance unmounts (counter resets correctly)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { unmount: unmount1 } = renderHook(() => useServerSettingsSync());
    act(() => { unmount1(); });

    // First instance is gone — a second mount must not trigger the guard.
    const { unmount: unmount2 } = renderHook(() => useServerSettingsSync());

    const singletonErrors = spy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("mounted twice"),
    );
    expect(singletonErrors).toHaveLength(0);

    act(() => { unmount2(); });
  });
});
