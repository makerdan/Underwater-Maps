/**
 * puzzleStore.ts — Zustand store that mirrors the puzzle-mode state from
 * OverviewMap into the 3D scene so MarkerLayer can position markers relative
 * to their puzzle tile.
 *
 * OverviewMap is the authoritative source; it writes here via useEffect.
 * MarkerLayer reads here — no React prop drilling needed.
 *
 * No persistence: OverviewMap already owns sessionStorage for transforms.
 */
import { create } from "zustand";
import type { TerrainData } from "@workspace/api-client-react";
import type { OverviewTransform } from "./overviewRenderer";

export interface PuzzleTransform {
  tx: number;
  ty: number;
  angleDeg: number;
  flipH: boolean;
  flipV: boolean;
}

interface PuzzleStoreState {
  puzzleMode: boolean;
  /** Per-dataset spatial offsets (canvas pixels) — keyed by datasetId. */
  puzzleTransforms: Record<string, PuzzleTransform>;
  /**
   * Current pan/zoom state of the overview canvas — required by
   * applyPuzzleTransformToLonLat to convert canvas-pixel offsets to lon/lat.
   */
  overviewTransform: OverviewTransform | null;
  /**
   * The reference grid used by the overview canvas (union bbox of all visible
   * datasets when multiple are loaded; primary overviewGrid otherwise).
   * Only the bbox fields are meaningful — depth arrays are not populated.
   */
  worldGrid: TerrainData | null;

  setPuzzleMode: (mode: boolean) => void;
  setPuzzleTransforms: (transforms: Record<string, PuzzleTransform>) => void;
  setOverviewTransform: (t: OverviewTransform | null) => void;
  setWorldGrid: (grid: TerrainData | null) => void;
  clear: () => void;
}

export const usePuzzleStore = create<PuzzleStoreState>()((set) => ({
  puzzleMode: false,
  puzzleTransforms: {},
  overviewTransform: null,
  worldGrid: null,

  setPuzzleMode: (mode) => set({ puzzleMode: mode }),
  setPuzzleTransforms: (transforms) => set({ puzzleTransforms: transforms }),
  setOverviewTransform: (t) => set({ overviewTransform: t }),
  setWorldGrid: (grid) => set({ worldGrid: grid }),
  clear: () =>
    set({ puzzleMode: false, puzzleTransforms: {}, overviewTransform: null, worldGrid: null }),
}));
