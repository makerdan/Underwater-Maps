import { useEffect, useRef } from "react";
import { useSatelliteTileStore } from "@/lib/satelliteTileStore";
import { getPersistentTile, putPersistentTile } from "@/lib/tileCache";

interface Bbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

const CACHE_NAME = "bathyscan-satellite-tiles";
const CACHE_MAX = 6;

/** L1 module-level LRU: bboxKey → object URL. Survives within a page session. */
const satelliteTileCache = new Map<string, string>();

function lruGet(key: string): string | undefined {
  const url = satelliteTileCache.get(key);
  if (url === undefined) return undefined;
  satelliteTileCache.delete(key);
  satelliteTileCache.set(key, url);
  return url;
}

function lruPut(key: string, url: string): void {
  if (satelliteTileCache.has(key)) {
    satelliteTileCache.delete(key);
  } else if (satelliteTileCache.size >= CACHE_MAX) {
    const oldest = satelliteTileCache.keys().next().value as string;
    URL.revokeObjectURL(satelliteTileCache.get(oldest)!);
    satelliteTileCache.delete(oldest);
  }
  satelliteTileCache.set(key, url);
}

/**
 * Fetches a satellite imagery tile from `/api/terrain/satellite-tile` for
 * the given bounding box and stores the resulting object URL in
 * `useSatelliteTileStore`.
 *
 * Cache hierarchy:
 *   L1  — module-level LRU (up to 6 object URLs, survives within a page session)
 *   L2  — browser Cache API (persists across page reloads, 24 h TTL)
 *   L3  — network fetch from /api/terrain/satellite-tile
 *
 * - On failure the store's `error` field is set and `tileUrl` remains null,
 *   letting `LandTerrainMesh` fall back to its procedural colour ramp.
 * - `tileSize` controls the texture resolution — 512 gives a sharp result for
 *   most coastal extents; 256 is used for larger bounding boxes where the ESRI
 *   source data resolution is the limiting factor anyway.
 * - Pass `bbox = null` (when satellite imagery is off) to clear the store
 *   without making any network request.
 */
export function useSatelliteTile(bbox: Bbox | null, tileSize = 512): void {
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const { setLoading, clear, setTileUrl, setError, bboxKey: storedKey, tileUrl: storedUrl } =
      useSatelliteTileStore.getState();

    if (!bbox) {
      clear();
      return;
    }

    const bboxKey = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat},${tileSize}`;

    // Store already has (or is fetching) the same bbox — reuse without fetching.
    if (bboxKey === storedKey && (storedUrl || useSatelliteTileStore.getState().isLoading)) {
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

    (async () => {
      // L2: check the persistent Cache API before hitting the network.
      const persistedBlob = await getPersistentTile(CACHE_NAME, bboxKey);
      if (cancelled) return;

      if (persistedBlob) {
        const objectUrl = URL.createObjectURL(persistedBlob);
        lruPut(bboxKey, objectUrl);
        setTileUrl(objectUrl, bboxKey);
        return;
      }

      // L3: fetch from the network.
      const bboxParam = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
      const url = `/api/terrain/satellite-tile?bbox=${encodeURIComponent(bboxParam)}&size=${tileSize}`;

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        if (cancelled) return;

        // Persist to L2 (fire-and-forget; errors are swallowed inside putPersistentTile).
        putPersistentTile(CACHE_NAME, bboxKey, blob).catch(() => undefined);

        const objectUrl = URL.createObjectURL(blob);
        lruPut(bboxKey, objectUrl);
        setTileUrl(objectUrl, bboxKey);
      } catch (err: unknown) {
        if (cancelled) return;
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.warn(`[useSatelliteTile] fetch failed: ${msg}`);
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bbox, tileSize]);
}
