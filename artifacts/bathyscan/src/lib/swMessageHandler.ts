/**
 * Service-worker message handlers — extracted for unit-testability.
 *
 * Exporting the handlers as plain functions lets tests call them directly with
 * mock event objects (and a mocked global `caches`) without having to import
 * the full sw.ts entry-point, which depends on Workbox and service-worker
 * globals that are unavailable in the jsdom test environment.
 */

import {
  isCachePackMessage,
  isCachePackMarkersMessage,
  isDeletePackCacheMessage,
} from "./swHelpers";

/** The cache name used for persisting offline pack terrain/overview tiles. */
export const PACK_TERRAIN_CACHE_NAME = "bathyscan-pack-terrain";

/**
 * Minimal event shape the handler needs — matches ExtendableMessageEvent but
 * is expressed as a plain interface so tests can supply simple mock objects.
 */
export interface MessageEventLike {
  data: unknown;
  ports: readonly Pick<MessagePort, "postMessage">[];
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * CACHE_PACK message handler.
 *
 * Called from `self.addEventListener("message", ...)` in sw.ts.
 * Returns immediately (no-op) for any message that does not pass the
 * `isCachePackMessage` runtime guard.
 */
export function handleCachePackMessage(event: MessageEventLike): void {
  const raw: unknown = event.data;
  if (!isCachePackMessage(raw)) return;

  event.waitUntil(
    (async () => {
      const port = event.ports[0];
      try {
        const cache = await caches.open(PACK_TERRAIN_CACHE_NAME);
        await Promise.all([
          fetch(raw.terrainUrl).then((r): Promise<void> => {
            if (r.ok) return cache.put(raw.terrainUrl, r);
            return Promise.resolve();
          }),
          fetch(raw.overviewUrl).then((r): Promise<void> => {
            if (r.ok) return cache.put(raw.overviewUrl, r);
            return Promise.resolve();
          }),
        ]);
        port?.postMessage({ ok: true });
      } catch (err) {
        port?.postMessage({ ok: false, error: String(err) });
      }
    })(),
  );
}

/**
 * CACHE_PACK_MARKERS message handler.
 *
 * Stores a pre-fetched marker API response in the persistent pack cache so
 * saved-dataset markers survive SW upgrades (the versioned runtime cache is
 * wiped on every upgrade). The page fetches `/api/markers?datasetId=…` with
 * its Clerk Bearer token (the SW has no access to the token getter) and
 * ships the serialized body here; a synthetic JSON `Response` is put at the
 * marker URL so offline requests can be answered from the cache.
 */
export function handleCachePackMarkersMessage(event: MessageEventLike): void {
  const raw: unknown = event.data;
  if (!isCachePackMarkersMessage(raw)) return;

  event.waitUntil(
    (async () => {
      const port = event.ports[0];
      try {
        const cache = await caches.open(PACK_TERRAIN_CACHE_NAME);
        await cache.put(
          raw.markersUrl,
          new Response(raw.body, {
            headers: { "Content-Type": "application/json" },
          }),
        );
        port?.postMessage({ ok: true });
      } catch (err) {
        port?.postMessage({ ok: false, error: String(err) });
      }
    })(),
  );
}

/**
 * DELETE_PACK_CACHE message handler.
 *
 * Removes terrain, overview, and (when present) marker entries from the
 * persistent pack cache. Called by the page when a saveOfflinePack call
 * fails after terrain was already cached, and when a saved pack is deleted,
 * preventing orphaned Cache Storage entries.
 */
export function handleDeletePackCacheMessage(event: MessageEventLike): void {
  const raw: unknown = event.data;
  if (!isDeletePackCacheMessage(raw)) return;

  event.waitUntil(
    (async () => {
      const port = event.ports[0];
      try {
        const cache = await caches.open(PACK_TERRAIN_CACHE_NAME);
        const deletions = [
          cache.delete(raw.terrainUrl),
          cache.delete(raw.overviewUrl),
        ];
        // Optional — messages from app versions before markers were bundled
        // into offline packs omit this field.
        if (typeof raw.markersUrl === "string") {
          deletions.push(cache.delete(raw.markersUrl));
        }
        await Promise.all(deletions);
        port?.postMessage({ ok: true });
      } catch (err) {
        port?.postMessage({ ok: false, error: String(err) });
      }
    })(),
  );
}

/**
 * Combined message handler — routes to the appropriate handler based on
 * message type. Use this as the single `message` event listener in sw.ts.
 */
export function handleSwMessage(event: MessageEventLike): void {
  handleCachePackMessage(event);
  handleCachePackMarkersMessage(event);
  handleDeletePackCacheMessage(event);
}
