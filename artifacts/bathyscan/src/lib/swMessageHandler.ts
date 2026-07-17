/**
 * Service-worker CACHE_PACK message handler — extracted for unit-testability.
 *
 * Exporting the handler as a plain function lets tests call it directly with
 * a mock event object (and a mocked global `caches`) without having to import
 * the full sw.ts entry-point, which depends on Workbox and service-worker
 * globals that are unavailable in the jsdom test environment.
 */

import { isCachePackMessage } from "./swHelpers";

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
 * Called from `self.addEventListener("message", handleCachePackMessage)` in
 * sw.ts.  Returns immediately (no-op) for any message that does not pass the
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
