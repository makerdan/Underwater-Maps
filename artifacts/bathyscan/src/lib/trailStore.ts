/**
 * trailStore — Zustand store for GPS trail recording.
 *
 * While recording, samples the current GPS position every `intervalMs` ms.
 * On stop, returns the collected points and optionally uploads them.
 */
import { create } from "zustand";
import { useGpsStore, type GpsPosition } from "./gpsStore";

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

  startRecording: (intervalMs = DEFAULT_INTERVAL_MS) => {
    const { recording, intervalId } = get();
    if (recording) return;
    if (intervalId) clearInterval(intervalId);

    const now = Date.now();
    set({ recording: true, currentPoints: [], startedAt: now, intervalId: null });

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
    set((state) => ({
      currentPoints: [
        ...state.currentPoints,
        {
          lon: pos.longitude,
          lat: pos.latitude,
          accuracy: pos.accuracy,
          timestamp: pos.timestamp,
          seq: state.currentPoints.length,
        },
      ],
    }));
  },

  stopRecording: () => {
    const { intervalId, currentPoints } = get();
    if (intervalId) clearInterval(intervalId);
    set({ recording: false, intervalId: null });
    return currentPoints;
  },

  clearPoints: () => set({ currentPoints: [], startedAt: null }),
}));
