import { useEffect, useRef } from "react";
import { useTerrainTileStore } from "@/lib/terrainTileStore";

interface Bbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/**
 * Fetches a USGS hillshaded terrain tile from `/api/terrain/terrain-tile` for
 * the given bounding box and stores the resulting object URL in
 * `useTerrainTileStore`.
 *
 * - The store's `bboxKey` persists across OverviewMap remounts: if the component
 *   is torn down and re-mounted with the same bbox (e.g. user closes and reopens
 *   the Overview Map), the hook detects the match and skips the network request.
 * - When bbox changes the previous object URL is revoked before the new fetch.
 * - Pass `bbox = null` (when `terrainImagery` is off) to clear the store
 *   without making any network request.
 */
export function useTerrainTile(bbox: Bbox | null, tileSize = 512): void {
  const abortRef = useRef<AbortController | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const { setLoading, clear, setTileUrl, setError, bboxKey: storedKey, tileUrl: storedUrl } =
      useTerrainTileStore.getState();

    if (!bbox) {
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = null;
      }
      clear();
      return;
    }

    const bboxKey = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat},${tileSize}`;

    // If the store already has (or is fetching) the same bbox, reuse it.
    // This covers the case where OverviewMap unmounts and remounts with the
    // same dataset — no second HTTP request fires.
    if (bboxKey === storedKey && (storedUrl || useTerrainTileStore.getState().isLoading)) {
      // Sync the prevUrlRef so we hold a reference for cleanup on unmount.
      if (storedUrl) prevUrlRef.current = storedUrl;
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    clear();
    setLoading(true, bboxKey);

    const bboxParam = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
    const url = `/api/terrain/terrain-tile?bbox=${encodeURIComponent(bboxParam)}&size=${tileSize}`;

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
        prevUrlRef.current = objectUrl;
        setTileUrl(objectUrl, bboxKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.warn(`[useTerrainTile] fetch failed: ${msg}`);
        setError(msg);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bbox, tileSize]);
}
