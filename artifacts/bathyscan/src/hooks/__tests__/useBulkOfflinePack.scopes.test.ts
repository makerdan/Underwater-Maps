/**
 * useBulkOfflinePack — scope-intake regression guard (task: offline downloads
 * for library / folder / selection / collection scopes).
 *
 * The bulk engine takes an arbitrary BulkDataset[]; the new scope resolver
 * now feeds it lists instead of DatasetPanel's legacy inline "all visible"
 * computation. These tests pin:
 *
 *   1. Visible-pool parity — the library-scope resolver output produces the
 *      IDENTICAL dataset sequence and skip decisions that the legacy inline
 *      list produced (fails if the all-visible path drifts).
 *   2. Overlapping scopes — a dataset covered by multiple scope members is
 *      saved exactly once.
 *   3. Cancel and network-pause mid-run leave the same resumable state as
 *      the pre-refactor behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBulkOfflinePack, type BulkDataset } from "@/hooks/useBulkOfflinePack";
import { resolveOfflineScope } from "@/lib/offlineScopeResolver";
import type { UserCatalogSave, UserDatasetMeta } from "@workspace/api-client-react";

// ── Hoisted mock values (same pattern as useBulkOfflinePack.test.ts) ─────────

const {
  mockSaveOfflinePack,
  mockListOfflinePacks,
  mockIsPackExpired,
  mockIsOnline,
  mockStorageEstimate,
} = vi.hoisted(() => {
  const mockSaveOfflinePack = vi.fn();
  const mockListOfflinePacks = vi.fn();
  const mockIsPackExpired = vi.fn();
  const mockIsOnline = { value: true };
  const mockStorageEstimate = vi.fn();
  return { mockSaveOfflinePack, mockListOfflinePacks, mockIsPackExpired, mockIsOnline, mockStorageEstimate };
});

vi.mock("@/lib/offlinePackStore", () => ({
  saveOfflinePack: mockSaveOfflinePack,
  listOfflinePacks: mockListOfflinePacks,
  isPackExpired: mockIsPackExpired,
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: {
    getState: () => ({ isOnline: mockIsOnline.value }),
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePack(datasetId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `pack-${datasetId}`,
    datasetId,
    datasetName: `Dataset ${datasetId}`,
    bbox: { minLon: -70, maxLon: -69, minLat: 43, maxLat: 44 },
    centerLat: 43.5,
    centerLon: -69.5,
    savedAt: new Date().toISOString(),
    terrainUrl: `/api/datasets/${datasetId}/terrain`,
    overviewUrl: `/api/datasets/${datasetId}/overview`,
    tidePack: {
      station: null,
      heightPredictions: [],
      currentPredictions: [],
      tidalExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      generatedAt: new Date().toISOString(),
    },
    weatherPack: { station: null, observation: null, snapshotAt: new Date().toISOString() },
    storageBytesEstimate: 2_500_000,
    ...overrides,
  };
}

const upload = (
  id: string,
  name: string,
  extra: Partial<UserDatasetMeta> = {},
): UserDatasetMeta => ({
  id,
  name,
  minDepth: 0,
  maxDepth: 100,
  folderId: null,
  createdAt: "2024-01-01T00:00:00Z",
  ...extra,
});

const save = (
  id: string,
  status: UserCatalogSave["status"],
  extra: Partial<UserCatalogSave> = {},
): UserCatalogSave => ({
  id,
  catalogId: `cat-${id}`,
  status,
  requestedAt: "2024-01-01T00:00:00Z",
  ...extra,
});

/**
 * The legacy DatasetPanel "⬇ All" inline computation, reproduced verbatim as
 * the parity baseline: all uploads first (bbox ?? undefined, resolutionM
 * spread only when non-null), then ready saves whose datasetId is not
 * already covered.
 */
function legacyVisibleList(
  userDatasets: UserDatasetMeta[],
  mySaves: UserCatalogSave[],
): BulkDataset[] {
  const out: BulkDataset[] = [];
  const seen = new Set<string>();
  for (const d of userDatasets) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push({
      id: d.id,
      name: d.name,
      bbox: d.bbox ?? undefined,
      ...(d.resolutionM != null ? { resolutionM: d.resolutionM } : {}),
    });
  }
  for (const s of mySaves) {
    if (s.status !== "ready" || !s.datasetId || seen.has(s.datasetId)) continue;
    seen.add(s.datasetId);
    out.push({
      id: s.datasetId,
      name: s.displayLabel ?? s.catalog?.name ?? s.catalogId,
      bbox: s.catalog?.coverageBbox ?? undefined,
    });
  }
  return out;
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIsOnline.value = true;
  mockListOfflinePacks.mockResolvedValue([]);
  mockIsPackExpired.mockReturnValue(false);
  mockSaveOfflinePack.mockImplementation(
    (ds: BulkDataset, _days: number, onProgress: (p: unknown) => void) => {
      onProgress({ step: "saving", label: "Saved", done: true });
      return Promise.resolve(makePack(ds.id));
    },
  );
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
  mockStorageEstimate.mockResolvedValue({ usage: 10 * 1024 * 1024, quota: 500 * 1024 * 1024 });
  if (typeof navigator.storage === "undefined") {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate: mockStorageEstimate },
    });
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator.storage as any).estimate = mockStorageEstimate;
  }
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
});

// ── 1. Visible-pool parity ────────────────────────────────────────────────────

describe("scope intake — library scope parity with the legacy all-visible list", () => {
  const BBOX = { minLon: -122.5, maxLon: -122.0, minLat: 37.5, maxLat: 38.0 };
  const COVERAGE = { minLon: -71, maxLon: -70, minLat: 41, maxLat: 42 };
  const userDatasets: UserDatasetMeta[] = [
    upload("u1", "Upload One", { bbox: BBOX, resolutionM: 4 }),
    upload("m1", "Materialized One"),
    upload("u2", "Upload Two"),
  ];
  const mySaves: UserCatalogSave[] = [
    save("s1", "ready", { datasetId: "m1" }), // covered by upload row → deduped
    save("s2", "ready", {
      datasetId: "m2",
      displayLabel: "Orphan Save",
      catalog: { coverageBbox: COVERAGE } as UserCatalogSave["catalog"],
    }),
    save("s3", "processing", { displayLabel: "Cooking" }), // legacy silently ignored; resolver skips
  ];

  it("resolver output equals the legacy inline list (ids, names, bbox, resolution, order)", () => {
    const resolved = resolveOfflineScope(
      { kind: "library" },
      { folders: [], datasets: userDatasets, saves: mySaves },
    );
    expect(resolved.datasets).toEqual(legacyVisibleList(userDatasets, mySaves));
    // Non-ready saves become visible skips (legacy dropped them silently).
    expect(resolved.skipped).toEqual([
      { id: "s3", name: "Cooking", reason: expect.stringMatching(/Still processing/) },
    ]);
  });

  it("engine processes the resolved library list in the same sequence with the same skip decisions as the legacy list", async () => {
    // m1 already has a valid pack → skip-valid must hit the same row in both runs.
    mockListOfflinePacks.mockResolvedValue([makePack("m1")]);
    mockIsPackExpired.mockReturnValue(false);

    const runEngine = async (datasets: BulkDataset[]) => {
      const order: string[] = [];
      mockSaveOfflinePack.mockImplementation(
        (ds: BulkDataset, _d: number, onP: (p: unknown) => void) => {
          order.push(ds.id);
          onP({ step: "saving", label: "Saved", done: true });
          return Promise.resolve(makePack(ds.id));
        },
      );
      const { result, unmount } = renderHook(() => useBulkOfflinePack(datasets));
      await act(async () => { void result.current.start(); });
      await waitFor(() => expect(result.current.phase).toBe("done"), { timeout: 5000 });
      const statuses = result.current.rows.map((r) => [r.dataset.id, r.status]);
      unmount();
      return { order, statuses };
    };

    const legacyRun = await runEngine(legacyVisibleList(userDatasets, mySaves));
    const resolvedRun = await runEngine(
      resolveOfflineScope(
        { kind: "library" },
        { folders: [], datasets: userDatasets, saves: mySaves },
      ).datasets,
    );

    expect(resolvedRun.order).toEqual(legacyRun.order);
    expect(resolvedRun.statuses).toEqual(legacyRun.statuses);
    // Sanity: the skip decision actually happened (m1 skipped, not saved).
    expect(resolvedRun.statuses).toContainEqual(["m1", "skipped"]);
  });
});

// ── 2. Overlapping scopes save each dataset exactly once ─────────────────────

describe("scope intake — overlapping scope members download once", () => {
  it("a dataset reachable via folder + direct id + save id is saved exactly once", async () => {
    const folders = [
      { id: "f1", name: "F1", parentId: null, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
    ];
    const datasets = [upload("m1", "Materialized", { folderId: "f1" }), upload("d2", "Plain", { folderId: "f1" })];
    const saves = [save("s1", "ready", { datasetId: "m1", folderId: "f1" })];

    const resolved = resolveOfflineScope(
      { kind: "selection", ids: ["f1", "m1", "s1", "d2"] },
      { folders, datasets, saves },
    );
    expect(resolved.datasets.map((d) => d.id).sort()).toEqual(["d2", "m1"]);

    const { result } = renderHook(() => useBulkOfflinePack(resolved.datasets));
    await act(async () => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe("done"), { timeout: 5000 });

    // Exactly one save call per unique dataset — no duplicates.
    expect(mockSaveOfflinePack).toHaveBeenCalledTimes(2);
    const savedIds = mockSaveOfflinePack.mock.calls.map((c) => (c[0] as BulkDataset).id).sort();
    expect(savedIds).toEqual(["d2", "m1"]);
  });
});

// ── 3. Cancel / pause leave the same resumable state ─────────────────────────

describe("scope intake — cancel and pause semantics unchanged for resolved lists", () => {
  const scopedList = (): BulkDataset[] =>
    resolveOfflineScope(
      { kind: "library" },
      {
        folders: [],
        datasets: [upload("a", "A"), upload("b", "B"), upload("c", "C")],
        saves: [],
      },
    ).datasets;

  it("cancel mid-run stops after the in-flight row, leaving later rows untouched", async () => {
    let resolveA!: () => void;
    mockSaveOfflinePack
      .mockImplementationOnce((_ds: BulkDataset, _d: number, onP: (p: unknown) => void) =>
        new Promise((res) => {
          resolveA = () => {
            onP({ step: "saving", label: "Saved", done: true });
            res(makePack("a"));
          };
        }),
      )
      .mockImplementation((ds: BulkDataset, _d: number, onP: (p: unknown) => void) => {
        onP({ step: "saving", label: "Saved", done: true });
        return Promise.resolve(makePack(ds.id));
      });

    const { result } = renderHook(() => useBulkOfflinePack(scopedList()));

    act(() => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe("running"));
    act(() => { result.current.cancel(); });
    await act(async () => { resolveA(); });
    await waitFor(() => expect(result.current.phase).toBe("cancelled"), { timeout: 3000 });

    // Only the in-flight row was processed; b and c never started.
    expect(mockSaveOfflinePack).toHaveBeenCalledTimes(1);
    const rowB = result.current.rows.find((r) => r.dataset.id === "b");
    const rowC = result.current.rows.find((r) => r.dataset.id === "c");
    expect(rowB?.status).not.toBe("done");
    expect(rowC?.status).not.toBe("done");
  });

  it("network loss mid-run pauses with completed rows done and the rest paused", async () => {
    let callCount = 0;
    mockSaveOfflinePack.mockImplementation(
      (ds: BulkDataset, _d: number, onP: (p: unknown) => void) => {
        callCount++;
        if (callCount === 1) mockIsOnline.value = false;
        onP({ step: "saving", label: "Saved", done: true });
        return Promise.resolve(makePack(ds.id));
      },
    );

    const { result } = renderHook(() => useBulkOfflinePack(scopedList()));
    await act(async () => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe("paused"), { timeout: 5000 });

    expect(mockSaveOfflinePack).toHaveBeenCalledTimes(1);
    const rowA = result.current.rows.find((r) => r.dataset.id === "a");
    const rowB = result.current.rows.find((r) => r.dataset.id === "b");
    expect(rowA?.status).toBe("done");
    expect(rowB?.status).toBe("paused");
  });
});
