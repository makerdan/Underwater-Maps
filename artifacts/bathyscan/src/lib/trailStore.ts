/**
 * trailStore — Zustand store for GPS trail recording.
 *
 * While recording, samples the current GPS position every `intervalMs` ms.
 * On stop, returns the collected points and optionally uploads them.
 *
 * Memory is bounded by MAX_TRAIL_POINTS. When the cap is reached the oldest
 * point is evicted (ring-buffer semantics) and `isOverflowing` is set true so
 * the UI can show a notice to the user.
 */
import { create } from "zustand";
import { useGpsStore, type GpsPosition } from "./gpsStore";
import { useSettingsStore } from "./settingsStore";

export const MAX_TRAIL_POINTS = 10_000;

export interface TrailGpsPoint {
  lon: number;
  lat: number;
  accuracy: number;
  timestamp: number;
  seq: number;
}

interface TrailStore {
  recording: boolean;
  /** Colour applied to this recording session — set from defaultTrailColor at startRecording time. */
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
  startRecording: (intervalMs?: number) => void;
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
  /**
   * Update the session color while recording — call when the user picks a
   * different colour in the TrailRecorder swatch so TrailLayer reflects the
   * choice immediately without waiting for a new session.
   */
  setColor: (color: string) => void;
  addPoint: (pos: GpsPosition) => void;
  stopRecording: () => TrailGpsPoint[];
  clearPoints: () => void;
}

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_TRAIL_COLOR = "#ff6600";

type Get = () => TrailStore;
type Set = (partial: Partial<TrailStore>) => void;

/**
 * Shared implementation for startRecording / resumeRecording.
 * When `preservePoints` is true, previously recorded points (and startedAt /
 * isOverflowing state) are kept so the session continues where it left off.
 */
function beginRecording(get: Get, set: Set, intervalMs: number, preservePoints: boolean): void {
  const { recording, intervalId, beforeUnloadCleanup: prevCleanup, startedAt } = get();
  if (recording) return;

  // Clean up any leftover interval / listener from a previous aborted session.
  if (intervalId) clearInterval(intervalId);
  if (prevCleanup) window.removeEventListener("beforeunload", prevCleanup);

  const now = Date.now();
  // On a fresh recording, pick up the user's current defaultTrailColor so
  // TrailLayer and the save payload both reflect their preference.
  const colorPatch = preservePoints
    ? {}
    : { color: useSettingsStore.getState().defaultTrailColor ?? DEFAULT_TRAIL_COLOR };

  set({
    recording: true,
    intervalId: null,
    beforeUnloadCleanup: null,
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
  const cleanup = () => {
    clearInterval(id);
  };
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

  startRecording: (intervalMs = DEFAULT_INTERVAL_MS) => {
    beginRecording(get, set, intervalMs, /* preservePoints */ false);
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
    const cleanup = () => {
      clearInterval(id);
    };
    window.addEventListener("beforeunload", cleanup, { once: true });

    set({ intervalId: id, beforeUnloadCleanup: cleanup });
  },

  addPoint: (pos) => {
    set((state) => {
      const next: TrailGpsPoint = {
        lon: pos.longitude,
        lat: pos.latitude,
        accuracy: pos.accuracy,
        timestamp: pos.timestamp,
        seq: state.currentPoints.length,
      };

      if (state.currentPoints.length < MAX_TRAIL_POINTS) {
        return { currentPoints: [...state.currentPoints, next] };
      }

      // Ring-buffer: drop oldest, append new, mark overflowing.
      const trimmed = state.currentPoints.slice(1);
      trimmed.push(next);
      return { currentPoints: trimmed, isOverflowing: true };
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
    return currentPoints;
  },

  clearPoints: () => set({ currentPoints: [], startedAt: null, isOverflowing: false }),
}));
