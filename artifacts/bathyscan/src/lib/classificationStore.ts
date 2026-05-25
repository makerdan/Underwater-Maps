/**
 * classificationStore.ts — Zustand store for AI seafloor zone classification.
 *
 * Calls /poe/classify with a base64 PNG of the depth grid,
 * caches the result in sessionStorage, and exposes the parsed zoneMap
 * (Uint8Array, one index per terrain vertex) for TerrainMesh to consume.
 */
import { create } from "zustand";
import { poeClassify } from "@workspace/api-client-react";
import type { TerrainData } from "@workspace/api-client-react";
import { gridToBase64Png } from "./gridToImage";
import { parseAndUpsampleZones, zoneMapToStorage, zoneMapFromStorage } from "./zoneMap";

const SESSION_KEY_PREFIX = "bszone-";

interface ClassificationState {
  zoneMap: Uint8Array | null;
  loading: boolean;
  error: string | null;

  classify: (grid: TerrainData) => Promise<void>;
  clearZoneMap: () => void;
}

export const useClassificationStore = create<ClassificationState>((set) => ({
  zoneMap: null,
  loading: false,
  error: null,

  clearZoneMap: () => set({ zoneMap: null, error: null }),

  classify: async (grid: TerrainData) => {
    const cacheKey = SESSION_KEY_PREFIX + grid.datasetId;

    // Check sessionStorage cache first
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const zoneMap = zoneMapFromStorage(cached);
        set({ zoneMap, loading: false, error: null });
        return;
      }
    } catch {
      // sessionStorage unavailable — proceed without cache
    }

    set({ loading: true, error: null, zoneMap: null });

    try {
      const gridBase64 = gridToBase64Png(grid);

      const result = await poeClassify({
        gridBase64,
        waterType: grid.waterType as "saltwater" | "freshwater",
        datasetId: grid.datasetId,
      });

      const targetN = grid.resolution ?? grid.width ?? 256;
      const zoneMap = parseAndUpsampleZones(result.zones, grid.waterType as "saltwater" | "freshwater", targetN);

      // Cache in sessionStorage
      try {
        sessionStorage.setItem(cacheKey, zoneMapToStorage(zoneMap));
      } catch {
        // quota exceeded or unavailable — skip caching
      }

      set({ zoneMap, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Classification failed";
      console.warn("[BathyScan] AI classification failed:", message);
      set({ loading: false, error: message, zoneMap: null });
    }
  },
}));
