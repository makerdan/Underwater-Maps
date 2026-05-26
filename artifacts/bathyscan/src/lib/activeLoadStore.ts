/**
 * Active dataset-load store + ETA model.
 *
 * Tracks the one dataset whose terrain payload is currently downloading
 * (matches today's single-load behaviour) so the row in DatasetPanel /
 * DatasetFolderTree can render an accurate circular progress dial.
 *
 * Two progress signals are supported:
 *
 *  - Real byte progress when the server advertised `Content-Length`. The
 *    dial then reflects `bytesLoaded / bytesTotal` and the ETA is the
 *    extrapolated remaining time.
 *
 *  - A time-based asymptotic fallback when no byte total exists (e.g. a
 *    compressed response without `Content-Length`). We use a rolling
 *    per-bucket median of recent durations and the curve
 *    `min(0.99, 1 - exp(-t / median))` so the dial advances smoothly and
 *    never sits at 100% before the real completion event fires.
 *
 * The history is in-memory per browser tab (per spec).
 */
import { create } from "zustand";

const DEFAULT_FALLBACK_MEDIAN_MS = 3_000;
const HISTORY_MAX = 10;

export interface ActiveLoad {
  datasetId: string;
  bucket: string;
  bytesLoaded: number;
  bytesTotal: number | null;
  startedAt: number;
  /** Bumped on every progress event so subscribers re-render. */
  tick: number;
}

interface ActiveLoadStore {
  active: ActiveLoad | null;
  history: Record<string, number[]>;
  /** Begin tracking a new load. Aborts any previous one via the caller. */
  start: (opts: { datasetId: string; bucket: string }) => void;
  /** Update bytes received. */
  update: (datasetId: string, bytesLoaded: number, bytesTotal: number | null) => void;
  /** Mark the load complete and record its duration into the bucket. */
  complete: (datasetId: string) => void;
  /** Clear the active load (error or abort) without recording history. */
  fail: (datasetId: string) => void;
  /** Force a re-render (used by the dial's RAF ticker for time-based curves). */
  tickNow: () => void;
}

export const useActiveLoadStore = create<ActiveLoadStore>((set, get) => ({
  active: null,
  history: {},
  start: ({ datasetId, bucket }) =>
    set({
      active: {
        datasetId,
        bucket,
        bytesLoaded: 0,
        bytesTotal: null,
        startedAt: Date.now(),
        tick: 0,
      },
    }),
  update: (datasetId, bytesLoaded, bytesTotal) =>
    set((prev) => {
      if (!prev.active || prev.active.datasetId !== datasetId) return prev;
      // Progress must be monotonic — never let a stale callback rewind us.
      const nextLoaded = Math.max(prev.active.bytesLoaded, bytesLoaded);
      return {
        active: {
          ...prev.active,
          bytesLoaded: nextLoaded,
          bytesTotal: bytesTotal ?? prev.active.bytesTotal,
          tick: prev.active.tick + 1,
        },
      };
    }),
  complete: (datasetId) => {
    const { active, history } = get();
    if (!active || active.datasetId !== datasetId) {
      set({ active: null });
      return;
    }
    const duration = Math.max(1, Date.now() - active.startedAt);
    const prevHist = history[active.bucket] ?? [];
    const nextHist = [...prevHist, duration].slice(-HISTORY_MAX);
    set({
      active: null,
      history: { ...history, [active.bucket]: nextHist },
    });
  },
  fail: (datasetId) =>
    set((prev) => {
      if (!prev.active || prev.active.datasetId !== datasetId) return prev;
      return { active: null };
    }),
  tickNow: () =>
    set((prev) => {
      if (!prev.active) return prev;
      return { active: { ...prev.active, tick: prev.active.tick + 1 } };
    }),
}));

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export interface ProgressView {
  /** Smoothed 0..1 progress (capped at 0.99 in time-fallback mode). */
  progress: number;
  /** Estimated remaining time in ms when known, else null. */
  etaMs: number | null;
  /** ms since start. */
  elapsedMs: number;
  /** True when based on real Content-Length, false when on the time curve. */
  hasRealTotal: boolean;
}

export function computeProgress(
  active: ActiveLoad,
  history: Record<string, number[]>,
  now: number = Date.now(),
): ProgressView {
  const elapsedMs = Math.max(0, now - active.startedAt);

  if (active.bytesTotal && active.bytesTotal > 0) {
    const raw = active.bytesLoaded / active.bytesTotal;
    const progress = Math.max(0, Math.min(0.999, raw));
    let etaMs: number | null = null;
    if (progress > 0.01 && progress < 0.999) {
      etaMs = Math.max(0, elapsedMs * (1 / progress - 1));
    }
    return { progress, etaMs, elapsedMs, hasRealTotal: true };
  }

  const med = median(history[active.bucket] ?? []) ?? DEFAULT_FALLBACK_MEDIAN_MS;
  // Asymptotic curve never reaches 1 — completion event snaps it to 100%.
  const raw = 1 - Math.exp(-elapsedMs / med);
  const progress = Math.min(0.99, raw);
  const etaMs = Math.max(0, med - elapsedMs);
  return { progress, etaMs, elapsedMs, hasRealTotal: false };
}
