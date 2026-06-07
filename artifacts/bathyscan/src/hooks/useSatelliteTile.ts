import { useEffect, useRef } from "react";
import { useSatelliteTileStore } from "@/lib/satelliteTileStore";

interface Bbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

const CACHE_MAX = 6;

/** Module-level LRU: bboxKey → object URL. Persists across hook lifetimes. */
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
 * - A module-level LRU cache (up to 6 entries) keeps object URLs alive across
 *   store clears. Toggling satellite off and back on for the same bbox reuses
 *   the cached URL — no second HTTP round-trip fires.
 * - URLs are revoked only when they age out of the LRU (not on toggle-off or
 *   bbox change).
 * - The store's `bboxKey` also guards against duplicate fetches when the
 *   OverviewMap remounts with the same dataset.
 * - On failure the store's `error` field is set and `tileUrl` remains null,
 *   letting `LandTerrainMesh` fall back to its procedural colour ramp.
 *
 * `tileSize` controls the texture resolution — 512 gives a sharp result for
 * most coastal extents; 256 is used for larger bounding boxes where the ESRI
 * source data resolution is the limiting factor anyway.
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

    // LRU hit: restore from cache without a network request.
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

    const bboxParam = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
    const url = `/api/terrain/satellite-tile?bbox=${encodeURIComponent(bboxParam)}&size=${tileSize}`;

    let cancelled = false;

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        lruPut(bboxKey, objectUrl);
        setTileUrl(objectUrl, bboxKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.warn(`[useSatelliteTile] fetch failed: ${msg}`);
        setError(msg);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bbox, tileSize]);
}
