import { useState, useRef, useCallback } from "react";
import type { OverviewTransform } from "@/lib/overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Hook that auto-upscales the 2D heatmap via Topaz Labs on Poe when the
 * rendered grid is coarser than the canvas resolution warrants.
 *
 * Trigger condition (both must hold):
 *   1. `transform.scale < 4` — imageSmoothing is enabled in renderHeatmap
 *   2. pixelsPerCell > 2 — each data cell occupies several canvas pixels
 *
 * Upscale factor:
 *   - pixelsPerCell > 4 → 4×
 *   - pixelsPerCell > 2 → 2×
 *
 * Concurrent requests are suppressed via `inFlightRef`. Requests for the same
 * transform key (scale + offset + factor) are skipped. Errors fall back
 * silently — the original bitmap remains visible.
 */
export function useUpscaledHeatmap() {
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaledBitmap, setUpscaledBitmap] = useState<HTMLImageElement | null>(null);
  const inFlightRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);

  const invalidate = useCallback(() => {
    setUpscaledBitmap(null);
    lastKeyRef.current = null;
  }, []);

  const requestUpscaleIfNeeded = useCallback(
    async (
      canvas: HTMLCanvasElement,
      transform: OverviewTransform,
      grid: TerrainData,
    ) => {
      const lonRange = grid.maxLon - grid.minLon || 1;
      const latRange = grid.maxLat - grid.minLat || 1;
      const terrainW = transform.pxPerDeg * lonRange * transform.scale;
      const terrainH = transform.pxPerDeg * latRange * transform.scale;
      const pixelsPerCellW = terrainW / (grid.width || 1);
      const pixelsPerCellH = terrainH / (grid.height || 1);
      const pixelsPerCell = Math.min(pixelsPerCellW, pixelsPerCellH);

      const imageSmoothingEnabled = transform.scale < 4;
      if (!imageSmoothingEnabled || pixelsPerCell <= 2) {
        return;
      }

      const factor: 2 | 4 = pixelsPerCell > 4 ? 4 : 2;
      const key = `${transform.scale.toFixed(2)}_${transform.offsetX.toFixed(0)}_${transform.offsetY.toFixed(0)}_${factor}`;
      if (inFlightRef.current || lastKeyRef.current === key) return;

      inFlightRef.current = true;
      lastKeyRef.current = key;
      setIsUpscaling(true);

      try {
        const imageBase64 = canvas.toDataURL("image/png");
        const response = await fetch(`${API_BASE}/api/poe/upscale`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64, upscaleFactor: factor }),
          credentials: "include",
        });

        if (!response.ok) {
          console.warn(`[upscale] Poe upscale failed: HTTP ${response.status}`);
          lastKeyRef.current = null;
          return;
        }

        const data = (await response.json()) as { imageBase64?: string };
        if (!data.imageBase64) return;

        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = data.imageBase64!.startsWith("data:")
            ? data.imageBase64!
            : `data:image/png;base64,${data.imageBase64!}`;
        });

        setUpscaledBitmap(img);
      } catch (err) {
        console.warn("[upscale] Upscale error (silent fallback):", err);
        lastKeyRef.current = null;
      } finally {
        inFlightRef.current = false;
        setIsUpscaling(false);
      }
    },
    [],
  );

  return { isUpscaling, upscaledBitmap, requestUpscaleIfNeeded, invalidate };
}
