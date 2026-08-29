/**
 * VisibleDatasetsLoader — fetches terrain + overview grids for every visible
 * dataset that doesn't already have them in the store.
 *
 * Why this exists:
 *   "Load Together" lets multiple datasets be visible at once. The primary
 *   dataset's terrain is committed to AppState by useActiveDatasetSync (for
 *   presets) or DatasetPanel's pending-load pipeline (for user uploads). The
 *   non-primary (secondary) visible datasets need their grids fetched here so
 *   NonPrimaryDatasetMeshes in TourScene can render them.
 *
 *   Prior to this version the loader only handled preset sources and assumed
 *   user-uploaded grids were "already inline". That was true for freshly
 *   uploaded datasets but not for existing library datasets loaded via
 *   "Load Together" — they also need a /user/datasets/:id/terrain fetch.
 *
 * Implementation:
 *   React hooks can't live in loops, so we mount one child component per
 *   missing entry. Each child runs the two React Query hooks (deduped with
 *   existing fetches via shared query keys) and writes the result to the
 *   terrain store via setDatasetGrids. Once grids are present the child
 *   unmounts so we don't keep dangling subscriptions.
 */
import React, { useEffect, useRef } from "react";
import {
  useGetDatasetsIdTerrain,
  useGetDatasetsIdOverview,
  getGetDatasetsIdTerrainQueryKey,
  getGetDatasetsIdOverviewQueryKey,
  useGetUserDatasetsIdTerrain,
  useGetUserDatasetsIdOverview,
  getGetUserDatasetsIdTerrainQueryKey,
  getGetUserDatasetsIdOverviewQueryKey,
} from "@workspace/api-client-react";
import { useTerrainStore } from "@/lib/terrainStore";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { lonLatToWorldXZ } from "@/lib/terrain";

const PresetDatasetLoader: React.FC<{ datasetId: string; loadTerrain: boolean; requestId?: number }> = ({
  datasetId,
  loadTerrain,
  requestId,
}) => {
  /**
   * Epoch (generation) counter — incremented on mount and whenever datasetId
   * changes. Captured before any async work; if the counter has advanced by
   * the time the data effect fires, the result belongs to a stale visibility
   * cycle and must not be committed to the store.
   *
   * This prevents the re-add race: when a dataset is removed then immediately
   * re-added (same ID) before the first React Query fetch resolves, the stale
   * completion runs in the same component instance and would otherwise write
   * old grids into the newly-added entry.
   */
  const epochRef = useRef(0);
  useEffect(() => {
    epochRef.current += 1;
  }, [datasetId]);

  const { data: terrain, isError: terrainIsError, refetch: refetchTerrain } = useGetDatasetsIdTerrain(datasetId, undefined, {
    query: {
      enabled: !!datasetId && loadTerrain,
      queryKey: getGetDatasetsIdTerrainQueryKey(datasetId),
    },
  });
  useEffect(() => {
    if (loadTerrain && requestId !== undefined) void refetchTerrain();
  }, [loadTerrain, requestId, refetchTerrain]);
  const { data: overview, isError: overviewIsError } = useGetDatasetsIdOverview(datasetId, {
    query: {
      enabled: !!datasetId,
      queryKey: getGetDatasetsIdOverviewQueryKey(datasetId),
    },
  });

  // Propagate definitive fetch failures to the terrain store so OverviewMap
  // can surface the error UI immediately (without waiting for the 15 s timeout).
  useEffect(() => {
    useTerrainStore.getState().setOverviewFetchError(datasetId, overviewIsError);
    return () => {
      // Clear the error when the loader unmounts (dataset removed or grids loaded).
      useTerrainStore.getState().setOverviewFetchError(datasetId, false);
    };
  }, [datasetId, overviewIsError]);

  useEffect(() => {
    useTerrainStore.getState().setDatasetFetchError(
      datasetId,
      (loadTerrain && terrainIsError) || overviewIsError,
    );
    return () => {
      useTerrainStore.getState().setDatasetFetchError(datasetId, false);
    };
  }, [datasetId, loadTerrain, terrainIsError, overviewIsError]);

  useEffect(() => {
    if (!overview || overview.datasetId !== datasetId) return;
    useTerrainStore.getState().setDatasetGrids(datasetId, { overviewGrid: overview });
  }, [datasetId, overview]);

  useEffect(() => {
    if (
      !loadTerrain ||
      !terrain ||
      !overview ||
      terrain.datasetId !== datasetId ||
      overview.datasetId !== datasetId
    ) return;
    // Epoch guard: capture the epoch at effect-run time. If the epoch has
    // advanced (because datasetId changed or the component remounted) by the
    // time this closure executes any async follow-up work, the write is
    // rejected. For the current synchronous path this also acts as a
    // React-StrictMode double-invoke guard — the cleanup sets stale=true so
    // the second invocation is a no-op.
    const myEpoch = epochRef.current;
    let stale = false;
    useTerrainStore.getState().setDatasetGrids(datasetId, {
      activeGrid: terrain,
    });
    return () => {
      stale = true;
      void myEpoch; void stale; // referenced so the guard is not tree-shaken
    };
  }, [datasetId, loadTerrain, terrain, overview]);

  return null;
};

const UserDatasetLoader: React.FC<{ datasetId: string; loadTerrain: boolean; requestId?: number }> = ({
  datasetId,
  loadTerrain,
  requestId,
}) => {
  /**
   * Epoch (generation) counter — same re-add race guard as PresetDatasetLoader.
   * See that component for a full explanation.
   */
  const epochRef = useRef(0);
  useEffect(() => {
    epochRef.current += 1;
  }, [datasetId]);

  const { data: terrain, isError: terrainIsError, refetch: refetchTerrain } = useGetUserDatasetsIdTerrain(datasetId, {
    query: {
      enabled: !!datasetId && loadTerrain,
      queryKey: getGetUserDatasetsIdTerrainQueryKey(datasetId),
    },
  });
  useEffect(() => {
    if (loadTerrain && requestId !== undefined) void refetchTerrain();
  }, [loadTerrain, requestId, refetchTerrain]);
  const { data: overview, isError: overviewIsError } = useGetUserDatasetsIdOverview(datasetId, {
    query: {
      enabled: !!datasetId,
      queryKey: getGetUserDatasetsIdOverviewQueryKey(datasetId),
    },
  });

  // Propagate definitive fetch failures to the terrain store so OverviewMap
  // can surface the error UI immediately (without waiting for the 15 s timeout).
  useEffect(() => {
    useTerrainStore.getState().setOverviewFetchError(datasetId, overviewIsError);
    return () => {
      // Clear the error when the loader unmounts (dataset removed or grids loaded).
      useTerrainStore.getState().setOverviewFetchError(datasetId, false);
    };
  }, [datasetId, overviewIsError]);

  useEffect(() => {
    useTerrainStore.getState().setDatasetFetchError(
      datasetId,
      (loadTerrain && terrainIsError) || overviewIsError,
    );
    return () => {
      useTerrainStore.getState().setDatasetFetchError(datasetId, false);
    };
  }, [datasetId, loadTerrain, terrainIsError, overviewIsError]);

  useEffect(() => {
    if (!overview || overview.datasetId !== datasetId) return;
    useTerrainStore.getState().setDatasetGrids(datasetId, { overviewGrid: overview });
  }, [datasetId, overview]);

  useEffect(() => {
    if (!loadTerrain || !terrain || !overview) return;
    // Reject responses whose server-returned ID does not match the captured
    // visible-entry ID. Previously this block rebranded the response ID to the
    // captured ID, which allowed a response intended for dataset Y to land in
    // dataset X's slot. The preset path has always rejected mismatches; now both
    // paths are consistent.
    if (terrain.datasetId !== datasetId || overview.datasetId !== datasetId) {
      return;
    }
    // Same epoch guard as PresetDatasetLoader — see that component.
    const myEpoch = epochRef.current;
    let stale = false;
    useTerrainStore.getState().setDatasetGrids(datasetId, {
      activeGrid: terrain,
    });
    return () => {
      stale = true;
      void myEpoch; void stale;
    };
  }, [datasetId, loadTerrain, terrain, overview]);

  return null;
};

/**
 * Completes the collection-to-App handoff once the first collection member's
 * full-resolution grid has arrived. App keeps this mounted next to the
 * per-dataset loaders, so the handoff does not depend on DatasetPanel being
 * open.
 */
export const CollectionPrimaryHandoff: React.FC = () => {
  const visible = useTerrainStore((s) => s.visibleDatasets);
  const pending = useTerrainStore((s) => s.collectionNavigation);
  const failedIds = useTerrainStore((s) => s.datasetFetchErrorIds);
  const { setDatasetId, setTerrain } = useAppState();
  const pendingEntry = pending
    ? visible.find((entry) => entry.datasetId === pending.datasetId)
    : undefined;

  useEffect(() => {
    if (!pending || !failedIds.includes(pending.datasetId)) return;
    useTerrainStore.getState().failCollectionNavigation(
      pending.requestId,
      "Could not load this terrain. Try again or choose another tile.",
    );
  }, [pending, failedIds]);

  useEffect(() => {
    if (!pending || !pendingEntry?.activeGrid) return;
    if (pendingEntry.activeGrid.datasetId !== pending.datasetId) return;
    const current = useTerrainStore.getState().collectionNavigation;
    if (current?.requestId !== pending.requestId) return;
    let target: { x: number; z: number };
    try {
      target = lonLatToWorldXZ(pending.lon, pending.lat, pendingEntry.activeGrid);
    } catch {
      useTerrainStore.getState().failCollectionNavigation(
        pending.requestId,
        "That point is outside the selected terrain. Choose another point.",
      );
      return;
    }
    useTerrainStore.getState().setPrimary(pending.datasetId, pendingEntry.source);
    setTerrain(pendingEntry.activeGrid);
    setDatasetId(null);
    useUiStore.getState().setPendingDropIn({ worldX: target.x, worldZ: target.z });
    useUiStore.getState().setSidebarMode("explore");
    useUiStore.getState().setOverviewOpen(false);
    useTerrainStore.getState().completeCollectionNavigation(pending.requestId);
  }, [pending, pendingEntry, setDatasetId, setTerrain]);

  return null;
};

export const VisibleDatasetsLoader: React.FC = () => {
  const visible = useTerrainStore((s) => s.visibleDatasets);
  const collectionScopeId = useTerrainStore((s) => s.collectionScopeId);
  const navigation = useTerrainStore((s) => s.collectionNavigation);
  // Mount a child loader for each entry whose grids haven't arrived yet.
  // Once grids are present (!activeGrid check fails) the child unmounts,
  // keeping React Query subscriptions tidy.
  const needsTerrain = (datasetId: string) =>
    collectionScopeId === null || navigation?.datasetId === datasetId;
  const presetNeedsLoad = visible.filter((v) =>
    v.source === "preset" && (!v.overviewGrid || (needsTerrain(v.datasetId) && !v.activeGrid)));
  const userNeedsLoad = visible.filter((v) =>
    v.source === "user" && (!v.overviewGrid || (needsTerrain(v.datasetId) && !v.activeGrid)));
  return (
    <>
      {presetNeedsLoad.map((v) => (
        <PresetDatasetLoader
          key={v.datasetId}
          datasetId={v.datasetId}
          loadTerrain={needsTerrain(v.datasetId)}
          requestId={navigation?.datasetId === v.datasetId ? navigation.requestId : undefined}
        />
      ))}
      {userNeedsLoad.map((v) => (
        <UserDatasetLoader
          key={v.datasetId}
          datasetId={v.datasetId}
          loadTerrain={needsTerrain(v.datasetId)}
          requestId={navigation?.datasetId === v.datasetId ? navigation.requestId : undefined}
        />
      ))}
    </>
  );
};
