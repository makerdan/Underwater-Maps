/**
 * SectionSaveButton — signed-out / local-only flushSync UX.
 *
 * The e2e webServer config (playwright.config.ts) hard-wires
 * VITE_DEV_AUTH_BYPASS=1, which is evaluated at module-init time and cannot
 * be toggled per Playwright test. This vitest spec covers the signed-out
 * branch of the per-section Save flow by mocking `useUser` to return
 * `{ isSignedIn: false }` and rendering the real <Settings/> page.
 *
 * Verifies:
 *   - Editing a HUD field marks the section dirty (data-dirty="true").
 *   - Clicking the HUD SAVE button takes the local-only flushSync branch
 *     (no PUT issued — usePutSettings.mutateAsync is mocked and asserted
 *     unused), then flashes "✓ SAVED" feedback on the button and clears
 *     dirty (data-dirty="false").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({
    useUser: () => ({ user: null, isSignedIn: false, isLoaded: true }),
  });
});

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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

const putSettingsMock = vi.fn();
vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetSettings: () => ({ data: null }),
    usePutSettings: () => ({ mutateAsync: putSettingsMock, mutate: vi.fn() }),
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

import { Settings } from "@/pages/Settings";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
  putSettingsMock.mockReset();
});

describe("SectionSaveButton (signed-out)", () => {
  it("clicking SAVE on a dirty section shows ✓ SAVED feedback without issuing a PUT", async () => {
    render(<Settings />);
    // Switch to the HUD tab.
    fireEvent.click(screen.getByText("DISPLAY & OVERLAYS"));

    const saveBtn = await screen.findByTestId("save-section-hud-btn");
    expect(saveBtn.getAttribute("data-dirty")).toBe("false");
    expect(saveBtn).toBeDisabled();

    // Mutate a HUD field directly through the store (the slider DOM is
    // exercised by the e2e spec); the dirty flag and Save UX are what we
    // care about here.
    act(() => {
      useSettingsStore.getState().setHudOpacity(0.4);
    });

    await waitFor(() => {
      expect(saveBtn.getAttribute("data-dirty")).toBe("true");
    });
    expect(saveBtn).toBeEnabled();

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveBtn.textContent ?? "").toMatch(/✓ SAVED/);
    });
    expect(saveBtn.getAttribute("data-dirty")).toBe("false");
    expect(saveBtn.getAttribute("data-state")).toBe("saved");

    // Signed-out branch must not call the PUT mutation at all.
    expect(putSettingsMock).not.toHaveBeenCalled();
  });
});
