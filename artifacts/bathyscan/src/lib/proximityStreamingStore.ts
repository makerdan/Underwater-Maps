/**
 * proximityStreamingStore — lightweight Zustand slice for proximity streaming HUD state.
 *
 * Holds the three pieces of data the ProximityHudChip needs without
 * prop-drilling through DatasetPanel or modifying the R3F canvas:
 *
 *   loadingDatasetId — datasetId currently mid-fetch (spinner in HUD chip).
 *                      Set by DatasetPanel's handleProximityActivate before the
 *                      network call; cleared on success or failure.
 *
 *   distanceTableM   — per-datasetId Haversine distance to the camera in metres.
 *                      Updated by useDatasetProximityStreaming on every 500 ms tick
 *                      so the popover always reflects the current camera position.
 *
 *   nameMap          — datasetId → human-readable display name.
 *                      Written by DatasetPanel once catalog data resolves so the
 *                      popover can show survey names, not just raw IDs.
 */
import { create } from "zustand";

interface ProximityStreamingState {
  /** datasetId currently being network-fetched by proximity activation, or null. */
  loadingDatasetId: string | null;
  /** Per-dataset Haversine distance to camera in metres (undefined = no bbox / not computed). */
  distanceTableM: Record<string, number>;
  /** datasetId → display name (populated from catalog + user-dataset lists). */
  nameMap: Record<string, string>;

  setLoadingDatasetId: (id: string | null) => void;
  /** Merge-update the distance table (partial updates are safe). */
  updateDistanceTable: (table: Record<string, number>) => void;
  /** Merge-update the name map. */
  updateNameMap: (names: Record<string, string>) => void;
}

export const useProximityStreamingStore = create<ProximityStreamingState>((set) => ({
  loadingDatasetId: null,
  distanceTableM: {},
  nameMap: {},

  setLoadingDatasetId: (id) => set({ loadingDatasetId: id }),

  updateDistanceTable: (table) =>
    set((prev) => ({ distanceTableM: { ...prev.distanceTableM, ...table } })),

  updateNameMap: (names) =>
    set((prev) => ({ nameMap: { ...prev.nameMap, ...names } })),
}));
