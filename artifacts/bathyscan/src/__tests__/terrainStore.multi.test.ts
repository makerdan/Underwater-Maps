import { describe, it, expect, beforeEach } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import { useTerrainStore, VISIBLE_DATASETS_CAP } from "@/lib/terrainStore";

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

  it("respects the soft cap by evicting the oldest non-primary entry", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    const ids = ["b", "c", "d", "e", "f"];
    for (const id of ids) {
      useTerrainStore
        .getState()
        .toggleVisible({ datasetId: id, source: "preset" });
    }
    const s = useTerrainStore.getState();
    expect(s.visibleDatasets.length).toBe(VISIBLE_DATASETS_CAP);
    // Primary always preserved.
    expect(s.visibleDatasets.find((v) => v.datasetId === "alpha")).toBeDefined();
    expect(s.primaryDatasetId).toBe("alpha");
    // The most-recent additions remain.
    expect(s.visibleDatasets.map((v) => v.datasetId)).toContain("f");
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

  it("evictedId is set when toggleVisible triggers eviction over the cap", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    // Fill to cap.
    for (const id of ["b", "c", "d"]) {
      useTerrainStore.getState().toggleVisible({ datasetId: id, source: "preset" });
    }
    // One more push — oldest non-primary "b" should be evicted.
    useTerrainStore.getState().toggleVisible({ datasetId: "e", source: "preset" });
    const s = useTerrainStore.getState();
    expect(s.visibleDatasets.length).toBe(4);
    expect(s.evictedId).toBe("b");
    expect(s.visibleDatasets.map((v) => v.datasetId)).not.toContain("b");
  });

  it("clearEviction resets evictedId to null without touching other state", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    for (const id of ["b", "c", "d", "e"]) {
      useTerrainStore.getState().toggleVisible({ datasetId: id, source: "preset" });
    }
    expect(useTerrainStore.getState().evictedId).toBeTruthy();
    useTerrainStore.getState().clearEviction();
    const s = useTerrainStore.getState();
    expect(s.evictedId).toBeNull();
    // Visible datasets unchanged.
    expect(s.visibleDatasets.length).toBe(4);
    expect(s.primaryDatasetId).toBe("alpha");
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
    // Pre-fill to cap then call setGrids with a new dataset to trigger eviction.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    for (const id of ["b", "c", "d"]) {
      useTerrainStore.getState().toggleVisible({ datasetId: id, source: "preset" });
    }
    expect(useTerrainStore.getState().visibleDatasets.length).toBe(4);
    // setGrids for a new primary "e" should evict the oldest non-primary ("b").
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("e") });
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("e");
    expect(s.evictedId).toBe("b");
    expect(s.visibleDatasets.length).toBe(4);
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
});
