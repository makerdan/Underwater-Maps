/**
 * Tests for useActiveDatasetSync — the always-mounted orchestrator that
 * keeps `activeGrid` and `overviewGrid` in the terrain store in sync with
 * the currently-active preset dataset, regardless of whether the
 * DatasetPanel is mounted.
 */
import React, { useState } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";

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
vi.mock("@workspace/api-client-react", () => ({
  useGetDatasetsIdTerrain: (id: string, _opts: unknown, options: { query?: { enabled?: boolean } }) => ({
    data: options?.query?.enabled && id ? terrainFor(id) : undefined,
  }),
  useGetDatasetsIdOverview: (id: string, options: { query?: { enabled?: boolean } }) => ({
    data: options?.query?.enabled && id ? overviewFor(id) : undefined,
  }),
  getGetDatasetsIdTerrainQueryKey: (id: string) => ["datasets", id, "terrain"],
  getGetDatasetsIdOverviewQueryKey: (id: string) => ["datasets", id, "overview"],
}));

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
});
