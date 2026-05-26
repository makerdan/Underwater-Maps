/**
 * VisibleDatasetsLoader — fetches terrain + overview grids for every visible
 * *preset* dataset that doesn't already have them in the store.
 *
 * Why this exists:
 *   Task #350 lets multiple datasets be visible at once. The primary dataset's
 *   grids are still loaded by `useActiveDatasetSync` (and committed to context
 *   for downstream consumers). Additional non-primary preset datasets need
 *   parallel fetches so their meshes/footprints render too. User-uploaded
 *   datasets carry their grids inline when added, so this loader skips them.
 *
 * Implementation:
 *   React hooks can't live in loops, so we mount one `<PresetDatasetLoader>`
 *   child per missing entry. Each child runs the two React Query hooks (dedupe
 *   with `useActiveDatasetSync` via shared query keys) and writes the result
 *   to the terrain store via `setDatasetGrids`.
 */
import React, { useEffect } from "react";
import {
  useGetDatasetsIdTerrain,
  useGetDatasetsIdOverview,
  getGetDatasetsIdTerrainQueryKey,
  getGetDatasetsIdOverviewQueryKey,
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

export const VisibleDatasetsLoader: React.FC = () => {
  const visible = useTerrainStore((s) => s.visibleDatasets);
  // Only preset entries need fetching; user-uploaded grids are already inline.
  // Only mount a loader if grids are missing — once cached, the child unmounts
  // so we don't keep dangling React Query subscriptions per dataset.
  const needsLoad = visible.filter(
    (v) => v.source === "preset" && (!v.activeGrid || !v.overviewGrid),
  );
  return (
    <>
      {needsLoad.map((v) => (
        <PresetDatasetLoader key={v.datasetId} datasetId={v.datasetId} />
      ))}
    </>
  );
};
