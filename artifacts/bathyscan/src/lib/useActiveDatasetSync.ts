/**
 * useActiveDatasetSync — always-mounted orchestrator that keeps the active
 * preset dataset's terrain grid and overview grid in sync, regardless of
 * whether the DatasetPanel is open.
 *
 * Why this exists:
 *   Before this hook, the overview-grid fetch lived inside DatasetPanel, so
 *   if the user switched datasets (e.g. via FindDataPanel) while the dataset
 *   panel was hidden, `overviewGrid` would stay stale — markers and trails
 *   computed against it would be mis-associated with the previous dataset.
 *
 * Behaviour:
 *   - Watches the active `datasetId` from AppState.
 *   - Fetches terrain + overview in parallel via React Query (deduped with
 *     DatasetPanel's own queries by query key).
 *   - When both arrive and reference the same id, writes terrain to context
 *     and commits both grids to the terrain store in a single atomic update.
 *   - User-uploaded datasets set `datasetId` to null and write terrain/overview
 *     directly from DatasetPanel, so this hook becomes a no-op for those.
 */
import { useEffect, useRef } from "react";
import {
  useGetDatasetsIdTerrain,
  useGetDatasetsIdOverview,
  getGetDatasetsIdTerrainQueryKey,
  getGetDatasetsIdOverviewQueryKey,
} from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useTerrainStore } from "@/lib/terrainStore";

export function useActiveDatasetSync(): void {
  const { datasetId, terrain, setTerrain } = useAppState();
  const id = datasetId ?? "";

  const { data: fetchedTerrain } = useGetDatasetsIdTerrain(id, undefined, {
    query: {
      enabled: !!id,
      queryKey: getGetDatasetsIdTerrainQueryKey(id),
    },
  });

  const { data: fetchedOverview } = useGetDatasetsIdOverview(id, {
    query: {
      enabled: !!id,
      queryKey: getGetDatasetsIdOverviewQueryKey(id),
    },
  });

  const committedRef = useRef<string | null>(null);
  const promotedRef = useRef<string | null>(null);

  // Promote the active preset to primary as soon as the id changes, so the
  // 3D scene + Overview Map start showing the right dataset even before its
  // grids arrive (the slot will just render empty until the loader fills it).
  //
  // In single-dataset mode (multiDatasetMode === false) we evict all prior
  // visible datasets atomically via setSinglePrimary, eliminating ghost terrain
  // from the previously visible dataset. In multi-dataset mode the user has
  // explicitly pinned datasets side-by-side, so we fall back to setPrimary to
  // preserve the accumulation behaviour.
  useEffect(() => {
    if (!id) return;
    if (promotedRef.current === id) return;
    promotedRef.current = id;
    const { multiDatasetMode } = useTerrainStore.getState();
    if (multiDatasetMode) {
      useTerrainStore.getState().setPrimary(id, "preset");
    } else {
      useTerrainStore.getState().setSinglePrimary(id, "preset");
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      committedRef.current = null;
      return;
    }
    if (!fetchedTerrain || !fetchedOverview) return;
    if (
      fetchedTerrain.datasetId !== id ||
      fetchedOverview.datasetId !== id
    ) {
      return;
    }
    // Avoid re-committing the same data on every render, but allow re-commit
    // if the active terrain in context no longer matches (e.g. terrain was
    // cleared by a water-type switch).
    if (committedRef.current === id && terrain?.datasetId === id) return;
    committedRef.current = id;
    setTerrain(fetchedTerrain);
    useTerrainStore.getState().setGrids({
      activeGrid: fetchedTerrain,
      overviewGrid: fetchedOverview,
      source: "preset",
    });
  }, [id, fetchedTerrain, fetchedOverview, setTerrain, terrain]);
}
