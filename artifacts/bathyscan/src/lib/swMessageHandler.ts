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
  isCommitPackCacheMessage,
  isDeletePackCacheMessage,
} from "./swHelpers";

/** The cache name used for persisting offline pack terrain/overview tiles. */
export const PACK_TERRAIN_CACHE_NAME = "bathyscan-pack-terrain";
export const PACK_TERRAIN_TRANSACTION_CACHE_NAME = "bathyscan-pack-terrain-transactions";
export const CACHE_PACK_FETCH_TIMEOUT_MS = 120_000;
const cacheMutationTails = new Map<string, Promise<void>>();

function transactionCacheKey(transactionId: string, url: string): string {
  return new URL(
    `/__bathyscan-pack-transaction__/${encodeURIComponent(transactionId)}/${encodeURIComponent(url)}`,
    "https://bathyscan.invalid",
  ).href;
}

function transactionOwnerKey(url: string): string {
  return new URL(
    `/__bathyscan-pack-transaction-owner__/${encodeURIComponent(url)}`,
    "https://bathyscan.invalid",
  ).href;
}

async function withCacheUrlLocks<T>(urls: string[], action: () => Promise<T>): Promise<T> {
  const keys = [...new Set(urls)].sort();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  const predecessors = keys.map((key) => cacheMutationTails.get(key) ?? Promise.resolve());
  for (const key of keys) cacheMutationTails.set(key, tail);
  await Promise.all(predecessors);
  try {
    return await action();
  } finally {
    release();
    for (const key of keys) {
      if (cacheMutationTails.get(key) === tail) cacheMutationTails.delete(key);
    }
  }
}

async function transactionOwnsEntry(transactionId: string | undefined, url: string): Promise<boolean> {
  if (!transactionId) return true;
  const transactionCache = await caches.open(PACK_TERRAIN_TRANSACTION_CACHE_NAME);
  const owner = typeof transactionCache.match === "function"
    ? await transactionCache.match(transactionOwnerKey(url))
    : undefined;
  return (await owner?.text?.()) === transactionId;
}

async function backupExistingEntry(
  cache: Cache,
  transactionId: string | undefined,
  url: string,
): Promise<void> {
  if (!transactionId) return;
  const transactionCache = await caches.open(PACK_TERRAIN_TRANSACTION_CACHE_NAME);
  const existing = typeof cache.match === "function" ? await cache.match(url) : undefined;
  await transactionCache.put(
    transactionCacheKey(transactionId, url),
    existing?.clone?.() ?? existing ?? new Response(null, { headers: { "x-bathyscan-empty": "1" } }),
  );
  await transactionCache.put(transactionOwnerKey(url), new Response(transactionId));
}

async function restoreOrDeleteEntry(
  cache: Cache,
  transactionId: string | undefined,
  url: string,
): Promise<void> {
  if (!transactionId) {
    await cache.delete(url);
    return;
  }
  const transactionCache = await caches.open(PACK_TERRAIN_TRANSACTION_CACHE_NAME);
  const key = transactionCacheKey(transactionId, url);
  const backup = typeof transactionCache.match === "function"
    ? await transactionCache.match(key)
    : undefined;
  // A newer save owns this URL now. Discard our snapshot but never let an old
  // rollback overwrite (or delete) that newer pack.
  const owner = typeof transactionCache.match === "function"
    ? await transactionCache.match(transactionOwnerKey(url))
    : undefined;
  const ownsUrl = (await owner?.text?.()) === transactionId;
  if (!backup || !ownsUrl) {
    await transactionCache.delete(key);
    return;
  }
  if (backup.headers.get("x-bathyscan-empty") === "1") {
    await cache.delete(url);
  } else {
    await cache.put(url, backup.clone?.() ?? backup);
  }
  await transactionCache.delete(key);
}

async function discardTransactionEntry(transactionId: string, url: string): Promise<void> {
  const transactionCache = await caches.open(PACK_TERRAIN_TRANSACTION_CACHE_NAME);
  await transactionCache.delete(transactionCacheKey(transactionId, url));
  const owner = typeof transactionCache.match === "function"
    ? await transactionCache.match(transactionOwnerKey(url))
    : undefined;
  if ((await owner?.text?.()) === transactionId) {
    await transactionCache.delete(transactionOwnerKey(url));
  }
}

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
        const fetchResponse = async (
          url: string,
          body: string | undefined,
          contentType: string | undefined,
        ): Promise<Response> => {
          if (body !== undefined) {
            return new Response(body, {
              status: 200,
              headers: { "Content-Type": contentType ?? "application/json" },
            });
          }
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`${url === raw.terrainUrl ? "Terrain" : "Overview"} HTTP ${response.status}`);
          }
          return response;
        };
        // Snapshot before fetching or writing. A failed fetch must leave the
        // existing pack alone, and a later rollback needs the original values.
        await withCacheUrlLocks([raw.terrainUrl, raw.overviewUrl], () =>
          Promise.all([
            backupExistingEntry(cache, raw.transactionId, raw.terrainUrl),
            backupExistingEntry(cache, raw.transactionId, raw.overviewUrl),
          ]),
        );
        const [terrain, overview] = await Promise.all([
          fetchResponse(raw.terrainUrl, raw.terrainBody, raw.terrainContentType),
          fetchResponse(raw.overviewUrl, raw.overviewBody, raw.overviewContentType),
        ]);
        if (!terrain.ok || !overview.ok) {
          throw new Error("Terrain or overview response was not cacheable");
        }
        await withCacheUrlLocks([raw.terrainUrl, raw.overviewUrl], async () => {
          const ownsBoth = await Promise.all([
            transactionOwnsEntry(raw.transactionId, raw.terrainUrl),
            transactionOwnsEntry(raw.transactionId, raw.overviewUrl),
          ]);
          if (!ownsBoth.every(Boolean)) {
            throw new Error("Offline cache save was superseded by a newer attempt");
          }
          await Promise.all([
            cache.put(raw.terrainUrl, terrain.clone?.() ?? terrain),
            cache.put(raw.overviewUrl, overview.clone?.() ?? overview),
          ]);
        });
        port?.postMessage({ ok: true });
      } catch (err) {
        // A failed second write must not leave a misleading half-pack behind.
        try {
          const cache = await caches.open(PACK_TERRAIN_CACHE_NAME);
          await withCacheUrlLocks([raw.terrainUrl, raw.overviewUrl], () =>
            Promise.all([
              restoreOrDeleteEntry(cache, raw.transactionId, raw.terrainUrl),
              restoreOrDeleteEntry(cache, raw.transactionId, raw.overviewUrl),
            ]),
          );
        } catch {
          // Cleanup is best-effort; preserve the useful original error.
        }
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
        await withCacheUrlLocks([raw.markersUrl], () =>
          backupExistingEntry(cache, raw.transactionId, raw.markersUrl),
        );
        await withCacheUrlLocks([raw.markersUrl], async () => {
          if (!(await transactionOwnsEntry(raw.transactionId, raw.markersUrl))) {
            throw new Error("Offline marker cache save was superseded by a newer attempt");
          }
          await cache.put(
            raw.markersUrl,
            new Response(raw.body, {
              headers: { "Content-Type": "application/json" },
            }),
          );
        });
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
        const urls = [raw.terrainUrl, raw.overviewUrl];
        // Optional — messages from app versions before markers were bundled
        // into offline packs omit this field.
        if (typeof raw.markersUrl === "string") {
          urls.push(raw.markersUrl);
        }
        await withCacheUrlLocks(
          urls,
          () => Promise.all(urls.map((url) => restoreOrDeleteEntry(cache, raw.transactionId, url))),
        );
        port?.postMessage({ ok: true });
      } catch (err) {
        port?.postMessage({ ok: false, error: String(err) });
      }
    })(),
  );
}

/** Discards rollback snapshots after IndexedDB has durably committed a pack. */
export function handleCommitPackCacheMessage(event: MessageEventLike): void {
  const raw: unknown = event.data;
  if (!isCommitPackCacheMessage(raw)) return;
  event.waitUntil(
    (async () => {
      const port = event.ports[0];
      try {
        await withCacheUrlLocks(
          [raw.terrainUrl, raw.overviewUrl, raw.markersUrl],
          () => Promise.all([
            discardTransactionEntry(raw.transactionId, raw.terrainUrl),
            discardTransactionEntry(raw.transactionId, raw.overviewUrl),
            discardTransactionEntry(raw.transactionId, raw.markersUrl),
          ]),
        );
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
  handleCommitPackCacheMessage(event);
}
