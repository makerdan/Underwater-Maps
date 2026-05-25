/**
 * settingsStore — persisted user preferences for BathyScan.
 *
 * Persisted to localStorage under the key "bathyscan:settings".
 * All settings are optional and fall back to sensible defaults.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface DatasetHomePosition {
  lon: number;
  lat: number;
  depth: number;
}

interface SettingsStore {
  gpsRecordingInterval: number;
  setGpsRecordingInterval: (ms: number) => void;

  /** Per-dataset saved camera spawn positions, set via the "Set as home" context menu action. */
  datasetHomePositions: Record<string, DatasetHomePosition>;
  setDatasetHome: (datasetId: string, pos: DatasetHomePosition) => void;
  clearDatasetHome: (datasetId: string) => void;
}

const DEFAULT_INTERVAL_MS = 10_000;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      gpsRecordingInterval: DEFAULT_INTERVAL_MS,
      setGpsRecordingInterval: (ms) => set({ gpsRecordingInterval: ms }),

      datasetHomePositions: {},
      setDatasetHome: (datasetId, pos) =>
        set((state) => ({
          datasetHomePositions: { ...state.datasetHomePositions, [datasetId]: pos },
        })),
      clearDatasetHome: (datasetId) =>
        set((state) => {
          const next = { ...state.datasetHomePositions };
          delete next[datasetId];
          return { datasetHomePositions: next };
        }),
    }),
    { name: "bathyscan:settings" },
  ),
);
