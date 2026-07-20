/**
 * DatasetPanel.gcsUpload.test.tsx
 *
 * Regression tests for the GCS large-file upload path:
 *   - gcsUploadFile sends `Authorization: Bearer <token>` on the
 *     request-gcs-url fetch call.
 *   - gcsUploadFile surfaces a clear auth error when the token getter is
 *     registered but returns null (expired session).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

// Controls getAuthToken and hasAuthTokenGetter for each test.
const authMock = vi.hoisted(() => ({
  getAuthToken: vi.fn<() => Promise<string | null>>(async () => "test-bearer-token-abc"),
  hasAuthTokenGetter: vi.fn<() => boolean>(() => true),
}));

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

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat();
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
        mutate: vi.fn(),
        isPending: false,
        isSuccess: false,
      }),
      getAuthToken: authMock.getAuthToken,
      hasAuthTokenGetter: authMock.hasAuthTokenGetter,
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

describe("DatasetPanel — gcsUploadFile Authorization header", () => {
  beforeEach(() => {
    authMock.getAuthToken.mockResolvedValue("test-bearer-token-abc");
    authMock.hasAuthTokenGetter.mockReturnValue(true);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes Authorization: Bearer <token> on the request-gcs-url fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        uploadUrl: "https://storage.googleapis.com/test-bucket/pending-datasets/user/uuid/survey.csv?sig=fake",
        objectKey: "pending-datasets/user/uuid/survey.csv",
      }),
    } as Response);

    render(<DatasetPanel />);

    const file = makeFakeFile(
      "survey.csv",
      "text/csv",
      60 * 1024 * 1024,
    );

    await act(async () => {
      dropzoneMock.trigger([file]);
    });

    const presignedCall = fetchSpy.mock.calls.find(([url]) =>
      typeof url === "string" && url.includes("request-gcs-url"),
    );
    expect(presignedCall).toBeDefined();

    const [, init] = presignedCall!;
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("authorization")).toBe("Bearer test-bearer-token-abc");
  });

  it("surfaces a clear auth error when getAuthToken returns null but getter is registered", async () => {
    authMock.getAuthToken.mockResolvedValue(null);
    authMock.hasAuthTokenGetter.mockReturnValue(true);

    const fetchSpy = vi.spyOn(global, "fetch");

    render(<DatasetPanel />);

    const file = makeFakeFile(
      "survey.csv",
      "text/csv",
      60 * 1024 * 1024,
    );

    await act(async () => {
      dropzoneMock.trigger([file]);
    });

    expect(fetchSpy).not.toHaveBeenCalled();

    expect(
      screen.getByText(/Authentication required/i),
    ).toBeInTheDocument();
  });

  it("proceeds without Authorization header when no getter is registered (test/dev environment)", async () => {
    authMock.getAuthToken.mockResolvedValue(null);
    authMock.hasAuthTokenGetter.mockReturnValue(false);

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_param" }),
    } as Response);

    render(<DatasetPanel />);

    const file = makeFakeFile(
      "survey.csv",
      "text/csv",
      60 * 1024 * 1024,
    );

    await act(async () => {
      dropzoneMock.trigger([file]);
    });

    const presignedCall = fetchSpy.mock.calls.find(([url]) =>
      typeof url === "string" && url.includes("request-gcs-url"),
    );
    expect(presignedCall).toBeDefined();

    const [, init] = presignedCall!;
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("authorization")).toBeNull();
  });

  it("retries with a fresh token when request-gcs-url returns 401 (Clerk token expiry race)", async () => {
    vi.useFakeTimers();

    // First getAuthToken call returns a stale token; second returns a fresh one.
    authMock.getAuthToken
      .mockResolvedValueOnce("stale-token-expired")
      .mockResolvedValueOnce("fresh-token-after-refresh");
    authMock.hasAuthTokenGetter.mockReturnValue(true);

    // First fetch → 401 (expired token). Second fetch → presigned URL (fresh token).
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          uploadUrl: "https://storage.googleapis.com/bucket/pending/survey.csv?sig=ok",
          objectKey: "pending/survey.csv",
        }),
      } as Response);

    render(<DatasetPanel />);

    const file = makeFakeFile("survey.csv", "text/csv", 60 * 1024 * 1024);

    // Kick off the upload, advance past the 3-second retry delay, then settle.
    await act(async () => {
      dropzoneMock.trigger([file]);
      await vi.advanceTimersByTimeAsync(3_500);
    });

    vi.useRealTimers();

    // Two calls to request-gcs-url should have been made.
    const presignedCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === "string" && url.includes("request-gcs-url"),
    );
    expect(presignedCalls).toHaveLength(2);

    // First call used the stale token.
    const firstHeaders = new Headers(presignedCalls[0]![1]?.headers as HeadersInit);
    expect(firstHeaders.get("authorization")).toBe("Bearer stale-token-expired");

    // Second call used the fresh token.
    const secondHeaders = new Headers(presignedCalls[1]![1]?.headers as HeadersInit);
    expect(secondHeaders.get("authorization")).toBe("Bearer fresh-token-after-refresh");
  });
});
