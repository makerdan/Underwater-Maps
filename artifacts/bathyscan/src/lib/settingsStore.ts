/**
 * settingsStore — persisted user preferences for BathyScan.
 *
 * Persisted to localStorage under the key "bathyscan:settings".
 * All settings are optional and fall back to sensible defaults.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsStore {
  gpsRecordingInterval: number;
  setGpsRecordingInterval: (ms: number) => void;
}

const DEFAULT_INTERVAL_MS = 10_000;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      gpsRecordingInterval: DEFAULT_INTERVAL_MS,
      setGpsRecordingInterval: (ms) => set({ gpsRecordingInterval: ms }),
    }),
    { name: "bathyscan:settings" },
  ),
);
