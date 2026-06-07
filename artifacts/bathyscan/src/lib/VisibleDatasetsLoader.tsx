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
import React, { useEffect } from "react";
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
  const { data: terrain } = useGetDatasetsIdTerrain(datasetId, undefined, {
    query: {
      enabled: !!datasetId,
      queryKey: getGetDatasetsIdTerrainQueryKey(datasetId),
    },
  });
  const { data: overview } = useGetDatasetsIdOverview(datasetId, {
    query: {
      enabled: !!datasetId,
      queryKey: getGetDatasetsIdOverviewQueryKey(datasetId),
    },
  });

  useEffect(() => {
    if (!terrain || !overview) return;
    if (terrain.datasetId !== datasetId || overview.datasetId !== datasetId) {
      return;
    }
    useTerrainStore.getState().setDatasetGrids(datasetId, {
      activeGrid: terrain,
      overviewGrid: overview,
    });
  }, [datasetId, terrain, overview]);

  return null;
};

const UserDatasetLoader: React.FC<{ datasetId: string }> = ({ datasetId }) => {
  const { data: terrain } = useGetUserDatasetsIdTerrain(datasetId, {
    query: {
      enabled: !!datasetId,
      queryKey: getGetUserDatasetsIdTerrainQueryKey(datasetId),
    },
  });
  const { data: overview } = useGetUserDatasetsIdOverview(datasetId, {
    query: {
      enabled: !!datasetId,
      queryKey: getGetUserDatasetsIdOverviewQueryKey(datasetId),
    },
  });

  useEffect(() => {
    if (!terrain || !overview) return;
    // Rebrand stale embedded datasetId (mirrors DatasetPanel's user-load path).
    const terrainStamped =
      terrain.datasetId === datasetId ? terrain : { ...terrain, datasetId };
    const overviewStamped =
      overview.datasetId === datasetId ? overview : { ...overview, datasetId };
    useTerrainStore.getState().setDatasetGrids(datasetId, {
      activeGrid: terrainStamped,
      overviewGrid: overviewStamped,
    });
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
