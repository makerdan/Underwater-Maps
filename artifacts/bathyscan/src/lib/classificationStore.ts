/**
 * classificationStore.ts — Zustand store for AI seafloor zone classification.
 *
 * Check order (fastest → most expensive):
 *   1. sessionStorage cache (keyed by grid content hash — instant)
 *   2. Server in-memory cache via GET /api/datasets/:id/zones (fast, no AI cost)
 *   3. Poe AI classify endpoint (3–8 s)
 *
 * Single-flight deduplication:
 *   A module-level Map<gridHash, Promise<void>> ensures that even if classify()
 *   is called twice for the same grid (DatasetPanel + App.tsx catch-all), only
 *   one AI call fires. Both callers await the same in-flight promise.
 *
 * Dataset guard:
 *   `currentDatasetId` is set at classify() entry. Every async checkpoint
 *   re-checks it before writing state, so stale responses from a prior dataset
 *   silently drop.
 */
import { create } from "zustand";
import { poeClassify } from "@workspace/api-client-react";
import type { TerrainData } from "@workspace/api-client-react";
import { gridToBase64Png } from "./gridToImage";
import { parseAndUpsampleZones, zoneMapToStorage, zoneMapFromStorage } from "./zoneMap";

// ---------------------------------------------------------------------------
// Grid hash — FNV-1a 32-bit over the depths float array
// Produces a hex string that changes whenever the depth values change,
// even when the datasetId stays the same (e.g. upload flows).
// ---------------------------------------------------------------------------

function hashGrid(depths: number[]): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < depths.length; i++) {
    const v = depths[i] ?? 0;
    // Spread the float's bits over 4 bytes via bit-manipulation
    const bits = Math.round(v * 1000) & 0xffffffff;
    h ^= (bits & 0xff);
    h = (Math.imul(h, 0x01000193) >>> 0);
    h ^= ((bits >>> 8) & 0xff);
    h = (Math.imul(h, 0x01000193) >>> 0);
    h ^= ((bits >>> 16) & 0xff);
    h = (Math.imul(h, 0x01000193) >>> 0);
    h ^= ((bits >>> 24) & 0xff);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const SESSION_KEY_PREFIX = "bszone-";

/** Build a sessionStorage key that is unique to the grid's content (hash). */
function sessionKey(gridHash: string): string {
  return `${SESSION_KEY_PREFIX}${gridHash}`;
}

// ---------------------------------------------------------------------------
// Single-flight deduplication — prevents duplicate AI calls when two callers
// (DatasetPanel + App.tsx catch-all) both invoke classify() before the first
// resolves.
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<void>>();

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

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

  classify: (grid: TerrainData): Promise<void> => {
    const { datasetId, waterType } = grid;
    const targetN = grid.resolution ?? grid.width ?? 256;
    const wt = waterType as "saltwater" | "freshwater";
    const gridHash = hashGrid(grid.depths);
    const cacheKey = sessionKey(gridHash);

    // 1. sessionStorage — synchronous, no spinner, no dedup needed
    try {
      const stored = sessionStorage.getItem(cacheKey);
      if (stored) {
        const zoneMap = zoneMapFromStorage(stored);
        set({ zoneMap, loading: false, error: null, currentDatasetId: datasetId });
        return Promise.resolve();
      }
    } catch {
      // sessionStorage unavailable (strict incognito, etc.)
    }

    // 2+3. Async path — deduplicate by gridHash so both callers share one fetch
    const existing = inFlight.get(cacheKey);
    if (existing) return existing;

    // Mark this dataset as in-progress BEFORE the async work starts
    set({ loading: true, error: null, zoneMap: null, currentDatasetId: datasetId });

    const work = (async () => {
      try {
        // 2. Server in-memory cache — cheap, no AI cost
        try {
          const resp = await fetch(`/api/datasets/${encodeURIComponent(datasetId)}/zones`, {
            credentials: "include",
          });
          if (resp.ok) {
            const data = (await resp.json()) as { zones: string[]; waterType: string };
            // Guard: user switched dataset while we were fetching
            if (get().currentDatasetId !== datasetId) return;

            const zoneMap = parseAndUpsampleZones(data.zones, wt, targetN);
            try { sessionStorage.setItem(cacheKey, zoneMapToStorage(zoneMap)); } catch {}
            set({ zoneMap, loading: false, error: null });
            return;
          }
        } catch {
          // Server cache miss or network error — fall through to AI
        }

        // Guard before kicking off the expensive AI call
        if (get().currentDatasetId !== datasetId) return;

        // 3. Poe AI classification
        const gridBase64 = gridToBase64Png(grid);
        const result = await poeClassify({ gridBase64, waterType: wt, datasetId });

        // Guard: user switched dataset during the AI call
        if (get().currentDatasetId !== datasetId) return;

        const zoneMap = parseAndUpsampleZones(result.zones, wt, targetN);
        try { sessionStorage.setItem(cacheKey, zoneMapToStorage(zoneMap)); } catch {}
        set({ zoneMap, loading: false, error: null });
      } catch (err) {
        if (get().currentDatasetId !== datasetId) return;
        const message = err instanceof Error ? err.message : "Classification failed";
        console.warn("[BathyScan] AI classification failed:", message);
        set({ loading: false, error: message, zoneMap: null });
      }
    })();

    // Register the promise so parallel callers join it; clean up when done
    inFlight.set(cacheKey, work);
    void work.finally(() => inFlight.delete(cacheKey));

    return work;
  },
}));
