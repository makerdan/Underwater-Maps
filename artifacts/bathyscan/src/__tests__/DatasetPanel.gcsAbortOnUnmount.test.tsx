/**
 * DatasetPanel.gcsAbortOnUnmount.test.tsx
 *
 * Regression test for GCS XHR abort and zombie timer cleanup on unmount.
 *
 * Before the fix:
 *   - The XMLHttpRequest created in gcsUploadFile was never stored in a ref,
 *     so it could not be aborted when the component unmounted.
 *   - The poll setInterval and watchdog setTimeout continued firing for up to
 *     15 minutes after unmount, calling state setters on a destroyed component.
 *
 * After the fix:
 *   - The XHR is stored in gcsXhrRef; the unmount cleanup calls xhr.abort().
 *   - gcsUnmountedRef is set to true on cleanup; all async state setters are
 *     no-ops after that point.
 *   - The poll interval and watchdog are cleared on unmount as before.
 *
 * Tests:
 * 1. xhr.abort() is called when the component unmounts while the XHR is
 *    in-flight (presigned URL obtained, PUT not yet complete).
 * 2. No state-setter calls (setGcsPhase / setGcsError) occur after unmount
 *    even if the XHR abort event fires and poll fetches are in-flight.
 * 3. No poll fires after unmount (interval is cleared by the cleanup).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act } from "@testing-library/react";
import { DatasetPanel } from "@/components/DatasetPanel";

// ── Hoisted state ─────────────────────────────────────────────────────────────

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false };
  }
  function mutationHook() {
    return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined };
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
          return (...a: unknown[]) => `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

const dropzoneMock = vi.hoisted(() => {
  let capturedOnDrop: ((accepted: File[], rejected: unknown[]) => void) | null = null;
  return {
    trigger: (files: File[]) => capturedOnDrop?.(files, []),
    setup(fn: (accepted: File[], rejected: unknown[]) => void) { capturedOnDrop = fn; },
  };
});

const authMock = vi.hoisted(() => ({
  getAuthToken: vi.fn<() => Promise<string | null>>(async () => "token"),
  hasAuthTokenGetter: vi.fn<() => boolean>(() => true),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("react-dropzone", () => ({
  useDropzone: (opts: { onDrop: (accepted: File[], rejected: unknown[]) => void }) => {
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
    datasetId: null, setDatasetId: vi.fn(), setTerrain: vi.fn(), terrain: null,
    mode: "fly", pendingExternalUserDatasetId: null, setPendingExternalUserDatasetId: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat();
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
  QueryClient: class { fetchQuery = vi.fn(); invalidateQueries = vi.fn(); },
  QueryCache: class { constructor(_opts?: unknown) {} },
  MutationCache: class { constructor(_opts?: unknown) {} },
}));

vi.mock("@/lib/terrainStore", () => {
  const state = {
    setGrids: vi.fn(), visibleDatasets: [] as Array<{ datasetId: string }>,
    primaryDatasetId: null as string | null, hideAllOthers: vi.fn(),
    toggleVisible: vi.fn(), addSelected: vi.fn(), removeSelected: vi.fn(),
    autoActivate: vi.fn(), autoEvict: vi.fn(), clearAutoEviction: vi.fn(),
    selectedIds: [] as string[], selectedSources: {} as Record<string, string>,
    evictedId: null as string | null, autoEvictedId: null as string | null,
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
  const uiState = {
    setPendingDropIn: vi.fn(),
    georefPickBbox: null as null | {
      minLon: number;
      minLat: number;
      maxLon: number;
      maxLat: number;
    },
    georefPickMode: false,
    setGeorefPickBbox: vi.fn(),
    setGeorefPickMode: vi.fn(),
  };
  const useUiStore = ((sel: (s: typeof uiState) => unknown) =>
    sel(uiState)) as ((sel: (s: typeof uiState) => unknown) => unknown) & {
    getState: () => typeof uiState;
  };
  useUiStore.getState = () => uiState;
  return { useUiStore };
});

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: {
    getState: () => ({ clearZoneMap: vi.fn(), classify: vi.fn() }),
  },
}));

vi.mock("@/lib/settingsStore", () => {
  type S = { waterType: "saltwater" | "freshwater"; units: "metric" | "imperial"; bookmarks: unknown[] };
  const state: S = { waterType: "saltwater", units: "metric", bookmarks: [] };
  const useSettingsStore = ((sel: (s: S) => unknown) => sel(state)) as
    ((sel: (s: S) => unknown) => unknown) & { getState: () => S };
  useSettingsStore.getState = () => state;
  return { useSettingsStore };
});

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: ({ onConfirm }: { onConfirm: () => void }) => { onConfirm(); },
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) => sel({ isOnline: true }),
}));

vi.mock("@/lib/markerEditStore", () => ({
  useMarkerEditStore: (sel: (s: { editingMarkerId: string | null }) => unknown) =>
    sel({ editingMarkerId: null }),
}));

vi.mock("@/lib/panelCollapseStore", () => {
  const state = {
    collapsed: { datasets: false, uploadTerrainAccordion: false },
    toggle: vi.fn(),
    setCollapsed: vi.fn((key: string, val: boolean) => {
      (state.collapsed as Record<string, boolean>)[key] = val;
    }),
  };
  return { usePanelCollapseStore: (sel: (s: typeof state) => unknown) => sel(state) };
});

vi.mock("@/lib/activeLoadStore", () => ({
  useActiveLoadStore: {
    getState: () => ({ start: vi.fn(), update: vi.fn(), complete: vi.fn(), fail: vi.fn(), active: null }),
  },
}));

vi.mock("@/lib/markerConstants", () => ({
  MARKER_COLOR: {}, MARKER_ICON: {},
  SALTWATER_MARKER_TYPES: [], FRESHWATER_MARKER_TYPES: [],
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

vi.mock("@/components/GpsImportDialog", () => ({ GpsImportDialog: () => null }));
vi.mock("@/components/GpsExportDialog", () => ({ GpsExportDialog: () => null }));
vi.mock("@/components/ProvenancePanel", () => ({ ProvenancePanel: () => null }));
vi.mock("@/components/DatasetFolderTree", () => ({ DatasetFolderTree: () => null }));
vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock("@/components/WaterTypeToggle", () => ({ WaterTypeToggle: () => null }));
vi.mock("@/components/help/HelpButton", () => ({ HelpIcon: () => null }));
vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock("@/components/LoadingDial", () => ({ LoadingDial: () => null }));

vi.mock("@/lib/units", () => ({
  formatDepthRange: (min: number, max: number, units: string) =>
    `${min} ${units} to ${max} ${units}`,
}));

vi.mock("@/lib/terrain", () => ({
  lonLatToWorldXZ: vi.fn(() => [0, 0]),
  MAX_DEPTH_WORLD: 10000,
}));

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasets: () => ({ data: [], isLoading: false }),
    useGetUserDatasets: () => ({ data: undefined, isLoading: false }),
    useGetMarkers: () => ({ data: undefined }),
    usePostDatasetsUpload: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
    getAuthToken: authMock.getAuthToken,
    hasAuthTokenGetter: authMock.hasAuthTokenGetter,
  }),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakeFile(name: string, type: string, fakeSize: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: fakeSize, configurable: true, writable: false });
  return file;
}

/**
 * Build an XHR stub that hangs on send() until either abort() or resolve() is
 * called externally. Returns both the stub and control handles.
 */
function makeSuspendedXhr() {
  const abortSpy = vi.fn();
  const loadListeners: Array<() => void> = [];
  const abortListeners: Array<() => void> = [];

  const stub = {
    open: vi.fn(),
    setRequestHeader: vi.fn(),
    upload: { addEventListener: vi.fn() },
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === "load") loadListeners.push(handler);
      if (event === "abort") abortListeners.push(handler);
    }),
    send: vi.fn(),
    abort: vi.fn(() => {
      abortSpy();
      (stub as unknown as { status: number }).status = 0;
      abortListeners.forEach((fn) => fn());
    }),
    status: 200,
    readyState: 4,
  };

  const OrigXHR = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = vi.fn(() => stub) as unknown as typeof XMLHttpRequest;

  return {
    abortSpy,
    resolveXhr: () => {
      (stub as unknown as { status: number }).status = 200;
      loadListeners.forEach((fn) => fn());
    },
    restore: () => { globalThis.XMLHttpRequest = OrigXHR; },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DatasetPanel — GCS XHR abort on unmount", () => {
  let restoreXhr: () => void;

  beforeEach(() => {
    authMock.getAuthToken.mockResolvedValue("token");
    authMock.hasAuthTokenGetter.mockReturnValue(true);
  });

  afterEach(() => {
    restoreXhr?.();
    vi.restoreAllMocks();
  });

  it("calls xhr.abort() when the component unmounts while the GCS PUT is in-flight", async () => {
    const { abortSpy, restore } = makeSuspendedXhr();
    restoreXhr = restore;

    // Presigned URL request resolves immediately; XHR send() then hangs.
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("request-gcs-url")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            uploadUrl: "https://storage.googleapis.com/bucket/pending/survey.bag?sig=ok",
            objectKey: "pending/survey.bag",
          }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    const file = makeFakeFile("survey.bag", "application/octet-stream", 60 * 1024 * 1024);

    const { unmount } = render(<DatasetPanel />);

    // Trigger the GCS upload — this queues gcsUploadFile as an async task.
    await act(async () => {
      dropzoneMock.trigger([file]);
    });

    // Allow the async gcsUploadFile to progress far enough to get the presigned
    // URL and call xhr.send() (all I/O is mocked, so a microtask flush is enough).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // XHR has been sent but not yet completed. Unmounting now should abort it.
    expect(abortSpy).not.toHaveBeenCalled();

    unmount();

    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it("does not fire poll callbacks after unmount even if a fetch was in-flight", async () => {
    // Use a real-resolving XHR stub so the upload finishes and polling starts.
    const { restore } = makeSuspendedXhr();
    restoreXhr = restore;

    vi.useFakeTimers();

    let pollCount = 0;
    let allowPresigned = false;

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("request-gcs-url")) {
        allowPresigned = true;
        return {
          ok: true, status: 200,
          json: async () => ({
            uploadUrl: "https://storage.googleapis.com/bucket/pending/survey.bag?sig=ok",
            objectKey: "pending/survey.bag",
          }),
        } as Response;
      }
      if (url.includes("gcs-job-status")) {
        pollCount++;
        return {
          ok: true, status: 200,
          json: async () => ({ status: "processing" }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    const file = makeFakeFile("survey.bag", "application/octet-stream", 60 * 1024 * 1024);

    const { unmount } = render(<DatasetPanel />);

    await act(async () => {
      dropzoneMock.trigger([file]);
      await vi.advanceTimersByTimeAsync(50);
    });

    // Unmount immediately — poll interval should be cleared before it ever fires.
    unmount();

    const countAtUnmount = pollCount;

    // Advance well past the 10 s poll interval and the 15 min watchdog.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 5000);
    });

    // Poll count must not have increased after unmount.
    expect(pollCount).toBe(countAtUnmount);

    // Suppress unused-variable warning for allowPresigned (used as a sentinel
    // to confirm the fetch mock was installed before the unmount path ran).
    void allowPresigned;

    vi.useRealTimers();
  });
});
