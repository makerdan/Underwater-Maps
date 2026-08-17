/**
 * DatasetPanel.gcsRestartRecovery.test.tsx
 *
 * Tests for the GCS job-status poll handling of restart-recovery statuses
 * (UX audit SEED F-008). After a server restart the poll endpoint answers
 * from the persisted upload_jobs row or GCS probing instead of the lost
 * in-memory job, producing statuses the client previously treated as
 * "unexpected" hard failures:
 *
 *   "pending"  → file safe in GCS, server will re-queue it — keep polling
 *   "complete" → processing finished but datasetId was lost — success toast,
 *                refresh dataset list, no error UI
 *   "unknown"  → no trace of the upload — dismissible "Upload interrupted"
 *                error asking the user to retry
 *
 * Mock scaffolding mirrors DatasetPanel.gcsJobStatusOk.test.tsx, with a
 * hoisted toast spy so toast content can be asserted.
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

const toastMock = vi.hoisted(() => ({
  toast: vi.fn(),
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
  const mockState = {
    setPendingDropIn: vi.fn(),
    georefPickBbox: null as null | { minLon: number; minLat: number; maxLon: number; maxLat: number },
    georefPickMode: false,
    setGeorefPickMode: vi.fn(),
    setGeorefPickBbox: vi.fn(),
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
  useToast: () => toastMock,
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

/** XHR stub that immediately fires "load" with status 200 on send(). */
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
      setTimeout(() => {
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

/**
 * Mock fetch so the request-gcs-url step succeeds and every job-status poll
 * responds with the given payload. Returns a counter object for poll calls.
 */
function mockPolls(jobPayload: Record<string, unknown>) {
  const counter = { polls: 0 };
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("request-gcs-url")) {
      return {
        ok: true, status: 200,
        json: async () => ({
          uploadUrl: "https://storage.googleapis.com/bucket/obj?sig=ok",
          objectKey: "pending-datasets/user_a/uuid-1/survey.csv",
        }),
      } as Response;
    }
    if (url.includes("gcs-job-status")) {
      counter.polls++;
      return { ok: true, status: 200, json: async () => jobPayload } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  return counter;
}

async function startGcsUpload() {
  render(<DatasetPanel />);
  const file = makeFakeFile("survey.csv", "text/csv", 60 * 1024 * 1024);
  await act(async () => {
    dropzoneMock.trigger([file]);
    await vi.advanceTimersByTimeAsync(100);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DatasetPanel — GCS poll restart-recovery statuses", () => {
  let restoreXhr: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    authMock.getAuthToken.mockResolvedValue("token");
    authMock.hasAuthTokenGetter.mockReturnValue(true);
    toastMock.toast.mockClear();
    restoreXhr = mockXhrSuccess();
  });

  afterEach(() => {
    restoreXhr();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows a dismissible "Upload interrupted" error when the poll returns status=unknown', async () => {
    const serverMsg = "Job not found — please re-upload your file.";
    mockPolls({ status: "unknown", error: serverMsg });

    await startGcsUpload();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    // The dismissible upload-error popup shows the server's message.
    expect(screen.getByText(serverMsg)).toBeInTheDocument();
    expect(toastMock.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Upload interrupted", variant: "destructive" }),
    );
  });

  it("falls back to a generic interrupted message when status=unknown carries no error", async () => {
    mockPolls({ status: "unknown" });

    await startGcsUpload();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    expect(screen.getByText(/Upload interrupted — the server was restarted/)).toBeInTheDocument();
  });

  it("treats status=complete as success: toast, no error UI, polling stops", async () => {
    const counter = mockPolls({ status: "complete" });

    await startGcsUpload();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    expect(toastMock.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("Dataset ready") }),
    );
    expect(screen.queryByText(/Upload interrupted/)).not.toBeInTheDocument();

    // Polling stopped — no further requests on later ticks.
    const pollsAtStop = counter.polls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });
    expect(counter.polls).toBe(pollsAtStop);
  });

  it("keeps polling on status=pending (post-restart requeue) without error UI", async () => {
    const counter = mockPolls({ status: "pending" });

    await startGcsUpload();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(21_000); // two poll ticks
    });

    expect(counter.polls).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Upload interrupted/)).not.toBeInTheDocument();
    expect(toastMock.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("maps status=error to the same failure handling as status=failed", async () => {
    mockPolls({ status: "error", error: "Depth column missing" });

    await startGcsUpload();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    expect(screen.getByText("Depth column missing")).toBeInTheDocument();
    expect(toastMock.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Upload processing failed", variant: "destructive" }),
    );
  });
});
