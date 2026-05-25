/**
 * classificationStore.ts — Zustand store for AI seafloor zone classification.
 *
 * Check order (fastest → most expensive):
 *   1. sessionStorage cache (keyed by datasetId + resolution — instant)
 *   2. Server in-memory cache via GET /api/poe/zones/:id (fast, no AI cost)
 *   3. Poe AI classify endpoint (3–8 s)
 *
 * A dataset guard (`currentDatasetId`) prevents stale AI responses from a
 * previous dataset overwriting the current zoneMap when the user switches
 * datasets quickly.
 */
import { create } from "zustand";
import { poeClassify } from "@workspace/api-client-react";
import type { TerrainData } from "@workspace/api-client-react";
import { gridToBase64Png } from "./gridToImage";
import { parseAndUpsampleZones, zoneMapToStorage, zoneMapFromStorage } from "./zoneMap";

const SESSION_KEY_PREFIX = "bszone-";

/** Build a sessionStorage key that is unique to both the dataset AND its resolution. */
function sessionKey(datasetId: string, resolution: number): string {
  return `${SESSION_KEY_PREFIX}${datasetId}-${resolution}`;
}

interface ClassificationState {
  zoneMap: Uint8Array | null;
  loading: boolean;
  error: string | null;
  /** datasetId of the in-flight or last-completed classification — used as a guard. */
  currentDatasetId: string | null;

  classify: (grid: TerrainData) => Promise<void>;
  clearZoneMap: () => void;
}

export const useClassificationStore = create<ClassificationState>((set, get) => ({
  zoneMap: null,
  loading: false,
  error: null,
  currentDatasetId: null,

  clearZoneMap: () => set({ zoneMap: null, error: null, currentDatasetId: null }),

  classify: async (grid: TerrainData) => {
    const { datasetId, resolution, waterType } = grid;
    const targetN = resolution ?? grid.width ?? 256;
    const wt = waterType as "saltwater" | "freshwater";
    const cacheKey = sessionKey(datasetId, targetN);

    // 1. sessionStorage — synchronous, no loading spinner needed
    try {
      const stored = sessionStorage.getItem(cacheKey);
      if (stored) {
        const zoneMap = zoneMapFromStorage(stored);
        set({ zoneMap, loading: false, error: null, currentDatasetId: datasetId });
        return;
      }
    } catch {
      // sessionStorage unavailable (e.g. incognito with strict settings)
    }

    // Mark this dataset as the in-progress one
    set({ loading: true, error: null, zoneMap: null, currentDatasetId: datasetId });

    try {
      // 2. Server in-memory cache — cheap, hits globalPoeCache result
      try {
        const resp = await fetch(`/api/poe/zones/${encodeURIComponent(datasetId)}`, {
          credentials: "include",
        });
        if (resp.ok) {
          const data = (await resp.json()) as {
            zones: string[];
            waterType: string;
          };
          // Guard: did the user switch datasets while we were fetching?
          if (get().currentDatasetId !== datasetId) return;

          const zoneMap = parseAndUpsampleZones(data.zones, wt, targetN);
          try { sessionStorage.setItem(cacheKey, zoneMapToStorage(zoneMap)); } catch {}
          set({ zoneMap, loading: false, error: null });
          return;
        }
      } catch {
        // Server cache miss or unavailable — fall through to AI
      }

      // Guard before expensive AI call
      if (get().currentDatasetId !== datasetId) return;

      // 3. Poe AI classification
      const gridBase64 = gridToBase64Png(grid);

      const result = await poeClassify({
        gridBase64,
        waterType: wt,
        datasetId,
      });

      // Guard: did the user switch datasets during the AI call?
      if (get().currentDatasetId !== datasetId) return;

      const zoneMap = parseAndUpsampleZones(result.zones, wt, targetN);

      try { sessionStorage.setItem(cacheKey, zoneMapToStorage(zoneMap)); } catch {}
      set({ zoneMap, loading: false, error: null });
    } catch (err) {
      // Guard: don't stomp on a newer dataset's error state
      if (get().currentDatasetId !== datasetId) return;
      const message = err instanceof Error ? err.message : "Classification failed";
      console.warn("[BathyScan] AI classification failed:", message);
      set({ loading: false, error: message, zoneMap: null });
    }
  },
}));
