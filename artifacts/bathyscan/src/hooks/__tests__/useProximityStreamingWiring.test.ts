import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onActivate: undefined as
    | ((datasetId: string, source: "preset" | "user") => Promise<void>)
    | undefined,
  queryClient: {
    fetchQuery: vi.fn(),
    cancelQueries: vi.fn(),
  },
}));

vi.mock("@/hooks/useDatasetProximityStreaming", () => ({
  useDatasetProximityStreaming: ({
    onActivate,
  }: {
    onActivate: (datasetId: string, source: "preset" | "user") => Promise<void>;
  }) => {
    mocks.onActivate = onActivate;
  },
}));

vi.mock("@/lib/queryClient", () => ({ queryClient: mocks.queryClient }));

vi.mock("@workspace/api-client-react", () => ({
  getGetDatasetsIdTerrainQueryKey: (id: string) => ["datasets", id, "terrain"],
  getGetDatasetsIdTerrainUrl: (id: string) => `/datasets/${id}/terrain`,
  getGetDatasetsIdOverviewQueryKey: (id: string) => ["datasets", id, "overview"],
  getGetDatasetsIdOverviewUrl: (id: string) => `/datasets/${id}/overview`,
  getGetUserDatasetsIdTerrainQueryKey: (id: string) => ["user-datasets", id, "terrain"],
  getGetUserDatasetsIdTerrainUrl: (id: string) => `/user-datasets/${id}/terrain`,
  getGetUserDatasetsIdOverviewQueryKey: (id: string) => ["user-datasets", id, "overview"],
  getGetUserDatasetsIdOverviewUrl: (id: string) => `/user-datasets/${id}/overview`,
}));

import {
  __resetAutoRegisteredIds,
  useProximityStreamingWiring,
} from "@/hooks/useProximityStreamingWiring";
import {
  __resetProximityRequestCancellers,
  useTerrainStore,
} from "@/lib/terrainStore";
import { useProximityStreamingStore } from "@/lib/proximityStreamingStore";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeGrid(datasetId: string) {
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
  };
}

function startActivation(datasetId: string): Promise<void> {
  expect(mocks.onActivate).toBeTypeOf("function");
  return mocks.onActivate!(datasetId, "preset");
}

describe("useProximityStreamingWiring — selection cancellation", () => {
  const pending = new Map<string, Deferred<ReturnType<typeof makeGrid>>>();

  beforeEach(() => {
    __resetAutoRegisteredIds();
    __resetProximityRequestCancellers();
    useTerrainStore.getState().clear();
    useProximityStreamingStore.setState({
      loadingDatasetId: null,
      distanceTableM: {},
      nameMap: {},
    });
    mocks.onActivate = undefined;
    mocks.queryClient.fetchQuery.mockReset();
    mocks.queryClient.cancelQueries.mockReset();
    pending.clear();

    mocks.queryClient.fetchQuery.mockImplementation(
      ({ queryKey }: { queryKey: unknown[] }) => {
        const request = pending.get(JSON.stringify(queryKey));
        if (!request) throw new Error(`Missing deferred query for ${JSON.stringify(queryKey)}`);
        return request.promise;
      },
    );
    mocks.queryClient.cancelQueries.mockImplementation(
      ({ queryKey }: { queryKey: unknown[] }) => {
        pending.get(JSON.stringify(queryKey))?.reject(
          Object.assign(new Error("Request cancelled"), { name: "AbortError" }),
        );
        return Promise.resolve();
      },
    );

    renderHook(() =>
      useProximityStreamingWiring({ datasets: undefined, userDatasets: undefined }),
    );
  });

  function addPresetPair(datasetId: string) {
    const terrain = deferred<ReturnType<typeof makeGrid>>();
    const overview = deferred<ReturnType<typeof makeGrid>>();
    pending.set(JSON.stringify(["datasets", datasetId, "terrain"]), terrain);
    pending.set(JSON.stringify(["datasets", datasetId, "overview"]), overview);
    return { terrain, overview };
  }

  it("cancels obsolete terrain and overview work when a collection replaces the proximity selection", async () => {
    const oldPair = addPresetPair("old-proximity");
    useTerrainStore.setState({
      selectedIds: ["old-proximity"],
      selectedSources: { "old-proximity": "preset" },
    });

    const oldLoad = startActivation("old-proximity");
    expect(mocks.queryClient.fetchQuery).toHaveBeenCalledTimes(2);

    act(() => {
      useTerrainStore.getState().setCollectionScope("new-collection", ["collection-member"]);
      useTerrainStore.getState().activateCollection([
        { datasetId: "collection-member", source: "preset" },
      ]);
    });
    await oldLoad;

    expect(mocks.queryClient.cancelQueries).toHaveBeenCalledWith({
      queryKey: ["datasets", "old-proximity", "terrain"],
      exact: true,
    });
    expect(mocks.queryClient.cancelQueries).toHaveBeenCalledWith({
      queryKey: ["datasets", "old-proximity", "overview"],
      exact: true,
    });
    expect(useTerrainStore.getState().selectedIds).toEqual(["collection-member"]);
    expect(useTerrainStore.getState().visibleDatasets.map((entry) => entry.datasetId)).toEqual([
      "collection-member",
    ]);
    expect(useTerrainStore.getState().datasetFetchErrorIds).toEqual([]);
    expect(useProximityStreamingStore.getState().loadingDatasetId).toBeNull();
    void oldPair;
  });

  it("cancels obsolete proximity work when an ordinary map replaces the selection", async () => {
    addPresetPair("old-proximity");
    useTerrainStore.setState({
      selectedIds: ["old-proximity"],
      selectedSources: { "old-proximity": "preset" },
    });

    const oldLoad = startActivation("old-proximity");
    act(() => {
      useTerrainStore.getState().setSinglePrimary("ordinary-map", "preset");
    });
    await oldLoad;

    expect(mocks.queryClient.cancelQueries).toHaveBeenCalledTimes(2);
    expect(useTerrainStore.getState().visibleDatasets.map((entry) => entry.datasetId)).toEqual([
      "ordinary-map",
    ]);
    expect(useTerrainStore.getState().datasetFetchErrorIds).toEqual([]);
  });

  it("keeps an in-flight request when its dataset remains a member of the active collection", async () => {
    const memberPair = addPresetPair("shared-member");
    useTerrainStore.setState({
      selectedIds: ["shared-member"],
      selectedSources: { "shared-member": "preset" },
    });

    const memberLoad = startActivation("shared-member");
    act(() => {
      useTerrainStore.getState().setCollectionScope("active-collection", ["shared-member"]);
      useTerrainStore.getState().activateCollection([
        { datasetId: "shared-member", source: "preset" },
      ]);
    });

    expect(mocks.queryClient.cancelQueries).not.toHaveBeenCalled();
    await act(async () => {
      memberPair.terrain.resolve(makeGrid("shared-member"));
      memberPair.overview.resolve(makeGrid("shared-member"));
      await memberLoad;
    });

    const member = useTerrainStore.getState().visibleDatasets[0];
    expect(member?.activeGrid?.datasetId).toBe("shared-member");
    expect(member?.overviewGrid?.datasetId).toBe("shared-member");
  });
});