import { create } from "zustand";
import type { TerrainData } from "@workspace/api-client-react";
// Circular import: settingsStore imports terrainStore (for eviction) and
// terrainStore imports settingsStore (for getActiveCap). Both accesses happen
// only inside zustand action bodies (not during module init), so the cycle is
// safe — ESM live bindings ensure the reference is populated by call time.
import { useSettingsStore } from "./settingsStore";
// Type-only import (erased at compile time) — keeps terrainStore free of any
// runtime dependency on the overview/puzzle rendering modules.
import type { GeoCorrection } from "./puzzleTransform";

export type { GeoCorrection } from "./puzzleTransform";

/**
 * Default / fallback active-dataset cap. Kept for import compatibility in
 * tests and legacy callers. The actual runtime cap is read from settingsStore
 * via getActiveCap() so it respects the user's "Max active datasets" setting.
 */
export const MAX_ACTIVE_DATASETS = 3;

/**
 * @deprecated Use MAX_ACTIVE_DATASETS or getActiveCap(). Kept for import compatibility.
 */
export const VISIBLE_DATASETS_CAP = MAX_ACTIVE_DATASETS;

/**
 * Read the active-dataset cap from settingsStore at call time.
 * Falls back to MAX_ACTIVE_DATASETS (3) when the store is not yet hydrated or
 * maxActiveDatasets is absent (e.g. in tests that don't mock the store).
 */
function getActiveCap(): number {
  try {
    return useSettingsStore.getState().maxActiveDatasets ?? MAX_ACTIVE_DATASETS;
  } catch {
    return MAX_ACTIVE_DATASETS;
  }
}

export type DatasetSource = "preset" | "user";

/**
 * Proximity activation owns a short-lived terrain/overview query pair. Keep
 * its cancellation callbacks outside the persisted render state so selection
 * transitions can abort work that no longer has a valid destination without
 * coupling this store to React Query.
 */
type ProximityRequestCanceller = () => void;
const proximityRequestCancellers = new Map<string, Set<ProximityRequestCanceller>>();

/**
 * Register cancellation work for an in-flight proximity load. The returned
 * cleanup must run when that load settles, regardless of success or failure.
 */
export function registerProximityRequest(
  datasetId: string,
  cancel: ProximityRequestCanceller,
): () => void {
  const cancellers = proximityRequestCancellers.get(datasetId) ?? new Set();
  cancellers.add(cancel);
  proximityRequestCancellers.set(datasetId, cancellers);

  return () => {
    const active = proximityRequestCancellers.get(datasetId);
    if (!active) return;
    active.delete(cancel);
    if (active.size === 0) proximityRequestCancellers.delete(datasetId);
  };
}

/**
 * Abort only proximity loads that cannot contribute to the new selection.
 * Keeping an ID is important for collection transitions: a request already in
 * flight for a member shared by the old and new selection remains useful.
 */
export function cancelObsoleteProximityRequests(keepDatasetIds: Iterable<string>): void {
  const keep = new Set(keepDatasetIds);
  for (const [datasetId, cancellers] of proximityRequestCancellers) {
    if (keep.has(datasetId)) continue;
    for (const cancel of [...cancellers]) cancel();
  }
}

/** Test-only cleanup for the module-level proximity request registry. */
export function __resetProximityRequestCancellers(): void {
  proximityRequestCancellers.clear();
}

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
  /**
   * ISO date string for the survey/data currency of this dataset (catalog
   * `lastUpdated`).  Used to sort draw order in the Overview Map so the most
   * recently surveyed dataset is always drawn on top.  Null/undefined for
   * user-uploaded datasets that have no catalog entry.
   */
  dataUpdatedAt?: string | null;
  /**
   * Optional geographic correction from an applied special-collection puzzle
   * layout (Apply-to-3D). When present, the 3D scene shifts this dataset's
   * effective render origin by {dLon, dLat} and rotates secondary meshes around
   * their centres by `angleDeg`. The stored grids (activeGrid/overviewGrid
   * bboxes) are NEVER mutated — the correction applies to scene placement only.
   */
  geoCorrection?: GeoCorrection | null;
}

export interface CollectionNavigationRequest {
  requestId: number;
  datasetId: string;
  lon: number;
  lat: number;
}

/**
 * Sort a list of VisibleDatasets oldest-first so the newest entry is painted
 * last (on top) in the Overview Map canvas.
 *
 * Rules:
 *   - Entries with a known `dataUpdatedAt` sort by that date, oldest first.
 *   - Entries with null/undefined `dataUpdatedAt` are treated as epoch 0
 *     (they go underneath all dated entries).
 *   - The sort is stable: entries with equal or both-unknown dates preserve
 *     their original relative order (primary entry retains its position as
 *     a natural tiebreaker when dates match).
 */
export function sortByRecency(datasets: VisibleDataset[]): VisibleDataset[] {
  // Assign a numeric timestamp for comparison; null/undefined → 0 (epoch).
  const ts = (d: VisibleDataset): number => {
    if (!d.dataUpdatedAt) return 0;
    const t = Date.parse(d.dataUpdatedAt);
    return isNaN(t) ? 0 : t;
  };
  // Stable sort: copy array first, then sort with index tiebreaker.
  return datasets
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const diff = ts(a.d) - ts(b.d);
      return diff !== 0 ? diff : a.i - b.i;
    })
    .map(({ d }) => d);
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
   * Dataset requested by a collection load as the App state's next primary
   * terrain. The always-mounted handoff clears this after its active grid
   * arrives.
   */
  pendingPrimaryHandoffId: string | null;

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
   * Explicit collection-owned selection scope. While non-null, proximity
   * registration must not add anything outside these resolved member IDs.
   */
  collectionScopeId: string | null;
  collectionScopeIds: string[] | null;
  /** The one collection member currently requested for a 2D → full-terrain handoff. */
  collectionNavigation: CollectionNavigationRequest | null;
  /** Actionable failure text for the current collection navigation request. */
  collectionNavigationError: string | null;
  /** Monotonic stale-response fence, independent of nullable request state. */
  collectionNavigationSequence: number;
  requestCollectionNavigation: (datasetId: string, lon: number, lat: number) => void;
  retryCollectionNavigation: () => void;
  completeCollectionNavigation: (requestId: number) => void;
  failCollectionNavigation: (requestId: number, message: string) => void;

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
   *
   * `geoCorrection` (optional): when provided (including explicit null), the
   * entry's geographic correction is set to it; when omitted (undefined), an
   * existing entry's correction is preserved — promotion must never silently
   * wipe an applied puzzle-layout correction (same preservation rule as grids).
   */
  setPrimary: (
    datasetId: string,
    source?: DatasetSource,
    dataUpdatedAt?: string | null,
    geoCorrection?: GeoCorrection | null,
  ) => void;

  /**
   * Bulk-apply geographic corrections from a special-collection puzzle layout
   * (Apply-to-3D). Every visible entry gets `geoCorrection` set from the
   * record (or cleared when absent / when the record is null). Grids and
   * their stored bboxes are untouched — corrections affect scene placement
   * only. Pass null to clear all corrections.
   */
  setDatasetGeoCorrections: (corrections: Record<string, GeoCorrection> | null) => void;

  /**
   * Toggle a dataset's visibility.
   * ADDING: adds to selectedIds; immediately activates if active slots remain
   *   (< MAX_ACTIVE_DATASETS), otherwise leaves in selected-but-not-active state.
   *   Never evicts an existing dataset — the streaming engine does that.
   * REMOVING: removes from both selectedIds AND visibleDatasets (full deselect).
   */
  toggleVisible: (entry: { datasetId: string; source: DatasetSource; dataUpdatedAt?: string | null }) => void;

  /**
   * Add a dataset to the "selected" pool (user intent).
   * If there is room in active slots (visibleDatasets.length < MAX_ACTIVE_DATASETS),
   * the dataset is immediately activated. Otherwise it waits for proximity streaming.
   */
  addSelected: (datasetId: string, source: DatasetSource, dataUpdatedAt?: string | null) => void;

  /**
   * Activate the complete member set of a Special Collection. Unlike ordinary
   * selection, this deliberately bypasses the active-dataset cap so every
   * resolvable member can receive an Overview tile.
   */
  activateCollection: (
    entries: Array<{
      datasetId: string;
      source: DatasetSource;
      dataUpdatedAt?: string | null;
    }>,
  ) => void;

  /** Establish the collection scope before an activation handoff begins. */
  setCollectionScope: (collectionId: string, datasetIds: string[]) => void;

  /**
   * Add resolvable collection members to the current Explore scene without
   * replacing datasets the user already has loaded.
   */
  addCollectionMembers: (
    entries: Array<{
      datasetId: string;
      source: DatasetSource;
      dataUpdatedAt?: string | null;
    }>,
  ) => void;

  /**
   * Add a dataset to the selected pool WITHOUT activating it.
   * Used by the proximity-mode auto-registration effect so that all datasets
   * are enrolled in the proximity pool but none are activated immediately —
   * the proximity hook activates based on camera distance only.
   * Safe to call for datasets already in the pool (becomes a source update).
   */
  addSelectedToPool: (datasetId: string, source: DatasetSource) => void;

  /**
   * Remove a dataset from the selected pool AND from active visibleDatasets.
   * Called when the user explicitly deselects / removes a dataset.
   */
  removeSelected: (datasetId: string) => void;

  /**
   * Proximity streaming: move a dataset from selected-but-not-active to active.
   * The cap (MAX_ACTIVE_DATASETS) is enforced internally inside the functional
   * updater — if the active list is already full this is a silent no-op.
   * Callers do not need to check capacity before calling.
   * This action does NOT evict anything.
   */
  autoActivate: (datasetId: string) => void;

  /**
   * Proximity streaming: remove a dataset from active (visibleDatasets) while
   * keeping it in selectedIds. Sets autoEvictedId (no toast fired for this).
   */
  autoEvict: (datasetId: string) => void;

  /** Remove every visible dataset except the first one (legacy alias).
   *  Also removes non-first selected IDs so streaming doesn't re-add them. */

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

  /** Clear the collection-to-App primary terrain handoff request. */
  clearPendingPrimaryHandoff: () => void;

  /**
   * Dataset IDs whose overview fetch has definitively failed (React Query
   * returned isError: true).  OverviewMap reads this to surface the error UI
   * immediately rather than waiting for the 15 s stale-fetch timeout.
   */
  overviewFetchErrorIds: string[];

  /**
   * Record or clear a definitively-failed overview fetch for a dataset.
   * Called by VisibleDatasetsLoader when the overview query transitions to
   * isError: true (set hasError=true) or recovers / unmounts (hasError=false).
   */
  setOverviewFetchError: (datasetId: string, hasError: boolean) => void;

  /**
   * Dataset IDs whose terrain or overview fetch has definitively failed.
   * Collection rows use this to replace their loading state with a retryable
   * error while preserving the collection controls.
   */
  datasetFetchErrorIds: string[];
  setDatasetFetchError: (datasetId: string, hasError: boolean) => void;
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
  pendingPrimaryHandoffId: null,
  selectedIds: [],
  selectedSources: {},
  multiDatasetMode: false,
  collectionScopeId: null,
  collectionScopeIds: null,
  collectionNavigation: null,
  collectionNavigationError: null,
  collectionNavigationSequence: 0,
  overviewFetchErrorIds: [],
  datasetFetchErrorIds: [],

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
      // AppState may publish a late grid from the dataset that was selected
      // before a collection opened. A legacy writer is not selection intent:
      // while a collection owns the view, reject non-member grids entirely.
      if (
        explicitId &&
        prev.collectionScopeIds !== null &&
        !prev.collectionScopeIds.includes(explicitId)
      ) {
        return prev;
      }
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
        if (base.length >= getActiveCap()) {
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
        pendingPrimaryHandoffId: null,
        ...syncPrimaryGrids(nextVisible),
        ...(evictedId !== null ? { evictedId } : {}),
      };
    }),

  setDatasetGrids: (datasetId, { activeGrid, overviewGrid }) =>
    set((prev) => {
      const existing = prev.visibleDatasets.find((v) => v.datasetId === datasetId);
      if (!existing) {
        // Loader can race ahead of the user removing a dataset — silently ignore.
        //
        // NOTE: this presence check does NOT protect against the re-add race.
        // If dataset X is removed and immediately re-added, the entry for X is
        // present again, so a stale in-flight completion for the OLD visibility
        // instance would still write here. That race is prevented one layer up in
        // VisibleDatasetsLoader via a per-component epoch counter — grids from a
        // prior visibility cycle are rejected before this action is ever called.
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

  setDatasetGeoCorrections: (corrections) =>
    set((prev) => {
      let changed = false;
      const nextVisible = prev.visibleDatasets.map((v) => {
        const next = corrections?.[v.datasetId] ?? null;
        const cur = v.geoCorrection ?? null;
        if (next === cur) return v; // both null → no change for this entry
        changed = true;
        // Only the correction field changes — grids and their stored bboxes
        // are deliberately untouched (corrections are scene-placement-only).
        return { ...v, geoCorrection: next };
      });
      if (!changed) return prev;
      return {
        ...prev,
        visibleDatasets: nextVisible,
        ...syncPrimaryGrids(nextVisible),
      };
    }),

  setPrimary: (datasetId, source, dataUpdatedAt, geoCorrection) =>
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
          dataUpdatedAt: dataUpdatedAt ?? null,
          geoCorrection: geoCorrection ?? null,
        };
        if (nextVisible.length >= getActiveCap()) {
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
        // Preserve loaded grids AND any applied geoCorrection unless the
        // caller explicitly passes one (undefined = leave untouched).
        const promoted: VisibleDataset =
          geoCorrection !== undefined ? { ...existing, geoCorrection } : existing;
        nextVisible = [
          promoted,
          ...nextVisible.filter((v) => v.datasetId !== datasetId),
        ];
      }

      return {
        ...prev,
        visibleDatasets: nextVisible,
        // Any explicit primary selection supersedes an in-flight collection
        // click. The collection handoff itself performs these writes in one
        // effect tick after verifying its request fence.
        collectionScopeId: null,
        collectionScopeIds: null,
        collectionNavigation: null,
        collectionNavigationError: null,
        pendingPrimaryHandoffId: null,
        ...syncPrimaryGrids(nextVisible),
        ...(evictedId !== null ? { evictedId } : {}),
      };
    }),

  toggleVisible: ({ datasetId, source, dataUpdatedAt }) =>
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

      if (prev.visibleDatasets.length < getActiveCap()) {
        // Room available — activate immediately.
        const entry: VisibleDataset = {
          datasetId,
          source,
          activeGrid: null,
          overviewGrid: null,
          dataUpdatedAt: dataUpdatedAt ?? null,
        };
        const nextVisible = [...prev.visibleDatasets, entry];
        return {
          ...prev,
          collectionScopeId: null,
          collectionScopeIds: null,
          collectionNavigation: null,
          collectionNavigationError: null,
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
        collectionScopeId: null,
        collectionScopeIds: null,
        collectionNavigation: null,
        collectionNavigationError: null,
        selectedIds: nextSelectedIds,
        selectedSources: nextSelectedSources,
        multiDatasetMode: true,
      };
    }),

  addSelected: (datasetId, source, dataUpdatedAt) =>
    set((prev) => {
      // Already selected — just update source and activate if room.
      const alreadySelected = prev.selectedIds.includes(datasetId);
      const alreadyVisible = prev.visibleDatasets.some((v) => v.datasetId === datasetId);

      const nextSelectedIds = alreadySelected
        ? prev.selectedIds
        : [...prev.selectedIds, datasetId];
      const nextSelectedSources = { ...prev.selectedSources, [datasetId]: source };

      if (!alreadyVisible && prev.visibleDatasets.length < getActiveCap()) {
        // Room available — activate immediately.
        const entry: VisibleDataset = {
          datasetId,
          source,
          activeGrid: null,
          overviewGrid: null,
          dataUpdatedAt: dataUpdatedAt ?? null,
        };
        const nextVisible = [...prev.visibleDatasets, entry];
        return {
          ...prev,
          collectionScopeId: null,
          collectionScopeIds: null,
          collectionNavigation: null,
          collectionNavigationError: null,
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
        collectionScopeId: null,
        collectionScopeIds: null,
        collectionNavigation: null,
        collectionNavigationError: null,
        selectedIds: nextSelectedIds,
        selectedSources: nextSelectedSources,
        multiDatasetMode: true,
      };
    }),

  activateCollection: (entries) => {
    // Collection members replace the prior proximity pool. Retain requests for
    // any member that remains relevant across the handoff.
    cancelObsoleteProximityRequests(entries.map((entry) => entry.datasetId));
    set((prev) => {
      const seen = new Set<string>();
      const unique = entries.filter((entry) => {
        if (!entry.datasetId || seen.has(entry.datasetId)) return false;
        seen.add(entry.datasetId);
        return true;
      });
      const oldById = new Map(prev.visibleDatasets.map((entry) => [entry.datasetId, entry]));
      const visibleDatasets = unique.map((entry) => {
        const previous = oldById.get(entry.datasetId);
        return {
          datasetId: entry.datasetId,
          source: entry.source,
          // Collection activation is preview-first. A member that was
          // previously active must not silently bring full terrain back into
          // the 3D scene before the user selects it from Overview.
          activeGrid: null,
          overviewGrid: previous?.overviewGrid ?? null,
          dataUpdatedAt: entry.dataUpdatedAt ?? previous?.dataUpdatedAt ?? null,
          geoCorrection: previous?.geoCorrection ?? null,
        };
      });
      const selectedIds = unique.map((entry) => entry.datasetId);
      const selectedSources = Object.fromEntries(
        unique.map((entry) => [entry.datasetId, entry.source]),
      );
      return {
        ...prev,
        visibleDatasets,
        collectionScopeIds: unique.map((entry) => entry.datasetId),
        pendingPrimaryHandoffId: null,
        collectionNavigation: null,
        collectionNavigationError: null,
        selectedIds,
        selectedSources,
        multiDatasetMode: true,
        evictedId: null,
        autoEvictedId: null,
        ...syncPrimaryGrids(visibleDatasets),
      };
    });
  },

  setCollectionScope: (collectionId, datasetIds) => {
    const scopeIds = [...new Set(datasetIds.filter(Boolean))];
    // This runs before activateCollection so obsolete proximity fetches stop as
    // soon as the collection selection starts, not after its members render.
    cancelObsoleteProximityRequests(scopeIds);
    set((prev) => ({
      ...prev,
      collectionScopeId: collectionId,
      collectionScopeIds: scopeIds,
      collectionNavigation: null,
      collectionNavigationError: null,
    }));
  },

  requestCollectionNavigation: (datasetId, lon, lat) =>
    set((prev) => {
      if (
        prev.collectionScopeId === null ||
        !prev.collectionScopeIds?.includes(datasetId) ||
        !Number.isFinite(lon) ||
        !Number.isFinite(lat)
      ) {
        return prev;
      }
      return {
        ...prev,
        collectionNavigationSequence: prev.collectionNavigationSequence + 1,
        collectionNavigation: {
          requestId: prev.collectionNavigationSequence + 1,
          datasetId,
          lon,
          lat,
        },
        collectionNavigationError: null,
      };
    }),

  retryCollectionNavigation: () =>
    set((prev) => {
      const pending = prev.collectionNavigation;
      if (!pending) return prev;
      return {
        ...prev,
        collectionNavigationSequence: prev.collectionNavigationSequence + 1,
        collectionNavigation: {
          ...pending,
          requestId: prev.collectionNavigationSequence + 1,
        },
        collectionNavigationError: null,
      };
    }),

  completeCollectionNavigation: (requestId) =>
    set((prev) =>
      prev.collectionNavigation?.requestId === requestId
        ? { ...prev, collectionNavigation: null, collectionNavigationError: null }
        : prev,
    ),

  failCollectionNavigation: (requestId, message) =>
    set((prev) =>
      prev.collectionNavigation?.requestId === requestId
        ? { ...prev, collectionNavigationError: message }
        : prev,
    ),

  addCollectionMembers: (entries) =>
    set((prev) => {
      // A retry that completes after the user has started another selection
      // must not resurrect the old collection or broaden the new selection.
      if (prev.collectionScopeIds === null) return prev;
      const existingIds = new Set(prev.visibleDatasets.map((entry) => entry.datasetId));
      const seen = new Set<string>();
      const additions = entries.filter((entry) => {
        if (!entry.datasetId || existingIds.has(entry.datasetId) || seen.has(entry.datasetId)) {
          return false;
        }
        seen.add(entry.datasetId);
        return true;
      });
      if (additions.length === 0) return prev;

      const additionsAsVisible: VisibleDataset[] = additions.map((entry) => ({
        datasetId: entry.datasetId,
        source: entry.source,
        activeGrid: null,
        overviewGrid: null,
        dataUpdatedAt: entry.dataUpdatedAt ?? null,
      }));
      const visibleDatasets = [...prev.visibleDatasets, ...additionsAsVisible];
      const selectedIds = [
        ...prev.selectedIds,
        ...additionsAsVisible
          .map((entry) => entry.datasetId)
          .filter((id) => !prev.selectedIds.includes(id)),
      ];
      const selectedSources = {
        ...prev.selectedSources,
        ...Object.fromEntries(additions.map((entry) => [entry.datasetId, entry.source])),
      };
      const collectionScopeIds = [
        ...prev.collectionScopeIds,
        ...additions
          .map((entry) => entry.datasetId)
          .filter((id) => !prev.collectionScopeIds!.includes(id)),
      ];
      return {
        ...prev,
        visibleDatasets,
        collectionScopeIds,
        selectedIds,
        selectedSources,
        multiDatasetMode: true,
        ...syncPrimaryGrids(visibleDatasets),
      };
    }),

  addSelectedToPool: (datasetId, source) =>
    set((prev) => {
      // Already in pool — update source but do not activate.
      const alreadySelected = prev.selectedIds.includes(datasetId);
      return {
        ...prev,
        selectedIds: alreadySelected
          ? prev.selectedIds
          : [...prev.selectedIds, datasetId],
        selectedSources: { ...prev.selectedSources, [datasetId]: source },
        // Intentionally does NOT add to visibleDatasets or set multiDatasetMode.
        // Activation is deferred entirely to the proximity streaming hook.
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
      // Cap is enforced here — callers cannot exceed the active cap regardless
      // of call ordering or timing. Re-reading visibleDatasets.length inside the
      // functional updater ensures concurrent calls each see up-to-date state.
      const activeCap = getActiveCap();
      if (prev.visibleDatasets.length >= activeCap) return prev;
      const source = prev.selectedSources[datasetId] ?? "preset";
      const entry: VisibleDataset = {
        datasetId,
        source,
        activeGrid: null,
        overviewGrid: null,
      };
      const nextVisible = [...prev.visibleDatasets, entry];
      if (process.env.NODE_ENV === "development") {
        console.assert(
          nextVisible.length <= activeCap,
          `[terrainStore] autoActivate: visibleDatasets exceeded cap (${nextVisible.length} > ${activeCap})`,
        );
      }
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
      if (process.env.NODE_ENV === "development") {
        const cap = getActiveCap();
        console.assert(
          nextVisible.length <= cap,
          `[terrainStore] autoEvict: visibleDatasets exceeded cap (${nextVisible.length} > ${cap})`,
        );
      }
      return {
        ...prev,
        visibleDatasets: nextVisible,
        autoEvictedId: datasetId,
        ...syncPrimaryGrids(nextVisible),
      };
    }),

  setSinglePrimary: (datasetId, source) => {
    // A normal replace selection makes every other proximity result obsolete.
    cancelObsoleteProximityRequests([datasetId]);
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
        collectionScopeId: null,
        collectionScopeIds: null,
        collectionNavigation: null,
        collectionNavigationError: null,
        visibleDatasets: nextVisible,
        pendingPrimaryHandoffId: null,
        selectedIds: [],
        selectedSources: {},
        ...syncPrimaryGrids(nextVisible),
        multiDatasetMode: false,
        evictedId: null,
        autoEvictedId: null,
      };
    });
  },

  clear: () => {
    cancelObsoleteProximityRequests([]);
    set((prev) => ({
      visibleDatasets: [],
      primaryDatasetIds: [],
      primaryDatasetId: null,
      activeGrid: null,
      overviewGrid: null,
      evictedId: null,
      autoEvictedId: null,
      pendingPrimaryHandoffId: null,
      selectedIds: [],
      selectedSources: {},
      multiDatasetMode: false,
      collectionScopeId: null,
      collectionScopeIds: null,
      collectionNavigation: null,
      collectionNavigationError: null,
      collectionNavigationSequence: prev.collectionNavigationSequence + 1,
      overviewFetchErrorIds: [],
      datasetFetchErrorIds: [],
    }));
  },

  clearEviction: () =>
    set((prev) => (prev.evictedId === null ? prev : { ...prev, evictedId: null })),

  clearAutoEviction: () =>
    set((prev) => (prev.autoEvictedId === null ? prev : { ...prev, autoEvictedId: null })),

  clearPendingPrimaryHandoff: () =>
    set((prev) =>
      prev.pendingPrimaryHandoffId === null
        ? prev
        : { ...prev, pendingPrimaryHandoffId: null },
    ),

  setOverviewFetchError: (datasetId, hasError) =>
    set((prev) => {
      const had = prev.overviewFetchErrorIds.includes(datasetId);
      if (hasError === had) return prev; // no-op: state unchanged
      return {
        ...prev,
        overviewFetchErrorIds: hasError
          ? [...prev.overviewFetchErrorIds, datasetId]
          : prev.overviewFetchErrorIds.filter((id) => id !== datasetId),
      };
    }),

  setDatasetFetchError: (datasetId, hasError) =>
    set((prev) => {
      const had = prev.datasetFetchErrorIds.includes(datasetId);
      if (hasError === had) return prev;
      return {
        ...prev,
        datasetFetchErrorIds: hasError
          ? [...prev.datasetFetchErrorIds, datasetId]
          : prev.datasetFetchErrorIds.filter((id) => id !== datasetId),
      };
    }),
}));
