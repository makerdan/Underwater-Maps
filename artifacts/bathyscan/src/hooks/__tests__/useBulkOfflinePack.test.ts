/**
 * useBulkOfflinePack — unit tests
 *
 * Covers:
 *   - Sequential processing order across multiple datasets
 *   - Already-saved non-expired packs are skipped by default
 *   - Force-update overrides the skip for an existing pack
 *   - A saveOfflinePack error on one row marks it failed without aborting the rest
 *   - Cancellation stops after the current iteration completes
 *   - Mid-batch offline detection pauses the batch
 *   - IDB unavailable during the initial probe surfaces a pre-flight error
 *   - Quota below the low-water mark produces a pre-flight warning (not a block)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBulkOfflinePack } from "@/hooks/useBulkOfflinePack";

// ── Hoisted mock values ───────────────────────────────────────────────────────

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

// ── Module mocks ──────────────────────────────────────────────────────────────

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

const DS_A = { id: "a", name: "Dataset A" };
const DS_B = { id: "b", name: "Dataset B" };
const DS_C = { id: "c", name: "Dataset C" };

function makePack(datasetId: string, overrides: Partial<ReturnType<typeof makePack>> = {}) {
  return {
    id: `pack-${datasetId}`,
    datasetId,
    datasetName: `Dataset ${datasetId.toUpperCase()}`,
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

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIsOnline.value = true;

  // Default: no existing packs, no errors
  mockListOfflinePacks.mockResolvedValue([]);
  mockIsPackExpired.mockReturnValue(false);

  // Default saveOfflinePack: resolves immediately with a pack
  mockSaveOfflinePack.mockImplementation(
    (ds: typeof DS_A, _days: number, onProgress: (p: unknown) => void) => {
      onProgress({ step: "terrain", label: "Terrain cached", done: true });
      onProgress({ step: "tide", label: "Tide saved", done: true });
      onProgress({ step: "weather", label: "Weather saved", done: true });
      onProgress({ step: "saving", label: "Saved", done: true });
      return Promise.resolve(makePack(ds.id));
    },
  );

  // navigator.onLine = true by default
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => true,
  });

  // navigator.storage.estimate — normal quota
  mockStorageEstimate.mockResolvedValue({
    usage: 10 * 1024 * 1024,
    quota: 500 * 1024 * 1024,
  });
  if (typeof navigator.storage === "undefined") {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate: mockStorageEstimate },
    });
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator.storage as any).estimate = mockStorageEstimate;
  }

  // Silence SW pack probe fetches (not a real browser)
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useBulkOfflinePack — sequential processing order", () => {
  it("processes datasets in order and marks all done", async () => {
    const order: string[] = [];
    mockSaveOfflinePack.mockImplementation(
      (ds: typeof DS_A, _d: number, onP: (p: unknown) => void) => {
        order.push(ds.id);
        onP({ step: "saving", label: "Saved", done: true });
        return Promise.resolve(makePack(ds.id));
      },
    );

    const { result } = renderHook(() =>
      useBulkOfflinePack([DS_A, DS_B, DS_C]),
    );

    await act(async () => {
      void result.current.start();
    });

    await waitFor(() => expect(result.current.phase).toBe("done"), { timeout: 5000 });

    expect(order).toEqual(["a", "b", "c"]);
    expect(result.current.rows.every((r) => r.status === "done")).toBe(true);
  });
});

describe("useBulkOfflinePack — skip already-saved non-expired packs", () => {
  it("skips a dataset that has a valid existing pack by default", async () => {
    const existingPack = makePack("a");
    mockListOfflinePacks.mockResolvedValue([existingPack]);
    mockIsPackExpired.mockReturnValue(false);

    const { result } = renderHook(() =>
      useBulkOfflinePack([DS_A, DS_B]),
    );

    await act(async () => {
      void result.current.start();
    });

    await waitFor(() => expect(result.current.phase).toBe("done"), { timeout: 5000 });

    const rowA = result.current.rows.find((r) => r.dataset.id === "a");
    const rowB = result.current.rows.find((r) => r.dataset.id === "b");

    expect(rowA?.status).toBe("skipped");
    expect(rowB?.status).toBe("done");

    // saveOfflinePack should only be called for DS_B
    expect(mockSaveOfflinePack).toHaveBeenCalledTimes(1);
    expect(mockSaveOfflinePack.mock.calls[0][0]).toMatchObject({ id: "b" });
  });

  it("does NOT skip an expired existing pack", async () => {
    const expiredPack = makePack("a", {
      tidePack: {
        station: null,
        heightPredictions: [],
        currentPredictions: [],
        tidalExpiresAt: new Date(Date.now() - 1000).toISOString(),
        generatedAt: new Date().toISOString(),
      },
    });
    mockListOfflinePacks.mockResolvedValue([expiredPack]);
    mockIsPackExpired.mockReturnValue(true);

    const { result } = renderHook(() => useBulkOfflinePack([DS_A]));

    await act(async () => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe("done"), { timeout: 5000 });

    expect(result.current.rows[0].status).toBe("done");
    expect(mockSaveOfflinePack).toHaveBeenCalledTimes(1);
  });
});

describe("useBulkOfflinePack — force-update overrides skip", () => {
  it("processes a dataset with an existing pack when force-update is checked", async () => {
    const existingPack = makePack("a");
    mockListOfflinePacks.mockResolvedValue([existingPack]);
    mockIsPackExpired.mockReturnValue(false);

    const { result } = renderHook(() => useBulkOfflinePack([DS_A]));

    // Toggle force-update for DS_A
    act(() => {
      result.current.toggleForceUpdate("a");
    });

    await act(async () => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe("done"), { timeout: 5000 });

    expect(result.current.rows[0].status).toBe("done");
    expect(mockSaveOfflinePack).toHaveBeenCalledTimes(1);
  });
});

describe("useBulkOfflinePack — row error does not abort the rest", () => {
  it("marks one row as error but continues and finishes subsequent rows", async () => {
    mockSaveOfflinePack
      .mockRejectedValueOnce(new Error("Network timeout"))       // DS_A fails
      .mockImplementation((ds: typeof DS_A, _d: number, onP: (p: unknown) => void) => {
        onP({ step: "saving", label: "Saved", done: true });
        return Promise.resolve(makePack(ds.id));
      });

    const { result } = renderHook(() => useBulkOfflinePack([DS_A, DS_B, DS_C]));

    await act(async () => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe("done"), { timeout: 5000 });

    const rowA = result.current.rows.find((r) => r.dataset.id === "a");
    const rowB = result.current.rows.find((r) => r.dataset.id === "b");
    const rowC = result.current.rows.find((r) => r.dataset.id === "c");

    expect(rowA?.status).toBe("error");
    expect(rowA?.error).toMatch(/Network timeout/);
    expect(rowB?.status).toBe("done");
    expect(rowC?.status).toBe("done");
  });
});

describe("useBulkOfflinePack — cancellation", () => {
  it("stops after the current in-flight iteration completes", async () => {
    let resolveA!: () => void;
    mockSaveOfflinePack
      .mockImplementationOnce((_ds: typeof DS_A, _d: number, onP: (p: unknown) => void) =>
        new Promise<ReturnType<typeof makePack>>((res) => {
          resolveA = () => {
            onP({ step: "saving", label: "Saved", done: true });
            res(makePack("a"));
          };
        }),
      )
      .mockImplementation((ds: typeof DS_A, _d: number, onP: (p: unknown) => void) => {
        onP({ step: "saving", label: "Saved", done: true });
        return Promise.resolve(makePack(ds.id));
      });

    const { result } = renderHook(() => useBulkOfflinePack([DS_A, DS_B, DS_C]));

    // Start the batch — DS_A hangs
    act(() => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe("running"));

    // Cancel while DS_A is in-flight
    act(() => { result.current.cancel(); });

    // Resolve DS_A — the batch should then detect cancellation and stop
    await act(async () => { resolveA(); });

    await waitFor(() => expect(result.current.phase).toBe("cancelled"), { timeout: 3000 });

    // DS_B and DS_C should never have been processed
    expect(mockSaveOfflinePack).toHaveBeenCalledTimes(1);
  });
});

describe("useBulkOfflinePack — mid-batch network loss pauses", () => {
  it("pauses the batch when isOnline becomes false between iterations", async () => {
    let callCount = 0;
    mockSaveOfflinePack.mockImplementation(
      (ds: typeof DS_A, _d: number, onP: (p: unknown) => void) => {
        callCount++;
        // After DS_A completes, simulate going offline before DS_B is checked
        if (callCount === 1) {
          mockIsOnline.value = false;
        }
        onP({ step: "saving", label: "Saved", done: true });
        return Promise.resolve(makePack(ds.id));
      },
    );

    const { result } = renderHook(() => useBulkOfflinePack([DS_A, DS_B]));

    await act(async () => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe("paused"), { timeout: 5000 });

    expect(mockSaveOfflinePack).toHaveBeenCalledTimes(1);
    // DS_A done, DS_B paused
    const rowA = result.current.rows.find((r) => r.dataset.id === "a");
    const rowB = result.current.rows.find((r) => r.dataset.id === "b");
    expect(rowA?.status).toBe("done");
    expect(rowB?.status).toBe("paused");
  });
});

describe("useBulkOfflinePack — IDB unavailable", () => {
  it("surfaces a pre-flight error and prevents the batch from starting", async () => {
    mockListOfflinePacks.mockRejectedValueOnce(new Error("IDB blocked"));

    const { result } = renderHook(() => useBulkOfflinePack([DS_A]));

    await act(async () => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe("preflight-error"), { timeout: 3000 });

    expect(result.current.preflightError).toMatch(/IDB blocked/);
    expect(mockSaveOfflinePack).not.toHaveBeenCalled();
  });
});

describe("useBulkOfflinePack — quota below low-water mark", () => {
  it("sets quotaWarning but still allows the batch to start", async () => {
    // Return a near-full quota (< 50 MB remaining)
    mockStorageEstimate.mockResolvedValue({
      usage: 490 * 1024 * 1024,
      quota: 500 * 1024 * 1024,
    });

    const { result } = renderHook(() => useBulkOfflinePack([DS_A]));

    await act(async () => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe("done"), { timeout: 5000 });

    // Batch completed (not blocked)
    expect(result.current.rows[0].status).toBe("done");
    // Advisory warning was set
    expect(result.current.quotaWarning).toBeTruthy();
    expect(result.current.quotaWarning).toMatch(/Storage is low/);
  });
});
