import { useEffect, useRef } from "react";
import { useTerrainTileStore } from "@/lib/terrainTileStore";
import { getPersistentTile, putPersistentTile } from "@/lib/tileCache";

interface Bbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

const CACHE_NAME = "bathyscan-terrain-tiles";
const CACHE_MAX = 6;

/** L1 module-level LRU: bboxKey → object URL. Survives within a page session. */
const terrainTileCache = new Map<string, string>();

function lruGet(key: string): string | undefined {
  const url = terrainTileCache.get(key);
  if (url === undefined) return undefined;
  terrainTileCache.delete(key);
  terrainTileCache.set(key, url);
  return url;
}

function lruPut(key: string, url: string): void {
  const existing = terrainTileCache.get(key);
  if (existing !== undefined) {
    if (existing !== url) URL.revokeObjectURL(existing);
    terrainTileCache.delete(key);
  } else if (terrainTileCache.size >= CACHE_MAX) {
    const oldest = terrainTileCache.keys().next().value as string;
    URL.revokeObjectURL(terrainTileCache.get(oldest)!);
    terrainTileCache.delete(oldest);
  }
  terrainTileCache.set(key, url);
}

/**
 * Fetches a USGS hillshaded terrain tile from `/api/terrain/terrain-tile` for
 * the given bounding box and stores the resulting object URL in
 * `useTerrainTileStore`.
 *
 * Cache hierarchy:
 *   L1  — module-level LRU (up to 6 object URLs, survives within a page session)
 *   L2  — browser Cache API (persists across page reloads, 24 h TTL)
 *   L3  — network fetch from /api/terrain/terrain-tile
 *
 * - Pass `bbox = null` to clear the store
 *   without making any network request.
 */
export function useTerrainTile(bbox: Bbox | null, tileSize = 512): void {
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const { setLoading, clear, setTileUrl, setError, bboxKey: storedKey, tileUrl: storedUrl } =
      useTerrainTileStore.getState();

    if (!bbox) {
      clear();
      return;
    }

    const bboxKey = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat},${tileSize}`;

    // Store already has (or is fetching) the same bbox — reuse without fetching.
    if (bboxKey === storedKey && (storedUrl || useTerrainTileStore.getState().isLoading)) {
      return;
    }

    // L1 hit: restore from in-memory LRU without any async work.
    const cached = lruGet(bboxKey);
    if (cached) {
      clear();
      setTileUrl(cached, bboxKey);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    clear();
    setLoading(true, bboxKey);

    let cancelled = false;

    /**
     * Create an object URL for `blob` and publish it, unless the effect has
     * been cancelled — in which case the URL is revoked immediately so a
     * late-arriving fetch never leaks a blob URL for the session.
     */
    const publishTile = (blob: Blob): void => {
      const objectUrl = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      lruPut(bboxKey, objectUrl);
      setTileUrl(objectUrl, bboxKey);
    };

    (async () => {
      // L2: check the persistent Cache API before hitting the network.
      const persistedBlob = await getPersistentTile(CACHE_NAME, bboxKey);
      if (cancelled) return;

      if (persistedBlob) {
        publishTile(persistedBlob);
        return;
      }

      // L3: fetch from the network.
      const bboxParam = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
      const url = `/api/terrain/terrain-tile?bbox=${encodeURIComponent(bboxParam)}&size=${tileSize}`;

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        if (cancelled) return;

        // Persist to L2 (fire-and-forget; errors are swallowed inside putPersistentTile).
        putPersistentTile(CACHE_NAME, bboxKey, blob).catch(() => undefined);

        publishTile(blob);
      } catch (err: unknown) {
        if (cancelled) return;
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.warn(`[useTerrainTile] fetch failed: ${msg}`);
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bbox, tileSize]);
}
