/**
 * Regression test for WT-003 (water-type scoped UX audit):
 * FindDataPanel's catalog search must forward the active exploration mode
 * (`waterType`) to the search API.
 *
 * Before the fix, the params omitted `waterType` entirely — the server
 * (which supports the filter) returned BOTH modes' datasets, so a
 * freshwater user searching in Find Data saw saltwater results and vice
 * versa. Because waterType is part of the params (and therefore the query
 * key), a mode switch while the panel is open must also refetch with the
 * new value.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, act } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isFetching: false, isLoading: false, isError: false };
  }
  function mutationHook() {
    return {
      mutate: noop,
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      isSuccess: false,
      variables: undefined,
    };
  }
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
          return (...a: unknown[]) => `/api/mock/${(a as string[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

// Most recent params the catalog search hook was called with.
let catalogSearchParams: { q?: string; dataType?: string; waterType?: string } = {};

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasetsCatalogSearch: (params: { q?: string; dataType?: string; waterType?: string }) => {
        catalogSearchParams = params ?? {};
        return { data: [], isFetching: false };
      },
      useGetDatasetsMySaves: () => ({ data: [], isFetching: false }),
    }),
);

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setPendingExternalUserDatasetId: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn: false, isLoaded: true }) });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQueries: ({ queries }: { queries: unknown[] }) =>
    queries.map(() => ({
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
    })),
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

const onClose = vi.fn();

describe("FindDataPanel — catalog search waterType param (WT-003)", () => {
  beforeEach(() => {
    onClose.mockClear();
    catalogSearchParams = {};
    try { localStorage.clear(); } catch { /* ignore */ }
    useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
  });

  it("forwards the active mode to the search API (saltwater default)", () => {
    renderWithProviders(<FindDataPanel onClose={onClose} />);
    expect(catalogSearchParams.waterType).toBe("saltwater");
  });

  it("forwards freshwater when that mode is active", () => {
    useSettingsStore.setState({ waterType: "freshwater" });
    renderWithProviders(<FindDataPanel onClose={onClose} />);
    expect(catalogSearchParams.waterType).toBe("freshwater");
  });

  it("updates the params when the mode switches while the panel is open", () => {
    renderWithProviders(<FindDataPanel onClose={onClose} />);
    expect(catalogSearchParams.waterType).toBe("saltwater");

    act(() => {
      useSettingsStore.setState({ waterType: "freshwater" });
    });
    expect(catalogSearchParams.waterType).toBe("freshwater");
    // Panel still mounted and functional after the switch.
    expect(screen.getByTestId("find-data-search-input")).toBeInTheDocument();
  });
});
