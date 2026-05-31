/**
 * Unit tests for the commitFresh hash guard in classificationStore.
 *
 * Covers:
 *   - A commitFresh call whose gridHash no longer matches currentGridHash is
 *     a no-op (stale result from a previous dataset is silently discarded).
 *   - A commitFresh call whose gridHash still matches currentGridHash writes
 *     through normally.
 *
 * Strategy: we expose commitFresh indirectly by calling classify() and then
 * transplanting currentGridHash mid-flight so the in-progress call sees a
 * changed hash when it reaches the write step.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook()    { return { data: undefined, isLoading: false, isError: false }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
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

import { useClassificationStore } from "@/lib/classificationStore";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Minimal TerrainData fixture
// ---------------------------------------------------------------------------

function makeGrid(seed = 1): TerrainData {
  const SIZE = 4;
  const depths = Array.from({ length: SIZE * SIZE }, (_, i) => -(i + 1) * seed);
  return {
    datasetId: `test-dataset-${seed}`,
    waterType: "saltwater",
    width: SIZE,
    height: SIZE,
    resolution: SIZE,
    depths,
    minDepth: Math.min(...depths),
    maxDepth: Math.max(...depths),
  } as unknown as TerrainData;
}

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// gridToBase64Png — not meaningful in unit tests, return a tiny stable string.
vi.mock("@/lib/gridToImage", () => ({
  gridToBase64Png: () => "data:image/png;base64,AAAA",
}));

// poeClassify — not called in these tests because the server cache fetch
// path is what we intercept. Mock it as a safety net so it never resolves.
vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({ poeClassify: vi.fn(() => new Promise(() => {})) }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the store to a predictable clean state before each test. */
function resetStore(): void {
  useClassificationStore.setState({
    zoneMap: null,
    aiZoneMap: null,
    hasEdits: false,
    loading: false,
    error: null,
    currentGridHash: null,
    currentSubstrateFp: null,
    source: null,
    paintUndoStack: [],
    paintRedoStack: [],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  try { sessionStorage.clear(); } catch { /* ignore */ }
});

describe("commitFresh hash guard — stale write is a no-op", () => {
  it("does not mutate state when currentGridHash has changed before the write", async () => {
    const grid = makeGrid(1);

    // Seed the store with the hash that a "new" dataset would have set.
    // This simulates the user switching datasets while the classify() call
    // for the old grid is in-flight.
    const newDatasetHash = "new-dataset-hash-000000000000000000000000000000000000000000000000";

    // Intercept the server zone-cache fetch so we can control when it resolves.
    let resolveServerFetch!: (value: Response) => void;
    const serverFetchPromise = new Promise<Response>((res) => { resolveServerFetch = res; });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      () => serverFetchPromise,
    );

    // Start classify() — it will set currentGridHash to gridHash(grid.depths)
    // and then await the server fetch.
    const classifyPromise = useClassificationStore.getState().classify(grid);

    // Wait long enough for hashGrid() (crypto.subtle.digest — async) to resolve
    // and for classify() to set loading:true and issue the fetch call. A short
    // setTimeout flushes both microtasks and the SubtleCrypto callback.
    await new Promise((r) => setTimeout(r, 50));

    // Simulate a dataset switch: overwrite currentGridHash with a different value.
    useClassificationStore.setState({ currentGridHash: newDatasetHash });

    // Resolve the server fetch with a valid zones response — commitFresh will
    // be called with the OLD gridHash but currentGridHash is now newDatasetHash.
    resolveServerFetch(
      new Response(
        JSON.stringify({
          zones: Array.from({ length: 32 * 32 }, () => "sandy_shelf"),
          waterType: "saltwater",
          source: "ai",
          substrateFp: "aabbccdd",
          coarseWidth: 32,
          coarseHeight: 32,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    // Wait for the classify() promise to settle.
    await classifyPromise;

    // The store must not have been overwritten by the stale result.
    const state = useClassificationStore.getState();
    expect(state.currentGridHash).toBe(newDatasetHash);
    expect(state.zoneMap).toBeNull();
    // loading stays true — the early-return guard exits work() before commitFresh
    // (which is the only thing that clears loading), so the loading flag is left
    // for the new dataset's classify() call to manage.
    expect(state.loading).toBe(true);

    fetchSpy.mockRestore();
  });

  it("writes through normally when currentGridHash still matches", async () => {
    const grid = makeGrid(2);

    let resolveServerFetch!: (value: Response) => void;
    const serverFetchPromise = new Promise<Response>((res) => { resolveServerFetch = res; });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      () => serverFetchPromise,
    );

    const classifyPromise = useClassificationStore.getState().classify(grid);
    await Promise.resolve();

    // Do NOT switch datasets — currentGridHash must still match when the
    // server response arrives.
    resolveServerFetch(
      new Response(
        JSON.stringify({
          zones: Array.from({ length: 32 * 32 }, () => "sandy_shelf"),
          waterType: "saltwater",
          source: "ai",
          substrateFp: "11223344",
          coarseWidth: 32,
          coarseHeight: 32,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await classifyPromise;

    const state = useClassificationStore.getState();
    expect(state.zoneMap).not.toBeNull();
    expect(state.source).toBe("ai");
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();

    fetchSpy.mockRestore();
  });
});
