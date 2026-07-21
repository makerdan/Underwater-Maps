/**
 * DatasetPanel.chunkedRetry.healthProbe.test.tsx
 *
 * Verifies that handleRetryChunked probes GET /api/healthz before re-entering
 * the upload loop and, when the server is unreachable, shows a clear
 * "Server unreachable" error message while keeping the retry button visible.
 *
 * Also verifies the auto-retry-on-reconnect path introduced alongside the
 * health probe: when handleRetryChunked's probe fails it calls
 * markServerUnreachable() so the background health poll starts. When the
 * poll detects the server is back it fires the reconnect event, the subscriber
 * re-probes /api/healthz, and if that succeeds the upload resumes without
 * requiring the user to click Retry again.
 *
 * Strategy (existing probe-failure tests):
 *   1. Drop a fake chunked-size file → doSendChunks → chunk 500 → "error" phase.
 *   2. Replace the global fetch mock so /api/healthz returns a non-OK response
 *      (or throws a TypeError) to simulate the server being unreachable.
 *   3. Click "Retry upload" — handleRetryChunked runs the health probe, sees
 *      the server is unreachable, sets the "Server unreachable" error and returns.
 *   4. Assert the new error message is rendered.
 *   5. Assert the retry button is still visible (chunkedPhase stayed "error").
 *   6. Assert the chunk endpoint was never called during the retry attempt.
 *
 * Strategy (new auto-reconnect tests):
 *   7. After the "Server unreachable" error is set, confirm markServerUnreachable
 *      was called (so the health poll is started).
 *   8. Fire the reconnect event via the captured subscribeToReconnect listener.
 *   9a. When the re-probe still fails: assert "Server unreachable" stays on screen.
 *   9b. When the re-probe succeeds: assert the chunk upload endpoint is called
 *       and the retry button disappears (upload auto-resumed).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { DatasetPanel } from "@/components/DatasetPanel";

// ── Hoisted state ──────────────────────────────────────────────────────────────

const reconnectMock = vi.hoisted(() => {
  const listeners = new Set<() => void | Promise<void>>();
  return {
    listeners,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    async fire() {
      for (const fn of [...listeners]) {
        await fn();
      }
    },
    markUnreachable: vi.fn(),
    reset() {
      listeners.clear();
      reconnectMock.markUnreachable.mockReset();
    },
  };
});

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

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/queryClient", () => ({
  subscribeToReconnect: reconnectMock.subscribe,
  markServerUnreachable: reconnectMock.markUnreachable,
}));

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

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn: false, isLoaded: true }) });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
  QueryClient: class {
    fetchQuery = vi.fn();
    invalidateQueries = vi.fn();
  },
  QueryCache: class { constructor(_opts?: unknown) {} },
  MutationCache: class { constructor(_opts?: unknown) {} },
}));

vi.mock("@/lib/terrainStore", () => {
  const state = {
    setGrids: vi.fn(),
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
    }),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakeFile(name: string, type: string, fakeSize: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", {
    value: fakeSize,
    configurable: true,
    writable: false,
  });
  return file;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DatasetPanel — handleRetryChunked health probe", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows 'Server unreachable' and keeps the retry button visible when the health probe fails (network error)", async () => {
    // Phase 1: The initial chunk upload fails with a 500 so the component enters
    // the "error" state and the retry button appears.
    let fetchCallCount = 0;
    const chunkCallsDuringRetry: string[] = [];

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : String(input);
      fetchCallCount++;

      // Health probe during retry — simulate a network failure.
      if (url.includes("/api/healthz")) {
        throw new TypeError("Failed to fetch");
      }

      // Track any chunk calls that sneak through after the retry click.
      if (url.includes("/datasets/upload/chunk")) {
        chunkCallsDuringRetry.push(url);
        // First chunk call (initial upload) → 500 to trigger error state.
        return {
          ok: false,
          status: 500,
          json: async () => ({
            error: "server_error",
            details: "Simulated chunk failure",
          }),
        } as Response;
      }

      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    render(<DatasetPanel />);

    // Drop a file in the chunked range (10 MB < size ≤ 50 MB).
    const file = makeFakeFile("survey.bag", "application/octet-stream", 15 * 1024 * 1024);
    await act(async () => {
      dropzoneMock.trigger([file]);
    });

    // The retry button must be visible after the initial chunk failure.
    const retryBtn = await screen.findByTestId("btn-retry-chunked-upload");
    expect(retryBtn).toBeInTheDocument();

    // Reset the chunk-call tracker — we only care about calls during the retry.
    chunkCallsDuringRetry.length = 0;
    const fetchCallsBeforeRetry = fetchCallCount;

    // Phase 2: Click Retry — the health probe fires, fails, and handleRetryChunked
    // returns early without touching the chunk endpoint.
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    // The "Server unreachable" message must now appear in the error popup.
    expect(
      screen.getByText(/Server unreachable — check your connection and try again/i),
    ).toBeInTheDocument();

    // The retry button must still be visible (chunkedPhase stayed "error").
    expect(screen.getByTestId("btn-retry-chunked-upload")).toBeInTheDocument();

    // The chunk upload endpoint must NOT have been called during the retry.
    expect(chunkCallsDuringRetry).toHaveLength(0);

    // The health probe itself must have been attempted (at least one fetch after retry click).
    expect(fetchCallCount).toBeGreaterThan(fetchCallsBeforeRetry);
  });

  it("shows 'Server unreachable' and keeps the retry button visible when the health probe returns a non-OK HTTP response", async () => {
    let chunkPhaseEntered = false;

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : String(input);

      if (url.includes("/api/healthz")) {
        // Simulate the server returning 503 during the health probe.
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }

      if (url.includes("/datasets/upload/chunk")) {
        if (!chunkPhaseEntered) {
          chunkPhaseEntered = true;
          // First call: initial upload → fail to put component into "error" state.
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "server_error", details: "Simulated failure" }),
          } as Response;
        }
        // Any subsequent chunk call during retry → should not happen.
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }

      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    render(<DatasetPanel />);

    const file = makeFakeFile("ocean.csv", "text/csv", 20 * 1024 * 1024);
    await act(async () => {
      dropzoneMock.trigger([file]);
    });

    const retryBtn = await screen.findByTestId("btn-retry-chunked-upload");
    expect(retryBtn).toBeInTheDocument();

    // Reset entry flag so we can detect a second chunk call during retry.
    chunkPhaseEntered = false;

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(
      screen.getByText(/Server unreachable — check your connection and try again/i),
    ).toBeInTheDocument();

    // Retry button must persist.
    expect(screen.getByTestId("btn-retry-chunked-upload")).toBeInTheDocument();

    // Chunk endpoint must not have been called again during the retry.
    expect(chunkPhaseEntered).toBe(false);
  });

  it("calls markServerUnreachable after a health probe failure so the reconnect poll is started", async () => {
    reconnectMock.reset();

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/healthz")) {
        throw new TypeError("Failed to fetch");
      }
      if (url.includes("/datasets/upload/chunk")) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "server_error", details: "Simulated failure" }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    render(<DatasetPanel />);

    const file = makeFakeFile("survey.bag", "application/octet-stream", 15 * 1024 * 1024);
    await act(async () => { dropzoneMock.trigger([file]); });

    const retryBtn = await screen.findByTestId("btn-retry-chunked-upload");

    await act(async () => { fireEvent.click(retryBtn); });

    expect(
      screen.getByText(/Server unreachable — check your connection and try again/i),
    ).toBeInTheDocument();

    // markServerUnreachable must have been called so the health poll starts
    // and the reconnect event can fire when the server comes back.
    expect(reconnectMock.markUnreachable).toHaveBeenCalledTimes(1);
  });

  it("re-probes health on reconnect and stays in error when the re-probe still fails", async () => {
    reconnectMock.reset();

    let healthProbeCount = 0;

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/healthz")) {
        healthProbeCount++;
        throw new TypeError("Failed to fetch");
      }
      if (url.includes("/datasets/upload/chunk")) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "server_error", details: "Simulated failure" }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    render(<DatasetPanel />);

    const file = makeFakeFile("survey.bag", "application/octet-stream", 15 * 1024 * 1024);
    await act(async () => { dropzoneMock.trigger([file]); });

    const retryBtn = await screen.findByTestId("btn-retry-chunked-upload");

    // Click Retry → health probe fails → "Server unreachable"
    await act(async () => { fireEvent.click(retryBtn); });

    expect(
      screen.getByText(/Server unreachable — check your connection and try again/i),
    ).toBeInTheDocument();

    const probesBefore = healthProbeCount;

    // Fire reconnect — the subscriber re-probes health (still failing)
    await act(async () => { await reconnectMock.fire(); });

    // Health probe must have been called again during the reconnect handler
    expect(healthProbeCount).toBeGreaterThan(probesBefore);

    // "Server unreachable" must still be shown — probe still failing
    expect(
      screen.getByText(/Server unreachable — check your connection and try again/i),
    ).toBeInTheDocument();

    // Retry button must still be present
    expect(screen.getByTestId("btn-retry-chunked-upload")).toBeInTheDocument();
  });

  it("auto-resumes the upload without a manual click when reconnect fires and the re-probe passes", async () => {
    reconnectMock.reset();

    let serverBack = false;
    const chunkCallsAfterReconnect: string[] = [];

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : String(input);

      if (url.includes("/api/healthz")) {
        if (!serverBack) throw new TypeError("Failed to fetch");
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }

      if (url.includes("/datasets/upload/chunk/status/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ receivedChunks: [] }),
        } as Response;
      }

      if (url.includes("/datasets/upload/chunk/finalize")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ jobId: "fake-job-id" }),
        } as Response;
      }

      if (url.includes("/datasets/upload/chunk")) {
        if (!serverBack) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "server_error", details: "Simulated failure" }),
          } as Response;
        }
        chunkCallsAfterReconnect.push(url);
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }

      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    render(<DatasetPanel />);

    const file = makeFakeFile("survey.bag", "application/octet-stream", 15 * 1024 * 1024);
    await act(async () => { dropzoneMock.trigger([file]); });

    const retryBtn = await screen.findByTestId("btn-retry-chunked-upload");

    // Click Retry → health probe fails → "Server unreachable"
    await act(async () => { fireEvent.click(retryBtn); });

    expect(
      screen.getByText(/Server unreachable — check your connection and try again/i),
    ).toBeInTheDocument();

    // Server comes back — fire the reconnect event
    serverBack = true;
    await act(async () => { await reconnectMock.fire(); });

    // The reconnect subscriber re-probed health (passed), ran the status
    // endpoint, and re-entered the upload loop — chunk endpoint must have
    // been called.
    expect(chunkCallsAfterReconnect.length).toBeGreaterThan(0);

    // The retry button must be gone — the phase moved past "error".
    expect(screen.queryByTestId("btn-retry-chunked-upload")).not.toBeInTheDocument();
  });
});
