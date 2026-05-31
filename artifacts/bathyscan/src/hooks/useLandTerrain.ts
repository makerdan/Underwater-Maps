import { useEffect, useRef } from "react";
import { useLandTerrainStore } from "@/lib/landTerrainStore";
import type { LandGrid } from "@/lib/landTerrainStore";

interface Bbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/**
 * Fetches Copernicus DEM 90 m land elevation for the given bounding box.
 *
 * - Fires an async fetch to `/api/terrain/land` whenever `bbox` changes.
 * - Writes the result into `useLandTerrainStore` so `LandTerrainMesh` can
 *   consume it without prop drilling.
 * - The store is cleared (set to null) immediately when a new bbox is
 *   received so the old land mesh disappears while the new one loads.
 * - An in-flight fetch that becomes stale (bbox changed again) is ignored
 *   via an AbortController / stale-result check.
 *
 * Grid size defaults to 128×128 — coarser than the bathymetric mesh but
 * sufficient for 90 m Copernicus source data at typical coastal extents.
 */
export function useLandTerrain(bbox: Bbox | null, gridSize = 128): void {
  const abortRef = useRef<AbortController | null>(null);
  const bboxKeyRef = useRef<string>("");

  useEffect(() => {
    // Access Zustand actions via getState() — they are stable references so
    // they don't need to be reactive dependencies.
    const { setLoading, clear } = useLandTerrainStore.getState();

    if (!bbox) {
      // Reset bboxKey so the same bbox refetches reliably after a null phase.
      bboxKeyRef.current = "";
      clear();
      return;
    }

    const bboxKey = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat},${gridSize}`;

    // If the bbox hasn't changed, don't refetch.
    if (bboxKey === bboxKeyRef.current) return;
    bboxKeyRef.current = bboxKey;

    // Abort any in-flight request.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Clear the old grid immediately so stale land terrain doesn't flash.
    clear();
    setLoading(true);

    const bboxParam = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
    const url = `/api/terrain/land?bbox=${encodeURIComponent(bboxParam)}&size=${gridSize}`;

    let cancelled = false;

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as LandGrid;
        if (!cancelled) {
          useLandTerrainStore.getState().setLandGrid(data);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.warn(`[useLandTerrain] fetch failed: ${msg}`);
        useLandTerrainStore.getState().setError(msg);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bbox, gridSize]);
}
