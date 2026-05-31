/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { StaleWhileRevalidate, CacheFirst } from "workbox-strategies";
import { get as idbGet, del as idbDel, keys as idbKeys } from "idb-keyval";

declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_HASH__: string;

// Versioned cache prefix — updated on every build so stale terrain/marker
// caches from previous deploys are purged automatically in the activate step.
const CACHE_VERSION = `bathyscan-v${__BUILD_HASH__}`;
const CACHE_PREFIX = "bathyscan-v";

// Version-independent persistent caches for offline packs — intentionally
// survive SW version upgrades so saved packs aren't wiped on app update.
const PACK_TERRAIN_CACHE = "bathyscan-pack-terrain";
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
  new StaleWhileRevalidate({ cacheName: `${CACHE_VERSION}-api-datasets` }),
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
  }),
);

registerRoute(
  ({ url }: { url: URL }) => /\/api\/markers/.test(url.pathname),
  new StaleWhileRevalidate({ cacheName: `${CACHE_VERSION}-api-markers` }),
);

// Help media: serve from pack cache when available, fall back to network.
registerRoute(
  ({ url }: { url: URL }) => /\/help\/.+\.(gif|png)$/.test(url.pathname),
  new CacheFirst({ cacheName: PACK_HELP_CACHE }),
);

// ── CACHE_PACK message handler ────────────────────────────────────────────────

interface CachePackMessage {
  type: "CACHE_PACK";
  terrainUrl: string;
  overviewUrl: string;
}

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data = event.data as CachePackMessage;
  if (!data || data.type !== "CACHE_PACK") return;

  event.waitUntil(
    (async () => {
      const port = event.ports[0];
      try {
        const cache = await caches.open(PACK_TERRAIN_CACHE);
        await Promise.all([
          fetch(data.terrainUrl).then((r) => {
            if (r.ok) return cache.put(data.terrainUrl, r);
          }),
          fetch(data.overviewUrl).then((r) => {
            if (r.ok) return cache.put(data.overviewUrl, r);
          }),
        ]);
        port?.postMessage({ ok: true });
      } catch (err) {
        port?.postMessage({ ok: false, error: String(err) });
      }
    })(),
  );
});

// ── Background Sync: push queued markers to the API ─────────────────────────

interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}

self.addEventListener("sync", (rawEvent: Event) => {
  const event = rawEvent as SyncEvent;
  if (event.tag === "sync-markers") {
    event.waitUntil(syncQueuedMarkers());
  }
});

async function syncQueuedMarkers(): Promise<void> {
  const allKeys = await idbKeys();
  const pendingKeys = allKeys.filter(
    (k): k is string => typeof k === "string" && k.startsWith("pending-marker-"),
  );

  const results = await Promise.allSettled(
    pendingKeys.map(async (key) => {
      const data = await idbGet<Record<string, unknown>>(key);
      if (!data) {
        await idbDel(key);
        return;
      }
      const resp = await fetch("/api/markers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (resp.ok) {
        await idbDel(key);
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    }),
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    // Throw so the browser retries the sync on next opportunity
    throw new Error(`Failed to sync ${failed.length} marker(s)`);
  }
}
