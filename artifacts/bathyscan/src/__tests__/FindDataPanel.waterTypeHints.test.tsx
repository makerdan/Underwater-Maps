/**
 * Tests for water-type clarity hints on the external Find Data tabs (task #4037).
 *
 * Coverage:
 *   NCEI Portal tab
 *     1. Shows a notice when the user is in Fresh Water mode (all NCEI results
 *        are ocean/saltwater surveys that may not match).
 *     2. Does NOT show the notice when the user is in Salt Water mode (default).
 *
 *   External sources (federated section — Search tab)
 *     3. NCEI results always carry a "🌊 saltwater" water-type badge.
 *     4. MN DNR results always carry a "🏞 freshwater" water-type badge.
 *     5. GitHub results (unknown water type) show no water-type badge.
 *     6. NCEI results show a mismatch notice when the user is in Fresh Water mode.
 *     7. MN DNR results show a mismatch notice when the user is in Salt Water mode.
 *     8. MN DNR results show NO mismatch notice when the user is in Fresh Water mode.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

// ---------------------------------------------------------------------------
// API client mock factory — same pattern as other FindDataPanel tests
// ---------------------------------------------------------------------------

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
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally")
          return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) =>
            `/api/mock/${(a as string[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// ---------------------------------------------------------------------------
// Federated source registry + per-source result fixtures
// ---------------------------------------------------------------------------

const SOURCE_REGISTRY = {
  sources: [
    { id: "local-catalog", label: "BathyScan Catalog" },
    { id: "ncei-geoportal", label: "NOAA NCEI Geoportal" },
    { id: "portal-mndnr", label: "Minnesota DNR" },
    { id: "github-allowlist", label: "GitHub (open bathymetry repos)" },
  ],
};

const NCEI_ITEM = {
  id: "ncei-geoportal:gov.noaa:sitka-123",
  sourceId: "ncei-geoportal",
  sourceLabel: "NOAA NCEI Geoportal",
  name: "Sitka Sound Multibeam Survey",
  description: "High-resolution multibeam survey of Sitka Sound",
  url: "https://example.org/sitka-meta",
  endpointUrl: "https://gis.ngdc.noaa.gov/arcgis/services/WCSServer",
  coverageBbox: { minLon: -136, minLat: 56.8, maxLon: -135, maxLat: 57.4 },
  resolutionMMin: 4,
  resolutionMMax: 8,
  importable: true,
  importKind: "ncei-wcs",
};

const MNDNR_ITEM = {
  id: "portal-mndnr:lake-vermilion-42",
  sourceId: "portal-mndnr",
  sourceLabel: "Minnesota DNR",
  name: "Lake Vermilion Bathymetry",
  description: "MN DNR lake bathymetry",
  url: "https://gisdata.mn.gov/dataset/lake-vermilion",
  endpointUrl: "https://arcgis.dnr.state.mn.us/arcgis/rest/services/lakes/FeatureServer/0",
  coverageBbox: { minLon: -92.6, minLat: 47.8, maxLon: -92.2, maxLat: 47.95 },
  resolutionMMin: null,
  resolutionMMax: null,
  importable: true,
  importKind: "arcgis-rest",
};

const GITHUB_ITEM = {
  id: "github-allowlist:noaa-ocs-hydrography/nbs-data",
  sourceId: "github-allowlist",
  sourceLabel: "GitHub (open bathymetry repos)",
  name: "noaa-ocs-hydrography/nbs-data",
  description: "National Bathymetric Source data",
  url: "https://github.com/noaa-ocs-hydrography/nbs-data",
  endpointUrl: null,
  coverageBbox: null,
  resolutionMMin: null,
  resolutionMMax: null,
  importable: false,
  importKind: null,
};

function okStatus(sourceId: string, label: string, resultCount: number) {
  return { sourceId, label, status: "ok", resultCount, tookMs: 100, error: null };
}

const PER_SOURCE_RESPONSES: Record<string, unknown> = {
  "ncei-geoportal": {
    results: [NCEI_ITEM],
    sources: [okStatus("ncei-geoportal", "NOAA NCEI Geoportal", 1)],
  },
  "portal-mndnr": {
    results: [MNDNR_ITEM],
    sources: [okStatus("portal-mndnr", "Minnesota DNR", 1)],
  },
  "github-allowlist": {
    results: [GITHUB_ITEM],
    sources: [okStatus("github-allowlist", "GitHub (open bathymetry repos)", 1)],
  },
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetSearchFederatedSources: (options?: { query?: { enabled?: boolean } }) => {
        if (!options?.query?.enabled) {
          return { data: undefined, isFetching: false, isError: false, error: null };
        }
        return { data: SOURCE_REGISTRY, isFetching: false, isError: false, error: null };
      },
      useGetDatasetsCatalogSearch: () => ({ data: [], isFetching: false }),
      useGetDatasetsMySaves: () => ({ data: [], isFetching: false, refetch: vi.fn() }),
    }),
);

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setPendingExternalUserDatasetId: vi.fn(),
    setCatalogSourcedAt: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn: true, isLoaded: true }) });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQueries: ({
    queries,
  }: {
    queries: Array<{ queryKey: unknown[]; enabled?: boolean }>;
  }) =>
    queries.map((q) => {
      const params = q.queryKey[1] as { sources?: string } | undefined;
      const sourceId = params?.sources ?? "";
      if (!q.enabled || !(sourceId in PER_SOURCE_RESPONSES)) {
        return { data: undefined, isPending: true, error: null };
      }
      return { data: PER_SOURCE_RESPONSES[sourceId], isPending: false, error: null };
    }),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const onClose = vi.fn();

function renderPanel() {
  return renderWithProviders(<FindDataPanel onClose={onClose} />);
}

/** Switch to the NCEI Portal tab. */
function goToNceiTab() {
  fireEvent.click(screen.getByTestId("find-data-ncei-tab"));
}

/** Type a query and wait for the federated section to appear. */
async function typeQuery(value: string) {
  fireEvent.change(screen.getByTestId("find-data-search-input"), {
    target: { value },
  });
  await waitFor(
    () => expect(screen.getByTestId("federated-section")).toBeInTheDocument(),
    { timeout: 3000 },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FindDataPanel — water-type hints on external tabs (task #4037)", () => {
  beforeEach(() => {
    onClose.mockClear();
    try { localStorage.clear(); } catch { /* ignore */ }
    useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
  });

  // ── NCEI Portal tab ──────────────────────────────────────────────────────

  describe("NCEI Portal tab", () => {
    it("shows the freshwater-mismatch notice when the user is in Fresh Water mode", () => {
      useSettingsStore.setState({ waterType: "freshwater" });
      renderPanel();
      goToNceiTab();
      expect(screen.getByTestId("ncei-freshwater-notice")).toBeInTheDocument();
      expect(screen.getByTestId("ncei-freshwater-notice").textContent).toContain(
        "NCEI Geoportal serves ocean/saltwater surveys",
      );
      expect(screen.getByTestId("ncei-freshwater-notice").textContent).toContain(
        "Fresh Water",
      );
    });

    it("does NOT show the notice when the user is in Salt Water mode", () => {
      useSettingsStore.setState({ waterType: "saltwater" });
      renderPanel();
      goToNceiTab();
      expect(screen.queryByTestId("ncei-freshwater-notice")).toBeNull();
    });
  });

  // ── External sources (federated section) ─────────────────────────────────

  describe("External sources — water-type badges and mismatch notices", () => {
    it("NCEI result carries a '🌊 saltwater' badge regardless of user mode", async () => {
      renderPanel();
      await typeQuery("sitka");
      const card = screen.getByTestId(`federated-result-${NCEI_ITEM.id}`);
      const badge = within(card).getByTestId("federated-water-type-badge");
      expect(badge.textContent).toMatch(/saltwater/i);
    });

    it("MN DNR result carries a '🏞 freshwater' badge regardless of user mode", async () => {
      renderPanel();
      await typeQuery("vermilion");
      const card = screen.getByTestId(`federated-result-${MNDNR_ITEM.id}`);
      const badge = within(card).getByTestId("federated-water-type-badge");
      expect(badge.textContent).toMatch(/freshwater/i);
    });

    it("GitHub result (unknown water type) shows no water-type badge", async () => {
      renderPanel();
      await typeQuery("nbs");
      const card = screen.getByTestId(`federated-result-${GITHUB_ITEM.id}`);
      expect(within(card).queryByTestId("federated-water-type-badge")).toBeNull();
    });

    it("NCEI result shows a mismatch notice when user is in Fresh Water mode", async () => {
      useSettingsStore.setState({ waterType: "freshwater" });
      renderPanel();
      await typeQuery("sitka");
      const card = screen.getByTestId(`federated-result-${NCEI_ITEM.id}`);
      const notice = within(card).getByTestId("federated-water-type-mismatch-notice");
      expect(notice.textContent).toContain("ocean/saltwater");
      expect(notice.textContent).toContain("Fresh Water");
    });

    it("MN DNR result shows a mismatch notice when user is in Salt Water mode", async () => {
      useSettingsStore.setState({ waterType: "saltwater" });
      renderPanel();
      await typeQuery("vermilion");
      const card = screen.getByTestId(`federated-result-${MNDNR_ITEM.id}`);
      const notice = within(card).getByTestId("federated-water-type-mismatch-notice");
      expect(notice.textContent).toContain("freshwater");
      expect(notice.textContent).toContain("Salt Water");
    });

    it("MN DNR result shows NO mismatch notice when user is in Fresh Water mode", async () => {
      useSettingsStore.setState({ waterType: "freshwater" });
      renderPanel();
      await typeQuery("vermilion");
      const card = screen.getByTestId(`federated-result-${MNDNR_ITEM.id}`);
      expect(
        within(card).queryByTestId("federated-water-type-mismatch-notice"),
      ).toBeNull();
    });

    it("NCEI result shows NO mismatch notice when user is in Salt Water mode", async () => {
      useSettingsStore.setState({ waterType: "saltwater" });
      renderPanel();
      await typeQuery("sitka");
      const card = screen.getByTestId(`federated-result-${NCEI_ITEM.id}`);
      expect(
        within(card).queryByTestId("federated-water-type-mismatch-notice"),
      ).toBeNull();
    });
  });
});
