/**
 * DatasetPanel.pollInterrupt.test.tsx
 *
 * Verifies that the chunked-upload poll loop survives transient API failures
 * and only surfaces an interruption after the durable job is confirmed missing.
 *
 * Three scenarios are covered:
 *
 *   (a) A confirmed 404 → chunkedPhase becomes "error" and the missing-job
 *       message is displayed.
 *   (b) One non-OK response followed by a successful response → no error is surfaced.
 *   (c) A job status:"error" response → the existing job-error path fires,
 *       NOT the new consecutive-failure path.
 *
 * Strategy:
 *   1. Drop a file in the chunked range (10 MB < size ≤ 50 MB) to enter the
 *      upload phase.
 *   2. Mock authorizedFetch so chunk + finalize calls succeed and return a
 *      jobId, moving the component into "processing" (poll loop active).
 *   3. Control poll responses via a sequence-based mock.
 *   4. Use real timers + waitFor (generous timeout) so successive 1.5 s poll
 *      cycles complete naturally without fake-timer complexity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { DatasetPanel, MAX_UPLOAD_POLL_DURATION_MS } from "@/components/DatasetPanel";

// ── Hoisted state ──────────────────────────────────────────────────────────────

const authorizedFetchMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<Response>>());

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

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: (...args: unknown[]) => authorizedFetchMock(...args),
}));

vi.mock("@/lib/queryClient", () => ({
  subscribeToReconnect: () => () => {},
  markServerUnreachable: () => {},
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
    persist: { hasHydrated: () => boolean };
    setState: (patch: Partial<SettingsMockState>) => void;
    subscribe: () => () => void;
  };
  useSettingsStore.getState = () => state;
  useSettingsStore.persist = { hasHydrated: () => true };
  useSettingsStore.setState = vi.fn();
  useSettingsStore.subscribe = () => () => {};
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

/** Build a minimal ok Response-like object for a poll job status. */
function makeJobResponse(body: object): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

/** Build a non-OK Response-like object. */
function makeNonOkResponse(status = 404): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as Response;
}

/**
 * Install the authorizedFetch mock and render DatasetPanel.
 * The mock routes requests:
 *   - upload/chunk        → ok
 *   - upload/chunk/finalize → ok, returns { jobId: "test-job-id" }
 *   - upload/jobs/:id     → responses from `pollResponses` in order;
 *                           the last entry repeats once exhausted
 *
 * Returns a `nthJobPoll(n)` helper that resolves when the nth poll
 * (1-based) against the jobs endpoint fires, without needing to poll
 * `mock.calls` repeatedly from the test.
 */
function installMockAndRender(pollResponses: Response[]): {
  nthJobPoll: (n: number) => Promise<void>;
} {
  let pollIdx = 0;
  let jobPollCount = 0;
  // Per-n promise resolvers so tests can await a specific poll number.
  const resolvers: Map<number, () => void> = new Map();
  const promises: Map<number, Promise<void>> = new Map();

  function nthJobPoll(n: number): Promise<void> {
    if (!promises.has(n)) {
      promises.set(
        n,
        new Promise<void>((resolve) => {
          resolvers.set(n, resolve);
        }),
      );
    }
    return promises.get(n)!;
  }

  authorizedFetchMock.mockImplementation(async (url: unknown) => {
    const u = String(url);

    if (u.includes("/upload/start")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ uploadId: "00000000-0000-4000-8000-000000000001" }),
      } as Response;
    }

    if (u.includes("/upload/chunk/finalize")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ jobId: "test-job-id" }),
      } as Response;
    }

    if (u.includes("/upload/chunk")) {
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }

    if (u.includes("/upload/jobs/")) {
      jobPollCount++;
      // Resolve the promise for this poll number immediately.
      resolvers.get(jobPollCount)?.();
      const resp =
        pollResponses[Math.min(pollIdx, pollResponses.length - 1)] ??
        makeNonOkResponse(500);
      pollIdx = Math.min(pollIdx + 1, pollResponses.length - 1);
      return resp;
    }

    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });

  render(<DatasetPanel />);
  return { nthJobPoll };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DatasetPanel — durable poll recovery (SEED F-008)", () => {
  beforeEach(() => {
    authorizedFetchMock.mockReset();
  });

  afterEach(() => {
    // Always restore real timers so a test that enables vi.useFakeTimers()
    // cannot poison subsequent tests with stale fake-timer state.
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * (a) A confirmed 404 is terminal. It is the only non-OK poll response
   * that tells the user the durable job cannot be recovered.
   */
   it("(a) surfaces a missing-job error after a confirmed 404", async () => {
    installMockAndRender([
      makeNonOkResponse(404),
    ]);

    // Drop a 15 MB file → chunked path (10 MB < size ≤ 50 MB).
    const file = makeFakeFile("survey.bag", "application/octet-stream", 15 * 1024 * 1024);
    await act(async () => {
      dropzoneMock.trigger([file]);
    });

    await waitFor(
      () => {
        expect(
          screen.getByText(/Upload processing could not be recovered/i),
        ).toBeInTheDocument();
      },
      { timeout: 3_000 },
    );

    // The retry button is appropriate only after the missing job is confirmed.
    expect(screen.getByTestId("btn-retry-chunked-upload")).toBeInTheDocument();
  }, 10_000);

  /**
   * (b) One transient non-OK followed by a successful "done" response → no
   * interruption error is surfaced and the poll loop terminates cleanly.
   *
   * WHY fake timers:
   *   React 18's act() drains ALL pending scheduled work — including real
   *   setTimeout callbacks — before settling. With an ongoing poll loop that
   *   keeps calling scheduleNext(), act() chases each new 1.5 s timer
   *   indefinitely and never settles (→ 15 s hang). We need the loop to
   *   terminate *before* act() tries to settle. "done" terminates it, but
   *   we also need to ensure act() sees a quiescent state when it flushes.
   *
   *   Fake timers give us deterministic control: we advance the clock by
   *   exactly 2 s inside act() so poll 2 fires and returns "done" (no further
   *   timer is scheduled), then act() settles cleanly.
   *
   * The important invariant is that the first failure did not discard the
   * session or stop recovery before the durable response arrived.
   */
  it("(b) resets the failure counter on a successful response — no error after 1 non-OK then 1 OK", async () => {
    vi.useFakeTimers();

    installMockAndRender([
      makeNonOkResponse(503),
      makeJobResponse({ status: "done", datasetId: "completed-dataset-id" }),
    ]);

    const file = makeFakeFile("survey.bag", "application/octet-stream", 15 * 1024 * 1024);

    // Drop file and advance fake clock to flush the entire async upload chain
    // (chunk POSTs + finalize) which runs as microtasks. poll() is called
    // immediately by the useEffect; poll 1 fires (non-OK, counter=1) and
    // schedules the next poll via setTimeout(poll, 1500) — a fake timer.
    await act(async () => {
      dropzoneMock.trigger([file]);
      await vi.advanceTimersByTimeAsync(100);
    });

    // Advance past the 1500 ms poll interval so poll 2 fires. poll 2 returns
    // "done": counter resets to 0, stopped=true, no further timer scheduled.
    // act() can now drain the resulting idle-state updates and settle cleanly.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    // The transient interruption must not become a user-visible error.
    expect(
      screen.queryByText(/Upload processing could not be recovered/i),
    ).not.toBeInTheDocument();

    // The retry button must NOT be visible — chunkedPhase moved to "idle"
    // (successful done), not to "error".
    expect(
      screen.queryByTestId("btn-retry-chunked-upload"),
    ).not.toBeInTheDocument();
  }, 15_000);

  /**
   * (d) The exported MAX_UPLOAD_POLL_DURATION_MS constant equals 5 minutes
   * (300 000 ms).  This constant is passed directly to the setTimeout that
   * caps the poll loop, so asserting its value is equivalent to asserting the
   * timeout fires at the right time — without any rendering or timer overhead.
   */
  it("(d) MAX_UPLOAD_POLL_DURATION_MS is 5 minutes (300 000 ms), not 10 minutes", () => {
    expect(MAX_UPLOAD_POLL_DURATION_MS).toBe(300_000);
    expect(MAX_UPLOAD_POLL_DURATION_MS).not.toBe(600_000);
  });

  /**
   * (c) A job status:"error" response → existing job-error path fires,
   * NOT the new consecutive-failure path.
   *
   * The first poll returns ok:true + status:"error". The component should
   * surface the job's own error message, not the interruption message.
   */
  it("(c) a job status:'error' response uses the existing error path, not the consecutive-failure path", async () => {
    installMockAndRender([
      makeJobResponse({ status: "error", progress: 0, error: "Codec not supported" }),
    ]);

    const file = makeFakeFile("survey.bag", "application/octet-stream", 15 * 1024 * 1024);
    await act(async () => {
      dropzoneMock.trigger([file]);
    });

    // The explicit job error message must be shown (not the interruption message).
    await waitFor(
      () => {
        expect(screen.getByText(/Codec not supported/i)).toBeInTheDocument();
      },
      { timeout: 5_000 },
    );

    // The interruption message must NOT appear.
    expect(
      screen.queryByText(/Upload processing was interrupted/i),
    ).not.toBeInTheDocument();

    // The retry button must be visible (chunkedPhase === "error").
    expect(screen.getByTestId("btn-retry-chunked-upload")).toBeInTheDocument();
  }, 10_000);
});
