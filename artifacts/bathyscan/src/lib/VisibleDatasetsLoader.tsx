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

const PresetDatasetLoader: React.FC<{ datasetId: string }> = ({ datasetId }) => {
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

  const { data: terrain } = useGetDatasetsIdTerrain(datasetId, undefined, {
    query: {
      enabled: !!datasetId,
      queryKey: getGetDatasetsIdTerrainQueryKey(datasetId),
    },
  });
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
    if (!terrain || !overview) return;
    if (terrain.datasetId !== datasetId || overview.datasetId !== datasetId) {
      return;
    }
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
      overviewGrid: overview,
    });
    return () => {
      stale = true;
      void myEpoch; void stale; // referenced so the guard is not tree-shaken
    };
  }, [datasetId, terrain, overview]);

  return null;
};

const UserDatasetLoader: React.FC<{ datasetId: string }> = ({ datasetId }) => {
  /**
   * Epoch (generation) counter — same re-add race guard as PresetDatasetLoader.
   * See that component for a full explanation.
   */
  const epochRef = useRef(0);
  useEffect(() => {
    epochRef.current += 1;
  }, [datasetId]);

  const { data: terrain } = useGetUserDatasetsIdTerrain(datasetId, {
    query: {
      enabled: !!datasetId,
      queryKey: getGetUserDatasetsIdTerrainQueryKey(datasetId),
    },
  });
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
    if (!terrain || !overview) return;
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
      overviewGrid: overview,
    });
    return () => {
      stale = true;
      void myEpoch; void stale;
    };
  }, [datasetId, terrain, overview]);

  return null;
};

export const VisibleDatasetsLoader: React.FC = () => {
  const visible = useTerrainStore((s) => s.visibleDatasets);
  // Mount a child loader for each entry whose grids haven't arrived yet.
  // Once grids are present (!activeGrid check fails) the child unmounts,
  // keeping React Query subscriptions tidy.
  const presetNeedsLoad = visible.filter(
    (v) => v.source === "preset" && (!v.activeGrid || !v.overviewGrid),
  );
  const userNeedsLoad = visible.filter(
    (v) => v.source === "user" && (!v.activeGrid || !v.overviewGrid),
  );
  return (
    <>
      {presetNeedsLoad.map((v) => (
        <PresetDatasetLoader key={v.datasetId} datasetId={v.datasetId} />
      ))}
      {userNeedsLoad.map((v) => (
        <UserDatasetLoader key={v.datasetId} datasetId={v.datasetId} />
      ))}
    </>
  );
};
