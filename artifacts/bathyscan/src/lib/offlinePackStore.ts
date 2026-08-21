/**
 * offlinePackStore.ts — manages deliberate offline area packs in IndexedDB.
 *
 * Each pack bundles terrain cache references, tide predictions, and a weather
 * snapshot for a single dataset so the app works without a network connection.
 */

import { get, set, del, keys } from "idb-keyval";
import type { Marker } from "@workspace/api-client-react";
import { authorizedFetch } from "./authorizedFetch";
import { CACHE_PACK_FETCH_TIMEOUT_MS } from "./swMessageHandler";
import {
  getControllingServiceWorker,
  SERVICE_WORKER_READY_TIMEOUT_MS,
} from "./serviceWorkerReadiness";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PACK_KEY_PREFIX = "offline-pack-";

/**
 * Build the markers API URL for a dataset.
 *
 * Must byte-match the URL the generated API client produces at runtime
 * (URLSearchParams encoding) — the SW pack cache is keyed on this exact URL,
 * so any mismatch means offline marker requests never hit the cached entry.
 */
export function markersUrlForDataset(datasetId: string): string {
  return `${API_BASE}/api/markers?${new URLSearchParams({ datasetId }).toString()}`;
}

export interface TideHeightPrediction {
  t: string;
  v: number;
}

export interface TideCurrentPrediction {
  t: string;
  speed: number;
  dir: number;
}

export interface TidePack {
  station: string | null;
  heightPredictions: TideHeightPrediction[];
  currentPredictions: TideCurrentPrediction[];
  tidalExpiresAt: string;
  generatedAt: string;
}

export interface WeatherStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  windSpeedKnots: number | null;
  windDirDeg: number | null;
  visibilityMiles: number | null;
  ceilingFt: number | null;
  tempC: number | null;
  observedAt: string | null;
}

export interface WeatherPack {
  station: string | null;
  observation: WeatherStation | null;
  snapshotAt: string;
}

export interface OfflinePack {
  id: string;
  datasetId: string;
  datasetName: string;
  /**
   * Bounding box of the dataset, or `null` when the dataset has no known
   * survey area.  Null-bbox packs carry stub tide/weather data (no location
   * to fetch for) and are excluded from `getPackForLocation` matching.
   */
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null;
  centerLat: number;
  centerLon: number;
  savedAt: string;
  terrainUrl: string;
  overviewUrl: string;
  tidePack: TidePack;
  weatherPack: WeatherPack;
  /**
   * Markers assigned to the dataset, captured at pack-save time.
   * Optional — packs saved before markers were bundled lack this field, so
   * every read path must nil-check (`pack.markersPack ?? []`).
   */
  markersPack?: Marker[];
  storageBytesEstimate: number;
}

export interface PackProgress {
  step: "terrain" | "tide" | "weather" | "markers" | "saving";
  label: string;
  done: boolean;
  error?: string;
}

// ─── Pack change listeners ────────────────────────────────────────────────────
//
// Lightweight registry so UI (offline-status badges) can refresh immediately
// after a pack is saved or deleted, without polling IndexedDB.

type PackListener = () => void;
const packListeners = new Set<PackListener>();

/** Subscribe to pack save/delete events. Returns an unsubscribe function. */
export function subscribeOfflinePacks(listener: PackListener): () => void {
  packListeners.add(listener);
  return () => {
    packListeners.delete(listener);
  };
}

function notifyPackListeners(): void {
  for (const listener of Array.from(packListeners)) {
    try {
      listener();
    } catch {
      // A broken listener must never fail the save/delete that triggered it.
    }
  }
}

// ─── Haversine distance ───────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── UUID helper ──────────────────────────────────────────────────────────────

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─── Tell the SW to cache terrain into the persistent pack cache ──────────────

export const OFFLINE_PACK_SW_READY_TIMEOUT_MS = SERVICE_WORKER_READY_TIMEOUT_MS;
export const OFFLINE_PACK_AUXILIARY_TIMEOUT_MS = 5_000;
const CUSTOM_DATASET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cancellationError(): Error {
  const error = new Error("Offline pack save cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError();
}

function awaitAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onLateResolve?: (value: T) => void,
): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cancellationError());
    };
    if (signal.aborted) {
      onAbort();
      void promise.catch(() => undefined);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) {
          onLateResolve?.(value);
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function awaitWithDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onAbort = () => settle(() => reject(cancellationError()));
    const timer = setTimeout(
      () => settle(() => reject(new Error(timeoutMessage))),
      timeoutMs,
    );
    if (signal?.aborted) {
      onAbort();
      void promise.catch(() => undefined);
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

function waitForWorkerMessage(
  activeWorker: ServiceWorker,
  message: unknown,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const channel = new MessageChannel();
    const timer = setTimeout(() => settle(() => reject(new Error(timeoutMessage))), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      channel.port1.onmessage = null;
      channel.port1.close?.();
      channel.port2.close?.();
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onAbort = () => settle(() => reject(cancellationError()));
    channel.port1.onmessage = (event: MessageEvent<{ ok: boolean; error?: string }>) => {
      if (event.data.ok) settle(resolve);
      else settle(() => reject(new Error(event.data.error ?? "Service worker request failed")));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      activeWorker.postMessage(message, [channel.port2]);
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

async function cacheTerrain(
  terrainUrl: string,
  overviewUrl: string,
  transactionId: string,
  signal?: AbortSignal,
): Promise<void> {
  const activeWorker = await getControllingServiceWorker(signal);
  throwIfAborted(signal);

  // Fetch in the page context so Clerk authorization is applied to private
  // uploaded datasets. Only response data crosses the worker boundary. A
  // relative-URL parse failure is limited to non-browser test doubles; in a
  // browser it is never expected and the SW's legacy fetch path remains useful
  // for older callers.
  let responsePayload:
    | {
        terrainBody: string;
        overviewBody: string;
        terrainContentType?: string;
        overviewContentType?: string;
      }
    | undefined;
  if (CUSTOM_DATASET_UUID_RE.test(terrainUrl.split("/").at(-2) ?? "")) {
    const [terrainResponse, overviewResponse] = await Promise.all([
      authorizedFetch(terrainUrl, { signal }),
      authorizedFetch(overviewUrl, { signal }),
    ]);
    throwIfAborted(signal);
    if (!terrainResponse.ok) throw new Error(`Terrain HTTP ${terrainResponse.status}`);
    if (!overviewResponse.ok) throw new Error(`Overview HTTP ${overviewResponse.status}`);
    const [terrainBody, overviewBody] = await Promise.all([
      typeof terrainResponse.text === "function" ? terrainResponse.text() : Promise.resolve(""),
      typeof overviewResponse.text === "function" ? overviewResponse.text() : Promise.resolve(""),
    ]);
    throwIfAborted(signal);
    responsePayload = {
      terrainBody,
      overviewBody,
      terrainContentType: terrainResponse.headers?.get?.("Content-Type") ?? undefined,
      overviewContentType: overviewResponse.headers?.get?.("Content-Type") ?? undefined,
    };
  }

  return waitForWorkerMessage(
    activeWorker,
    { type: "CACHE_PACK", terrainUrl, overviewUrl, transactionId, ...responsePayload },
    signal,
    CACHE_PACK_FETCH_TIMEOUT_MS,
    "SW CACHE_PACK timed out — terrain may not be cached for offline use",
  );
}

// ─── Tell the SW to cache a pre-fetched marker response (persistent cache) ────

async function cachePackMarkers(
  markersUrl: string,
  body: string,
  transactionId?: string,
  signal?: AbortSignal,
): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  let reg: ServiceWorkerRegistration;
  try {
    reg = await awaitWithDeadline(
      navigator.serviceWorker.ready,
      OFFLINE_PACK_SW_READY_TIMEOUT_MS,
      "Service worker readiness timed out while caching markers",
      signal,
    );
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  }
  if (!reg?.active) return;
  return waitForWorkerMessage(
    reg.active,
    { type: "CACHE_PACK_MARKERS", markersUrl, body, ...(transactionId ? { transactionId } : {}) },
    signal,
    OFFLINE_PACK_AUXILIARY_TIMEOUT_MS,
    "SW CACHE_PACK_MARKERS timed out",
  );
}

// ─── Tell the SW to remove cached terrain entries (rollback on pack failure) ──

async function deletePackCache(
  terrainUrl: string,
  overviewUrl: string,
  markersUrl?: string,
  transactionId?: string,
): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await awaitWithDeadline(
    navigator.serviceWorker.ready,
    OFFLINE_PACK_SW_READY_TIMEOUT_MS,
    "Service worker readiness timed out while cleaning offline pack cache",
  ).catch(() => null);
  if (!reg?.active) return;
  await waitForWorkerMessage(
    reg.active,
    {
      type: "DELETE_PACK_CACHE",
      terrainUrl,
      overviewUrl,
      ...(markersUrl !== undefined ? { markersUrl } : {}),
      ...(transactionId !== undefined ? { transactionId } : {}),
    },
    undefined,
    OFFLINE_PACK_AUXILIARY_TIMEOUT_MS,
    "SW DELETE_PACK_CACHE timed out",
  ).catch(() => undefined);
}

async function commitPackCache(
  transactionId: string,
  terrainUrl: string,
  overviewUrl: string,
  markersUrl: string,
  signal?: AbortSignal,
): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await awaitWithDeadline(
    navigator.serviceWorker.ready,
    OFFLINE_PACK_SW_READY_TIMEOUT_MS,
    "Service worker readiness timed out while committing offline pack cache",
    signal,
  ).catch((_error) => {
    throwIfAborted(signal);
    return null;
  });
  if (!reg?.active) return;
  await waitForWorkerMessage(
    reg.active,
    { type: "COMMIT_PACK_CACHE", transactionId, terrainUrl, overviewUrl, markersUrl },
    signal,
    OFFLINE_PACK_AUXILIARY_TIMEOUT_MS,
    "SW COMMIT_PACK_CACHE timed out",
  ).catch(() => undefined);
}

// ─── saveOfflinePack ──────────────────────────────────────────────────────────

// ─── fetchDatasetBbox ─────────────────────────────────────────────────────────

/**
 * Try to derive a bounding box for a dataset from the server.
 *
 * Calls GET /api/datasets/:id/preview, which for user-uploaded custom datasets
 * extracts the bbox from the stored terrain JSON.  Returns `null` when the
 * dataset has no server-side bbox, the request fails, or the response carries
 * the sentinel null-island bbox `{0,0,0,0}` (the server's error fallback).
 *
 * Best-effort and silent — callers should treat a `null` return as "still no
 * location", not as an error.
 */
export async function fetchDatasetBbox(
  datasetId: string,
  signal?: AbortSignal,
): Promise<{ minLon: number; maxLon: number; minLat: number; maxLat: number } | null> {
  try {
    const res = await authorizedFetch(`${API_BASE}/api/datasets/${datasetId}/preview`, { signal });
    throwIfAborted(signal);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null;
    };
    const bbox = data?.bbox;
    if (!bbox) return null;
    // Reject the server's null-island error fallback {0,0,0,0}.
    if (
      bbox.minLon === 0 &&
      bbox.maxLon === 0 &&
      bbox.minLat === 0 &&
      bbox.maxLat === 0
    ) {
      return null;
    }
    return bbox;
  } catch {
    throwIfAborted(signal);
    return null;
  }
}

export async function saveOfflinePack(
  dataset: {
    id: string;
    name: string;
    bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null;
    /** Horizontal grid resolution in metres — forwarded to the storage estimator. */
    resolutionM?: number | null;
  },
  days: number,
  onProgress: (p: PackProgress) => void,
  signal?: AbortSignal,
): Promise<OfflinePack> {
  // When no bbox was supplied (or it was explicitly null), attempt to derive one
  // from the server — the /preview endpoint extracts it from stored terrain JSON
  // for user-uploaded datasets.  If derivation also fails the old "no location"
  // stub behaviour applies: tide/weather fetches are skipped and the pack stores
  // null-station stubs with a visible warning.
  const resolvedBbox =
    dataset.bbox != null ? dataset.bbox : await fetchDatasetBbox(dataset.id, signal);
  throwIfAborted(signal);
  const hasBbox = resolvedBbox != null;
  const centerLat = resolvedBbox
    ? (resolvedBbox.minLat + resolvedBbox.maxLat) / 2
    : 0;
  const centerLon = resolvedBbox
    ? (resolvedBbox.minLon + resolvedBbox.maxLon) / 2
    : 0;

  const terrainUrl = `${API_BASE}/api/datasets/${dataset.id}/terrain`;
  const overviewUrl = `${API_BASE}/api/datasets/${dataset.id}/overview`;
  const transactionId = newId();
  let persistedPackKey: string | null = null;

  const progress = (p: PackProgress) => {
    if (!signal?.aborted) onProgress(p);
  };
  let terrainAttempted = false;
  // Step 1: cache terrain
  progress({ step: "terrain", label: "Downloading terrain — may take a minute on slow connections…", done: false });
  terrainAttempted = true;
  try {
    await cacheTerrain(terrainUrl, overviewUrl, transactionId, signal);
  } catch (err) {
    if (terrainAttempted) {
      // Cleanup has its own deadline but never delays the error the user needs
      // to see (or a cancellation retry). The transaction snapshot lets this
      // restore a pre-existing pack even when it completes after the UI settles.
      void deletePackCache(
        terrainUrl,
        overviewUrl,
        markersUrlForDataset(dataset.id),
        transactionId,
      ).catch(() => undefined);
    }
    const msg = err instanceof Error ? err.message : "SW CACHE_PACK failed";
    progress({ step: "terrain", label: msg, done: true, error: msg });
    throw err;
  }
  progress({ step: "terrain", label: "Terrain cached", done: true });

  // Steps 2–4: wrapped in a try/catch so any failure after terrain is cached
  // triggers best-effort cleanup of the orphaned Cache Storage entries.
  try {
    // Step 2: fetch tide pack
    let tidePack: TidePack;
    if (!hasBbox) {
      // No location — skip the remote fetch and store a null-station stub.
      // expiresAt is set to now so the stub never counts as fresh tide data.
      const tideMsg = "No location — tide unavailable";
      const nowIso = new Date().toISOString();
      tidePack = {
        station: null,
        heightPredictions: [],
        currentPredictions: [],
        tidalExpiresAt: nowIso,
        generatedAt: nowIso,
      };
      progress({ step: "tide", label: tideMsg, done: true, error: tideMsg });
    } else {
      progress({ step: "tide", label: "Fetching tide predictions…", done: false });
      try {
        const tideRes = await fetch(
          `${API_BASE}/api/tidal/pack?lat=${centerLat}&lon=${centerLon}&days=${days}`,
          { signal },
        );
        throwIfAborted(signal);
        if (!tideRes.ok) throw new Error(`HTTP ${tideRes.status}`);
        tidePack = (await tideRes.json()) as TidePack;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch tide predictions";
        throwIfAborted(signal);
        progress({ step: "tide", label: msg, done: true, error: msg });
        throw err;
      }
      progress({ step: "tide", label: "Tide predictions saved", done: true });
    }

    // Step 3: fetch weather pack (best-effort — does not throw)
    let weatherPack: WeatherPack;
    if (!hasBbox) {
      // No location — skip the remote fetch and store a null-station stub.
      const weatherMsg = "No location — weather unavailable";
      weatherPack = { station: null, observation: null, snapshotAt: new Date().toISOString() };
      progress({ step: "weather", label: weatherMsg, done: true, error: weatherMsg });
    } else {
      progress({ step: "weather", label: "Fetching weather snapshot…", done: false });
      let weatherDone = false;
      try {
        const weatherRes = await fetch(
          `${API_BASE}/api/weather/pack?lat=${centerLat}&lon=${centerLon}`,
          { signal },
        );
        throwIfAborted(signal);
        if (!weatherRes.ok) throw new Error(`HTTP ${weatherRes.status}`);
        weatherPack = (await weatherRes.json()) as WeatherPack;
      } catch {
        throwIfAborted(signal);
        // Weather is best-effort — create a minimal pack if it fails, but tell
        // the caller so the UI can surface the omission rather than showing a
        // silent success followed by an empty weather panel when offline.
        weatherPack = { station: null, observation: null, snapshotAt: new Date().toISOString() };
        progress({
          step: "weather",
          label: "Weather unavailable — pack saved without weather data",
          done: true,
        });
        weatherDone = true;
      }
      if (!weatherDone) {
        if (weatherPack.station !== null || weatherPack.observation !== null) {
          progress({ step: "weather", label: "Weather snapshot saved", done: true });
        } else {
          // A 200 response with both fields null means no station is nearby or NOAA
          // is temporarily unavailable.  Always emit a terminal done event so the
          // progress row never stays frozen on "Fetching weather snapshot…".
          progress({
            step: "weather",
            label: "Weather unavailable — no station nearby",
            done: true,
          });
        }
      }
    }

    // Step 4: fetch markers assigned to this dataset (best-effort — does not throw).
    // /api/markers is behind requireAuth, so the fetch must carry the Clerk
    // Bearer token via authorizedFetch (a plain fetch silently 401s).
    throwIfAborted(signal);
    progress({ step: "markers", label: "Fetching markers…", done: false });
    const markersUrl = markersUrlForDataset(dataset.id);
    let markersPack: Marker[] = [];
    let markersBytes = 0;
    let markersFetched = false;
    try {
      const markersRes = await authorizedFetch(markersUrl, { signal });
      throwIfAborted(signal);
      if (!markersRes.ok) throw new Error(`HTTP ${markersRes.status}`);
      const markersBody = await markersRes.text();
      const parsed: unknown = JSON.parse(markersBody);
      if (!Array.isArray(parsed)) throw new Error("Unexpected markers response shape");
      markersPack = parsed as Marker[];
      markersBytes = new TextEncoder().encode(markersBody).length;
      markersFetched = true;
      // Pre-populate the persistent pack cache so the SW can serve markers
      // offline even after a SW upgrade wipes the versioned runtime cache.
      // Failure here keeps the markers in the IDB record but surfaces a
      // warning label — the save itself never rolls back on marker errors.
      try {
        await cachePackMarkers(markersUrl, markersBody, transactionId, signal);
        progress({
          step: "markers",
          label:
            markersPack.length > 0
              ? `Markers saved (${markersPack.length})`
              : "No markers for this dataset",
          done: true,
        });
      } catch {
        throwIfAborted(signal);
        progress({
          step: "markers",
          label: "Markers saved to pack, but offline cache could not be updated",
          done: true,
        });
      }
    } catch {
      throwIfAborted(signal);
      // Markers are best-effort — same policy as weather. Store an empty
      // list and continue rather than failing the whole pack.
      markersPack = [];
      markersBytes = 0;
      if (!markersFetched) {
        progress({
          step: "markers",
          label: "Markers unavailable — pack saved without markers",
          done: true,
        });
      }
    }

    // Step 5: save to IndexedDB
    throwIfAborted(signal);
    progress({ step: "saving", label: "Writing to storage…", done: false });
    const id = newId();
    const pack: OfflinePack = {
      id,
      datasetId: dataset.id,
      datasetName: dataset.name,
      // Store the resolved bbox — which may have been derived from the server
      // when none was supplied by the caller — or null when neither is available.
      bbox: resolvedBbox ?? null,
      centerLat,
      centerLon,
      savedAt: new Date().toISOString(),
      terrainUrl,
      overviewUrl,
      tidePack,
      weatherPack,
      markersPack,
      storageBytesEstimate:
        (resolvedBbox
          ? estimatePackStorageBytesFromBbox({
              bbox: resolvedBbox,
              resolutionM: dataset.resolutionM ?? undefined,
            })
          : estimateFromPredictions(tidePack)) + markersBytes,
    };

    const packKey = `${PACK_KEY_PREFIX}${id}`;
    try {
      await awaitAbortable(
        set(packKey, pack),
        signal,
        () => void del(packKey).catch(() => undefined),
      );
      persistedPackKey = packKey;
      throwIfAborted(signal);
    } catch (idbErr) {
      if (signal?.aborted) {
        await del(packKey).catch(() => undefined);
        throw cancellationError();
      }
      const raw = idbErr instanceof Error ? idbErr.message : "Storage write failed";
      const userMsg = `Could not save to device storage: ${raw}`;
      progress({ step: "saving", label: userMsg, done: true, error: userMsg });
      throw new Error(userMsg);
    }

    await commitPackCache(
      transactionId,
      terrainUrl,
      overviewUrl,
      markersUrlForDataset(dataset.id),
      signal,
    );
    throwIfAborted(signal);
    progress({ step: "saving", label: "Saved to device", done: true });
    notifyPackListeners();
    return pack;
  } catch (err) {
    if (signal?.aborted && persistedPackKey) {
      await del(persistedPackKey).catch(() => undefined);
    }
    // Any failure after terrain was successfully cached — remove the orphaned
    // Cache Storage entries (including any cached marker response) so
    // re-saving always starts clean.
    // Best-effort rollback is deliberately detached from the save result:
    // service-worker readiness or an acknowledgement may be unavailable while
    // the original fetch/IDB error still needs to reach the UI immediately.
    void deletePackCache(
      terrainUrl,
      overviewUrl,
      markersUrlForDataset(dataset.id),
      transactionId,
    ).catch(() => undefined);
    throw err;
  }
}

function estimateFromPredictions(tidePack: TidePack): number {
  const tideBytesEst =
    (tidePack.heightPredictions.length + tidePack.currentPredictions.length) * 40;
  return tideBytesEst + 2 * 1024 * 1024;
}

/**
 * Return the most-recently saved offline pack whose `datasetId` matches, or
 * `null` if none exists.
 *
 * Why newest: re-saving a pack creates a new IDB record (new UUID key) rather
 * than overwriting the old one.  The SW cache path is keyed on URL so it is
 * always current; to keep the IDB fallback consistent we must select the same
 * data the SW cache would have served — the latest save.
 *
 * Used by the offline marker fallback when the SW cache has been evicted but
 * the IDB record is still intact.
 */
export async function getOfflinePackByDatasetId(
  datasetId: string,
): Promise<OfflinePack | null> {
  const packs = await listOfflinePacks();
  const matching = packs.filter((p) => p.datasetId === datasetId);
  if (matching.length === 0) return null;
  // Sort descending by savedAt so the most-recent pack is first.
  matching.sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
  );
  return matching[0] ?? null;
}

// ─── Refresh markers in a saved pack after an online mutation ─────────────────

/**
 * After a successful marker create/update/delete, call this to keep any saved
 * offline pack for the same dataset in sync.
 *
 * Best-effort and non-blocking: callers should fire-and-forget with `void`.
 * Failures are swallowed — a stale pack is still better than a missing pack.
 *
 * What it does:
 *   1. Finds all saved packs for `datasetId` (there is usually at most one).
 *   2. Re-fetches the current marker list via `authorizedFetch` (Clerk token).
 *   3. Updates each matching IDB record (`markersPack` + `storageBytesEstimate`).
 *   4. Sends `CACHE_PACK_MARKERS` to the SW so the persistent pack cache is
 *      also updated and survives SW upgrades.
 */
export async function refreshOfflinePackMarkers(datasetId: string): Promise<void> {
  if (!datasetId) return;

  const packs = await listOfflinePacks();
  const matching = packs.filter((p) => p.datasetId === datasetId);
  if (matching.length === 0) return; // no pack for this dataset — nothing to do

  const markersUrl = markersUrlForDataset(datasetId);
  let markersBody: string;
  let markersPack: Marker[];
  try {
    const res = await authorizedFetch(markersUrl);
    if (!res.ok) return; // best-effort: skip on HTTP error
    markersBody = await res.text();
    const parsed: unknown = JSON.parse(markersBody);
    if (!Array.isArray(parsed)) return;
    markersPack = parsed as Marker[];
  } catch {
    return; // network error — leave the existing pack as-is
  }

  const newMarkersBytes = new TextEncoder().encode(markersBody).length;

  for (const pack of matching) {
    const oldMarkersBytes = new TextEncoder().encode(
      JSON.stringify(pack.markersPack ?? []),
    ).length;
    const updatedPack: OfflinePack = {
      ...pack,
      markersPack,
      storageBytesEstimate: pack.storageBytesEstimate - oldMarkersBytes + newMarkersBytes,
    };
    try {
      await set(`${PACK_KEY_PREFIX}${pack.id}`, updatedPack);
    } catch {
      // best-effort — IDB write failure is not fatal
    }
  }

  // Update the SW persistent pack cache so offline requests stay current.
  // cachePackMarkers uses cache.put which is idempotent — safe to call every time.
  try {
    await cachePackMarkers(markersUrl, markersBody);
  } catch {
    // best-effort — SW may be absent in dev or during an update
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listOfflinePacks(): Promise<OfflinePack[]> {
  const allKeys = await keys();
  const packKeys = allKeys.filter(
    (k): k is string => typeof k === "string" && k.startsWith(PACK_KEY_PREFIX),
  );
  const packs = await Promise.all(packKeys.map((k) => get<OfflinePack>(k)));
  return packs.filter((p): p is OfflinePack => p !== undefined);
}

export async function deleteOfflinePack(id: string): Promise<void> {
  // Best-effort: remove the pack's persistent Cache Storage entries (terrain,
  // overview, markers) before dropping the IDB record. Old packs saved before
  // markersPack existed still carry datasetId, so the marker URL can always
  // be reconstructed. SW cleanup failure never blocks the IDB delete.
  try {
    const pack = await get<OfflinePack>(`${PACK_KEY_PREFIX}${id}`);
    if (pack) {
      await deletePackCache(
        pack.terrainUrl,
        pack.overviewUrl,
        markersUrlForDataset(pack.datasetId),
      );
    }
  } catch {
    // Best-effort cleanup only.
  }
  await del(`${PACK_KEY_PREFIX}${id}`);
  notifyPackListeners();
}

// ─── Location lookup ──────────────────────────────────────────────────────────

export async function getPackForLocation(
  lat: number,
  lon: number,
): Promise<OfflinePack | null> {
  const packs = await listOfflinePacks();
  // Exclude expired packs — an expired pack at 50 km must not win over a fresh
  // pack at 150 km because the expired pack's tide data is stale.
  // Also exclude null-bbox packs: they have no real location (centerLat/Lon
  // are meaningless) and carry stub tide/weather data, so they must never
  // match any coordinates.
  const freshPacks = packs.filter((p) => p.bbox != null && !isPackExpired(p));
  let nearest: OfflinePack | null = null;
  let nearestDist = 200; // km threshold
  for (const p of freshPacks) {
    const dist = haversineKm(lat, lon, p.centerLat, p.centerLon);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = p;
    }
  }
  return nearest;
}

// ─── Tide value interpolation ─────────────────────────────────────────────────

export interface OfflineTideValue {
  tideHeight: number;
  currentSpeed: number;
  currentDirection: number;
  source: "pack";
}

export function getOfflineTideValue(
  pack: OfflinePack,
  datetime: Date,
): OfflineTideValue {
  const refMs = datetime.getTime();
  const height = interpolateHeightPredictions(pack.tidePack.heightPredictions, refMs);
  const current = interpolateCurrentPredictions(pack.tidePack.currentPredictions, refMs);
  return {
    tideHeight: height,
    currentSpeed: current.speed,
    currentDirection: current.dir,
    source: "pack",
  };
}

function interpolateHeightPredictions(
  preds: TideHeightPrediction[],
  refMs: number,
): number {
  if (preds.length === 0) return 0;
  let prev: TideHeightPrediction | null = null;
  let next: TideHeightPrediction | null = null;
  for (const p of preds) {
    const t = new Date(p.t).getTime();
    if (t <= refMs) prev = p;
    else if (!next) { next = p; break; }
  }
  if (!prev && !next) return 0;
  if (!prev && next) return next.v;
  if (prev && !next) return prev.v;
  if (!prev || !next) return 0;
  const prevT = new Date(prev.t).getTime();
  const nextT = new Date(next.t).getTime();
  const span = nextT - prevT;
  if (span <= 0) return prev.v;
  const t = (refMs - prevT) / span;
  const c = (1 - Math.cos(Math.PI * t)) / 2;
  return prev.v + (next.v - prev.v) * c;
}

function interpolateCurrentPredictions(
  preds: TideCurrentPrediction[],
  refMs: number,
): { speed: number; dir: number } {
  if (preds.length === 0) return { speed: 0, dir: 0 };
  let prev: TideCurrentPrediction | null = null;
  let next: TideCurrentPrediction | null = null;
  for (const p of preds) {
    const t = new Date(p.t).getTime();
    if (t <= refMs) prev = p;
    else if (!next) { next = p; break; }
  }
  if (!prev && !next) return { speed: 0, dir: 0 };
  if (!prev && next) return { speed: next.speed, dir: next.dir };
  if (prev && !next) return { speed: prev.speed, dir: prev.dir };
  if (!prev || !next) return { speed: 0, dir: 0 };
  const prevT = new Date(prev.t).getTime();
  const nextT = new Date(next.t).getTime();
  const span = nextT - prevT;
  if (span <= 0) return { speed: prev.speed, dir: prev.dir };
  const t = (refMs - prevT) / span;
  // Use shortest-arc interpolation for direction so that e.g. 359° → 1° wraps
  // through 0° (north, Δ=2°) rather than through 180° (south, Δ=358°).
  const dirDiff = ((((next.dir - prev.dir) % 360) + 540) % 360) - 180;
  return {
    speed: prev.speed + (next.speed - prev.speed) * t,
    dir: (prev.dir + dirDiff * t + 360) % 360,
  };
}

// ─── Weather value ────────────────────────────────────────────────────────────

export interface OfflineWeatherValue extends WeatherStation {
  isStale: true;
  snapshotAt: string;
}

export function getOfflineWeatherValue(pack: OfflinePack): OfflineWeatherValue | null {
  if (!pack.weatherPack.observation) return null;
  return {
    ...pack.weatherPack.observation,
    isStale: true,
    snapshotAt: pack.weatherPack.snapshotAt,
  };
}

// ─── Storage estimate ─────────────────────────────────────────────────────────

/** Optional hints for a dataset-aware size estimate. */
export interface BboxEstimateHints {
  /**
   * Bounding box of the dataset in WGS-84 degrees.
   * Required by `estimatePackStorageBytesFromBbox`; optional in
   * `estimatePackStorageBytes` (which can still use `resolutionM` alone to
   * scale the fallback stub when bbox is unavailable).
   */
  bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  /**
   * Horizontal grid resolution in metres.
   * Used to select the compressed-bytes-per-sample factor.
   * Defaults to 10 m when omitted.
   */
  resolutionM?: number;
}

/**
 * Compute a terrain-size estimate from bbox area and resolution.
 *
 * Formula:
 *   sample_count ≈ bbox_area_m² / resolutionM²
 *   bytes ≈ sample_count × avg_bytes_per_sample + 200 KB overhead
 *
 * avg_bytes_per_sample accounts for float32 elevation values and typical
 * compression ratios:
 *   ≤ 2 m resolution → 4 bytes/sample (high variance, poor compression)
 *   > 2 m resolution → 1 byte/sample  (smoother terrain, better compression)
 *
 * Exported for direct unit testing.
 */
export function estimatePackStorageBytesFromBbox(hints: {
  bbox: NonNullable<BboxEstimateHints["bbox"]>;
  resolutionM?: number;
}): number {
  const { bbox, resolutionM = 10 } = hints;
  const dLon = Math.abs(bbox.maxLon - bbox.minLon);
  const dLat = Math.abs(bbox.maxLat - bbox.minLat);
  // Convert degrees to metres (approx 111 000 m/degree).
  // Apply cosine latitude correction so polar/high-latitude bboxes are not
  // over-estimated.  cos(0) = 1 so equatorial tests are unchanged.
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const cosLat = Math.max(0, Math.cos((midLat * Math.PI) / 180));
  const widthM = dLon * 111_000 * cosLat;
  const heightM = dLat * 111_000;
  const areaM2 = widthM * heightM;
  const resM = Math.max(1, resolutionM);
  const sampleCount = areaM2 / (resM * resM);
  // Compressed bytes per elevation sample, tuned to typical terrain payloads.
  const avgBytesPerSample = resM <= 2 ? 4 : 1;
  const terrainBytes = sampleCount * avgBytesPerSample;
  return Math.round(terrainBytes + 200 * 1024);
}

/**
 * Estimate the storage size of an offline pack for `datasetId`.
 *
 * When `hints.bbox` is provided the estimate is computed from the dataset's
 * area using `estimatePackStorageBytesFromBbox` — the preferred path.
 *
 * When only `hints.resolutionM` is provided (no bbox), the 2.5 MiB base stub
 * is scaled by the same resolution tier used in `estimatePackStorageBytesFromBbox`:
 *   ≤ 2 m → 4 × stub  (high-density survey, worse compression)
 *   > 2 m → 1 × stub  (regional survey, better compression)
 * This ensures resolutionM is never silently ignored even when bbox is absent.
 *
 * Falls back (in order) to:
 *   1. A HEAD request on the terrain endpoint reading Content-Length.
 *   2. The resolution-scaled 2.5 MiB stub when the header is absent or the
 *      request fails.
 */
export async function estimatePackStorageBytes(
  datasetId: string,
  hints?: BboxEstimateHints,
): Promise<number> {
  // Prefer bbox-area formula — avoids a network round-trip and is more
  // accurate than Content-Length (which is absent on chunked responses).
  if (hints?.bbox) {
    return estimatePackStorageBytesFromBbox({ bbox: hints.bbox, resolutionM: hints.resolutionM });
  }

  // Scale the base stub by resolution tier so that a 1 m multibeam survey
  // doesn't silently receive the same estimate as a 10 m regional survey when
  // bbox is unavailable.  Mirrors the avgBytesPerSample threshold in
  // estimatePackStorageBytesFromBbox.
  const resM = Math.max(1, hints?.resolutionM ?? 10);
  const stubMultiplier = resM <= 2 ? 4 : 1;
  const scaledStub = Math.round(2.5 * 1024 * 1024 * stubMultiplier);

  const terrainUrl = `${API_BASE}/api/datasets/${datasetId}/terrain`;
  try {
    const res = await fetch(terrainUrl, { method: "HEAD" });
    const contentLength = res.headers.get("content-length");
    if (contentLength) {
      const bytes = parseInt(contentLength, 10);
      if (!isNaN(bytes) && bytes > 0) {
        // Add ~200 KB overhead for tide + weather JSON pack data.
        // Content-Length reflects actual terrain bytes so no resolution scaling.
        return bytes + 200 * 1024;
      }
    }
  } catch {
    // Network unavailable or endpoint doesn't support HEAD — fall back.
  }
  return scaledStub;
}

// ─── Expiry detection ─────────────────────────────────────────────────────────

export async function getExpiringPacks(withinHours: number): Promise<OfflinePack[]> {
  const packs = await listOfflinePacks();
  const now = Date.now();
  const threshold = withinHours * 60 * 60 * 1000;
  return packs.filter((p) => {
    const expiresAt = new Date(p.tidePack.tidalExpiresAt).getTime();
    return expiresAt - now <= threshold && expiresAt > now;
  });
}

export function isPackExpired(pack: OfflinePack): boolean {
  return new Date(pack.tidePack.tidalExpiresAt).getTime() < Date.now();
}
