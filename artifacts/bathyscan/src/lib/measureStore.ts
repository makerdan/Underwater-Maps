import { create } from "zustand";
import type { GpsPoint } from "./cameraStore";

export interface MeasurementResult {
  distanceKm: number;
  depthDeltaM: number;
  at: number;
}

interface MeasureStore {
  anchorGps: GpsPoint | null;
  result: MeasurementResult | null;
  setAnchor: (gps: GpsPoint) => void;
  setResult: (distanceKm: number, depthDeltaM: number) => void;
  clearAnchor: () => void;
  clearResult: () => void;
}

export const useMeasureStore = create<MeasureStore>((set) => ({
  anchorGps: null,
  result: null,
  setAnchor: (gps) => set({ anchorGps: gps, result: null }),
  setResult: (distanceKm, depthDeltaM) =>
    set({ anchorGps: null, result: { distanceKm, depthDeltaM, at: Date.now() } }),
  clearAnchor: () => set({ anchorGps: null }),
  clearResult: () => set({ result: null }),
}));
