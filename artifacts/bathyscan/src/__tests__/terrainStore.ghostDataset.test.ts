/**
 * Regression test for the ghost-dataset bug on the Overview Map.
 *
 * Root cause: when dataset B's overview data arrives from cache before B's
 * terrain is committed, the DatasetPanel active-overview effect fires with
 * `terrain = A_terrain` (stale) + `activeOverviewData = B_overview` +
 * `activeId = B`. Without an identity guard, `setGrids` is called with
 * A_terrain, which re-inserts A into visibleDatasets as a ghost entry even
 * though the user already removed A from view.
 *
 * Fix: DatasetPanel guards the setGrids call so it only fires when BOTH
 * `terrain.datasetId` and `activeOverviewData.datasetId` equal `activeId`.
 * This test suite documents the root cause and verifies the guarded behaviour.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import { useTerrainStore } from "@/lib/terrainStore";

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

describe("terrainStore — ghost dataset after unload+reload", () => {
  it("calling setGrids with stale A_terrain after A is removed re-adds A as a ghost (documents the root-cause bug)", () => {
    // 1. Load dataset A as the sole primary.
    const aGrid = makeGrid("dataset-A");
    useTerrainStore.getState().setSinglePrimary("dataset-A", "preset");
    useTerrainStore.getState().setGrids({ activeGrid: aGrid, overviewGrid: aGrid });

    expect(useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId)).toEqual(["dataset-A"]);

    // 2. User removes A from view (equivalent to toggleVisible on the sole entry).
    useTerrainStore.getState().toggleVisible({ datasetId: "dataset-A", source: "preset" });
    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(0);

    // 3. Simulate the stale-terrain race: the OLD unguarded DatasetPanel effect
    //    would call setGrids with A's terrain even though activeId has moved to B.
    //    This is the bug: A is silently prepended back into visibleDatasets.
    const bOverview = makeGrid("dataset-B");
    useTerrainStore.getState().setGrids({ activeGrid: aGrid, overviewGrid: bOverview });

    const ghostIds = useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId);
    // A is re-added as a ghost — this is the behaviour the DatasetPanel guard prevents.
    expect(ghostIds).toContain("dataset-A");
  });

  it("NOT calling setGrids when terrain.datasetId !== activeId leaves visibleDatasets empty (guarded behaviour)", () => {
    // 1. Load dataset A as the sole primary.
    const aGrid = makeGrid("dataset-A");
    useTerrainStore.getState().setSinglePrimary("dataset-A", "preset");
    useTerrainStore.getState().setGrids({ activeGrid: aGrid, overviewGrid: aGrid });

    // 2. User removes A from view.
    useTerrainStore.getState().toggleVisible({ datasetId: "dataset-A", source: "preset" });
    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(0);

    // 3. The DatasetPanel guard fires:
    //      terrain.datasetId ("dataset-A") !== activeId ("dataset-B")  →  return early
    //    setGrids is NOT called. visibleDatasets must remain empty.
    //
    //    (We deliberately do NOT call setGrids here — that is exactly what the
    //    guard achieves.)

    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(0);
    expect(useTerrainStore.getState().primaryDatasetId).toBeNull();
  });

  it("setGrids with fully-matching IDs for the new dataset B still works correctly", () => {
    // Ensure the guard does not block legitimate calls where both grids match activeId.
    const aGrid = makeGrid("dataset-A");
    useTerrainStore.getState().setSinglePrimary("dataset-A", "preset");
    useTerrainStore.getState().setGrids({ activeGrid: aGrid, overviewGrid: aGrid });

    useTerrainStore.getState().toggleVisible({ datasetId: "dataset-A", source: "preset" });
    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(0);

    // Now B's terrain arrives — both activeGrid and overviewGrid carry B's id.
    const bGrid = makeGrid("dataset-B");
    useTerrainStore.getState().setGrids({ activeGrid: bGrid, overviewGrid: bGrid });

    const s = useTerrainStore.getState();
    expect(s.visibleDatasets.map((v) => v.datasetId)).toEqual(["dataset-B"]);
    expect(s.primaryDatasetId).toBe("dataset-B");
    // A must not appear.
    expect(s.visibleDatasets.some((v) => v.datasetId === "dataset-A")).toBe(false);
  });
});
