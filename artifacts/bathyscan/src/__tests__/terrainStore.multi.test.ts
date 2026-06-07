import { describe, it, expect, beforeEach } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import { useTerrainStore, MAX_ACTIVE_DATASETS } from "@/lib/terrainStore";

function makeGrid(datasetId: string): TerrainData {
  return {
    datasetId,
    minLat: 0,
    maxLat: 1,
    minLon: 0,
    maxLon: 1,
    minDepth: 0,
    maxDepth: 10,
    width: 2,
    height: 2,
    resolution: 2,
    depths: [0, 5, 5, 10],
  } as unknown as TerrainData;
}

beforeEach(() => {
  useTerrainStore.getState().clear();
});

describe("terrainStore multi-dataset", () => {
  it("setGrids promotes the grid's datasetId to primary and seeds visibleDatasets", () => {
    const g = makeGrid("alpha");
    useTerrainStore.getState().setGrids({ activeGrid: g, overviewGrid: g });
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("alpha");
    expect(s.visibleDatasets).toHaveLength(1);
    expect(s.activeGrid).toBe(g);
    expect(s.overviewGrid).toBe(g);
  });

  it("toggleVisible adds and removes datasets without disturbing primary", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore
      .getState()
      .toggleVisible({ datasetId: "beta", source: "preset" });
    let s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("alpha");
    expect(s.visibleDatasets.map((v) => v.datasetId)).toEqual(["alpha", "beta"]);

    useTerrainStore
      .getState()
      .toggleVisible({ datasetId: "beta", source: "preset" });
    s = useTerrainStore.getState();
    expect(s.visibleDatasets.map((v) => v.datasetId)).toEqual(["alpha"]);
    expect(s.primaryDatasetId).toBe("alpha");
  });

  it("hiding the primary promotes the most-recent remaining entry", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore
      .getState()
      .toggleVisible({ datasetId: "beta", source: "preset" });
    useTerrainStore
      .getState()
      .toggleVisible({ datasetId: "alpha", source: "preset" });
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("beta");
    expect(s.visibleDatasets.map((v) => v.datasetId)).toEqual(["beta"]);
  });

  it("setPrimary promotes a visible entry and mirrors its grids", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    const betaGrid = makeGrid("beta");
    useTerrainStore
      .getState()
      .toggleVisible({ datasetId: "beta", source: "preset" });
    useTerrainStore
      .getState()
      .setDatasetGrids("beta", { activeGrid: betaGrid, overviewGrid: betaGrid });
    useTerrainStore.getState().setPrimary("beta");
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("beta");
    expect(s.activeGrid).toBe(betaGrid);
    expect(s.overviewGrid).toBe(betaGrid);
  });

  it("setPrimary adds a not-yet-visible dataset", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().setPrimary("gamma", "user");
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("gamma");
    expect(s.visibleDatasets.map((v) => v.datasetId)).toContain("gamma");
    expect(
      s.visibleDatasets.find((v) => v.datasetId === "gamma")?.source,
    ).toBe("user");
  });

  it("hideAllOthers keeps only the primary visible", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    for (const id of ["b", "c", "d"]) {
      useTerrainStore
        .getState()
        .toggleVisible({ datasetId: id, source: "preset" });
    }
    useTerrainStore.getState().hideAllOthers();
    const s = useTerrainStore.getState();
    expect(s.visibleDatasets.map((v) => v.datasetId)).toEqual(["alpha"]);
    expect(s.primaryDatasetId).toBe("alpha");
  });

  it("toggleVisible queues datasets beyond MAX_ACTIVE_DATASETS in selectedIds", () => {
    // With the streaming model, toggleVisible activates immediately only while
    // visibleDatasets.length < MAX_ACTIVE_DATASETS (3). Beyond that, datasets are
    // queued in selectedIds for proximity streaming to activate later.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    const ids = ["b", "c", "d", "e", "f"];
    for (const id of ids) {
      useTerrainStore
        .getState()
        .toggleVisible({ datasetId: id, source: "preset" });
    }
    const s = useTerrainStore.getState();
    // Only MAX_ACTIVE_DATASETS (3) are active at once.
    expect(s.visibleDatasets.length).toBe(MAX_ACTIVE_DATASETS);
    // Primary always preserved in active set.
    expect(s.visibleDatasets.find((v) => v.datasetId === "alpha")).toBeDefined();
    expect(s.primaryDatasetId).toBe("alpha");
    // Overflow datasets are queued in selectedIds, not lost.
    expect(s.selectedIds).toContain("d");
    expect(s.selectedIds).toContain("e");
    expect(s.selectedIds).toContain("f");
  });

  it("clear resets visibleDatasets and primary", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().clear();
    const s = useTerrainStore.getState();
    expect(s.visibleDatasets).toEqual([]);
    expect(s.primaryDatasetId).toBeNull();
    expect(s.activeGrid).toBeNull();
    expect(s.overviewGrid).toBeNull();
  });

  // ── New tests added for eviction tracking and promote-to-primary sync ───────

  it("toggleVisible beyond MAX_ACTIVE_DATASETS queues into selectedIds without eviction", () => {
    // The streaming model never cap-evicts on toggleVisible ADD. Datasets queue up
    // in selectedIds; proximity streaming swaps them in/out later.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    // Fill to MAX_ACTIVE_DATASETS (3): alpha + b + c
    for (const id of ["b", "c"]) {
      useTerrainStore.getState().toggleVisible({ datasetId: id, source: "preset" });
    }
    expect(useTerrainStore.getState().visibleDatasets.length).toBe(MAX_ACTIVE_DATASETS);
    // One more — should queue, not evict.
    useTerrainStore.getState().toggleVisible({ datasetId: "d", source: "preset" });
    const s = useTerrainStore.getState();
    // Active count stays at cap.
    expect(s.visibleDatasets.length).toBe(MAX_ACTIVE_DATASETS);
    // No eviction fired.
    expect(s.evictedId).toBeNull();
    // "d" is queued, not lost.
    expect(s.selectedIds).toContain("d");
    expect(s.visibleDatasets.map((v) => v.datasetId)).not.toContain("d");
  });

  it("clearEviction resets evictedId to null without touching other state", () => {
    // Fill to MAX_ACTIVE_DATASETS (3): alpha + b + c.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    for (const id of ["b", "c"]) {
      useTerrainStore.getState().toggleVisible({ datasetId: id, source: "preset" });
    }
    expect(useTerrainStore.getState().visibleDatasets.length).toBe(MAX_ACTIVE_DATASETS);
    // setGrids("d") triggers eviction at the unified MAX_ACTIVE_DATASETS cap.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("d") });
    expect(useTerrainStore.getState().evictedId).toBeTruthy();
    const visLen = useTerrainStore.getState().visibleDatasets.length;
    useTerrainStore.getState().clearEviction();
    const s = useTerrainStore.getState();
    expect(s.evictedId).toBeNull();
    // Visible datasets unchanged after clear.
    expect(s.visibleDatasets.length).toBe(visLen);
    expect(s.primaryDatasetId).toBe("d");
  });

  it("setPrimary syncs activeGrid and overviewGrid from the promoted entry", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    const betaActive = makeGrid("beta");
    const betaOverview = makeGrid("beta");
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "user" });
    useTerrainStore.getState().setDatasetGrids("beta", {
      activeGrid: betaActive,
      overviewGrid: betaOverview,
    });
    useTerrainStore.getState().setPrimary("beta", "user");
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("beta");
    expect(s.activeGrid).toBe(betaActive);
    expect(s.overviewGrid).toBe(betaOverview);
    // Alpha's entry still exists in visibleDatasets.
    expect(s.visibleDatasets.map((v) => v.datasetId)).toContain("alpha");
  });

  it("evictedId is set when setGrids evicts over the cap", () => {
    // Fill to MAX_ACTIVE_DATASETS (3) via toggleVisible: alpha + b + c.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    for (const id of ["b", "c"]) {
      useTerrainStore.getState().toggleVisible({ datasetId: id, source: "preset" });
    }
    expect(useTerrainStore.getState().visibleDatasets.length).toBe(MAX_ACTIVE_DATASETS);
    // setGrids("d") triggers eviction at MAX_ACTIVE_DATASETS (3 >= 3).
    // base = [alpha, b, c]; firstId = "alpha"; evict index 1 → "b".
    // nextVisible = [d, alpha, c] — still MAX_ACTIVE_DATASETS entries.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("d") });
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("d");
    expect(s.evictedId).toBe("b");
    expect(s.visibleDatasets.length).toBe(MAX_ACTIVE_DATASETS);
    expect(s.visibleDatasets.map((v) => v.datasetId)).not.toContain("b");
  });

  // ── setSinglePrimary / sequential-load (single-dataset mode) ─────────────

  it("setSinglePrimary replaces all visible datasets with only the new one", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().setSinglePrimary("beta", "preset");
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("beta");
    expect(s.visibleDatasets).toHaveLength(1);
    expect(s.visibleDatasets[0]!.datasetId).toBe("beta");
    // Prior dataset evicted — grids start null pending load.
    expect(s.activeGrid).toBeNull();
    expect(s.overviewGrid).toBeNull();
    expect(s.evictedId).toBeNull();
    expect(s.multiDatasetMode).toBe(false);
  });

  it("setSinglePrimary evicts multiple prior datasets including the old primary", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });
    useTerrainStore.getState().toggleVisible({ datasetId: "gamma", source: "preset" });
    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(3);

    useTerrainStore.getState().setSinglePrimary("delta", "preset");
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("delta");
    expect(s.visibleDatasets).toHaveLength(1);
    expect(s.visibleDatasets[0]!.datasetId).toBe("delta");
  });

  it("toggleVisible sets multiDatasetMode to true", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    expect(useTerrainStore.getState().multiDatasetMode).toBe(false);
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });
    expect(useTerrainStore.getState().multiDatasetMode).toBe(true);
  });

  it("clear resets multiDatasetMode to false", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });
    expect(useTerrainStore.getState().multiDatasetMode).toBe(true);
    useTerrainStore.getState().clear();
    expect(useTerrainStore.getState().multiDatasetMode).toBe(false);
  });

  it("sequential setSinglePrimary calls leave only the latest dataset visible", () => {
    // Simulate a user flipping through datasets one by one.
    for (const id of ["alpha", "beta", "gamma", "delta"]) {
      useTerrainStore.getState().setSinglePrimary(id, "preset");
      expect(useTerrainStore.getState().visibleDatasets).toHaveLength(1);
      expect(useTerrainStore.getState().primaryDatasetId).toBe(id);
    }
    const s = useTerrainStore.getState();
    expect(s.visibleDatasets.map((v) => v.datasetId)).toEqual(["delta"]);
  });

  it("setSinglePrimary does not affect multiDatasetMode when it is already false", () => {
    useTerrainStore.getState().setSinglePrimary("alpha", "preset");
    useTerrainStore.getState().setSinglePrimary("beta", "preset");
    expect(useTerrainStore.getState().multiDatasetMode).toBe(false);
  });

  // ── primaryDatasetIds — multi-primary broadcast tests ────────────────────

  it("primaryDatasetIds is empty when no datasets are visible", () => {
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetIds).toEqual([]);
  });

  it("primaryDatasetIds contains the single dataset after setGrids", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetIds).toEqual(["alpha"]);
  });

  it("primaryDatasetIds includes ALL visible dataset IDs (multi-primary broadcast)", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });
    useTerrainStore.getState().toggleVisible({ datasetId: "gamma", source: "preset" });
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetIds).toContain("alpha");
    expect(s.primaryDatasetIds).toContain("beta");
    expect(s.primaryDatasetIds).toContain("gamma");
    expect(s.primaryDatasetIds).toHaveLength(3);
  });

  it("removing a dataset removes it from primaryDatasetIds", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" }); // hide
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetIds).toEqual(["alpha"]);
    expect(s.primaryDatasetIds).not.toContain("beta");
  });

  it("primaryDatasetIds is empty and primaryDatasetId is null after clear", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });
    useTerrainStore.getState().clear();
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetIds).toEqual([]);
    expect(s.primaryDatasetId).toBeNull();
  });

  it("primaryDatasetId (legacy alias) is always visibleDatasets[0]", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });
    // Before promote: alpha is first
    let s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("alpha");
    // After setPrimary("beta"): beta moves to front
    useTerrainStore.getState().setPrimary("beta");
    s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("beta");
    expect(s.visibleDatasets[0]!.datasetId).toBe("beta");
    // primaryDatasetIds still contains both
    expect(s.primaryDatasetIds).toContain("alpha");
    expect(s.primaryDatasetIds).toContain("beta");
  });

  it("primaryDatasetIds tracks evictions — evicted dataset not in primaryDatasetIds", () => {
    // Fill to MAX_ACTIVE_DATASETS (3) via setGrids + toggleVisible.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    for (const id of ["b", "c"]) {
      useTerrainStore.getState().toggleVisible({ datasetId: id, source: "preset" });
    }
    // setGrids("d") triggers eviction at MAX_ACTIVE_DATASETS cap:
    // base = [alpha, b, c]; firstId = "alpha"; evicts "b"; nextVisible = [d, alpha, c].
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("d") });
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetIds).not.toContain("b");
    expect(s.primaryDatasetIds).toContain("alpha");
    expect(s.primaryDatasetIds).toContain("d");
    expect(s.primaryDatasetIds).toHaveLength(MAX_ACTIVE_DATASETS);
  });

  it("setSinglePrimary sets primaryDatasetIds to only the new dataset", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });
    useTerrainStore.getState().setSinglePrimary("gamma", "preset");
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetIds).toEqual(["gamma"]);
  });
});
