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
  /**
   * Optional page-fetched response bodies.  The page supplies these for
   * authenticated datasets so the SW never needs to receive or persist a
   * reusable bearer token.
   */
  terrainBody?: string;
  overviewBody?: string;
  terrainContentType?: string;
  overviewContentType?: string;
  /** Page-generated id used to restore a prior pack if this save rolls back. */
  transactionId?: string;
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
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const value = data as Record<string, unknown>;
  return (
    value["type"] === "CACHE_PACK" &&
    typeof value["terrainUrl"] === "string" &&
    typeof value["overviewUrl"] === "string" &&
    (value["terrainBody"] === undefined || typeof value["terrainBody"] === "string") &&
    (value["overviewBody"] === undefined || typeof value["overviewBody"] === "string")
  );
}

export interface CachePackMarkersMessage {
  type: "CACHE_PACK_MARKERS";
  /** Marker API URL used as the cache key — must match the runtime request URL. */
  markersUrl: string;
  /** Serialized JSON response body for the marker list. */
  body: string;
  transactionId?: string;
}

/**
 * Runtime type guard for CACHE_PACK_MARKERS postMessage payloads.
 *
 * Stricter than the other guards: `markersUrl` and `body` must both be
 * strings because the handler constructs a synthetic `Response` from them.
 */
export function isCachePackMarkersMessage(data: unknown): data is CachePackMarkersMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>)["type"] === "CACHE_PACK_MARKERS" &&
    typeof (data as Record<string, unknown>)["markersUrl"] === "string" &&
    typeof (data as Record<string, unknown>)["body"] === "string"
  );
}

export interface DeletePackCacheMessage {
  type: "DELETE_PACK_CACHE";
  terrainUrl: string;
  overviewUrl: string;
  /**
   * Optional marker API URL to remove alongside terrain/overview.
   * Absent in messages sent by app versions before markers were bundled
   * into offline packs — the handler must treat it as optional.
   */
  markersUrl?: string;
  /** When present, restore entries backed up for this in-flight save. */
  transactionId?: string;
}

/**
 * Runtime type guard for DELETE_PACK_CACHE postMessage payloads.
 *
 * Used by the SW message handler to route cleanup requests sent when a
 * saveOfflinePack call fails after terrain was already cached.
 */
export function isDeletePackCacheMessage(data: unknown): data is DeletePackCacheMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>)["type"] === "DELETE_PACK_CACHE"
  );
}

export interface CommitPackCacheMessage {
  type: "COMMIT_PACK_CACHE";
  transactionId: string;
  terrainUrl: string;
  overviewUrl: string;
  markersUrl: string;
}

export function isCommitPackCacheMessage(data: unknown): data is CommitPackCacheMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>)["type"] === "COMMIT_PACK_CACHE" &&
    typeof (data as Record<string, unknown>)["transactionId"] === "string" &&
    typeof (data as Record<string, unknown>)["terrainUrl"] === "string" &&
    typeof (data as Record<string, unknown>)["overviewUrl"] === "string" &&
    typeof (data as Record<string, unknown>)["markersUrl"] === "string"
  );
}
