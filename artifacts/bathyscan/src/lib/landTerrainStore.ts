import { create } from "zustand";

/**
 * Above-water land elevation grid fetched from the Copernicus DEM 90 m
 * endpoint (`/api/terrain/land`).
 *
 * Values in `elevation` are metres above sea level (>= 0). Water cells are 0.
 * Row-major, top-to-bottom (north→south), left-to-right (west→east) — the
 * same orientation as the bathymetric `depths` grid so the two meshes share
 * the same vertex layout and meet cleanly at the waterline.
 */
export interface LandGrid {
  elevation: number[];
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

interface LandTerrainStore {
  /** Current land elevation grid, or null while unloaded / loading. */
  landGrid: LandGrid | null;
  /** True while the network request is in flight. */
  isLoading: boolean;
  /** Error message from the last failed fetch. */
  error: string | null;
  /**
   * Incremented each time the user clicks "Retry". The useLandTerrain hook
   * watches this value so a bump re-triggers the fetch for the current bbox
   * even when the bbox itself hasn't changed.
   */
  retryCount: number;

  setLandGrid: (grid: LandGrid | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /** Reset to the initial empty state (called when the active dataset changes). */
  clear: () => void;
  /** Increment retryCount to signal useLandTerrain to re-fetch. */
  retry: () => void;
}

export const useLandTerrainStore = create<LandTerrainStore>((set) => ({
  landGrid: null,
  isLoading: false,
  error: null,
  retryCount: 0,

  setLandGrid: (grid) => set({ landGrid: grid, isLoading: false, error: null }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error, isLoading: false }),
  clear: () => set({ landGrid: null, isLoading: false, error: null }),
  retry: () => set((s) => ({ retryCount: s.retryCount + 1, error: null })),
}));
