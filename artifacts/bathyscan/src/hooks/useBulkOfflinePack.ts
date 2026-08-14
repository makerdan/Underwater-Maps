/**
 * useBulkOfflinePack — batch-saves every selected dataset for offline use.
 *
 * Datasets are processed sequentially (never in parallel) to avoid overwhelming
 * storage and network.  Cancellation flips a ref flag that is checked between
 * iterations; the in-flight saveOfflinePack call for the current dataset
 * always completes normally.
 *
 * Mid-batch network loss pauses the batch between iterations.  Call resume()
 * to continue from where the batch left off.
 */

import { useCallback, useRef, useState } from "react";
import {
  saveOfflinePack,
  listOfflinePacks,
  isPackExpired,
  type OfflinePack,
} from "@/lib/offlinePackStore";
import { useOfflineStore } from "@/lib/offlineStore";

export interface BulkDataset {
  id: string;
  name: string;
  bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null;
}

export type RowStatus =
  | "pending"
  | "skipped"
  | "saving"
  | "done"
  | "done-warning"
  | "error"
  | "paused";

export interface BulkRow {
  dataset: BulkDataset;
  status: RowStatus;
  /** Steps from the underlying saveOfflinePack call (while saving). */
  progress: import("@/lib/offlinePackStore").PackProgress[];
  /** The finished pack, once done. */
  pack: OfflinePack | null;
  /** Error message, when status === "error". */
  error: string | null;
  /** Existing non-expired pack for this dataset (candidate for skip). */
  existingPack: OfflinePack | null;
  /** Advisory warning shown on success (e.g. SW probe failed, tide expiring). */
  warning: string | null;
}

export type BatchPhase =
  | "idle"
  | "preflighting"
  | "preflight-error"
  | "running"
  | "paused"
  | "done"
  | "cancelled";

export interface StorageQuota {
  used: number;
  total: number;
}

/** 50 MB low-water mark — advisory warning only, not a hard block. */
export const QUOTA_LOW_WATER_BYTES = 50 * 1024 * 1024;

export interface UseBulkOfflinePackResult {
  rows: BulkRow[];
  phase: BatchPhase;
  /** Pre-flight error message that prevents the batch from starting. */
  preflightError: string | null;
  /** Advisory quota warning (does not block start). */
  quotaWarning: string | null;
  storageQuota: StorageQuota | null;
  /** Dataset ids that have "force update" checked. */
  forceUpdateIds: Set<string>;
  toggleForceUpdate: (id: string) => void;
  /** Days of tide predictions to fetch per pack. */
  days: number;
  setDays: (d: number) => void;
  start: () => void;
  cancel: () => void;
  resume: () => void;
  refreshQuota: () => Promise<void>;
}

export function useBulkOfflinePack(datasets: BulkDataset[]): UseBulkOfflinePackResult {
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [phase, setPhase] = useState<BatchPhase>("idle");
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [quotaWarning, setQuotaWarning] = useState<string | null>(null);
  const [storageQuota, setStorageQuota] = useState<StorageQuota | null>(null);
  const [forceUpdateIds, setForceUpdateIds] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(7);

  const cancelRef = useRef(false);
  /** The row index to resume from after a network-loss pause. */
  const resumeIndexRef = useRef(0);

  // ── Quota helper ─────────────────────────────────────────────────────────

  const refreshQuota = useCallback(async () => {
    if (typeof navigator === "undefined" || !("storage" in navigator)) return;
    try {
      const est = await navigator.storage.estimate();
      if (est.usage != null && est.quota != null) {
        setStorageQuota({ used: est.usage, total: est.quota });
        const remaining = est.quota - est.usage;
        if (remaining < QUOTA_LOW_WATER_BYTES) {
          const mb = (remaining / (1024 * 1024)).toFixed(0);
          setQuotaWarning(
            `Storage is low (${mb} MB remaining). Free space before saving packs.`,
          );
        } else {
          setQuotaWarning(null);
        }
      }
    } catch {
      // Storage estimate not supported in this environment.
    }
  }, []);

  // ── Toggle force-update ──────────────────────────────────────────────────

  const toggleForceUpdate = useCallback((id: string) => {
    setForceUpdateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Core batch runner ────────────────────────────────────────────────────

  /**
   * Process datasets starting at `startIndex`.  `initialRows` is the full
   * snapshot of rows at the start of this run (or resume).  `forceIds` and
   * `tideDays` are captured once per start/resume so that UI state changes
   * mid-batch do not affect the running iteration.
   */
  const runBatch = useCallback(
    async (
      startIndex: number,
      initialRows: BulkRow[],
      forceIds: Set<string>,
      tideDays: number,
    ) => {
      // Keep a local mirror of rows so we can read the latest status without
      // relying on the stale closure from the previous render cycle.
      let localRows = initialRows;

      const patchLocal = (id: string, patch: Partial<BulkRow>) => {
        localRows = localRows.map((r) =>
          r.dataset.id === id ? { ...r, ...patch } : r,
        );
      };

      for (let i = startIndex; i < localRows.length; i++) {
        // ── Cancellation check ─────────────────────────────────────────────
        if (cancelRef.current) {
          setPhase("cancelled");
          return;
        }

        // ── Network check ─────────────────────────────────────────────────
        const isOnline = useOfflineStore.getState().isOnline;
        if (!isOnline) {
          resumeIndexRef.current = i;
          setPhase("paused");
          setRows((prev) =>
            prev.map((r, idx) =>
              idx >= i && r.status === "pending"
                ? { ...r, status: "paused" }
                : r,
            ),
          );
          return;
        }

        const row = localRows[i];
        if (!row) continue;
        const ds = row.dataset;

        // ── Skip check ────────────────────────────────────────────────────
        if (
          row.existingPack &&
          !isPackExpired(row.existingPack) &&
          !forceIds.has(ds.id)
        ) {
          patchLocal(ds.id, { status: "skipped" });
          setRows((prev) =>
            prev.map((r) =>
              r.dataset.id === ds.id ? { ...r, status: "skipped" } : r,
            ),
          );
          continue;
        }

        // ── Mark saving ───────────────────────────────────────────────────
        patchLocal(ds.id, { status: "saving", progress: [] });
        setRows((prev) =>
          prev.map((r) =>
            r.dataset.id === ds.id ? { ...r, status: "saving", progress: [] } : r,
          ),
        );

        try {
          const pack = await saveOfflinePack(ds, tideDays, (p) => {
            setRows((prev) =>
              prev.map((r) => {
                if (r.dataset.id !== ds.id) return r;
                const idx = r.progress.findIndex((x) => x.step === p.step);
                const newProgress =
                  idx >= 0
                    ? r.progress.map((x, j) => (j === idx ? p : x))
                    : [...r.progress, p];
                return { ...r, progress: newProgress };
              }),
            );
          });

          // ── SW integrity probe ────────────────────────────────────────
          let warning: string | null = null;
          try {
            const probeRes = await fetch(pack.terrainUrl, {
              headers: { "x-serve-from-pack": "1" },
              cache: "no-store",
            });
            if (!probeRes.ok) {
              warning =
                "Cached but unverified — SW may not be active. Terrain may not be available offline.";
            }
          } catch {
            warning =
              "Cached but unverified — SW may not be active. Terrain may not be available offline.";
          }

          // ── Tide-expiry warning ────────────────────────────────────────
          const tidalMs =
            new Date(pack.tidePack.tidalExpiresAt).getTime() - Date.now();
          if (tidalMs > 0 && tidalMs < 48 * 60 * 60 * 1000 && !warning) {
            warning = "Tide data expires soon (within 48 hours)";
          }

          const finalStatus: RowStatus = warning ? "done-warning" : "done";
          patchLocal(ds.id, { status: finalStatus, pack, warning });
          setRows((prev) =>
            prev.map((r) =>
              r.dataset.id === ds.id
                ? { ...r, status: finalStatus, pack, warning }
                : r,
            ),
          );
        } catch (err) {
          // Row failure does NOT abort the rest of the batch.
          const msg = err instanceof Error ? err.message : "Failed to save pack";
          patchLocal(ds.id, { status: "error", error: msg });
          setRows((prev) =>
            prev.map((r) =>
              r.dataset.id === ds.id ? { ...r, status: "error", error: msg } : r,
            ),
          );
        }
      }

      setPhase("done");

      // Refresh quota after the batch completes.
      if (typeof navigator !== "undefined" && "storage" in navigator) {
        try {
          const est = await navigator.storage.estimate();
          if (est.usage != null && est.quota != null) {
            setStorageQuota({ used: est.usage, total: est.quota });
          }
        } catch {
          // ignore
        }
      }
    },
    [],
  );

  // ── Pre-flight checks ────────────────────────────────────────────────────

  const runPreflight = useCallback(async (): Promise<boolean> => {
    setPreflightError(null);

    // (a) Online check.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setPreflightError("Go online to save offline packs.");
      return false;
    }

    // (b) IDB availability probe.
    try {
      await listOfflinePacks();
    } catch (e) {
      setPreflightError(
        `Storage unavailable — ${e instanceof Error ? e.message : "IndexedDB not accessible"}`,
      );
      return false;
    }

    // (c) Quota check (advisory — sets quotaWarning, does not return false).
    await refreshQuota();

    return true;
  }, [refreshQuota]);

  // ── start ────────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    cancelRef.current = false;
    // Enter "preflighting" so controls are hidden while checks run, but without
    // committing to "running" before we know preflight succeeded.
    setPhase("preflighting");
    setPreflightError(null);

    const ok = await runPreflight();
    if (!ok) {
      setPhase("preflight-error");
      return;
    }

    // Load existing packs so we can determine which rows to skip.
    // Propagate failures as a preflight error — silently converting to [] would
    // mean all packs are re-downloaded even when valid ones already exist.
    let existingPacks: OfflinePack[] = [];
    try {
      existingPacks = await listOfflinePacks();
    } catch (e) {
      setPreflightError(
        `Cannot check existing packs — ${e instanceof Error ? e.message : "storage unavailable"}. Try closing and reopening the panel.`,
      );
      setPhase("preflight-error");
      return;
    }

    setPhase("running");

    const initialRows: BulkRow[] = datasets.map((ds) => {
      const existing = existingPacks.find((p) => p.datasetId === ds.id) ?? null;
      return {
        dataset: ds,
        status: "pending",
        progress: [],
        pack: null,
        error: null,
        existingPack: existing,
        warning: null,
      };
    });
    setRows(initialRows);
    resumeIndexRef.current = 0;

    const forceIds = new Set(forceUpdateIds);
    const tideDays = days;

    await runBatch(0, initialRows, forceIds, tideDays);
  }, [datasets, forceUpdateIds, days, runPreflight, runBatch]);

  // ── cancel ───────────────────────────────────────────────────────────────

  const cancel = useCallback(() => {
    cancelRef.current = true;
    // If currently paused (not iterating), set phase immediately.
    setPhase((prev) => (prev === "paused" ? "cancelled" : prev));
  }, []);

  // ── resume ───────────────────────────────────────────────────────────────

  const resume = useCallback(() => {
    setPhase((prev) => {
      if (prev !== "paused") return prev;

      cancelRef.current = false;

      // We need to read the current rows and re-launch the batch.
      // Since setState callback can't be async, we schedule via setRows.
      setRows((currentRows) => {
        const restored = currentRows.map((r) =>
          r.status === "paused" ? { ...r, status: "pending" as RowStatus } : r,
        );

        const forceIds = new Set(forceUpdateIds);
        const tideDays = days;
        const idx = resumeIndexRef.current;

        // Kick off the batch outside the setState synchronously.
        void Promise.resolve().then(() =>
          runBatch(idx, restored, forceIds, tideDays),
        );

        return restored;
      });

      return "running";
    });
  }, [forceUpdateIds, days, runBatch]);

  return {
    rows,
    phase,
    preflightError,
    quotaWarning,
    storageQuota,
    forceUpdateIds,
    toggleForceUpdate,
    days,
    setDays,
    start,
    cancel,
    resume,
    refreshQuota,
  };
}
