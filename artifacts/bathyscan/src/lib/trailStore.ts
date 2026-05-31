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
  isOverflowing: false,

  startRecording: (intervalMs = DEFAULT_INTERVAL_MS) => {
    const { recording, intervalId } = get();
    if (recording) return;
    if (intervalId) clearInterval(intervalId);

    const now = Date.now();
    set({ recording: true, currentPoints: [], startedAt: now, intervalId: null, isOverflowing: false });

    // Sample immediately then on interval
    const sample = () => {
      const pos = useGpsStore.getState().position;
      if (pos) get().addPoint(pos);
    };

    sample();
    const id = setInterval(sample, intervalMs);
    set({ intervalId: id });
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

      // Ring-buffer: drop oldest, append new, mark overflowing
      const trimmed = state.currentPoints.slice(1);
      trimmed.push(next);
      return { currentPoints: trimmed, isOverflowing: true };
    });
  },

  stopRecording: () => {
    const { intervalId, currentPoints } = get();
    if (intervalId) clearInterval(intervalId);
    set({ recording: false, intervalId: null });
    return currentPoints;
  },

  clearPoints: () => set({ currentPoints: [], startedAt: null, isOverflowing: false }),
}));
