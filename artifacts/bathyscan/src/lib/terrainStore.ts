import { create } from "zustand";
import type { TerrainData } from "@workspace/api-client-react";

interface TerrainStore {
  activeGrid: TerrainData | null;
  overviewGrid: TerrainData | null;
  setGrids: (grids: {
    activeGrid?: TerrainData | null;
    overviewGrid?: TerrainData | null;
  }) => void;
}

export const useTerrainStore = create<TerrainStore>((set) => ({
  activeGrid: null,
  overviewGrid: null,
  setGrids: ({ activeGrid, overviewGrid }) =>
    set((prev) => ({
      activeGrid: activeGrid !== undefined ? activeGrid : prev.activeGrid,
      overviewGrid: overviewGrid !== undefined ? overviewGrid : prev.overviewGrid,
    })),
}));
