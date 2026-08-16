/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { StaleWhileRevalidate, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { handleSwMessage, PACK_TERRAIN_CACHE_NAME } from "./lib/swMessageHandler";

declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_HASH__: string;

// Versioned cache prefix — updated on every build so stale terrain/marker
// caches from previous deploys are purged automatically in the activate step.
const CACHE_VERSION = `bathyscan-v${__BUILD_HASH__}`;
const CACHE_PREFIX = "bathyscan-v";

// Version-independent persistent caches for offline packs — intentionally
// survive SW version upgrades so saved packs aren't wiped on app update.
const PACK_TERRAIN_CACHE = PACK_TERRAIN_CACHE_NAME;
const PACK_HELP_CACHE = "bathyscan-pack-help";
const PERSISTENT_CACHES = new Set([PACK_TERRAIN_CACHE, PACK_HELP_CACHE]);

// Workbox injects the precache manifest here at build time
precacheAndRoute(self.__WB_MANIFEST);

// ── Lifecycle: delete caches from previous builds on activate ────────────────

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter(
            (name) =>
              // Only purge our own versioned caches from older builds —
              // do NOT touch Workbox precache or any other origin cache.
              name.startsWith(CACHE_PREFIX) &&
              name !== CACHE_VERSION &&
              !PERSISTENT_CACHES.has(name),
          )
          .map((name) => caches.delete(name)),
      ),
    ),
  );
});

// ── Runtime caching ─────────────────────────────────────────────────────────

registerRoute(
  ({ url }: { url: URL }) => /\/api\/datasets$/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: `${CACHE_VERSION}-api-datasets`,
    plugins: [
      new ExpirationPlugin({ maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 }),
    ],
  }),
);

// Terrain and overview: serve from persistent pack cache first (CacheFirst)
// when offline; online requests still go through StaleWhileRevalidate so the
// versioned cache stays fresh. The persistent pack cache is populated by the
// CACHE_PACK message handler below.
registerRoute(
  ({ url, request }: { url: URL; request: Request }) =>
    /\/api\/datasets\/[^/]+\/terrain/.test(url.pathname) &&
    request.headers.get("x-serve-from-pack") === "1",
  new CacheFirst({ cacheName: PACK_TERRAIN_CACHE }),
);

registerRoute(
  ({ url }: { url: URL }) => /\/api\/datasets\/[^/]+\/terrain/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: `${CACHE_VERSION}-api-terrain`,
    plugins: [
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

registerRoute(
  ({ url, request }: { url: URL; request: Request }) =>
    /\/api\/datasets\/[^/]+\/overview/.test(url.pathname) &&
    request.headers.get("x-serve-from-pack") === "1",
  new CacheFirst({ cacheName: PACK_TERRAIN_CACHE }),
);

registerRoute(
  ({ url }: { url: URL }) => /\/api\/datasets\/[^/]+\/overview/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: `${CACHE_VERSION}-api-overview`,
    plugins: [
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

// Markers: the persistent pack cache (populated at pack-save time by the
// CACHE_PACK_MARKERS message handler) backs up the versioned runtime cache.
// Registered as the single /api/markers route so the pack fallback is always
// reachable — a separate route registered after the SWR route would never
// match (Workbox routes match first-registered). Online behaviour is
// unchanged: the SWR runtime strategy handles the request first, and the
// pack cache is only consulted when SWR fails outright (offline AND no
// runtime-cache entry, e.g. right after a SW upgrade wiped it). This also
// guarantees the pack copy never shadows fresh network data while online.
const markersRuntimeStrategy = new StaleWhileRevalidate({
  cacheName: `${CACHE_VERSION}-api-markers`,
  plugins: [
    new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }),
  ],
});

registerRoute(
  ({ url }: { url: URL }) => /\/api\/markers/.test(url.pathname),
  async ({ event, request }) => {
    try {
      return await markersRuntimeStrategy.handle({ event, request });
    } catch (err) {
      const packCache = await caches.open(PACK_TERRAIN_CACHE);
      const hit = await packCache.match(request.url, { ignoreVary: true });
      if (hit) return hit;
      throw err;
    }
  },
);

// Help media: serve from pack cache when available, fall back to network.
registerRoute(
  ({ url }: { url: URL }) => /\/help\/.+\.(gif|png)$/.test(url.pathname),
  new CacheFirst({ cacheName: PACK_HELP_CACHE }),
);

// ── CACHE_PACK message handler ────────────────────────────────────────────────

self.addEventListener("message", handleSwMessage as EventListener);

// ── Background Sync (markers) — intentionally not implemented in the SW ──────
//
// /api/markers is protected by requireAuth (Bearer token only — cookie auth is
// disabled in BathyScan). The service worker has no access to the Clerk token
// getter, which lives in the page's JS context, so any unauthenticated POST
// from here would 401 for every signed-in user and silently loop forever.
//
// Queued markers are flushed by the page-side offlineFlush.ts path instead:
//   • `flushPendingMarkers` reads idb-keyval and POSTs via `authorizedFetch`,
//     which attaches the current Clerk Bearer token automatically.
//   • App.tsx wires a `window "online"` listener that calls flushAll() (which
//     runs flushPendingTrails + flushPendingMarkers) on every reconnect.
//
// This means sync happens when the app is open and comes back online — not
// truly in the background — but it is reliable for signed-in users and never
// produces silent 401 loops.
