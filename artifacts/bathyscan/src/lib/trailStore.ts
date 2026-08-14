/**
 * trailStore — Zustand store for GPS trail recording.
 *
 * While recording, samples the current GPS position every `intervalMs` ms.
 * On stop, returns the collected points and optionally uploads them.
 *
 * Memory is bounded by MAX_TRAIL_POINTS. When the cap is reached the oldest
 * point is evicted (ring-buffer semantics) and `isOverflowing` is set true so
 * the UI can show a notice to the user.
 *
 * Draft persistence: active recording sessions are checkpointed to
 * sessionStorage on every N point adds. On next page load a `draftTrail` is
 * surfaced so the UI can offer to resume or discard the interrupted session.
 */
import { create } from "zustand";
import { useGpsStore, type GpsPosition } from "./gpsStore";
import { useSettingsStore } from "./settingsStore";

export const MAX_TRAIL_POINTS = 10_000;

/** sessionStorage key for in-progress trail draft. */
const TRAIL_DRAFT_KEY = "bathyscan-trail-draft";

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_TRAIL_COLOR = "#ff6600";

export interface TrailGpsPoint {
  lon: number;
  lat: number;
  accuracy: number;
  timestamp: number;
  seq: number;
}

export interface TrailDraft {
  points: TrailGpsPoint[];
  startedAt: number;
  /** Monotonic seq counter value at checkpoint time, so resume continues
   *  numbering from where it left off rather than restarting at 0. */
  sessionSeq: number;
}

interface TrailStore {
  recording: boolean;
  /** Trail colour for the active or most-recently-recorded session. */
  color: string;
  currentPoints: TrailGpsPoint[];
  startedAt: number | null;
  intervalId: ReturnType<typeof setInterval> | null;
  /**
   * The `beforeunload` listener registered when recording starts.
   * Stored in state so `stopRecording` can remove it cleanly without
   * mutating the timer-id primitive (which throws in strict-mode ES modules).
   */
  beforeUnloadCleanup: (() => void) | null;
  isOverflowing: boolean;
  /**
   * An in-progress trail draft recovered from sessionStorage after a page
   * reload during an active recording session. Null when there is no draft.
   */
  draftTrail: TrailDraft | null;
  startRecording: (intervalMs?: number, color?: string) => void;
  /**
   * Resume recording without clearing previously recorded points — used by
   * Live mode so switching tabs pauses (rather than resets) the trail.
   */
  resumeRecording: (intervalMs?: number) => void;
  /**
   * Change the sampling interval of an active recording session in place.
   * No-op when not recording.
   */
  setSamplingInterval: (intervalMs: number) => void;
  /** Update the trail colour stored in the session (for live TrailLayer sync). */
  setColor: (color: string) => void;
  addPoint: (pos: GpsPosition) => void;
  stopRecording: () => TrailGpsPoint[];
  clearPoints: () => void;
  /**
   * Restore a recovered draft into the live store state so `resumeRecording`
   * can continue the session where it left off.
   */
  resumeDraft: () => void;
  /**
   * Permanently discard the recovered draft (sessionStorage + state).
   */
  discardDraft: () => void;
}

type Get = () => TrailStore;
type Set = (partial: Partial<TrailStore>) => void;

// ---------------------------------------------------------------------------
// Module-level monotonic sequence counter.
// Independent of ring-buffer length so post-eviction points get unique, ordered
// sequence numbers. Reset to 0 on a fresh startRecording(); preserved across
// resumeRecording() so the sequence continues unbroken.
// ---------------------------------------------------------------------------
let sessionSeq = 0;

// ---------------------------------------------------------------------------
// Checkpoint throttle — write sessionStorage at most every N points.
// On beforeunload the final state is always flushed regardless of this counter.
// ---------------------------------------------------------------------------
const DRAFT_CHECKPOINT_EVERY = 10;
let checkpointCounter = 0;

/** Exported for test isolation — resets the module-level counters. */
export function __resetSessionSeqForTests(): void {
  sessionSeq = 0;
  checkpointCounter = 0;
}

// ---------------------------------------------------------------------------
// sessionStorage draft helpers — all wrapped in try/catch for private-browsing
// and storage-full environments.
// ---------------------------------------------------------------------------

/**
 * Build a `beforeunload` handler for a given interval id that:
 *   1. Clears the sampling timer.
 *   2. Always flushes the current points to sessionStorage so the final
 *      state survives a hard page close, regardless of the checkpoint counter.
 *
 * Used by both `beginRecording` and `setSamplingInterval` so that retiming
 * the session does not silently downgrade the unload guard.
 */
function makeDraftFlushingCleanup(get: Get, id: ReturnType<typeof setInterval>): () => void {
  return () => {
    clearInterval(id);
    const { currentPoints, startedAt } = get();
    if (startedAt !== null && currentPoints.length > 0) {
      saveDraft(currentPoints, startedAt);
    }
  };
}

function saveDraft(points: TrailGpsPoint[], startedAt: number): void {
  try {
    const draft: TrailDraft = { points, startedAt, sessionSeq };
    sessionStorage.setItem(TRAIL_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage unavailable — silently skip checkpoint
  }
}

function clearDraftStorage(): void {
  try {
    sessionStorage.removeItem(TRAIL_DRAFT_KEY);
  } catch {
    // ignore
  }
}

function loadDraftFromStorage(): TrailDraft | null {
  try {
    const raw = sessionStorage.getItem(TRAIL_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const candidate = parsed as TrailDraft;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !Array.isArray(candidate.points) ||
      typeof candidate.startedAt !== "number" ||
      !Number.isFinite(candidate.startedAt) ||
      typeof candidate.sessionSeq !== "number" ||
      !Number.isFinite(candidate.sessionSeq) ||
      candidate.sessionSeq < 0
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

// Read any persisted draft at module load time (i.e. on page load / HMR).
const initialDraft = loadDraftFromStorage();

/**
 * Shared implementation for startRecording / resumeRecording.
 * When `preservePoints` is true, previously recorded points (and startedAt /
 * isOverflowing state) are kept so the session continues where it left off.
 */
function beginRecording(get: Get, set: Set, intervalMs: number, preservePoints: boolean, color?: string): void {
  const { recording, intervalId, beforeUnloadCleanup: prevCleanup, startedAt } = get();
  if (recording) return;

  // Clean up any leftover interval / listener from a previous aborted session.
  if (intervalId) clearInterval(intervalId);
  if (prevCleanup) window.removeEventListener("beforeunload", prevCleanup);

  const now = Date.now();

  if (!preservePoints) {
    // Fresh start — reset the monotonic counter, checkpoint counter, and wipe
    // any in-progress draft.
    sessionSeq = 0;
    checkpointCounter = 0;
    clearDraftStorage();
  }
  // When preservePoints is true (resume), sessionSeq already holds the value
  // from when recording was last paused (or restored from the draft).

  // On a fresh recording, use the explicitly passed color if provided;
  // otherwise fall back to the user's stored default so TrailLayer and the
  // save payload both reflect their preference.
  const colorPatch = preservePoints
    ? {}
    : { color: color ?? useSettingsStore.getState().defaultTrailColor ?? DEFAULT_TRAIL_COLOR };

  set({
    recording: true,
    intervalId: null,
    beforeUnloadCleanup: null,
    draftTrail: null,
    ...colorPatch,
    ...(preservePoints
      ? { startedAt: startedAt ?? now }
      : { currentPoints: [], startedAt: now, isOverflowing: false }),
  });

  // Sample immediately, then on every interval tick.
  // Skip recording when GPS is not active (signal lost / error) so stale
  // last-known coordinates are never appended as if they were a live fix.
  const sample = () => {
    const gps = useGpsStore.getState();
    if (gps.active && gps.position) get().addPoint(gps.position);
  };

  sample();
  const id = setInterval(sample, intervalMs);

  // Guard against the page closing while a trail is still recording.
  // The handler is stored in Zustand state (not on the timer-id primitive,
  // which is a number and throws when you assign properties to it in strict
  // ES-module mode) so stopRecording() can remove it on a normal stop.
  const cleanup = makeDraftFlushingCleanup(get, id);
  window.addEventListener("beforeunload", cleanup, { once: true });

  set({ intervalId: id, beforeUnloadCleanup: cleanup });
}

export const useTrailStore = create<TrailStore>((set, get) => ({
  recording: false,
  color: DEFAULT_TRAIL_COLOR,
  currentPoints: [],
  startedAt: null,
  intervalId: null,
  beforeUnloadCleanup: null,
  isOverflowing: false,
  // Surface any draft found at page load so the UI can offer resume/discard.
  draftTrail: initialDraft,

  startRecording: (intervalMs = DEFAULT_INTERVAL_MS, color?) => {
    beginRecording(get, set, intervalMs, /* preservePoints */ false, color);
  },

  resumeRecording: (intervalMs = DEFAULT_INTERVAL_MS) => {
    beginRecording(get, set, intervalMs, /* preservePoints */ true);
  },

  setColor: (color) => set({ color }),

  setSamplingInterval: (intervalMs) => {
    const { recording, intervalId, beforeUnloadCleanup } = get();
    if (!recording) return;

    if (intervalId) clearInterval(intervalId);
    if (beforeUnloadCleanup) {
      window.removeEventListener("beforeunload", beforeUnloadCleanup);
    }

    const sample = () => {
      const gps = useGpsStore.getState();
      if (gps.active && gps.position) get().addPoint(gps.position);
    };
    const id = setInterval(sample, intervalMs);
    // Use the shared helper so retiming does not downgrade the unload guard.
    const cleanup = makeDraftFlushingCleanup(get, id);
    window.addEventListener("beforeunload", cleanup, { once: true });

    set({ intervalId: id, beforeUnloadCleanup: cleanup });
  },

  addPoint: (pos) => {
    set((state) => {
      const seq = sessionSeq++;
      const next: TrailGpsPoint = {
        lon: pos.longitude,
        lat: pos.latitude,
        accuracy: pos.accuracy,
        timestamp: pos.timestamp,
        seq,
      };

      let nextPoints: TrailGpsPoint[];
      let nextOverflowing = state.isOverflowing;

      if (state.currentPoints.length < MAX_TRAIL_POINTS) {
        nextPoints = [...state.currentPoints, next];
      } else {
        // Ring-buffer: drop oldest, append new, mark overflowing.
        nextPoints = [...state.currentPoints.slice(1), next];
        nextOverflowing = true;
      }

      // Checkpoint to sessionStorage so a page reload can offer to resume.
      // Throttled: write every DRAFT_CHECKPOINT_EVERY points to avoid
      // quadratic serialisation cost on long sessions. The beforeunload
      // handler always flushes the final state regardless of the counter.
      checkpointCounter++;
      if (state.startedAt !== null && checkpointCounter % DRAFT_CHECKPOINT_EVERY === 0) {
        saveDraft(nextPoints, state.startedAt);
      }

      return { currentPoints: nextPoints, isOverflowing: nextOverflowing };
    });
  },

  stopRecording: () => {
    const { intervalId, beforeUnloadCleanup, currentPoints } = get();
    if (intervalId) clearInterval(intervalId);
    if (beforeUnloadCleanup) {
      // Remove the listener so it doesn't dangle after a normal stop.
      window.removeEventListener("beforeunload", beforeUnloadCleanup);
    }
    set({ recording: false, intervalId: null, beforeUnloadCleanup: null });
    // Clear the draft — the session has ended (either saved or discarded by
    // the caller).
    clearDraftStorage();
    return currentPoints;
  },

  clearPoints: () => {
    sessionSeq = 0;
    checkpointCounter = 0;
    clearDraftStorage();
    set({ currentPoints: [], startedAt: null, isOverflowing: false, draftTrail: null });
  },

  resumeDraft: () => {
    const { draftTrail } = get();
    if (!draftTrail) return;
    // Restore the seq counter so recording continues from where it left off.
    sessionSeq = draftTrail.sessionSeq;
    set({
      currentPoints: draftTrail.points,
      startedAt: draftTrail.startedAt,
      isOverflowing: draftTrail.points.length >= MAX_TRAIL_POINTS,
      draftTrail: null,
    });
  },

  discardDraft: () => {
    clearDraftStorage();
    set({ draftTrail: null });
  },
}));
