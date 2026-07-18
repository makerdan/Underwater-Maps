import { useState, useRef, useCallback, useEffect } from "react";
import type { OverviewTransform } from "@/lib/overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";
import { authorizedFetch } from "@/lib/authorizedFetch";
import {
  idbGet,
  idbSet,
  idbDelete,
  initIdbCache,
  clearIdbStore,
  getIdbCacheInfo,
} from "@/lib/upscaleIdb";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Module-level cache — survives component unmount/remount within the session.
// Keyed by bitmapHash + "_" + upscaleFactor.
//
// Using the rendered pixel content as the key means any change that affects
// the heatmap image (new dataset, palette switch, depth recalculation) will
// produce a different hash and naturally miss the cache — no explicit
// invalidation of the module cache is needed.
// ---------------------------------------------------------------------------

const MAX_CACHE_ENTRIES = 20;
/**
 * In-memory byte cap: evict oldest entries when total estimated size
 * (base64 char length ≈ 1 byte) exceeds this limit even if count is below
 * MAX_CACHE_ENTRIES.  Prevents silent unbounded growth during long sessions
 * where only a few unique bitmaps are ever requested (so count stays low but
 * each entry is very large).
 */
const MAX_CACHE_BYTES = 10 * 1024 * 1024; // 10 MB
/**
 * Cap the total bytes loaded from IndexedDB on startup.  Matches the
 * exported MAX_IDB_BYTES constant from upscaleIdb but kept local here so
 * the hook does not import a constant-only symbol from the IDB module (which
 * would be stripped from the vi.mock() factory in unit tests).
 */
const MAX_IDB_LOAD_BYTES = 50 * 1024 * 1024; // 50 MB

const upscaleCache = new Map<string, HTMLImageElement>();
/** Parallel map tracking the estimated byte size (src char length) of each cache entry. */
const upscacheSrcLen = new Map<string, number>();
/** Running total of estimated bytes in the in-memory cache. */
let totalMemBytes = 0;

/**
 * Insert (or replace) an entry in the module-level cache and update the byte
 * size accounting.  Always call `evictIfNeeded` after inserting.
 */
function addToCache(key: string, img: HTMLImageElement, srcLen: number): void {
  const prev = upscacheSrcLen.get(key);
  if (prev !== undefined) totalMemBytes -= prev;
  upscaleCache.set(key, img);
  upscacheSrcLen.set(key, srcLen);
  totalMemBytes += srcLen;
}

/**
 * Evict the oldest entries until both the count and byte limits are satisfied.
 * Map preserves insertion order, so `keys().next()` is always the oldest entry.
 */
function evictIfNeeded(): void {
  while (upscaleCache.size > MAX_CACHE_ENTRIES || totalMemBytes > MAX_CACHE_BYTES) {
    const oldest = upscaleCache.keys().next().value;
    if (oldest === undefined) break;
    upscaleCache.delete(oldest);
    const evictedBytes = upscacheSrcLen.get(oldest) ?? 0;
    upscacheSrcLen.delete(oldest);
    totalMemBytes -= evictedBytes;
  }
}

/**
 * Snapshot of the in-memory cache: number of entries and estimated byte size.
 * Useful for diagnostics and E2E assertions without waiting for IDB.
 */
export function getInMemCacheStats(): { count: number; bytes: number } {
  return { count: upscaleCache.size, bytes: totalMemBytes };
}

/**
 * Return the number of entries and the approximate total byte size of the
 * IndexedDB upscale cache.  Size is estimated by summing the character length
 * of each `src` data URL (1 char ≈ 1 byte for base-64 ASCII).
 *
 * Returns `{ count: 0, bytes: 0 }` on any error so the UI degrades gracefully.
 */
export async function getUpscaleCacheInfo(): Promise<{ count: number; bytes: number }> {
  return getIdbCacheInfo();
}

/**
 * Clear every entry from both the module-level in-memory cache and the
 * IndexedDB store.  Useful when the user wants to free browser storage or
 * suspects a stale enhanced image is being shown.
 *
 * This is intentionally a module-level function (not inside the hook) so
 * Settings can call it without needing a hook instance mounted in the same
 * component tree.
 */
export async function clearUpscaleCache(): Promise<void> {
  upscaleCache.clear();
  upscacheSrcLen.clear();
  totalMemBytes = 0;
  await clearIdbStore();
}

/**
 * On module load: open IDB, prune entries older than TTL, and pre-populate the
 * in-memory cache from surviving entries so the first render hits the fast path.
 */
const idbReady: Promise<void> = initIdbCache(
  (key, src) => {
    const img = new Image();
    img.src = src;
    addToCache(key, img, src.length);
    evictIfNeeded();
  },
  MAX_CACHE_ENTRIES,
  MAX_IDB_LOAD_BYTES,
);

// ---------------------------------------------------------------------------
// Bitmap hashing
// ---------------------------------------------------------------------------

/**
 * Per-canvas hash memo.  buildHeatmapBitmap creates a new HTMLCanvasElement
 * each time it runs, so a WeakMap keyed on the canvas naturally invalidates
 * when the old canvas is replaced — no manual cache busting required.
 *
 * This avoids running getImageData + the hash loop on every rAF frame; the
 * hash is computed once per distinct canvas instance and reused thereafter.
 */
const bitmapHashMemo = new WeakMap<HTMLCanvasElement, string>();

/**
 * Compute (and memoize per canvas instance) a deterministic hash of the
 * heatmap bitmap's rendered pixel content.
 *
 * Reads up to ~4096 pixel samples via getImageData so large grids stay fast.
 * Captures R+G+B per pixel (alpha is always 255 in buildHeatmapBitmap), so
 * any change to the colormap / palette or to depth values changes the hash.
 * Results are memoized in a WeakMap so repeated calls on the same canvas
 * (across rAF frames) cost only one Map lookup.
 */
function hashBitmapCanvas(bitmap: HTMLCanvasElement): string {
  const memoized = bitmapHashMemo.get(bitmap);
  if (memoized !== undefined) return memoized;

  let hash: string;
  try {
    const ctx = bitmap.getContext("2d");
    if (!ctx) throw new Error("no 2d context");

    const { width: W, height: H } = bitmap;
    const data = ctx.getImageData(0, 0, W, H).data;

    // Step is always a multiple of 4 (one RGBA group); sample at most 4096 pixels
    const totalPixels = W * H;
    const stepPx = Math.max(1, Math.ceil(totalPixels / 4096));
    const step = stepPx * 4;

    // FNV-1a mix over RGB (alpha is always 255 in our bitmaps)
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i += step) {
      const px = ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
      h = Math.imul(h ^ px, 0x01000193) | 0;
    }

    hash = `${bitmap.width}x${bitmap.height}_${(h >>> 0).toString(16)}`;
  } catch {
    // Canvas taint or context unavailable — fall back to a unique timestamp key
    // so this bitmap never incorrectly matches a cached result.
    hash = `${bitmap.width}x${bitmap.height}_err_${Date.now()}`;
  }

  bitmapHashMemo.set(bitmap, hash);
  return hash;
}

function makeCacheKey(bitmapHash: string, factor: 2 | 4): string {
  return `${bitmapHash}_${factor}x`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

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
 * Caching behaviour:
 *   - Results are stored in a module-level Map keyed by a hash of the heatmap
 *     bitmap's rendered pixels + upscale factor.
 *   - On page load the in-memory cache is pre-populated from IndexedDB so the
 *     first render hits the fast path without a Poe call.
 *   - IndexedDB entries older than 7 days are pruned automatically on startup.
 *   - Any change that modifies the bitmap — new dataset, palette switch, depth
 *     recalculation — produces a different pixel hash → automatic cache miss.
 *     No manual cache clearing is required for those cases.
 *   - `invalidate()` clears the currently displayed upscaled image so the raw
 *     bitmap is shown immediately while the new upscale request is in flight
 *     (call it after a view change or any event that makes the cached image
 *     temporarily stale while a fresh request is being prepared).
 *     It also removes the corresponding IndexedDB entry.
 *
 * Concurrent requests are suppressed via `inFlightRef`. Requests for the same
 * cache key are skipped. Errors fall back silently — the original bitmap
 * remains visible.
 *
 * `isMountedRef` guards every state setter and IDB write that runs after an
 * async boundary so that an unmounted component never triggers orphaned IDB
 * writes or React state updates.
 */
export function useUpscaledHeatmap() {
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaledBitmap, setUpscaledBitmap] = useState<HTMLImageElement | null>(null);
  const inFlightRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Abort any in-flight Poe upscale — the result would be thrown away,
      // and each request costs Poe credits and server time.
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  /**
   * Clear the currently displayed upscaled bitmap, reset the in-component
   * key tracking, and remove the corresponding IndexedDB entry.
   *
   * The module-level in-memory cache is intentionally NOT cleared here — a
   * new bitmap produces a new hash, so stale entries are never reused.  Old
   * entries age out via the MAX_CACHE_ENTRIES eviction policy and the 7-day
   * TTL in IndexedDB.
   */
  const invalidate = useCallback(() => {
    const keyToRemove = lastKeyRef.current;
    // The displayed key is being invalidated — any in-flight upscale for it
    // is now stale, so abort rather than paying for a thrown-away result.
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setUpscaledBitmap(null);
    lastKeyRef.current = null;
    if (keyToRemove) {
      void idbDelete(keyToRemove);
    }
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

      // Key is derived from the rendered bitmap pixels + factor.
      // Any change to the data or palette changes the pixels → new hash → miss.
      const bitmapHash = hashBitmapCanvas(canvas);
      const cacheKey = makeCacheKey(bitmapHash, factor);

      // --- In-memory cache hit: serve immediately, no Poe call ---
      if (upscaleCache.has(cacheKey)) {
        const cached = upscaleCache.get(cacheKey)!;
        if (lastKeyRef.current !== cacheKey) {
          lastKeyRef.current = cacheKey;
          setUpscaledBitmap(cached);
        }
        return;
      }

      // --- De-duplicate concurrent/redundant calls ---
      if (inFlightRef.current || lastKeyRef.current === cacheKey) return;

      // --- IndexedDB cache hit: restore from persisted storage ---
      // Wait for IDB initialisation to complete (no-op after first call).
      await idbReady;

      // Check in-memory again — the init pass may have populated it.
      if (upscaleCache.has(cacheKey)) {
        const cached = upscaleCache.get(cacheKey)!;
        if (lastKeyRef.current !== cacheKey && isMountedRef.current) {
          lastKeyRef.current = cacheKey;
          setUpscaledBitmap(cached);
        }
        return;
      }

      const persistedSrc = await idbGet(cacheKey);
      if (persistedSrc) {
        const img = new Image();
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve(); // fall through to Poe on error
          img.src = persistedSrc;
        });
        if (img.complete && img.naturalWidth > 0) {
          addToCache(cacheKey, img, persistedSrc.length);
          evictIfNeeded();
          if (lastKeyRef.current !== cacheKey && isMountedRef.current) {
            lastKeyRef.current = cacheKey;
            setUpscaledBitmap(img);
          }
          return;
        }
      }

      // --- No cache hit anywhere: call Poe ---
      if (inFlightRef.current || lastKeyRef.current === cacheKey) return;

      inFlightRef.current = true;
      lastKeyRef.current = cacheKey;
      setIsUpscaling(true);

      // Abort any previous in-flight request (different cache key) and create
      // a fresh controller for this one so cleanup/invalidate can cancel it.
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const imageBase64 = canvas.toDataURL("image/png");
        const response = await authorizedFetch(`${API_BASE}/api/poe/upscale`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64, upscaleFactor: factor }),
          signal: controller.signal,
        });

        if (!response.ok) {
          console.warn(`[upscale] Poe upscale failed: HTTP ${response.status}`);
          lastKeyRef.current = null;
          return;
        }

        const data = (await response.json()) as { imageBase64?: string };
        if (!data.imageBase64) return;

        const src = data.imageBase64.startsWith("data:")
          ? data.imageBase64
          : `data:image/png;base64,${data.imageBase64}`;

        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = src;
        });

        // Store in module-level cache (survives unmount).
        addToCache(cacheKey, img, src.length);
        evictIfNeeded();

        // Guard IDB write and state update: the component may have unmounted
        // while the Poe call was in flight.
        if (isMountedRef.current) {
          void idbSet(cacheKey, src);
          setUpscaledBitmap(img);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Intentional cancellation (unmount / invalidate / superseded key) —
          // not an error; fall back silently to the raw bitmap.
        } else {
          console.warn("[upscale] Upscale error (silent fallback):", err);
        }
        lastKeyRef.current = null;
      } finally {
        inFlightRef.current = false;
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (isMountedRef.current) {
          setIsUpscaling(false);
        }
      }
    },
    // isMountedRef is a ref object — the closure always reads .current, so it
    // does not need to be listed as a dep.
    [],
  );

  return { isUpscaling, upscaledBitmap, requestUpscaleIfNeeded, invalidate };
}
