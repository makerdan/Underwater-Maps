/**
 * useProximityStreamingWiring — shared wiring for dataset proximity streaming.
 *
 * Extracted verbatim from DatasetPanel.tsx so the SAME machinery (bbox map,
 * HUD name map, auto-registration pool, activation fetches, and the
 * useDatasetProximityStreaming sampling hook) runs in BOTH hosts:
 *
 *   - Desktop: DatasetPanel (as before — behaviour unchanged).
 *   - MOBILE-ONLY: MobileChartShell, where no 3D scene or DatasetPanel is
 *     mounted. Proximity auto-switching must not depend on the 3D scene
 *     being alive — the mobile Live tab relies on it to hand off datasets
 *     as the user moves.
 *
 * The two hosts never mount simultaneously (App.tsx mobile gate), so the
 * 500 ms sampling interval is never doubled.
 */
import { useCallback, useEffect, useMemo } from "react";
import {
  getGetDatasetsIdTerrainQueryKey,
  getGetDatasetsIdTerrainUrl,
  getGetDatasetsIdOverviewQueryKey,
  getGetDatasetsIdOverviewUrl,
  getGetUserDatasetsIdTerrainQueryKey,
  getGetUserDatasetsIdTerrainUrl,
  getGetUserDatasetsIdOverviewQueryKey,
  getGetUserDatasetsIdOverviewUrl,
  type TerrainData,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { useTerrainStore, type DatasetSource } from "@/lib/terrainStore";
import { useProximityStreamingStore } from "@/lib/proximityStreamingStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { makeProgressTerrainFetcher } from "@/lib/progressTerrainFetcher";
import {
  useDatasetProximityStreaming,
  type DatasetBbox,
} from "@/hooks/useDatasetProximityStreaming";

/**
 * Module-level set of dataset IDs that have been auto-registered in the
 * proximity pool by this hook.  Declared at module scope (not inside the hook
 * as a useRef) so that it survives DatasetPanel / MobileChartShell remounts.
 * It is naturally reset on a full page reload, at which point the catalog data
 * also reloads from scratch — so the reset is always correct.
 *
 * This is the fix for the remount re-enrollment bug: a useRef resets to an
 * empty Set every time the host component unmounts and remounts, causing every
 * dataset to be re-enrolled even when it is already in selectedIds.
 */
const autoRegisteredIds = new Set<string>();

/**
 * Test-only reset — clears the module-level autoRegisteredIds set so that
 * each unit/integration test begins from a clean slate.
 *
 * Import and call in beforeEach:
 *   import { __resetAutoRegisteredIds } from "@/hooks/useProximityStreamingWiring";
 *   beforeEach(() => { __resetAutoRegisteredIds(); });
 *
 * Do not call this from production code.
 */
export function __resetAutoRegisteredIds(): void {
  autoRegisteredIds.clear();
}

/**
 * Minimal structural shape of a catalog / user dataset entry as consumed by
 * the proximity wiring — both generated API types satisfy it.
 */
export interface ProximityWiringDataset {
  id: string;
  name: string;
  bbox?: {
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
  } | null;
}

export interface UseProximityStreamingWiringArgs {
  /** Preset catalog entries (useGetDatasets data; undefined while loading). */
  datasets: ProximityWiringDataset[] | undefined;
  /** User-uploaded datasets (useGetUserDatasets data; undefined while loading). */
  userDatasets: ProximityWiringDataset[] | undefined;
}

export function useProximityStreamingWiring({
  datasets,
  userDatasets,
}: UseProximityStreamingWiringArgs): void {
  const proximityMode = useSettingsStore((s) => s.proximityMode ?? true);

  // Build a map from datasetId → bbox for ALL datasets that have geographic
  // bounding box data — both preset catalog entries and user-uploaded datasets.
  // User datasets now carry a computed bbox from the API when their terrainJson
  // or overviewJson contains valid geo bounds.
  const bboxMap = useMemo<Record<string, DatasetBbox>>(() => {
    const out: Record<string, DatasetBbox> = {};
    for (const d of datasets ?? []) {
      if (d.bbox) {
        out[d.id] = {
          minLon: d.bbox.minLon,
          maxLon: d.bbox.maxLon,
          minLat: d.bbox.minLat,
          maxLat: d.bbox.maxLat,
        };
      }
    }
    // Include user datasets with a known bbox so proximity distance checks are
    // real Haversine calculations rather than the "always nearby" fallback.
    for (const d of userDatasets ?? []) {
      if (d.bbox) {
        out[d.id] = {
          minLon: d.bbox.minLon,
          maxLon: d.bbox.maxLon,
          minLat: d.bbox.minLat,
          maxLat: d.bbox.maxLat,
        };
      }
    }
    return out;
  }, [datasets, userDatasets]);

  // ─── Proximity HUD: sync name map to store ────────────────────────────────
  // Keep the name map in proximityStreamingStore current whenever the catalog
  // or user-dataset list resolves, so the ProximityHudChip popover can show
  // survey names (not raw IDs) without being mounted inside DatasetPanel.
  useEffect(() => {
    const names: Record<string, string> = {};
    for (const d of datasets ?? []) {
      names[d.id] = d.name;
    }
    for (const d of userDatasets ?? []) {
      names[d.id] = d.name;
    }
    if (Object.keys(names).length > 0) {
      useProximityStreamingStore.getState().updateNameMap(names);
    }
  }, [datasets, userDatasets]);

  // ─── Proximity auto-registration effect ──────────────────────────────────
  // When proximityMode is ON, datasets are enrolled in the proximity pool via
  // addSelectedToPool — which adds to selectedIds WITHOUT immediate activation.
  // The proximity hook activates only when the camera enters the dataset's bbox.
  //
  // IMPORTANT: Only datasets with a known bbox are auto-enrolled.
  // User datasets without bbox are treated as "always nearby" by the proximity
  // hook (it activates them on first available slot), so auto-enrolling them
  // would cause unintended immediate loads regardless of camera position.
  // Those datasets remain manual-select only.
  //
  // Preset catalog entries always have bbox from the catalog; all are enrolled.
  //
  // autoRegisteredIds (module-level) tracks ONLY IDs we actually registered, so
  // toggle-off cannot evict datasets the user manually selected before enabling
  // the mode.  Being module-level (not a useRef) it also survives DatasetPanel
  // remounts — preventing the bug where every dataset was re-enrolled from
  // scratch on every navigation-triggered unmount/remount cycle.

  useEffect(() => {
    const { addSelectedToPool, removeSelected, selectedIds } = useTerrainStore.getState();

    if (!proximityMode) {
      // Remove every auto-registered ID from the pool (and evict if active).
      // removeSelected handles both selectedIds and visibleDatasets atomically.
      for (const id of autoRegisteredIds) {
        removeSelected(id);
      }
      autoRegisteredIds.clear();
      return;
    }

    const alreadySelected = new Set(selectedIds);

    // Register preset catalog entries (all carry bbox from catalog metadata).
    for (const d of datasets ?? []) {
      if (!autoRegisteredIds.has(d.id) && !alreadySelected.has(d.id)) {
        addSelectedToPool(d.id, "preset");
        autoRegisteredIds.add(d.id);
      }
    }

    // Register user-uploaded datasets ONLY when they have a valid bbox.
    // Without bbox, the proximity hook activates on any open slot (always-nearby
    // fallback), which would cause immediate unintended loads.
    for (const d of userDatasets ?? []) {
      if (
        d.bbox &&
        !autoRegisteredIds.has(d.id) &&
        !alreadySelected.has(d.id)
      ) {
        addSelectedToPool(d.id, "user");
        autoRegisteredIds.add(d.id);
      }
    }
  }, [proximityMode, datasets, userDatasets]);

  // Called by the proximity hook when a selected-but-not-active dataset should
  // be loaded into the scene. Adds it to visibleDatasets (with null grids) and
  // fetches the terrain+overview via React Query (uses cache when available).
  const handleProximityActivate = useCallback(
    async (datasetId: string, source: DatasetSource) => {
      useTerrainStore.getState().autoActivate(datasetId);
      useProximityStreamingStore.getState().setLoadingDatasetId(datasetId);
      try {
        if (source === "preset") {
          const [terrainData, overviewData] = await Promise.all([
            queryClient.fetchQuery({
              queryKey: getGetDatasetsIdTerrainQueryKey(datasetId),
              queryFn: makeProgressTerrainFetcher(
                getGetDatasetsIdTerrainUrl(datasetId),
                datasetId,
                false,
              ),
              staleTime: Infinity,
            }),
            queryClient.fetchQuery({
              queryKey: getGetDatasetsIdOverviewQueryKey(datasetId),
              queryFn: makeProgressTerrainFetcher(
                getGetDatasetsIdOverviewUrl(datasetId),
                datasetId,
                false,
              ),
              staleTime: Infinity,
            }),
          ]);
          useTerrainStore.getState().setDatasetGrids(datasetId, {
            activeGrid: terrainData as TerrainData,
            overviewGrid: overviewData as TerrainData,
          });
        } else {
          // User dataset: load via user-dataset endpoints
          const [terrainData, overviewData] = await Promise.all([
            queryClient.fetchQuery({
              queryKey: getGetUserDatasetsIdTerrainQueryKey(datasetId),
              queryFn: makeProgressTerrainFetcher(
                getGetUserDatasetsIdTerrainUrl(datasetId),
                datasetId,
                false,
              ),
              staleTime: Infinity,
            }),
            queryClient.fetchQuery({
              queryKey: getGetUserDatasetsIdOverviewQueryKey(datasetId),
              queryFn: makeProgressTerrainFetcher(
                getGetUserDatasetsIdOverviewUrl(datasetId),
                datasetId,
                false,
              ),
              staleTime: Infinity,
            }),
          ]);
          useTerrainStore.getState().setDatasetGrids(datasetId, {
            activeGrid: terrainData as TerrainData,
            overviewGrid: overviewData as TerrainData,
          });
        }
      } catch {
        // Load failed — remove from selected pool so it doesn't spin forever.
        useTerrainStore.getState().removeSelected(datasetId);
      } finally {
        // Clear the loading indicator regardless of success or failure.
        const store = useProximityStreamingStore.getState();
        if (store.loadingDatasetId === datasetId) {
          store.setLoadingDatasetId(null);
        }
      }
    },
    [],
  );

  useDatasetProximityStreaming({ bboxMap, onActivate: handleProximityActivate });
}
