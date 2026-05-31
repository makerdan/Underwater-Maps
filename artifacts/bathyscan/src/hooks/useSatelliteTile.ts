import { useEffect, useRef } from "react";
import { useSatelliteTileStore } from "@/lib/satelliteTileStore";

interface Bbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/**
 * Fetches a satellite imagery tile from `/api/terrain/satellite-tile` for
 * the given bounding box and stores the resulting object URL in
 * `useSatelliteTileStore`.
 *
 * - Fires whenever `bbox` changes; aborts in-flight requests that become stale.
 * - The previous object URL is revoked on each new fetch to avoid memory leaks.
 * - On failure the store's `error` field is set and `tileUrl` remains null,
 *   letting `LandTerrainMesh` fall back to its procedural colour ramp.
 *
 * `tileSize` controls the texture resolution — 512 gives a sharp result for
 * most coastal extents; 256 is used for larger bounding boxes where the ESRI
 * source data resolution is the limiting factor anyway.
 */
export function useSatelliteTile(bbox: Bbox | null, tileSize = 512): void {
  const abortRef = useRef<AbortController | null>(null);
  const bboxKeyRef = useRef<string>("");
  const prevUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const { setLoading, clear, setTileUrl, setError } =
      useSatelliteTileStore.getState();

    if (!bbox) {
      bboxKeyRef.current = "";
      // Revoke any previous object URL before clearing.
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = null;
      }
      clear();
      return;
    }

    const bboxKey = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat},${tileSize}`;
    if (bboxKey === bboxKeyRef.current) return;
    bboxKeyRef.current = bboxKey;

    // Abort any previous in-flight request.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Revoke the previous object URL and clear the store immediately so the
    // old satellite texture doesn't linger while the new one loads.
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    clear();
    setLoading(true);

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
        prevUrlRef.current = objectUrl;
        setTileUrl(objectUrl);
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
