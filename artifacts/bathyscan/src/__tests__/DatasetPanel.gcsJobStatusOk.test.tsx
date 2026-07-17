/**
 * DatasetPanel.gcsJobStatusOk.test.tsx
 *
 * Regression test for the GCS job-status poll r.ok guard.
 *
 * Before the fix, the poll called `.then((r) => r.json() ...)` unconditionally.
 * When the server returned a non-JSON error body (e.g. a 503 HTML page), the
 * SyntaxError from r.json() would propagate into the .catch() silently.
 * After the fix, the poll throws `Error("HTTP <status>")` before attempting
 * .json() when r.ok is false, giving the catch handler a typed error.
 *
 * This test confirms:
 * 1. When the poll endpoint returns ok:false / status:503, the component
 *    does NOT crash (the catch block stays in control).
 * 2. The component remains mounted after polling starts.
 *
 * Strategy: Mock XMLHttpRequest to immediately succeed (so the GCS PUT step
 * completes synchronously), then make job-status poll return ok:false/503.
 * Advance fake timers past the poll interval and assert no crash + poll fired.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

vi.mock("@/lib/uiStore", () => ({
  useUiStore: { getState: () => ({ setPendingDropIn: vi.fn() }) },
}));

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
 * Install a minimal XMLHttpRequest stub that immediately fires the "load"
 * event with status 200 when send() is called. This simulates a successful
 * GCS PUT without making any network request.
 */
function mockXhrSuccess() {
  const OrigXHR = globalThis.XMLHttpRequest;
  const loadListeners: Array<() => void> = [];
  const stub = {
    open: vi.fn(),
    setRequestHeader: vi.fn(),
    upload: { addEventListener: vi.fn() },
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === "load") loadListeners.push(handler);
    }),
    send: vi.fn(() => {
      // Defer so the Promise wrapping xhr.send() has time to attach listeners.
      // Uses a real setTimeout even under fake timers because vi.advanceTimersByTimeAsync
      // will flush it during the act() call.
      setTimeout(() => {
        // Set properties the component reads on load.
        (stub as unknown as XMLHttpRequest & { status: number; readyState: number }).status = 200;
        loadListeners.forEach((fn) => fn());
      }, 0);
    }),
    status: 200,
    readyState: 4,
  };

  globalThis.XMLHttpRequest = vi.fn(() => stub) as unknown as typeof XMLHttpRequest;
  return () => { globalThis.XMLHttpRequest = OrigXHR; };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DatasetPanel — GCS job-status r.ok guard", () => {
  let restoreXhr: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    authMock.getAuthToken.mockResolvedValue("token");
    authMock.hasAuthTokenGetter.mockReturnValue(true);
    restoreXhr = mockXhrSuccess();
  });

  afterEach(() => {
    restoreXhr();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not crash when the job-status poll returns ok:false with a non-JSON body", async () => {
    let pollCount = 0;

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("request-gcs-url")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            uploadUrl: "https://storage.googleapis.com/bucket/obj?sig=ok",
            objectKey: "pending/survey.csv",
          }),
        } as Response;
      }
      if (url.includes("gcs-job-status")) {
        pollCount++;
        // Return a non-JSON error body; r.json() would throw SyntaxError
        // without the r.ok guard. With the guard, the typed Error is thrown
        // first and caught by the .catch() handler (keep polling).
        return {
          ok: false, status: 503,
          json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
          text: async () => "<html>Service Unavailable</html>",
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    render(<DatasetPanel />);

    const file = makeFakeFile("survey.csv", "text/csv", 60 * 1024 * 1024);

    // Trigger the GCS upload path.
    await act(async () => {
      dropzoneMock.trigger([file]);
      // Advance past the XHR send's 0ms defer and let the upload settle.
      await vi.advanceTimersByTimeAsync(100);
    });

    // Now advance past the 10 s poll interval so at least one poll fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    // Component must still be mounted without crashing.
    expect(screen.getByTestId("dropzone-terrain")).toBeInTheDocument();
    // At least one poll should have been made.
    expect(pollCount).toBeGreaterThanOrEqual(1);
  });
});
