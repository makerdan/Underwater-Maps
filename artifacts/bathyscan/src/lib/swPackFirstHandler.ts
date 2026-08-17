/**
 * Pack-first route handler factory for the service worker's terrain and
 * overview routes.
 *
 * Offline-pack terrain/overview tiles are stored in the version-independent
 * `bathyscan-pack-terrain` cache (PACK_TERRAIN_CACHE_NAME) so they survive SW
 * upgrades — the versioned StaleWhileRevalidate runtime caches are wiped on
 * every app update. The handler produced here checks the persistent pack
 * cache for EVERY matching request (no `x-serve-from-pack` header required)
 * and falls through to the provided runtime strategy on a miss.
 *
 * History: the pack cache used to be gated behind an `x-serve-from-pack: 1`
 * request header that no normal terrain load ever sent, so after any app
 * update saved packs silently failed to load. The header may still be sent
 * (useBulkOfflinePack's integrity probe does); it is simply ignored.
 *
 * Kept in a separate module (like swMessageHandler.ts) so it can be
 * unit-tested with a mocked global `caches` without importing sw.ts, which
 * depends on Workbox and service-worker globals unavailable in jsdom.
 */

import { PACK_TERRAIN_CACHE_NAME } from "./swMessageHandler";

/**
 * Minimal structural shape of a Workbox strategy — just the `handle` method
 * the pack-first handler needs. Expressed structurally so sw.ts can pass a
 * real StaleWhileRevalidate instance and tests can pass a simple mock.
 */
export interface RuntimeStrategyLike {
  handle(options: { event: unknown; request: Request }): Promise<Response>;
}

/** Options the returned handler consumes — a subset of Workbox's
 * RouteHandlerCallbackOptions, so the handler is directly registrable. */
export interface PackFirstHandlerOptions {
  event: unknown;
  request: Request;
}

/**
 * Create a route handler that serves from the persistent pack cache first,
 * falling through to `runtimeStrategy` when the URL is not cached there
 * (or when the Cache API itself fails).
 *
 * The match is keyed on `request.url` with `ignoreVary: true`, mirroring the
 * /api/markers pack fallback: pack entries are stored via
 * `cache.put(url, response)` by the CACHE_PACK message handler, and stored
 * responses may carry Vary headers that would otherwise defeat the match.
 */
export function createPackFirstHandler(
  runtimeStrategy: RuntimeStrategyLike,
): (options: PackFirstHandlerOptions) => Promise<Response> {
  return async ({ event, request }: PackFirstHandlerOptions): Promise<Response> => {
    try {
      const packCache = await caches.open(PACK_TERRAIN_CACHE_NAME);
      const hit = await packCache.match(request.url, { ignoreVary: true });
      if (hit) return hit;
    } catch {
      // Cache API unavailable or failing — fall through to the runtime
      // strategy rather than breaking the request.
    }
    return runtimeStrategy.handle({ event, request });
  };
}
