/**
 * Regression tests for VisibleDatasetsLoader — specifically:
 *
 * 1. Re-add race guard: a preset fetch that completes after a remove+re-add of the
 *    same dataset ID must not overwrite the newly-added entry with stale grids.
 *
 * 2. User-dataset ID mismatch: a user-dataset response whose server-returned ID
 *    does not match the captured visible-entry ID must be rejected (the store entry
 *    must remain with null grids).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Controlled mock for @workspace/api-client-react
// Hook return values are driven by module-level variables set per-test.
// After changing these variables, call view.rerender(<VisibleDatasetsLoader />)
// to propagate new data into the rendered component.
// ---------------------------------------------------------------------------
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false, refetch: noop };
  }
  function mutationHook() {
    return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined };
  }
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

// Per-test terrain/overview data holders.
// Leave as undefined to simulate "still loading".
let presetTerrainData: Record<string, unknown> | undefined = undefined;
let presetOverviewData: Record<string, unknown> | undefined = undefined;
let userTerrainData: Record<string, unknown> | undefined = undefined;
let userOverviewData: Record<string, unknown> | undefined = undefined;

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasetsIdTerrain: () => ({ data: presetTerrainData }),
    useGetDatasetsIdOverview: () => ({ data: presetOverviewData }),
    getGetDatasetsIdTerrainQueryKey: (id: string) => ["datasets", id, "terrain"],
    getGetDatasetsIdOverviewQueryKey: (id: string) => ["datasets", id, "overview"],
    useGetUserDatasetsIdTerrain: () => ({ data: userTerrainData }),
    useGetUserDatasetsIdOverview: () => ({ data: userOverviewData }),
    getGetUserDatasetsIdTerrainQueryKey: (id: string) => ["user-datasets", id, "terrain"],
    getGetUserDatasetsIdOverviewQueryKey: (id: string) => ["user-datasets", id, "overview"],
  }),
);

import { useTerrainStore } from "@/lib/terrainStore";
import { VisibleDatasetsLoader } from "@/lib/VisibleDatasetsLoader";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeGrid(id: string) {
  return {
    datasetId: id,
    minLat: 0, maxLat: 1, minLon: 0, maxLon: 1,
    minDepth: 0, maxDepth: 10,
    width: 2, height: 2, resolution: 2,
    depths: [0, 5, 5, 10],
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  useTerrainStore.getState().clear();
  presetTerrainData = undefined;
  presetOverviewData = undefined;
  userTerrainData = undefined;
  userOverviewData = undefined;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("VisibleDatasetsLoader — re-add race guard", () => {
  it("writes grids to the store when a preset fetch completes for the visible dataset", async () => {
    // Seed the store with two preset datasets; "beta" needs grids loaded.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") as never });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });

    const view = render(<VisibleDatasetsLoader />);

    // Simulate the fetch completing — re-render so the hooks pick up the new data.
    await act(async () => {
      presetTerrainData = makeGrid("beta");
      presetOverviewData = makeGrid("beta");
      view.rerender(<VisibleDatasetsLoader />);
    });

    const betaEntry = useTerrainStore.getState().visibleDatasets.find(
      (v) => v.datasetId === "beta",
    );
    expect(betaEntry?.activeGrid?.datasetId).toBe("beta");
    expect(betaEntry?.overviewGrid?.datasetId).toBe("beta");
  });

  it("does not write grids after the dataset is removed from visibleDatasets", async () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") as never });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });

    const view = render(<VisibleDatasetsLoader />);

    // Remove "beta" before the fetch completes — child loader unmounts.
    await act(async () => {
      useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });
      view.rerender(<VisibleDatasetsLoader />);
    });

    // "Resolve" the fetch after removal.
    await act(async () => {
      presetTerrainData = makeGrid("beta");
      presetOverviewData = makeGrid("beta");
      view.rerender(<VisibleDatasetsLoader />);
    });

    // "beta" is no longer in visibleDatasets — there is no entry to write to.
    const betaEntry = useTerrainStore.getState().visibleDatasets.find(
      (v) => v.datasetId === "beta",
    );
    expect(betaEntry).toBeUndefined();
  });

  it("writes grids from the new load cycle after remove+re-add of the same dataset", async () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") as never });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });

    const view = render(<VisibleDatasetsLoader />);

    // Remove then immediately re-add "beta" before any fetch completes.
    await act(async () => {
      useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" }); // remove
      view.rerender(<VisibleDatasetsLoader />);
    });
    await act(async () => {
      useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" }); // re-add
      view.rerender(<VisibleDatasetsLoader />);
    });

    // Data arrives for the new (second) load cycle.
    await act(async () => {
      presetTerrainData = makeGrid("beta");
      presetOverviewData = makeGrid("beta");
      view.rerender(<VisibleDatasetsLoader />);
    });

    // The write must succeed — the entry is present and grids are set.
    const betaEntry = useTerrainStore.getState().visibleDatasets.find(
      (v) => v.datasetId === "beta",
    );
    expect(betaEntry?.activeGrid?.datasetId).toBe("beta");
    expect(betaEntry?.overviewGrid?.datasetId).toBe("beta");
  });
});

describe("VisibleDatasetsLoader — preset ID mismatch guard", () => {
  it("does not write grids when the returned terrain datasetId does not match the entry", async () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") as never });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });

    const view = render(<VisibleDatasetsLoader />);

    // Server returns data for a DIFFERENT dataset ID.
    await act(async () => {
      presetTerrainData = makeGrid("WRONG");
      presetOverviewData = makeGrid("WRONG");
      view.rerender(<VisibleDatasetsLoader />);
    });

    // "beta" entry must retain null grids (write was rejected by ID guard).
    const betaEntry = useTerrainStore.getState().visibleDatasets.find(
      (v) => v.datasetId === "beta",
    );
    expect(betaEntry?.activeGrid).toBeNull();
    expect(betaEntry?.overviewGrid).toBeNull();
  });

  it("does not write grids when terrain ID matches but overview ID does not", async () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") as never });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });

    const view = render(<VisibleDatasetsLoader />);

    await act(async () => {
      presetTerrainData = makeGrid("beta");   // matches
      presetOverviewData = makeGrid("WRONG"); // does not match
      view.rerender(<VisibleDatasetsLoader />);
    });

    const betaEntry = useTerrainStore.getState().visibleDatasets.find(
      (v) => v.datasetId === "beta",
    );
    expect(betaEntry?.activeGrid).toBeNull();
    expect(betaEntry?.overviewGrid).toBeNull();
  });
});

describe("VisibleDatasetsLoader — user-dataset ID mismatch guard (Bug 2)", () => {
  it("does not write grids when the server returns a different ID than the visible-entry ID", async () => {
    // Seed the store with a user dataset that needs grids.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") as never });
    useTerrainStore.getState().toggleVisible({ datasetId: "user-123", source: "user" });

    const view = render(<VisibleDatasetsLoader />);

    // The server returns data for "user-456" — a mismatched response.
    // Old code: would rebrand "user-456" → "user-123" and write (Bug 2).
    // New code: rejects the response.
    await act(async () => {
      userTerrainData = makeGrid("user-456");
      userOverviewData = makeGrid("user-456");
      view.rerender(<VisibleDatasetsLoader />);
    });

    const entry = useTerrainStore.getState().visibleDatasets.find(
      (v) => v.datasetId === "user-123",
    );
    expect(entry?.activeGrid).toBeNull();
    expect(entry?.overviewGrid).toBeNull();
  });

  it("does not write grids when terrain ID matches but user overview ID is mismatched", async () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") as never });
    useTerrainStore.getState().toggleVisible({ datasetId: "user-123", source: "user" });

    const view = render(<VisibleDatasetsLoader />);

    await act(async () => {
      userTerrainData = makeGrid("user-123"); // terrain matches
      userOverviewData = makeGrid("user-456"); // overview does NOT match
      view.rerender(<VisibleDatasetsLoader />);
    });

    const entry = useTerrainStore.getState().visibleDatasets.find(
      (v) => v.datasetId === "user-123",
    );
    expect(entry?.activeGrid).toBeNull();
  });

  it("writes grids when both user terrain and overview IDs match the visible-entry ID", async () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") as never });
    useTerrainStore.getState().toggleVisible({ datasetId: "user-123", source: "user" });

    const view = render(<VisibleDatasetsLoader />);

    await act(async () => {
      userTerrainData = makeGrid("user-123");
      userOverviewData = makeGrid("user-123");
      view.rerender(<VisibleDatasetsLoader />);
    });

    const entry = useTerrainStore.getState().visibleDatasets.find(
      (v) => v.datasetId === "user-123",
    );
    expect(entry?.activeGrid?.datasetId).toBe("user-123");
    expect(entry?.overviewGrid?.datasetId).toBe("user-123");
  });

  it("previous rebrand — user Y response writing into X slot — is now rejected", async () => {
    // Exact Bug 2 scenario: the old rebrand block would accept a "user-B" response
    // and stamp "user-A" onto it, silently corrupting the store. Verify rejection.
    useTerrainStore.getState().setSinglePrimary("user-A", "user");

    const view = render(<VisibleDatasetsLoader />);

    await act(async () => {
      userTerrainData = makeGrid("user-B");
      userOverviewData = makeGrid("user-B");
      view.rerender(<VisibleDatasetsLoader />);
    });

    const entry = useTerrainStore.getState().visibleDatasets.find(
      (v) => v.datasetId === "user-A",
    );
    expect(entry?.activeGrid).toBeNull();
    expect(entry?.overviewGrid).toBeNull();
  });
});
