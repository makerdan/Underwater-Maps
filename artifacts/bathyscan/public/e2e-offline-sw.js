/* E2E-only offline-pack worker. This is deliberately not included in builds. */
const CACHE_NAME = "bathyscan-pack-terrain";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || !["CACHE_PACK", "CACHE_PACK_MARKERS"].includes(data.type)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (data.type === "CACHE_PACK") {
      const headers = { "Content-Type": data.terrainContentType || "application/json" };
      await cache.put(data.terrainUrl, new Response(data.terrainBody, { headers }));
      await cache.put(data.overviewUrl, new Response(data.overviewBody, {
        headers: { "Content-Type": data.overviewContentType || "application/json" },
      }));
    } else {
      await cache.put(data.markersUrl, new Response(data.body, {
        headers: { "Content-Type": "application/json" },
      }));
    }
    event.ports[0]?.postMessage({ ok: true });
  })().catch((error) => {
    event.ports[0]?.postMessage({ ok: false, error: String(error) });
  }));
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(event.request)) || fetch(event.request);
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.open(CACHE_NAME).then((cache) => cache.match(event.request.url));
    return cached || fetch(event.request);
  })());
});