import { create } from "zustand";

/**
 * Holds the satellite imagery texture URL for the currently loaded land terrain.
 *
 * The URL is an `object URL` (blob:) created from the PNG buffer returned by
 * `/api/terrain/satellite-tile`. It is revoked and replaced whenever a new
 * bbox is loaded so there are no memory leaks.
 */
interface SatelliteTileStore {
  /** Object URL pointing to the PNG blob, or null while unloaded / loading. */
  tileUrl: string | null;
  /** True while the network request is in flight. */
  isLoading: boolean;
  /** Error message from the last failed fetch, or null. */
  error: string | null;

  setTileUrl: (url: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /** Reset to the initial empty state (called when the active dataset changes). */
  clear: () => void;
}

export const useSatelliteTileStore = create<SatelliteTileStore>((set) => ({
  tileUrl: null,
  isLoading: false,
  error: null,

  setTileUrl: (url) => set({ tileUrl: url, isLoading: false, error: null }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error, isLoading: false }),
  clear: () => set({ tileUrl: null, isLoading: false, error: null }),
}));
