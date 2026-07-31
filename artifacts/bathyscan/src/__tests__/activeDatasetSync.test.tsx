/**
 * Tests for useActiveDatasetSync — the always-mounted orchestrator that
 * keeps `activeGrid` and `overviewGrid` in the terrain store in sync with
 * the currently-active preset dataset, regardless of whether the
 * DatasetPanel is mounted.
 */
import React, { useState } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
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
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

// Per-test override: when set, the terrain mock returns data with THIS id
// instead of the requested id — simulating a stale/mismatched server response.
const mockTerrainResponseId = vi.hoisted(() => ({ current: null as string | null }));

const terrainFor = (id: string) => ({
  datasetId: id,
  minLat: 0, maxLat: 1, minLon: 0, maxLon: 1, resolution: 2,
  depths: new Float32Array([0, 0, 0, 0]),
});
const overviewFor = (id: string) => ({
  datasetId: id,
  minLat: 0, maxLat: 1, minLon: 0, maxLon: 1, resolution: 4,
  depths: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
});

// Mock the API client to return id-keyed data the hook can commit.
// When mockTerrainResponseId.current is set, the terrain/overview responses
// carry THAT datasetId instead of the requested one — simulating a mismatched
// server response (e.g. stale CDN cache, inflight concurrent request).
vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasetsIdTerrain: (id: string, _opts: unknown, options: { query?: { enabled?: boolean } }) => ({
      data: options?.query?.enabled && id
        ? terrainFor(mockTerrainResponseId.current ?? id)
        : undefined,
    }),
    useGetDatasetsIdOverview: (id: string, options: { query?: { enabled?: boolean } }) => ({
      data: options?.query?.enabled && id
        ? overviewFor(mockTerrainResponseId.current ?? id)
        : undefined,
    }),
    getGetDatasetsIdTerrainQueryKey: (id: string) => ["datasets", id, "terrain"],
    getGetDatasetsIdOverviewQueryKey: (id: string) => ["datasets", id, "overview"],
  }),
);

import { useActiveDatasetSync } from "@/lib/useActiveDatasetSync";
import { useTerrainStore } from "@/lib/terrainStore";

// Inline lightweight AppState context shim — useActiveDatasetSync only needs
// datasetId, terrain, setTerrain.
const setTerrainSpy = vi.fn();
let currentDatasetId: string | null = null;
let currentTerrain: unknown = null;
vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: currentDatasetId,
    terrain: currentTerrain,
    setTerrain: (t: unknown) => {
      currentTerrain = t;
      setTerrainSpy(t);
    },
  }),
}));

function Harness({ id }: { id: string | null }) {
  currentDatasetId = id;
  useActiveDatasetSync();
  return null;
}

function HarnessWithButton() {
  const [id, setId] = useState<string | null>(null);
  currentDatasetId = id;
  useActiveDatasetSync();
  return (
    <button data-testid="switch" onClick={() => setId("dataset-B")}>
      switch
    </button>
  );
}

describe("useActiveDatasetSync", () => {
  beforeEach(() => {
    setTerrainSpy.mockClear();
    currentDatasetId = null;
    currentTerrain = null;
    mockTerrainResponseId.current = null;
    useTerrainStore.setState({ activeGrid: null, overviewGrid: null });
  });

  it("commits both activeGrid and overviewGrid for the active dataset", () => {
    render(<Harness id="dataset-A" />);
    const state = useTerrainStore.getState();
    expect(state.activeGrid?.datasetId).toBe("dataset-A");
    expect(state.overviewGrid?.datasetId).toBe("dataset-A");
    expect(setTerrainSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps overviewGrid in sync when the active dataset changes (panel hidden case)", () => {
    // Seed the store with a previous dataset's grids — as if DatasetPanel
    // committed them earlier and was then unmounted.
    useTerrainStore.setState({
      activeGrid: terrainFor("dataset-A") as never,
      overviewGrid: overviewFor("dataset-A") as never,
    });
    currentTerrain = terrainFor("dataset-A");

    const { getByTestId, rerender } = render(<HarnessWithButton />);
    // Initially datasetId is null so nothing is fetched/committed.
    expect(useTerrainStore.getState().overviewGrid?.datasetId).toBe("dataset-A");

    // Simulate FindDataPanel switching the active dataset while the dataset
    // panel is unmounted — only this orchestrator is running.
    act(() => {
      getByTestId("switch").click();
    });
    rerender(<HarnessWithButton />);

    const state = useTerrainStore.getState();
    expect(state.activeGrid?.datasetId).toBe("dataset-B");
    expect(state.overviewGrid?.datasetId).toBe("dataset-B");
  });

  it("is a no-op when no dataset is active", () => {
    render(<Harness id={null} />);
    expect(setTerrainSpy).not.toHaveBeenCalled();
    expect(useTerrainStore.getState().activeGrid).toBeNull();
    expect(useTerrainStore.getState().overviewGrid).toBeNull();
  });

  it("rejects a mismatched server response — does not commit terrain or grids", () => {
    // Server returns data whose datasetId is "dataset-stale", not "dataset-A".
    // This simulates a stale CDN cache hit or a concurrent-request race where
    // the response resolves after the active id has already moved on.
    mockTerrainResponseId.current = "dataset-stale";

    render(<Harness id="dataset-A" />);

    // The hook must not commit mismatched data to context or to the store.
    // Neither the requested id ("dataset-A") nor the stale server id
    // ("dataset-stale") should appear in the store — the write is skipped.
    expect(setTerrainSpy).not.toHaveBeenCalled();
    const state = useTerrainStore.getState();
    expect(state.activeGrid?.datasetId).not.toBe("dataset-stale");
    expect(state.activeGrid?.datasetId).not.toBe("dataset-A");
    expect(state.overviewGrid?.datasetId).not.toBe("dataset-stale");
    expect(state.overviewGrid?.datasetId).not.toBe("dataset-A");
  });
});
