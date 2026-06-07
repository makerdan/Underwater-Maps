import { create } from "zustand";

/**
 * Holds the USGS hillshaded terrain texture URL for the currently loaded dataset.
 *
 * The URL is an `object URL` (blob:) created from the PNG buffer returned by
 * `/api/terrain/terrain-tile`. It is revoked and replaced whenever a new bbox
 * is loaded so there are no memory leaks.
 *
 * Draw order in OverviewMap: terrain (bottom) → heatmap → satellite (top).
 */
interface TerrainTileStore {
  /** Object URL pointing to the PNG blob, or null while unloaded / loading. */
  tileUrl: string | null;
  /** True while the network request is in flight. */
  isLoading: boolean;
  /** Error message from the last failed fetch, or null. */
  error: string | null;
  /**
   * The bbox+size key for the tile currently in the store (or being fetched).
   * Persists across remounts of the OverviewMap component so that toggling
   * the map closed/open with the same dataset does not trigger a second fetch.
   */
  bboxKey: string;

  setTileUrl: (url: string | null, bboxKey: string) => void;
  setLoading: (loading: boolean, bboxKey: string) => void;
  setError: (error: string | null) => void;
  /** Reset to the initial empty state (called when terrain is toggled off or bbox changes). */
  clear: () => void;
}

export const useTerrainTileStore = create<TerrainTileStore>((set) => ({
  tileUrl: null,
  isLoading: false,
  error: null,
  bboxKey: "",

  setTileUrl: (url, bboxKey) => set({ tileUrl: url, isLoading: false, error: null, bboxKey }),
  setLoading: (loading, bboxKey) => set({ isLoading: loading, bboxKey }),
  setError: (error) => set({ error, isLoading: false }),
  clear: () => set({ tileUrl: null, isLoading: false, error: null, bboxKey: "" }),
}));
