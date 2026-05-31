/**
 * Settings → UNITS section — verifies the units control flips the
 * persisted store value when the user picks Imperial, and switches back
 * to Metric.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({
    user: { primaryEmailAddress: { emailAddress: "test@example.com" }, username: "test" },
    isSignedIn: true,
  }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

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

import { Settings } from "@/pages/Settings";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
});

describe("Settings → UNITS section", () => {
  it("defaults to metric and switches the persisted store when imperial is picked", () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("UNITS"));

    expect(useSettingsStore.getState().units).toBe("metric");

    const getUnitsSelect = () =>
      screen.getAllByRole("combobox")[0] as HTMLSelectElement;

    const select = getUnitsSelect();
    expect(select.value).toBe("metric");

    fireEvent.change(select, { target: { value: "imperial" } });
    expect(useSettingsStore.getState().units).toBe("imperial");
    expect(getUnitsSelect().value).toBe("imperial");

    fireEvent.change(getUnitsSelect(), { target: { value: "metric" } });
    expect(useSettingsStore.getState().units).toBe("metric");
    expect(getUnitsSelect().value).toBe("metric");
  });

  it("temperature-unit override flips only temperatureUnit (not depthUnit or units)", () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("UNITS"));

    // Default: auto. Units row is first, Depth Unit second, Temperature third.
    expect(useSettingsStore.getState().temperatureUnit).toBe("auto");
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const tempSelect = selects[2]!;
    expect(tempSelect.value).toBe("auto");

    fireEvent.change(tempSelect, { target: { value: "fahrenheit" } });
    const state = useSettingsStore.getState();
    expect(state.temperatureUnit).toBe("fahrenheit");
    // The override must not bleed into the other unit prefs.
    expect(state.units).toBe("metric");
    expect(state.depthUnit).toBe("metres");

    fireEvent.change(
      (screen.getAllByRole("combobox") as HTMLSelectElement[])[2]!,
      { target: { value: "celsius" } },
    );
    expect(useSettingsStore.getState().temperatureUnit).toBe("celsius");
  });
});
