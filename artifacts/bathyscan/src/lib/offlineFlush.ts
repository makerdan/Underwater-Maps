/**
 * Offline-buffer flush helpers.
 *
 * `flushPendingTrails` and `flushPendingMarkers` drain queued writes stored in
 * localStorage / IndexedDB while the device was offline.
 *
 * `createFlushAllWithGuard` wraps any pair of flush functions with an
 * `isFlushing` mutex so concurrent calls (e.g. rapid "online" events) are
 * deduplicated — only one flush runs at a time.
 */

import { authorizedFetch } from "./authorizedFetch";

export async function flushPendingTrails(apiBase: string): Promise<void> {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("pending-trail-")) keys.push(k);
  }
  if (!keys.length) return;

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const payload = JSON.parse(raw) as {
        datasetId: string;
        name: string;
        colour?: string;
        startedAt: number;
        endedAt: number;
        points: {
          lon: number;
          lat: number;
          accuracy: number;
          timestamp: number;
          seq: number;
        }[];
      };
      const res = await authorizedFetch(`${apiBase}/api/trails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId: payload.datasetId,
          name: payload.name,
          colour: payload.colour ?? "#ff6600",
          startedAt: new Date(payload.startedAt).toISOString(),
          endedAt: new Date(payload.endedAt).toISOString(),
          points: payload.points,
        }),
      });
      if (res.ok) localStorage.removeItem(key);
    } catch {
      // leave key for next retry
    }
  }
}

export async function flushPendingMarkers(apiBase: string): Promise<void> {
  const { keys, get, del } = await import("idb-keyval");
  const allKeys = await keys();
  const markerKeys = allKeys.filter(
    (k): k is string =>
      typeof k === "string" && k.startsWith("pending-marker-"),
  );
  if (!markerKeys.length) return;

  for (const key of markerKeys) {
    try {
      const payload = await get(key);
      if (!payload) continue;
      const res = await authorizedFetch(`${apiBase}/api/markers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) await del(key);
    } catch {
      // leave for next retry
    }
  }
}

/**
 * Returns a `flushAll` function that runs `flushTrails` then `flushMarkers`
 * sequentially, guarded by a single-flight mutex. Concurrent invocations while
 * a flush is already in progress are silently dropped — only one flush runs at
 * a time.
 */
export function createFlushAllWithGuard(
  flushTrails: () => Promise<void>,
  flushMarkers: () => Promise<void>,
): () => Promise<void> {
  const isFlushing = { current: false };
  return async function flushAll() {
    if (isFlushing.current) return;
    isFlushing.current = true;
    try {
      await flushTrails();
      await flushMarkers();
    } finally {
      isFlushing.current = false;
    }
  };
}
