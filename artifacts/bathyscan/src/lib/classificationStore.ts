/**
 * classificationStore.ts — Zustand store for AI seafloor zone classification.
 *
 * Check order (fastest → most expensive):
 *   1. sessionStorage cache (keyed by gridHash — instant)
 *   2. Server zone cache via GET /api/datasets/:id/zones?h=<gridHash> (fast, no AI cost)
 *   3. Poe AI classify endpoint (3–8 s)
 *
 * The gridHash (FNV-1a 32-bit of depths[]) is the primary cache key everywhere.
 * This prevents collisions when datasetId is reused (e.g. all anonymous uploads
 * share the synthetic id "upload"). Different grid content → different hash →
 * separate cache entries, both in sessionStorage and on the server.
 *
 * Single-flight deduplication:
 *   inFlight: Map<gridHash, Promise<void>> ensures parallel callers
 *   (DatasetPanel + App.tsx catch-all) share one fetch and one AI call.
 *
 * Dataset guard:
 *   currentDatasetId tracks the in-progress dataset. Every async checkpoint
 *   re-checks it before writing state so stale responses silently drop.
 */
import { create } from "zustand";
import { poeClassify } from "@workspace/api-client-react";
import type { TerrainData, PoeClassifyRequest } from "@workspace/api-client-react";
import { gridToBase64Png } from "./gridToImage";
import { parseAndUpsampleZones, zoneMapToStorage, zoneMapFromStorage } from "./zoneMap";

// ---------------------------------------------------------------------------
// Grid hash — FNV-1a 32-bit over the depths float array.
// This is the primary content-addressable key used by both client + server.
// ---------------------------------------------------------------------------

export function hashGrid(depths: number[]): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < depths.length; i++) {
    const bits = Math.round((depths[i] ?? 0) * 1000) & 0xffffffff;
    h ^= (bits & 0xff);               h = (Math.imul(h, 0x01000193) >>> 0);
    h ^= ((bits >>> 8) & 0xff);       h = (Math.imul(h, 0x01000193) >>> 0);
    h ^= ((bits >>> 16) & 0xff);      h = (Math.imul(h, 0x01000193) >>> 0);
    h ^= ((bits >>> 24) & 0xff);      h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const SESSION_KEY_PREFIX = "bszone-";

// Module-level single-flight map — keyed by gridHash
const inFlight = new Map<string, Promise<void>>();

interface ClassificationState {
  zoneMap: Uint8Array | null;
  loading: boolean;
  error: string | null;
  /** Hash of the grid currently being classified (or last successfully classified). */
  currentGridHash: string | null;

  classify: (grid: TerrainData) => Promise<void>;
  clearZoneMap: () => void;
}

export const useClassificationStore = create<ClassificationState>((set, get) => ({
  zoneMap: null,
  loading: false,
  error: null,
  currentGridHash: null,

  clearZoneMap: () => set({ zoneMap: null, error: null, currentGridHash: null }),

  classify: (grid: TerrainData): Promise<void> => {
    const { datasetId, waterType } = grid;
    const targetN = grid.resolution ?? grid.width ?? 256;
    const wt = waterType as "saltwater" | "freshwater";
    const gridHash = hashGrid(grid.depths);
    const sessionKey = `${SESSION_KEY_PREFIX}${gridHash}`;

    // 1. sessionStorage — synchronous, keyed by content hash
    try {
      const stored = sessionStorage.getItem(sessionKey);
      if (stored) {
        const zoneMap = zoneMapFromStorage(stored);
        set({ zoneMap, loading: false, error: null, currentGridHash: gridHash });
        return Promise.resolve();
      }
    } catch {
      // sessionStorage unavailable
    }

    // 2+3. Async path — deduplicate by gridHash
    const existing = inFlight.get(gridHash);
    if (existing) return existing;

    set({ loading: true, error: null, zoneMap: null, currentGridHash: gridHash });

    const work = (async () => {
      try {
        // 2. Server zone cache (memory + disk, keyed by gridHash)
        try {
          const url = `/api/datasets/${encodeURIComponent(datasetId)}/zones?h=${gridHash}`;
          const resp = await fetch(url, { credentials: "include" });
          if (resp.ok) {
            const data = (await resp.json()) as { zones: string[]; waterType: string };
            // Guard: only commit if this is still the active grid
            if (get().currentGridHash !== gridHash) return;
            const zoneMap = parseAndUpsampleZones(data.zones, wt, targetN);
            try { sessionStorage.setItem(sessionKey, zoneMapToStorage(zoneMap)); } catch {}
            set({ zoneMap, loading: false, error: null });
            return;
          }
        } catch {
          // Server cache miss — fall through to AI
        }

        if (get().currentGridHash !== gridHash) return;

        // 3. Poe AI — include gridHash so server can store by it
        const gridBase64 = gridToBase64Png(grid);
        const result = await poeClassify(
          { gridBase64, waterType: wt, datasetId, gridHash } as PoeClassifyRequest
        );

        if (get().currentGridHash !== gridHash) return;

        const zoneMap = parseAndUpsampleZones(result.zones, wt, targetN);
        try { sessionStorage.setItem(sessionKey, zoneMapToStorage(zoneMap)); } catch {}
        set({ zoneMap, loading: false, error: null });
      } catch (err) {
        if (get().currentGridHash !== gridHash) return;
        const message = err instanceof Error ? err.message : "Classification failed";
        console.warn("[BathyScan] AI classification failed:", message);
        set({ loading: false, error: message, zoneMap: null });
      }
    })();

    inFlight.set(gridHash, work);
    void work.finally(() => inFlight.delete(gridHash));
    return work;
  },
}));
