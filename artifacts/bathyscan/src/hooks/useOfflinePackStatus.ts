/**
 * useOfflinePackStatus — per-dataset offline pack status for library rows,
 * plus pure derivation helpers for folder/collection rollups.
 *
 * Status semantics:
 *   "downloaded" — a non-expired pack exists for the dataset
 *   "stale"      — the newest pack exists but its tide data has expired
 *   "none"       — no pack saved (datasets with this status get no badge)
 */
import { useEffect, useState } from "react";
import {
  listOfflinePacks,
  subscribeOfflinePacks,
  type OfflinePack,
} from "@/lib/offlinePackStore";

export type PackStatus = "downloaded" | "stale" | "none";

/** Rollup over a group of datasets (folder subtree / collection members). */
export type PackRollupStatus = "downloaded" | "stale" | "partial" | "none";

/**
 * Derive the newest-pack status per datasetId.
 *
 * Newest-wins mirrors getOfflinePackByDatasetId: re-saving creates a new IDB
 * record rather than overwriting, so only the latest save reflects what the
 * SW cache actually serves.
 *
 * `nowMs` is injectable for tests; expiry rule matches isPackExpired
 * (tidePack.tidalExpiresAt in the past).
 */
export function derivePackStatusMap(
  packs: OfflinePack[],
  nowMs: number = Date.now(),
): Map<string, PackStatus> {
  const newest = new Map<string, OfflinePack>();
  for (const p of packs) {
    const cur = newest.get(p.datasetId);
    if (!cur || new Date(p.savedAt).getTime() > new Date(cur.savedAt).getTime()) {
      newest.set(p.datasetId, p);
    }
  }
  const out = new Map<string, PackStatus>();
  for (const [datasetId, pack] of newest) {
    const expired = new Date(pack.tidePack.tidalExpiresAt).getTime() < nowMs;
    out.set(datasetId, expired ? "stale" : "downloaded");
  }
  return out;
}

/**
 * Roll a group of per-dataset statuses up to one indicator:
 *   none        — no member has a pack
 *   downloaded  — every member has a fresh pack
 *   stale       — every member has a pack, at least one expired
 *   partial     — some members have packs, some do not
 */
export function rollupPackStatus(statuses: PackStatus[]): PackRollupStatus {
  if (statuses.length === 0) return "none";
  let haveCount = 0;
  let staleCount = 0;
  for (const s of statuses) {
    if (s !== "none") haveCount++;
    if (s === "stale") staleCount++;
  }
  if (haveCount === 0) return "none";
  if (haveCount < statuses.length) return "partial";
  return staleCount > 0 ? "stale" : "downloaded";
}

/**
 * Live per-dataset pack statuses. Reloads whenever a pack is saved or
 * deleted (via the offlinePackStore listener registry).
 *
 * IDB failures resolve to an empty map — status badges silently disappear
 * rather than crashing library rows (also keeps jsdom tests without a real
 * indexedDB working).
 */
export function useOfflinePackStatuses(): Map<string, PackStatus> {
  const [statuses, setStatuses] = useState<Map<string, PackStatus>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const packs = await listOfflinePacks();
        if (!cancelled) setStatuses(derivePackStatusMap(packs));
      } catch {
        if (!cancelled) setStatuses(new Map());
      }
    };
    void refresh();
    const unsubscribe = subscribeOfflinePacks(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return statuses;
}
