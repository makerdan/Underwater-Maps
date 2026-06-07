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

/**
 * Check whether a given datasetId is a member of the primary set.
 * In multi-primary mode every visible dataset is primary.
 */
export function isPrimary(visibleDatasets: VisibleDataset[], datasetId: string): boolean {
  return visibleDatasets.some((v) => v.datasetId === datasetId);
}

interface TerrainStore {
  /** All datasets currently visible (3D + 2D map). All are treated as primary. */
  visibleDatasets: VisibleDataset[];
  /**
   * IDs of all visible datasets — every visible dataset shares equal primary
   * status.  Replaces the old single-string `primaryDatasetId`.
   */
  primaryDatasetIds: string[];
  /**
   * Legacy alias: first visible dataset's ID (null if empty).  Kept so
   * callers that need a single reference (coordinate frame, Overview Map
   * centre, etc.) don't need to be updated all at once.
   */
  primaryDatasetId: string | null;

  /** Convenience: first visible dataset's full-res grid (legacy alias). */
  activeGrid: TerrainData | null;
  /** Convenience: first visible dataset's overview grid (legacy alias). */
  overviewGrid: TerrainData | null;

  /**
   * Set to the datasetId that was most recently evicted to respect VISIBLE_DATASETS_CAP.
   * Cleared after observers have reacted (call clearEviction()). Used to fire toast
   * notifications when the cap silently removes a dataset.
   */
  evictedId: string | null;

  /**
   * True when the user has explicitly opted into side-by-side multi-dataset viewing
   * (via toggleVisible / "Show together"). False in normal sequential navigation.
   * When false, setSinglePrimary evicts all prior datasets before promoting a new one.
   */
  multiDatasetMode: boolean;

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

  /**
   * Promote a dataset to the front of visibleDatasets (making it the legacy
   * primaryDatasetId alias). If it isn't visible yet, it's added first.
   * In multi-primary mode this does not change which datasets are "primary" —
   * it only affects the first-entry alias used by legacy callers.
   */
  setPrimary: (datasetId: string, source?: DatasetSource) => void;

  /**
   * Toggle a dataset's visibility. When hiding the last dataset the store
   * becomes empty.  When hiding what was previously the first entry, the
   * second entry takes over the legacy `primaryDatasetId` alias.
   */
  toggleVisible: (entry: { datasetId: string; source: DatasetSource }) => void;

  /** Remove every visible dataset except the first one (legacy alias). */
  hideAllOthers: () => void;

  /**
   * Single-dataset sequential-load entry point. Replaces ALL currently visible
   * datasets with just the new one and promotes it to primary. Use this instead
   * of setPrimary when multi-dataset mode is off, so no ghost terrain from a
   * prior dataset can remain in the scene.
   */
  setSinglePrimary: (datasetId: string, source?: DatasetSource) => void;

  /** Reset to empty (used by water-type switch). */
  clear: () => void;

  /** Clear the evictedId after observers have read and reacted to it. */
  clearEviction: () => void;
}

/**
 * Derive the multi-primary convenience fields from a visibleDatasets array.
 * `activeGrid`/`overviewGrid`/`primaryDatasetId` are first-entry aliases kept
 * for legacy callers; `primaryDatasetIds` is the full set of visible IDs.
 */
function syncPrimaryGrids(
  visibleDatasets: VisibleDataset[],
): {
  primaryDatasetIds: string[];
  primaryDatasetId: string | null;
  activeGrid: TerrainData | null;
  overviewGrid: TerrainData | null;
} {
  const first = visibleDatasets[0] ?? null;
  return {
    primaryDatasetIds: visibleDatasets.map((v) => v.datasetId),
    primaryDatasetId: first?.datasetId ?? null,
    activeGrid: first?.activeGrid ?? null,
    overviewGrid: first?.overviewGrid ?? null,
  };
}

export const useTerrainStore = create<TerrainStore>((set) => ({
  visibleDatasets: [],
  primaryDatasetIds: [],
  primaryDatasetId: null,
  activeGrid: null,
  overviewGrid: null,
  evictedId: null,
  multiDatasetMode: false,

  setGrids: ({ activeGrid, overviewGrid, source }) =>
    set((prev) => {
      // setGrids' legacy contract is "this is now THE primary terrain" — so
      // any grid carrying a datasetId promotes that dataset to primary. Fall
      // back to the existing first-entry when neither grid carries an id (e.g.
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
      let evictedId: string | null = null;
      if (existing) {
        // Keep the existing entry in its current position; update grids.
        nextVisible = prev.visibleDatasets.map((v) =>
          v.datasetId === primaryId ? merged : v,
        );
      } else {
        // Cap-evict oldest non-first entry when adding a new visible dataset.
        let base = prev.visibleDatasets;
        if (base.length >= VISIBLE_DATASETS_CAP) {
          // Evict the oldest entry that is NOT currently first (legacy alias).
          const firstId = base[0]?.datasetId ?? null;
          const evictIdx = base.findIndex((v) => v.datasetId !== firstId);
          if (evictIdx >= 0) {
            evictedId = base[evictIdx]!.datasetId;
            base = [...base.slice(0, evictIdx), ...base.slice(evictIdx + 1)];
          }
        }
        // New entry becomes the first (primary alias) — prepend it.
        nextVisible = [merged, ...base];
      }

      return {
        ...prev,
        visibleDatasets: nextVisible,
        ...syncPrimaryGrids(nextVisible),
        ...(evictedId !== null ? { evictedId } : {}),
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
        ...syncPrimaryGrids(nextVisible),
      };
    }),

  setPrimary: (datasetId, source) =>
    set((prev) => {
      const existing = prev.visibleDatasets.find((v) => v.datasetId === datasetId);
      let nextVisible = prev.visibleDatasets;
      let evictedId: string | null = null;

      if (!existing) {
        // Dataset not yet visible — add it.
        const entry: VisibleDataset = {
          datasetId,
          source: source ?? "preset",
          activeGrid: null,
          overviewGrid: null,
        };
        if (nextVisible.length >= VISIBLE_DATASETS_CAP) {
          // Evict oldest non-first entry.
          const firstId = nextVisible[0]?.datasetId ?? null;
          const evictIdx = nextVisible.findIndex((v) => v.datasetId !== firstId);
          if (evictIdx >= 0) {
            evictedId = nextVisible[evictIdx]!.datasetId;
            nextVisible = [
              ...nextVisible.slice(0, evictIdx),
              ...nextVisible.slice(evictIdx + 1),
            ];
          }
        }
        // Prepend so the new entry becomes the legacy primaryDatasetId alias.
        nextVisible = [entry, ...nextVisible];
      } else {
        // Already visible — move it to position 0 for the legacy alias.
        nextVisible = [
          existing,
          ...nextVisible.filter((v) => v.datasetId !== datasetId),
        ];
      }

      return {
        ...prev,
        visibleDatasets: nextVisible,
        ...syncPrimaryGrids(nextVisible),
        ...(evictedId !== null ? { evictedId } : {}),
      };
    }),

  toggleVisible: ({ datasetId, source }) =>
    set((prev) => {
      const existing = prev.visibleDatasets.find((v) => v.datasetId === datasetId);
      if (existing) {
        // Hide: remove from visibleDatasets.
        const nextVisible = prev.visibleDatasets.filter(
          (v) => v.datasetId !== datasetId,
        );
        return {
          ...prev,
          visibleDatasets: nextVisible,
          ...syncPrimaryGrids(nextVisible),
        };
      }
      // Add new entry (cap-evict oldest non-first if needed).
      let nextVisible = prev.visibleDatasets;
      let evictedId: string | null = null;
      if (nextVisible.length >= VISIBLE_DATASETS_CAP) {
        const firstId = nextVisible[0]?.datasetId ?? null;
        const evictIdx = nextVisible.findIndex((v) => v.datasetId !== firstId);
        if (evictIdx >= 0) {
          evictedId = nextVisible[evictIdx]!.datasetId;
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
      // Append — new entries go to the end, preserving first-entry alias.
      nextVisible = [...nextVisible, entry];
      return {
        ...prev,
        visibleDatasets: nextVisible,
        multiDatasetMode: true,
        ...syncPrimaryGrids(nextVisible),
        ...(evictedId !== null ? { evictedId } : {}),
      };
    }),

  hideAllOthers: () =>
    set((prev) => {
      // Keep only the first entry (legacy alias).
      const first = prev.visibleDatasets[0];
      if (!first) return prev;
      const nextVisible = [first];
      return {
        ...prev,
        visibleDatasets: nextVisible,
        ...syncPrimaryGrids(nextVisible),
      };
    }),

  setSinglePrimary: (datasetId, source) =>
    set((prev) => {
      const entry: VisibleDataset = {
        datasetId,
        source: source ?? "preset",
        activeGrid: null,
        overviewGrid: null,
      };
      const nextVisible = [entry];
      return {
        ...prev,
        visibleDatasets: nextVisible,
        ...syncPrimaryGrids(nextVisible),
        primaryDatasetIds: [datasetId],
        multiDatasetMode: false,
        evictedId: null,
      };
    }),

  clear: () =>
    set({
      visibleDatasets: [],
      primaryDatasetIds: [],
      primaryDatasetId: null,
      activeGrid: null,
      overviewGrid: null,
      evictedId: null,
      multiDatasetMode: false,
    }),

  clearEviction: () =>
    set((prev) => (prev.evictedId === null ? prev : { ...prev, evictedId: null })),
}));
