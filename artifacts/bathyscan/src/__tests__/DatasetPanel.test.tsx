import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DatasetPanel, EFH_DIVIDER_KEY_ACTIVE, EFH_DIVIDER_KEY_QUEUED } from "@/components/DatasetPanel";
import { usePanelCollapseStore, DEFAULTS } from "@/lib/panelCollapseStore";
import { useActiveLoadStore } from "@/lib/activeLoadStore";

// ---------------------------------------------------------------------------
// Shared proxy factory — available to the synchronous vi.mock factory below.
//
// vi.mock() calls are hoisted before ES imports resolve, so helpers imported
// at the top of this file are NOT available inside a vi.mock() factory.
// vi.hoisted() is Vitest's escape hatch: its callback runs during the hoisting
// phase, before any imports or mock processing, making the returned value
// usable in the synchronous factory below.
//
// See src/__tests__/apiClientMock.ts for full documentation and the canonical
// copy of this pattern that other test files should follow.
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
            `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

const setDatasetIdMock = vi.fn();
const setTerrainMock = vi.fn();

// Controls the upload mutation so the upload-mismatch describe block can fire
// onSuccess with a controlled payload.
const uploadCallbacks = vi.hoisted(() => {
  let stored: { onSuccess?: (data: unknown) => void; onError?: (err: unknown) => void } = {};
  const mutate = vi.fn((_vars: unknown, cbs?: typeof stored) => {
    stored = cbs ?? {};
  });
  return {
    mutate,
    fire(cbs: typeof stored) {
      stored.onSuccess?.call(undefined, cbs.onSuccess);
      stored.onError?.call(undefined, cbs.onError);
    },
    onSuccess(data: unknown) { stored.onSuccess?.(data); },
    onError(err: unknown) { stored.onError?.(err); },
    reset() { stored = {}; mutate.mockClear(); },
  };
});

// Captures the onDrop callback from useDropzone so the upload mismatch test
// can trigger a file drop without clicking.
const dropzoneCapture = vi.hoisted(() => {
  let fn: ((files: File[], rejected: unknown[]) => void) | null = null;
  return {
    set(f: (files: File[], rejected: unknown[]) => void) { fn = f; },
    trigger(files: File[]) { fn?.(files, []); },
  };
});

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: setDatasetIdMock,
    setTerrain: setTerrainMock,
    terrain: null,
    mode: "fly",
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn: false, isLoaded: true }) });
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
  useDropzone: (opts?: { onDrop?: (files: File[], rejected: unknown[]) => void }) => {
    if (opts?.onDrop) dropzoneCapture.set(opts.onDrop);
    return {
      getRootProps: () => ({ "data-testid": "dropzone" }),
      getInputProps: () => ({ "data-testid": "dropzone-input" }),
      isDragActive: false,
    };
  },
}));

vi.mock("@/lib/terrainStore", () => {
  const state = {
    setGrids: vi.fn(),
    setSinglePrimary: vi.fn(),
    multiDatasetMode: false,
    visibleDatasets: [] as Array<{ datasetId: string }>,
    primaryDatasetId: null as string | null,
    hideAllOthers: vi.fn(),
    toggleVisible: vi.fn(),
    addSelected: vi.fn(),
    removeSelected: vi.fn(),
    autoActivate: vi.fn(),
    autoEvict: vi.fn(),
    clearAutoEviction: vi.fn(),
    selectedIds: [] as string[],
    selectedSources: {} as Record<string, string>,
    evictedId: null as string | null,
    autoEvictedId: null as string | null,
    clearEviction: vi.fn(),
  };
  const useTerrainStore = ((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state) as unknown as {
    (sel?: (s: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };
  useTerrainStore.getState = () => state;
  return { useTerrainStore, VISIBLE_DATASETS_CAP: 3, MAX_ACTIVE_DATASETS: 3 };
});

vi.mock("@/lib/uiStore", () => {
  const mockState = {
    setPendingDropIn: vi.fn(),
    georefPickBbox: null as null | { minLon: number; minLat: number; maxLon: number; maxLat: number },
    georefPickMode: false,
    setGeorefPickMode: vi.fn(),
    setGeorefPickBbox: vi.fn(),
    setZoneOverlayEnabled: vi.fn(),
    setZonePaintMode: vi.fn(),
  };
  const useUiStore = Object.assign(
    (sel: (s: typeof mockState) => unknown) => sel(mockState),
    { getState: () => mockState },
  );
  return { useUiStore };
});

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: {
    getState: () => ({ clearZoneMap: vi.fn(), classify: vi.fn() }),
  },
}));

vi.mock("@/lib/settingsStore", () => {
  type SettingsMockState = {
    waterType: "saltwater" | "freshwater";
    units: "metric" | "imperial";
  };
  const state: SettingsMockState = { waterType: "saltwater", units: "metric" };
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

// Only the three hooks this test actually exercises need explicit overrides.
// Every other export from @workspace/api-client-react is auto-stubbed by the
// proxy above (query hooks → {data:undefined,isLoading:false}, mutation hooks
// → {mutate:noop,isPending:false}, query-key helpers → [...], URL helpers →
// "/api/mock/...").  When new endpoints are added to the generated client,
// this test continues to compile and run without any manual patching.
vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasets: () => ({ data: [], isLoading: false }),
      useGetUserDatasets: () => ({ data: [], isLoading: false }),
      useGetMarkers: () => ({ data: [] }),
      usePostDatasetsUpload: () => ({
        mutate: uploadCallbacks.mutate,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
    }),
);

describe("DatasetPanel", () => {
  beforeEach(() => {
    setDatasetIdMock.mockClear();
    setTerrainMock.mockClear();
    // Reset the real panelCollapseStore so every test starts with a fully
    // expanded panel (collapsed.datasets = false).
    try { localStorage.clear(); } catch { /* ignore */ }
    usePanelCollapseStore.setState({ collapsed: { ...DEFAULTS } });
  });

  it("renders the panel title and the expanded collapse chevron", () => {
    render(<DatasetPanel />);
    // The outer header button carries the "Datasets" title.
    expect(screen.getByText("Datasets")).toBeInTheDocument();
    // Default state: panel is expanded, so the ▾ chevron is shown.
    expect(screen.getByText("▾")).toBeInTheDocument();
  });

  it("renders the MY LIBRARY section header in expanded state", () => {
    render(<DatasetPanel />);
    // The MY LIBRARY toggle button must be present when the panel is expanded.
    expect(screen.getByRole("button", { name: /MY LIBRARY/ })).toBeInTheDocument();
  });

  it("collapses and expands the panel when the Datasets header is clicked", () => {
    render(<DatasetPanel />);
    // Panel starts expanded — MY LIBRARY header is visible.
    expect(screen.getByRole("button", { name: /MY LIBRARY/ })).toBeInTheDocument();

    // Click the Datasets header to collapse the entire panel.
    const header = screen.getByText("Datasets").closest("button")!;
    fireEvent.click(header);
    // MY LIBRARY section is unmounted when the panel is collapsed.
    expect(screen.queryByRole("button", { name: /MY LIBRARY/ })).not.toBeInTheDocument();

    // Click again to re-expand.
    fireEvent.click(header);
    expect(screen.getByRole("button", { name: /MY LIBRARY/ })).toBeInTheDocument();
  });

  it("renders the upload dropzone area after expanding the upload section", () => {
    render(<DatasetPanel />);
    expect(screen.queryByTestId("dropzone-terrain")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/UPLOAD DATASET\(S\)/));
    expect(screen.getByTestId("dropzone-terrain")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Upload-complete path: ID mismatch guard
//
// When the server returns a response whose terrain.datasetId differs from the
// savedDatasetId, the panel must surface an error instead of silently storing
// the terrain data under the wrong identity.
// ---------------------------------------------------------------------------
describe("DatasetPanel — upload-complete ID mismatch", () => {
  beforeEach(() => {
    uploadCallbacks.reset();
  });

  it("surfaces an error when terrain.datasetId does not match savedDatasetId", async () => {
    const { act } = await import("@testing-library/react");
    render(<DatasetPanel />);

    // Open the upload accordion so the dropzone is visible.
    fireEvent.click(screen.getByText(/UPLOAD DATASET\(S\)/));

    // Trigger a drop to wire up the mutate callbacks.
    const file = new File(["x"], "survey.bag", { type: "application/octet-stream" });
    act(() => {
      dropzoneCapture.trigger([file]);
    });

    expect(uploadCallbacks.mutate).toHaveBeenCalledTimes(1);

    // Simulate a server response where terrain.datasetId ≠ savedDatasetId.
    await act(async () => {
      uploadCallbacks.onSuccess({
        terrain: { datasetId: "server-generated-id", depths: [], width: 1, height: 1, minDepth: 0, maxDepth: 1 },
        overview: { datasetId: "server-generated-id", depths: [], width: 1, height: 1, minDepth: 0, maxDepth: 1 },
        savedDatasetId: "different-saved-id",
      });
    });

    // The panel must display an error — not silently commit the terrain.
    expect(
      screen.getByText(/mismatched dataset IDs/i),
    ).toBeInTheDocument();
  });

  it("does not surface an error when terrain.datasetId matches savedDatasetId", async () => {
    const { act } = await import("@testing-library/react");
    render(<DatasetPanel />);

    fireEvent.click(screen.getByText(/UPLOAD DATASET\(S\)/));

    const file = new File(["x"], "survey.bag", { type: "application/octet-stream" });
    act(() => {
      dropzoneCapture.trigger([file]);
    });

    // Matching IDs: no error should be shown.
    await act(async () => {
      uploadCallbacks.onSuccess({
        terrain: { datasetId: "saved-id-123", depths: [], width: 1, height: 1, minDepth: 0, maxDepth: 1 },
        overview: { datasetId: "saved-id-123", depths: [], width: 1, height: 1, minDepth: 0, maxDepth: 1 },
        savedDatasetId: "saved-id-123",
      });
    });

    expect(screen.queryByText(/mismatched dataset IDs/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Unmount cleanup: activeLoadStore must not stay in loading state after the
// panel is destroyed mid-load.
//
// When DatasetPanel unmounts while a dataset load is in progress the cleanup
// effect calls `activeLoadStore.fail(id)` so the next mount starts with a
// clean idle store rather than a stale spinner.
// ---------------------------------------------------------------------------
describe("DatasetPanel — unmount cleanup clears activeLoadStore", () => {
  beforeEach(() => {
    // Start each test with a clean store.
    useActiveLoadStore.setState({ active: null, history: {} });
    try { localStorage.clear(); } catch { /* ignore */ }
    usePanelCollapseStore.setState({ collapsed: { ...DEFAULTS } });
  });

  it("clears an in-progress load from activeLoadStore when the component unmounts", () => {
    const { unmount } = render(<DatasetPanel />);

    // Simulate a load that started before unmount.
    useActiveLoadStore.getState().start({ datasetId: "loading-id", bucket: "loading-id" });
    expect(useActiveLoadStore.getState().active).not.toBeNull();
    expect(useActiveLoadStore.getState().active?.datasetId).toBe("loading-id");

    // Unmount the component mid-load.
    unmount();

    // The cleanup effect must have called fail(), transitioning the store to idle.
    expect(useActiveLoadStore.getState().active).toBeNull();
  });

  it("leaves activeLoadStore untouched when no load is active at unmount", () => {
    const { unmount } = render(<DatasetPanel />);

    // No active load — store is already idle.
    expect(useActiveLoadStore.getState().active).toBeNull();

    unmount();

    // Still null — cleanup should be a no-op.
    expect(useActiveLoadStore.getState().active).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EFH divider sentinel key collision guard
//
// The EFH divider sentinels injected into the active/queued dataset lists must
// use React keys that can never collide with a valid dataset ID.  All dataset
// IDs are either:
//   • Catalog slugs — URL-path-safe ASCII, no control characters
//   • User-upload UUIDs — hex digits and hyphens only
//   • On-demand IDs — "ondemand-<source>-<timestamp>" format
//
// A null byte (\x00) is forbidden in all three formats, so a sentinel key
// starting with \x00 is structurally impossible to collide with any real ID.
//
// This test is a permanent regression guard: if someone changes the sentinel
// key format to one that *could* overlap with real IDs, this test fails
// immediately in CI before any catalog data is needed.
// ---------------------------------------------------------------------------
describe("EFH divider sentinel keys — structural collision guard", () => {
  it("EFH_DIVIDER_KEY_ACTIVE starts with a null byte", () => {
    expect(EFH_DIVIDER_KEY_ACTIVE.charCodeAt(0)).toBe(0);
  });

  it("EFH_DIVIDER_KEY_QUEUED starts with a null byte", () => {
    expect(EFH_DIVIDER_KEY_QUEUED.charCodeAt(0)).toBe(0);
  });

  it("sentinel keys are distinct from each other", () => {
    expect(EFH_DIVIDER_KEY_ACTIVE).not.toBe(EFH_DIVIDER_KEY_QUEUED);
  });

  it("sentinel keys cannot be URL-path-safe strings (no null byte in URL slugs, UUIDs, or ondemand IDs)", () => {
    // Demonstrate the invariant: valid dataset ID formats never contain \x00.
    const validIdSamples = [
      "noaa-efh-alaska-pcod",
      "gebco-2024-global",
      "fw-lake-superior",
      "ondemand-gebco-1234567890",
      "ondemand-ncei-crm-1234567890",
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890", // UUID
      "__efh-divider-active",  // the OLD format — safe but not null-prefixed
      "__efh-divider-queued",
    ];
    for (const id of validIdSamples) {
      expect(id.charCodeAt(0)).not.toBe(0);
      expect(id).not.toBe(EFH_DIVIDER_KEY_ACTIVE);
      expect(id).not.toBe(EFH_DIVIDER_KEY_QUEUED);
    }
  });
});
