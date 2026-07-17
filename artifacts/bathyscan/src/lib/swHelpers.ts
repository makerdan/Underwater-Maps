/**
 * Pure helper utilities for the service worker (sw.ts).
 *
 * Kept in a separate module so they can be imported in unit tests without
 * pulling in the full WebWorker type environment of sw.ts.
 */

export interface CachePackMessage {
  type: "CACHE_PACK";
  terrainUrl: string;
  overviewUrl: string;
}

/**
 * Runtime type guard for postMessage payloads.
 *
 * Returns true only when `data` is a non-null object with
 * `type === "CACHE_PACK"`. All other messages (including `null`, strings,
 * arrays, and objects with an unknown `type`) return false so the handler
 * exits early without touching the cache.
 */
export function isCachePackMessage(data: unknown): data is CachePackMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>)["type"] === "CACHE_PACK"
  );
}
