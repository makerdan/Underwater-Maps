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
  addPoint: (pos: GpsPosition) => void;
  stopRecording: () => TrailGpsPoint[];
  clearPoints: () => void;
}

const DEFAULT_INTERVAL_MS = 10_000;

export const useTrailStore = create<TrailStore>((set, get) => ({
  recording: false,
  currentPoints: [],
  startedAt: null,
  intervalId: null,
  beforeUnloadCleanup: null,
  isOverflowing: false,

  startRecording: (intervalMs = DEFAULT_INTERVAL_MS) => {
    const { recording, intervalId, beforeUnloadCleanup: prevCleanup } = get();
    if (recording) return;

    // Clean up any leftover interval / listener from a previous aborted session.
    if (intervalId) clearInterval(intervalId);
    if (prevCleanup) window.removeEventListener("beforeunload", prevCleanup);

    const now = Date.now();
    set({
      recording: true,
      currentPoints: [],
      startedAt: now,
      intervalId: null,
      beforeUnloadCleanup: null,
      isOverflowing: false,
    });

    // Sample immediately, then on every interval tick.
    const sample = () => {
      const pos = useGpsStore.getState().position;
      if (pos) get().addPoint(pos);
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
