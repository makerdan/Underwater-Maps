/**
 * MY LIBRARY collapse / expand wiring tests.
 *
 * Verifies that:
 *   1. Clicking the "▲ MY LIBRARY" header collapses the library content
 *      and flips the chevron to "▾ MY LIBRARY".
 *   2. Clicking again re-expands, restoring "▲ MY LIBRARY".
 *   3. The collapse state is driven through panelCollapseStore (the real Zustand
 *      store is used here — NOT mocked — so toggle() actually mutates state and
 *      triggers a React re-render, giving us end-to-end wiring coverage).
 *   4. The loading spinner beside the header is visible in both collapsed and
 *      expanded states (it lives inside the always-rendered header button).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import React from "react";
import { usePanelCollapseStore, DEFAULTS } from "@/lib/panelCollapseStore";
import { DatasetPanel } from "@/components/DatasetPanel";

// ---------------------------------------------------------------------------
// Proxy-based API client mock (same pattern as DatasetPanel.test.tsx).
// vi.mock() factories are hoisted before ES imports, so the factory must be
// self-contained. vi.hoisted() lets us share the helper without an import.
// ---------------------------------------------------------------------------
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false };
  }
  function mutationHook() {
    return {
      mutate: noop,
      mutateAsync: noop,
      isPending: false,
      isSuccess: false,
      variables: undefined,
    };
  }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (
          typeof p === "symbol" ||
          p === "then" ||
          p === "catch" ||
          p === "finally"
        )
          return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k))
          return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) =>
            `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setTerrain: vi.fn(),
    terrain: null,
    mode: "fly",
    pendingExternalUserDatasetId: null,
    setPendingExternalUserDatasetId: vi.fn(),
  }),
}));

// Signed IN — required so the MY LIBRARY section is rendered.
vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat();
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  QueryClient: class {
    fetchQuery = vi.fn();
    invalidateQueries = vi.fn();
  },
  QueryCache: class { constructor(_opts?: unknown) {} },
  MutationCache: class { constructor(_opts?: unknown) {} },
}));

vi.mock("react-dropzone", () => ({
  useDropzone: () => ({
    getRootProps: () => ({ "data-testid": "dropzone" }),
    getInputProps: () => ({ "data-testid": "dropzone-input" }),
    isDragActive: false,
  }),
}));

vi.mock("@/lib/terrainStore", () => {
  const state = {
    setGrids: vi.fn(),
    visibleDatasets: [] as Array<{ datasetId: string }>,
    primaryDatasetId: null as string | null,
    hideAllOthers: vi.fn(),
    toggleVisible: vi.fn(),
  };
  const useTerrainStore = ((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state) as unknown as {
    (sel?: (s: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };
  useTerrainStore.getState = () => state;
  return { useTerrainStore, VISIBLE_DATASETS_CAP: 4 };
});

vi.mock("@/lib/uiStore", () => ({
  useUiStore: { getState: () => ({ setPendingDropIn: vi.fn() }) },
}));

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: {
    getState: () => ({ clearZoneMap: vi.fn(), classify: vi.fn() }),
  },
}));

vi.mock("@/lib/settingsStore", () => {
  type State = { waterType: "saltwater" | "freshwater"; units: "metric" | "imperial" };
  const state: State = { waterType: "saltwater", units: "metric" };
  const useSettingsStore = ((sel: (s: State) => unknown) =>
    sel(state)) as ((sel: (s: State) => unknown) => unknown) & {
    getState: () => State;
  };
  useSettingsStore.getState = () => state;
  return { useSettingsStore };
});

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: ({ onConfirm }: { onConfirm: () => void }) => {
    onConfirm();
  },
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

vi.mock("@/lib/markerEditStore", () => ({
  useMarkerEditStore: (sel: (s: { editingMarkerId: string | null }) => unknown) =>
    sel({ editingMarkerId: null }),
}));

vi.mock("@/lib/activeLoadStore", () => ({
  useActiveLoadStore: {
    getState: () => ({
      start: vi.fn(),
      update: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      active: null,
    }),
  },
}));

vi.mock("@/lib/markerConstants", () => ({
  MARKER_COLOR: {},
  MARKER_ICON: {},
  SALTWATER_MARKER_TYPES: [],
  FRESHWATER_MARKER_TYPES: [],
}));

vi.mock("@/lib/markerLayerStore", () => ({
  useMarkerLayerStore: () => ({ layers: [] }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useUndoableMarkerDelete", () => ({
  useUndoableMarkerDelete: () => ({ handleDelete: vi.fn() }),
}));

vi.mock("@/lib/fetchWithProgress", () => ({
  fetchJsonWithProgress: vi.fn(),
}));

vi.mock("@/lib/units", () => ({
  formatDepthRange: (min: number, max: number, units: string) =>
    `${min} ${units} to ${max} ${units}`,
}));

vi.mock("@/lib/terrain", () => ({
  lonLatToWorldXZ: vi.fn(() => [0, 0]),
  MAX_DEPTH_WORLD: 10000,
}));

// Heavy sub-components — render null or a lightweight stub.
vi.mock("@/components/DatasetFolderTree", () => ({
  DatasetFolderTree: () =>
    React.createElement("div", { "data-testid": "dataset-folder-tree" }),
}));

vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/WaterTypeToggle", () => ({ WaterTypeToggle: () => null }));
vi.mock("@/components/help/HelpButton", () => ({ HelpIcon: () => null }));
vi.mock("@/components/LoadingDial", () => ({ LoadingDial: () => null }));
vi.mock("@/components/ProvenancePanel", () => ({ ProvenancePanel: () => null }));
vi.mock("@/components/GpsImportDialog", () => ({ GpsImportDialog: () => null }));
vi.mock("@/components/GpsExportDialog", () => ({ GpsExportDialog: () => null }));

// API client — useGetUserDatasets returns isLoading:true so the spinner
// is always mounted, letting us assert it in both expanded and collapsed states.
vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasets: () => ({ data: [], isLoading: false }),
      useGetUserDatasets: () => ({ data: [], isLoading: true }),
      useGetMarkers: () => ({ data: [] }),
    }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the MY LIBRARY toggle button, asserting it exists. */
function getMyLibraryBtn() {
  return screen.getByRole("button", { name: /MY LIBRARY/ });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DatasetPanel — MY LIBRARY collapse / expand", () => {
  beforeEach(() => {
    // Reset the real panelCollapseStore to defaults before every test so each
    // test starts from a known, expanded (myLibrary: false) state.
    try {
      localStorage.clear();
    } catch {
      // jsdom may not expose localStorage in all configurations
    }
    usePanelCollapseStore.setState({ collapsed: { ...DEFAULTS } });
  });

  it("starts expanded: shows ▲ MY LIBRARY and renders DatasetFolderTree", () => {
    render(<DatasetPanel />);

    // Header should show the expanded chevron.
    expect(getMyLibraryBtn()).toHaveTextContent("▲ MY LIBRARY");

    // The tree should be visible in the expanded state.
    expect(screen.getByTestId("dataset-folder-tree")).toBeInTheDocument();
  });

  it("clicking the header collapses the section and flips the chevron", () => {
    render(<DatasetPanel />);

    fireEvent.click(getMyLibraryBtn());

    // Chevron should flip to indicate collapsed state.
    expect(getMyLibraryBtn()).toHaveTextContent("▾ MY LIBRARY");

    // Tree should no longer be in the DOM.
    expect(screen.queryByTestId("dataset-folder-tree")).not.toBeInTheDocument();
  });

  it("clicking the header twice re-expands and restores ▲ MY LIBRARY", () => {
    render(<DatasetPanel />);

    const btn = getMyLibraryBtn();
    fireEvent.click(btn); // collapse
    fireEvent.click(btn); // expand

    expect(btn).toHaveTextContent("▲ MY LIBRARY");
    expect(screen.getByTestId("dataset-folder-tree")).toBeInTheDocument();
  });

  it("collapse is reflected in panelCollapseStore", () => {
    render(<DatasetPanel />);

    expect(usePanelCollapseStore.getState().collapsed.myLibrary).toBe(false);

    fireEvent.click(getMyLibraryBtn());

    expect(usePanelCollapseStore.getState().collapsed.myLibrary).toBe(true);
  });

  it("loading spinner is visible beside the header in both expanded and collapsed states", () => {
    render(<DatasetPanel />);

    // Expanded: spinner should be present inside the MY LIBRARY header button.
    // Scoped with `within` because other panel headers may also render spinners.
    expect(within(getMyLibraryBtn()).getByText("◌")).toBeInTheDocument();

    // Collapse.
    fireEvent.click(getMyLibraryBtn());

    // Collapsed: spinner must still be visible (it lives in the button, not the tree).
    expect(within(getMyLibraryBtn()).getByText("◌")).toBeInTheDocument();
  });
});
