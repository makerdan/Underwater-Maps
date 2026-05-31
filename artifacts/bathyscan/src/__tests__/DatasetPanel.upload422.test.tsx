/**
 * DatasetPanel.upload422.test.tsx
 *
 * Verifies that when the POST /datasets/upload route responds with 422 and a
 * `details` field, the DatasetPanel shows that exact error string in the
 * upload section's error banner.
 *
 * Done-looks-like (task-1202):
 *  - Open the "UPLOAD DATASET(S)" accordion
 *  - Drop a file → mutate is called
 *  - onError fires with { data: { details: "...", error: "parse_error" } }
 *  - The details string appears in the rendered output
 *
 * Mocking strategy: same pattern as DatasetPanel.test.tsx — all deps stubbed
 * via vi.hoisted + vi.mock; useDropzone captures onDrop so tests can trigger
 * drops synchronously.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { DatasetPanel } from "@/components/DatasetPanel";

// ── Hoisted state ─────────────────────────────────────────────────────────────

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
            `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// Controls the upload mutation so tests can trigger onError with specific payloads.
const uploadMock = vi.hoisted(() => {
  let pendingCallbacks: {
    onError?: (err: unknown) => void;
    onSuccess?: (data: unknown) => void;
  } = {};

  const mutate = vi.fn(
    (
      _variables: unknown,
      cbs?: {
        onError?: (err: unknown) => void;
        onSuccess?: (data: unknown) => void;
      },
    ) => {
      pendingCallbacks = cbs ?? {};
    },
  );

  return {
    mutate,
    getCallbacks: () => pendingCallbacks,
    reset: () => {
      pendingCallbacks = {};
      mutate.mockClear();
    },
  };
});

// Captures the onDrop callback from useDropzone so tests can simulate drops.
const dropzoneMock = vi.hoisted(() => {
  let capturedOnDrop:
    | ((accepted: File[], rejected: unknown[]) => void)
    | null = null;
  return {
    trigger: (files: File[]) => capturedOnDrop?.(files, []),
    setup(fn: (accepted: File[], rejected: unknown[]) => void) {
      capturedOnDrop = fn;
    },
  };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("react-dropzone", () => ({
  useDropzone: (opts: {
    onDrop: (accepted: File[], rejected: unknown[]) => void;
    disabled?: boolean;
  }) => {
    dropzoneMock.setup(opts.onDrop);
    return {
      getRootProps: () => ({ "data-testid": "dropzone-terrain" }),
      getInputProps: () => ({ "data-testid": "dropzone-input" }),
      isDragActive: false,
    };
  },
}));

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

vi.mock("@/lib/clerkCompat", () => ({
  useAuth: () => ({ isSignedIn: false }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
  QueryClient: class {
    fetchQuery = vi.fn();
    invalidateQueries = vi.fn();
  },
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
  type SettingsMockState = {
    waterType: "saltwater" | "freshwater";
    units: "metric" | "imperial";
    bookmarks: unknown[];
  };
  const state: SettingsMockState = {
    waterType: "saltwater",
    units: "metric",
    bookmarks: [],
  };
  const useSettingsStore = ((sel: (s: SettingsMockState) => unknown) =>
    sel(state)) as ((sel: (s: SettingsMockState) => unknown) => unknown) & {
    getState: () => SettingsMockState;
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

vi.mock("@/lib/panelCollapseStore", () => {
  const state = {
    collapsed: {
      datasets: false,
      // Start with the upload accordion open so the dropzone is immediately visible.
      // The mock store is non-reactive (no Zustand subscription), so toggling via
      // fireEvent.click would not cause a re-render. Rendering open from the start
      // sidesteps that limitation entirely.
      uploadTerrainAccordion: false,
    },
    toggle: vi.fn(),
    setCollapsed: vi.fn((key: string, val: boolean) => {
      (state.collapsed as Record<string, boolean>)[key] = val;
    }),
  };
  return {
    usePanelCollapseStore: (sel: (s: typeof state) => unknown) => sel(state),
  };
});

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

vi.mock("@/components/GpsImportDialog", () => ({
  GpsImportDialog: () => null,
}));

vi.mock("@/components/GpsExportDialog", () => ({
  GpsExportDialog: () => null,
}));

vi.mock("@/components/ProvenancePanel", () => ({
  ProvenancePanel: () => null,
}));

vi.mock("@/components/DatasetFolderTree", () => ({
  DatasetFolderTree: () => null,
}));

vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/WaterTypeToggle", () => ({
  WaterTypeToggle: () => null,
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/LoadingDial", () => ({
  LoadingDial: () => null,
}));

vi.mock("@/lib/units", () => ({
  formatDepthRange: (min: number, max: number, units: string) =>
    `${min} ${units} to ${max} ${units}`,
}));

vi.mock("@/lib/terrain", () => ({
  lonLatToWorldXZ: vi.fn(() => [0, 0]),
  MAX_DEPTH_WORLD: 10000,
}));

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasets: () => ({ data: [], isLoading: false }),
      useGetUserDatasets: () => ({ data: undefined, isLoading: false }),
      useGetMarkers: () => ({ data: undefined }),
      usePostDatasetsUpload: () => ({
        mutate: uploadMock.mutate,
        isPending: false,
        isSuccess: false,
      }),
    }),
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DatasetPanel — upload 422 error display", () => {
  beforeEach(() => {
    uploadMock.reset();
  });

  it("shows the server details string when a 422 parse_error is returned after dropping a GPX file", async () => {
    render(<DatasetPanel />);

    // The upload accordion is pre-opened by the panelCollapseStore mock
    // (uploadTerrainAccordion: false → uploadOpen: true), so the dropzone
    // is visible immediately without needing a click.
    expect(screen.getByTestId("dropzone-terrain")).toBeInTheDocument();

    const file = new File(
      ["<gpx><trk><trkseg><trkpt lat='55' lon='10'/></trkseg></trk></gpx>"],
      "track.gpx",
      { type: "application/gpx+xml" },
    );

    // Trigger the drop → uploadFile() → mutate() is called
    act(() => {
      dropzoneMock.trigger([file]);
    });

    expect(uploadMock.mutate).toHaveBeenCalledTimes(1);

    // Simulate the server's 422 response flowing through onError
    await act(async () => {
      uploadMock.getCallbacks().onError?.({
        data: {
          error: "parse_error",
          details: "GPX file contains no elevation/depth track points.",
        },
      });
    });

    expect(
      screen.getByText(/GPX file contains no elevation\/depth track points\./i),
    ).toBeInTheDocument();
  });

  it("shows the server details string when a 422 parse_error is returned after dropping an NMEA file", async () => {
    render(<DatasetPanel />);

    const file = new File(["$GPGGA,...\n"], "log.nmea", { type: "text/plain" });

    act(() => {
      dropzoneMock.trigger([file]);
    });

    await act(async () => {
      uploadMock.getCallbacks().onError?.({
        data: {
          error: "parse_error",
          details: "NMEA: no depth+position pairs found in the file.",
        },
      });
    });

    expect(
      screen.getByText(/NMEA: no depth\+position pairs found in the file\./i),
    ).toBeInTheDocument();
  });
});
