import { create } from "zustand";
import type { TerrainData } from "@workspace/api-client-react";

/**
 * Soft cap on the number of simultaneously visible datasets. Selecting / toggling
 * additional datasets beyond this cap is still allowed (oldest non-primary is
 * evicted), but the UI surfaces an inline warning when the cap is reached.
 */
export const VISIBLE_DATASETS_CAP = 4;

export type DatasetSource = "preset" | "user";

export interface VisibleDataset {
  /** Stable id (terrain.datasetId). For preset datasets this is the catalogue id;
   *  for user uploads this is the server-assigned id returned from /api/upload. */
  datasetId: string;
  /** Where the dataset came from — controls how grids get loaded. */
  source: DatasetSource;
  /** Full-resolution terrain grid (rendered in 3D). May be null while loading. */
  activeGrid: TerrainData | null;
  /** Low-resolution overview grid (rendered in Overview Map). May be null while loading. */
  overviewGrid: TerrainData | null;
}

interface TerrainStore {
  /** All datasets currently visible (3D + 2D map). Includes the primary. */
  visibleDatasets: VisibleDataset[];
  /** datasetId of the "primary" dataset — drives markers, AI, tides, camera, copy-coords. */
  primaryDatasetId: string | null;

  /** Convenience: primary's full-res grid (mirrors `activeGrid` field on the primary entry). */
  activeGrid: TerrainData | null;
  /** Convenience: primary's overview grid (mirrors `overviewGrid` field on the primary entry). */
  overviewGrid: TerrainData | null;

  /**
   * Legacy entry point — sets the primary's grids. If no primary is set yet,
   * one is derived from the grid's datasetId. Keeps existing callers (DatasetPanel,
   * useActiveDatasetSync, App.tsx terrain effect) working unchanged.
   */
  setGrids: (grids: {
    activeGrid?: TerrainData | null;
    overviewGrid?: TerrainData | null;
    source?: DatasetSource;
  }) => void;

  /** Write grids onto a specific visible entry (used by the per-dataset loader). */
  setDatasetGrids: (
    datasetId: string,
    grids: { activeGrid?: TerrainData | null; overviewGrid?: TerrainData | null },
  ) => void;

  /** Promote a dataset to primary. If it isn't visible yet, it's added first. */
  setPrimary: (datasetId: string, source?: DatasetSource) => void;

  /**
   * Toggle a dataset's visibility. When hiding the primary, the most-recent
   * other visible dataset (if any) is promoted to primary.
   */
  toggleVisible: (entry: { datasetId: string; source: DatasetSource }) => void;

  /** Remove every visible dataset except the primary. No-op when only primary is visible. */
  hideAllOthers: () => void;

  /** Reset to empty (used by water-type switch). */
  clear: () => void;
}

function syncPrimaryGrids(
  visibleDatasets: VisibleDataset[],
  primaryDatasetId: string | null,
): { activeGrid: TerrainData | null; overviewGrid: TerrainData | null } {
  const primary = primaryDatasetId
    ? visibleDatasets.find((v) => v.datasetId === primaryDatasetId)
    : null;
  return {
    activeGrid: primary?.activeGrid ?? null,
    overviewGrid: primary?.overviewGrid ?? null,
  };
}

export const useTerrainStore = create<TerrainStore>((set) => ({
  visibleDatasets: [],
  primaryDatasetId: null,
  activeGrid: null,
  overviewGrid: null,

  setGrids: ({ activeGrid, overviewGrid, source }) =>
    set((prev) => {
      // setGrids' legacy contract is "this is now THE primary terrain" — so
      // any grid carrying a datasetId promotes that dataset to primary. Fall
      // back to the existing primary when neither grid carries an id (e.g.
      // when callers clear with `{activeGrid: null}`).
      const explicitId =
        (activeGrid && activeGrid.datasetId) ||
        (overviewGrid && overviewGrid.datasetId) ||
        null;
      const primaryId = explicitId ?? prev.primaryDatasetId;
      if (!primaryId) {
        // Clearing with no prior primary — wipe the convenience mirrors too.
        return {
          ...prev,
          activeGrid: activeGrid !== undefined ? activeGrid : prev.activeGrid,
          overviewGrid:
            overviewGrid !== undefined ? overviewGrid : prev.overviewGrid,
        };
      }

      const inferredSource: DatasetSource =
        source ??
        prev.visibleDatasets.find((v) => v.datasetId === primaryId)?.source ??
        "preset";

      const existing = prev.visibleDatasets.find((v) => v.datasetId === primaryId);
      const merged: VisibleDataset = {
        datasetId: primaryId,
        source: inferredSource,
        activeGrid:
          activeGrid !== undefined ? activeGrid : existing?.activeGrid ?? null,
        overviewGrid:
          overviewGrid !== undefined
            ? overviewGrid
            : existing?.overviewGrid ?? null,
      };

      let nextVisible: VisibleDataset[];
      if (existing) {
        nextVisible = prev.visibleDatasets.map((v) =>
          v.datasetId === primaryId ? merged : v,
        );
      } else {
        // Cap-evict oldest non-primary entry when adding a new visible dataset.
        let base = prev.visibleDatasets;
        if (base.length >= VISIBLE_DATASETS_CAP) {
          const evictIdx = base.findIndex(
            (v) => v.datasetId !== prev.primaryDatasetId,
          );
          if (evictIdx >= 0) {
            base = [...base.slice(0, evictIdx), ...base.slice(evictIdx + 1)];
          }
        }
        nextVisible = [...base, merged];
      }

      return {
        ...prev,
        visibleDatasets: nextVisible,
        primaryDatasetId: primaryId,
        ...syncPrimaryGrids(nextVisible, primaryId),
      };
    }),

  setDatasetGrids: (datasetId, { activeGrid, overviewGrid }) =>
    set((prev) => {
      const existing = prev.visibleDatasets.find((v) => v.datasetId === datasetId);
      if (!existing) {
        // Loader can race ahead of the user removing a dataset — silently ignore.
        return prev;
      }
      const merged: VisibleDataset = {
        ...existing,
        activeGrid:
          activeGrid !== undefined ? activeGrid : existing.activeGrid,
        overviewGrid:
          overviewGrid !== undefined ? overviewGrid : existing.overviewGrid,
      };
      const nextVisible = prev.visibleDatasets.map((v) =>
        v.datasetId === datasetId ? merged : v,
      );
      return {
        ...prev,
        visibleDatasets: nextVisible,
        ...syncPrimaryGrids(nextVisible, prev.primaryDatasetId),
      };
    }),

  setPrimary: (datasetId, source) =>
    set((prev) => {
      const existing = prev.visibleDatasets.find((v) => v.datasetId === datasetId);
      let nextVisible = prev.visibleDatasets;
      if (!existing) {
        const entry: VisibleDataset = {
          datasetId,
          source: source ?? "preset",
          activeGrid: null,
          overviewGrid: null,
        };
        // Evict oldest non-primary if cap exceeded.
        if (nextVisible.length >= VISIBLE_DATASETS_CAP) {
          const evictIdx = nextVisible.findIndex(
            (v) => v.datasetId !== prev.primaryDatasetId,
          );
          if (evictIdx >= 0) {
            nextVisible = [
              ...nextVisible.slice(0, evictIdx),
              ...nextVisible.slice(evictIdx + 1),
            ];
          }
        }
        nextVisible = [...nextVisible, entry];
      }
      return {
        ...prev,
        visibleDatasets: nextVisible,
        primaryDatasetId: datasetId,
        ...syncPrimaryGrids(nextVisible, datasetId),
      };
    }),

  toggleVisible: ({ datasetId, source }) =>
    set((prev) => {
      const existing = prev.visibleDatasets.find((v) => v.datasetId === datasetId);
      if (existing) {
        const nextVisible = prev.visibleDatasets.filter(
          (v) => v.datasetId !== datasetId,
        );
        let nextPrimary = prev.primaryDatasetId;
        if (prev.primaryDatasetId === datasetId) {
          // Hiding the primary: promote the most-recent remaining entry, if any.
          nextPrimary = nextVisible[nextVisible.length - 1]?.datasetId ?? null;
        }
        return {
          ...prev,
          visibleDatasets: nextVisible,
          primaryDatasetId: nextPrimary,
          ...syncPrimaryGrids(nextVisible, nextPrimary),
        };
      }
      // Add new entry (cap-evict oldest non-primary if needed).
      let nextVisible = prev.visibleDatasets;
      if (nextVisible.length >= VISIBLE_DATASETS_CAP) {
        const evictIdx = nextVisible.findIndex(
          (v) => v.datasetId !== prev.primaryDatasetId,
        );
        if (evictIdx >= 0) {
          nextVisible = [
            ...nextVisible.slice(0, evictIdx),
            ...nextVisible.slice(evictIdx + 1),
          ];
        }
      }
      const entry: VisibleDataset = {
        datasetId,
        source,
        activeGrid: null,
        overviewGrid: null,
      };
      nextVisible = [...nextVisible, entry];
      const nextPrimary = prev.primaryDatasetId ?? datasetId;
      return {
        ...prev,
        visibleDatasets: nextVisible,
        primaryDatasetId: nextPrimary,
        ...syncPrimaryGrids(nextVisible, nextPrimary),
      };
    }),

  hideAllOthers: () =>
    set((prev) => {
      if (!prev.primaryDatasetId) return prev;
      const nextVisible = prev.visibleDatasets.filter(
        (v) => v.datasetId === prev.primaryDatasetId,
      );
      return {
        ...prev,
        visibleDatasets: nextVisible,
        ...syncPrimaryGrids(nextVisible, prev.primaryDatasetId),
      };
    }),

  clear: () =>
    set({
      visibleDatasets: [],
      primaryDatasetId: null,
      activeGrid: null,
      overviewGrid: null,
    }),
}));
