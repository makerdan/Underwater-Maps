import { create } from "zustand";
import type { TerrainData } from "@workspace/api-client-react";

/**
 * Alias for MAX_ACTIVE_DATASETS. All mutation paths (setGrids, setPrimary,
 * toggleVisible) enforce a single unified cap of MAX_ACTIVE_DATASETS = 3.
 * @deprecated Use MAX_ACTIVE_DATASETS directly. Kept for import compatibility.
 */
export const VISIBLE_DATASETS_CAP = 3;

/**
 * Maximum number of datasets that can be simultaneously ACTIVE (in GPU memory
 * / rendered in the 3D scene). The proximity streaming logic enforces this;
 * users may SELECT any number of datasets and the streaming engine decides
 * which MAX_ACTIVE_DATASETS are rendered based on camera distance.
 */
export const MAX_ACTIVE_DATASETS = 3;

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
   * Set to the datasetId that was most recently evicted by a MANUAL action
   * (user-initiated add that pushes past the cap). Cleared after observers
   * have reacted (call clearEviction()). Used to fire toast notifications.
   */
  evictedId: string | null;

  /**
   * Set to the datasetId most recently evicted by the PROXIMITY STREAMING
   * engine (auto, silent — no toast). Cleared by clearAutoEviction().
   */
  autoEvictedId: string | null;

  /**
   * Ordered list of ALL dataset IDs the user has "selected" (intent).
   * This is a superset of the active visibleDatasets — the streaming engine
   * decides which MAX_ACTIVE_DATASETS of these are actually rendered.
   */
  selectedIds: string[];

  /**
   * Source for each selected dataset ID.
   */
  selectedSources: Record<string, DatasetSource>;

  /**
   * True when the user has explicitly opted into side-by-side multi-dataset viewing
   * (via toggleVisible / "Load together"). False in normal sequential navigation.
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
   * Toggle a dataset's visibility.
   * ADDING: adds to selectedIds; immediately activates if active slots remain
   *   (< MAX_ACTIVE_DATASETS), otherwise leaves in selected-but-not-active state.
   *   Never evicts an existing dataset — the streaming engine does that.
   * REMOVING: removes from both selectedIds AND visibleDatasets (full deselect).
   */
  toggleVisible: (entry: { datasetId: string; source: DatasetSource }) => void;

  /**
   * Add a dataset to the "selected" pool (user intent).
   * If there is room in active slots (visibleDatasets.length < MAX_ACTIVE_DATASETS),
   * the dataset is immediately activated. Otherwise it waits for proximity streaming.
   */
  addSelected: (datasetId: string, source: DatasetSource) => void;

  /**
   * Remove a dataset from the selected pool AND from active visibleDatasets.
   * Called when the user explicitly deselects / removes a dataset.
   */
  removeSelected: (datasetId: string) => void;

  /**
   * Proximity streaming: move a dataset from selected-but-not-active to active.
   * Caller must ensure capacity (visibleDatasets.length < MAX_ACTIVE_DATASETS)
   * before calling; this action does NOT evict anything.
   */
  autoActivate: (datasetId: string) => void;

  /**
   * Proximity streaming: remove a dataset from active (visibleDatasets) while
   * keeping it in selectedIds. Sets autoEvictedId (no toast fired for this).
   */
  autoEvict: (datasetId: string) => void;

  /** Remove every visible dataset except the first one (legacy alias).
   *  Also removes non-first selected IDs so streaming doesn't re-add them. */
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

  /** Clear the autoEvictedId after proximity streaming has recorded the eviction. */
  clearAutoEviction: () => void;
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
  autoEvictedId: null,
  selectedIds: [],
  selectedSources: {},
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
        if (base.length >= MAX_ACTIVE_DATASETS) {
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
        if (nextVisible.length >= MAX_ACTIVE_DATASETS) {
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
      const existingVisible = prev.visibleDatasets.find((v) => v.datasetId === datasetId);
      if (existingVisible) {
        // REMOVE path: full deselect — remove from both selectedIds and visibleDatasets.
        const nextVisible = prev.visibleDatasets.filter(
          (v) => v.datasetId !== datasetId,
        );
        const nextSelectedIds = prev.selectedIds.filter((id) => id !== datasetId);
        const nextSelectedSources = { ...prev.selectedSources };
        delete nextSelectedSources[datasetId];
        return {
          ...prev,
          visibleDatasets: nextVisible,
          selectedIds: nextSelectedIds,
          selectedSources: nextSelectedSources,
          ...syncPrimaryGrids(nextVisible),
        };
      }

      // ADD path: add to selectedIds; activate immediately if room in active slots.
      const alreadySelected = prev.selectedIds.includes(datasetId);
      const nextSelectedIds = alreadySelected
        ? prev.selectedIds
        : [...prev.selectedIds, datasetId];
      const nextSelectedSources = { ...prev.selectedSources, [datasetId]: source };

      if (prev.visibleDatasets.length < MAX_ACTIVE_DATASETS) {
        // Room available — activate immediately.
        const entry: VisibleDataset = {
          datasetId,
          source,
          activeGrid: null,
          overviewGrid: null,
        };
        const nextVisible = [...prev.visibleDatasets, entry];
        return {
          ...prev,
          visibleDatasets: nextVisible,
          selectedIds: nextSelectedIds,
          selectedSources: nextSelectedSources,
          multiDatasetMode: true,
          ...syncPrimaryGrids(nextVisible),
        };
      }

      // No room — add to selected pool only; proximity streaming handles activation.
      return {
        ...prev,
        selectedIds: nextSelectedIds,
        selectedSources: nextSelectedSources,
        multiDatasetMode: true,
      };
    }),

  addSelected: (datasetId, source) =>
    set((prev) => {
      // Already selected — just update source and activate if room.
      const alreadySelected = prev.selectedIds.includes(datasetId);
      const alreadyVisible = prev.visibleDatasets.some((v) => v.datasetId === datasetId);

      const nextSelectedIds = alreadySelected
        ? prev.selectedIds
        : [...prev.selectedIds, datasetId];
      const nextSelectedSources = { ...prev.selectedSources, [datasetId]: source };

      if (!alreadyVisible && prev.visibleDatasets.length < MAX_ACTIVE_DATASETS) {
        // Room available — activate immediately.
        const entry: VisibleDataset = {
          datasetId,
          source,
          activeGrid: null,
          overviewGrid: null,
        };
        const nextVisible = [...prev.visibleDatasets, entry];
        return {
          ...prev,
          visibleDatasets: nextVisible,
          selectedIds: nextSelectedIds,
          selectedSources: nextSelectedSources,
          multiDatasetMode: true,
          ...syncPrimaryGrids(nextVisible),
        };
      }

      // No room or already visible — just update selected pool.
      return {
        ...prev,
        selectedIds: nextSelectedIds,
        selectedSources: nextSelectedSources,
        multiDatasetMode: true,
      };
    }),

  removeSelected: (datasetId) =>
    set((prev) => {
      const nextSelectedIds = prev.selectedIds.filter((id) => id !== datasetId);
      const nextSelectedSources = { ...prev.selectedSources };
      delete nextSelectedSources[datasetId];
      const nextVisible = prev.visibleDatasets.filter((v) => v.datasetId !== datasetId);
      return {
        ...prev,
        selectedIds: nextSelectedIds,
        selectedSources: nextSelectedSources,
        visibleDatasets: nextVisible,
        ...syncPrimaryGrids(nextVisible),
      };
    }),

  autoActivate: (datasetId) =>
    set((prev) => {
      // Must be in selectedIds but NOT in visibleDatasets.
      if (!prev.selectedIds.includes(datasetId)) return prev;
      if (prev.visibleDatasets.some((v) => v.datasetId === datasetId)) return prev;
      // Caller is responsible for ensuring capacity.
      const source = prev.selectedSources[datasetId] ?? "preset";
      const entry: VisibleDataset = {
        datasetId,
        source,
        activeGrid: null,
        overviewGrid: null,
      };
      const nextVisible = [...prev.visibleDatasets, entry];
      return {
        ...prev,
        visibleDatasets: nextVisible,
        ...syncPrimaryGrids(nextVisible),
      };
    }),

  autoEvict: (datasetId) =>
    set((prev) => {
      if (!prev.visibleDatasets.some((v) => v.datasetId === datasetId)) return prev;
      const nextVisible = prev.visibleDatasets.filter((v) => v.datasetId !== datasetId);
      return {
        ...prev,
        visibleDatasets: nextVisible,
        autoEvictedId: datasetId,
        ...syncPrimaryGrids(nextVisible),
      };
    }),

  hideAllOthers: () =>
    set((prev) => {
      // Keep only the first entry (legacy alias).
      const first = prev.visibleDatasets[0];
      if (!first) return prev;
      const nextVisible = [first];
      // Also remove non-first entries from selectedIds so streaming doesn't re-add them.
      const nextSelectedIds = prev.selectedIds.filter((id) => id === first.datasetId);
      const nextSelectedSources: Record<string, DatasetSource> = {};
      if (prev.selectedSources[first.datasetId]) {
        nextSelectedSources[first.datasetId] = prev.selectedSources[first.datasetId]!;
      }
      return {
        ...prev,
        visibleDatasets: nextVisible,
        selectedIds: nextSelectedIds,
        selectedSources: nextSelectedSources,
        ...syncPrimaryGrids(nextVisible),
      };
    }),

  setSinglePrimary: (datasetId, source) =>
    set((prev) => {
      // Preserve already-loaded grids when re-promoting a dataset that is
      // currently visible — otherwise promoting the active dataset (e.g. the
      // useActiveDatasetSync promote effect firing after grids were seeded
      // directly) wipes its grids and the Overview Map goes blank until a
      // refetch completes (or never, if the dataset has no server-side grid).
      const existing = prev.visibleDatasets.find((v) => v.datasetId === datasetId);
      const entry: VisibleDataset = {
        datasetId,
        source: source ?? existing?.source ?? "preset",
        activeGrid: existing?.activeGrid ?? null,
        overviewGrid: existing?.overviewGrid ?? null,
      };
      const nextVisible = [entry];
      return {
        ...prev,
        visibleDatasets: nextVisible,
        selectedIds: [],
        selectedSources: {},
        ...syncPrimaryGrids(nextVisible),
        multiDatasetMode: false,
        evictedId: null,
        autoEvictedId: null,
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
      autoEvictedId: null,
      selectedIds: [],
      selectedSources: {},
      multiDatasetMode: false,
    }),

  clearEviction: () =>
    set((prev) => (prev.evictedId === null ? prev : { ...prev, evictedId: null })),

  clearAutoEviction: () =>
    set((prev) => (prev.autoEvictedId === null ? prev : { ...prev, autoEvictedId: null })),
}));
