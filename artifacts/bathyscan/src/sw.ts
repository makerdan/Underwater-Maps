/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";
import { get as idbGet, del as idbDel, keys as idbKeys } from "idb-keyval";

declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_HASH__: string;

// Versioned cache prefix — updated on every build so stale terrain/marker
// caches from previous deploys are purged automatically in the activate step.
const CACHE_VERSION = `bathyscan-v${__BUILD_HASH__}`;
const CACHE_PREFIX = "bathyscan-v";

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
              name.startsWith(CACHE_PREFIX) && name !== CACHE_VERSION,
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

registerRoute(
  ({ url }: { url: URL }) => /\/api\/datasets\/[^/]+\/terrain/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: `${CACHE_VERSION}-api-terrain`,
  }),
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
