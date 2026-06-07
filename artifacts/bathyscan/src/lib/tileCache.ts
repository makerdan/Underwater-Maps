/**
 * Persistent tile cache backed by the browser Cache API.
 *
 * Architecture:
 *   L1  — in-memory LRU (inside each hook, survives within a page session)
 *   L2  — Cache API  (this module, survives page reloads, TTL-guarded)
 *   L3  — network fetch
 *
 * TTL is checked on every read.  Stale entries are deleted lazily so they
 * don't occupy quota indefinitely.  Storage errors (quota exceeded, etc.)
 * are swallowed silently — the caller always falls through to the network.
 *
 * Cache API keys must be valid HTTP/HTTPS URLs (the spec rejects other
 * schemes).  We use the synthetic origin `https://tile-cache.local/` with
 * the bboxKey percent-encoded as the path.
 */

/** How long a cached tile is considered fresh (default 24 h). */
export const TILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Custom header used to embed the write-timestamp inside the cached Response. */
const CACHED_AT_HEADER = "x-tile-cached-at";

/**
 * Build a Cache API–compatible URL for a given bboxKey.
 * The Cache API requires HTTP/HTTPS scheme; we use a synthetic local origin.
 */
function toCacheUrl(key: string): string {
  return `https://tile-cache.local/${encodeURIComponent(key)}`;
}

/**
 * Open the named Cache storage bucket.
 * Returns null when the Cache API is unavailable (e.g. non-secure context).
 */
async function openCache(cacheName: string): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(cacheName);
  } catch {
    return null;
  }
}

/**
 * Attempt to read a tile blob from the persistent Cache API.
 *
 * @param cacheName  The Cache storage bucket name (e.g. "bathyscan-terrain-tiles").
 * @param key        The bboxKey used as the cache lookup key.
 * @param ttlMs      Maximum age in milliseconds before the entry is considered stale.
 * @returns          The cached Blob, or null on miss / stale / error.
 */
export async function getPersistentTile(
  cacheName: string,
  key: string,
  ttlMs = TILE_CACHE_TTL_MS,
): Promise<Blob | null> {
  const cache = await openCache(cacheName);
  if (!cache) return null;

  const cacheUrl = toCacheUrl(key);
  try {
    const response = await cache.match(cacheUrl);
    if (!response) return null;

    const cachedAt = response.headers.get(CACHED_AT_HEADER);
    if (cachedAt) {
      const age = Date.now() - parseInt(cachedAt, 10);
      if (age > ttlMs) {
        cache.delete(cacheUrl).catch(() => undefined);
        return null;
      }
    }

    return await response.blob();
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[tileCache] getPersistentTile error:", err);
    }
    return null;
  }
}

/**
 * Write a tile blob to the persistent Cache API.
 * Silently ignores any storage errors (quota exceeded, etc.).
 *
 * @param cacheName  The Cache storage bucket name.
 * @param key        The bboxKey used as the cache lookup key.
 * @param blob       The image Blob to persist.
 */
export async function putPersistentTile(
  cacheName: string,
  key: string,
  blob: Blob,
): Promise<void> {
  const cache = await openCache(cacheName);
  if (!cache) return;

  const cacheUrl = toCacheUrl(key);
  try {
    const response = new Response(blob, {
      headers: {
        [CACHED_AT_HEADER]: String(Date.now()),
        "content-type": blob.type || "image/png",
      },
    });
    await cache.put(cacheUrl, response);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[tileCache] putPersistentTile error:", err);
    }
  }
}
