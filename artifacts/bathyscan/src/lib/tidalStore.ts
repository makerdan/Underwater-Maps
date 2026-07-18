/**
 * Zustand store for the NOAA tide-prediction engine.
 *
 * Holds the nearest tide station resolved for the active dataset plus the
 * 31-day window of 6-minute predictions fetched from the server
 * (GET /api/tides/station and GET /api/tides/:stationId, both cached 24 h
 * server-side).
 *
 * IMPORTANT: always consume this store with per-field selectors
 * (`useTidalStore((s) => s.field)`) — never call `useTidalStore()` bare.
 */
import { create } from "zustand";
import {
  prepareTideSamples,
  type RawTideSample,
  type TideSample,
} from "@/lib/tidePrediction";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface TideStationInfo {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
}

export type TideFetchStatus = "idle" | "loading" | "ready" | "unavailable";

interface TidalStoreState {
  /** Nearest NOAA station for the active dataset, or null when none resolved. */
  station: TideStationInfo | null;
  stationStatus: TideFetchStatus;
  /** Prepared (epoch-ms, sorted) 6-minute prediction samples for `station`. */
  samples: TideSample[] | null;
  predictionsStatus: TideFetchStatus;
  /** Window bounds (epoch ms) of the loaded predictions, for the date picker. */
  windowStartMs: number | null;
  windowEndMs: number | null;

  /**
   * Set the station directly (e.g. from a dataset's stored tideStation
   * binding) and kick off the predictions fetch.
   */
  setStation: (station: TideStationInfo) => void;
  /** Resolve the nearest station for a centroid, then fetch predictions. */
  resolveStation: (lat: number, lon: number) => Promise<void>;
  /** Fetch the 31-day prediction window for the current station. */
  loadPredictions: (stationId: string) => Promise<void>;
  /** Clear everything (dataset unloaded / switched). */
  reset: () => void;
}

function apiUrl(path: string): string {
  const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
  return `${base}api${path}`;
}

export const useTidalStore = create<TidalStoreState>((set, get) => ({
  station: null,
  stationStatus: "idle",
  samples: null,
  predictionsStatus: "idle",
  windowStartMs: null,
  windowEndMs: null,

  setStation: (station) => {
    const prev = get().station;
    if (prev && prev.id === station.id && get().predictionsStatus === "ready") {
      // Same station with predictions already loaded — just refresh metadata.
      set({ station, stationStatus: "ready" });
      return;
    }
    set({
      station,
      stationStatus: "ready",
      samples: null,
      predictionsStatus: "idle",
      windowStartMs: null,
      windowEndMs: null,
    });
    void get().loadPredictions(station.id);
  },

  resolveStation: async (lat, lon) => {
    set({ stationStatus: "loading" });
    try {
      const res = await fetch(apiUrl(`/tides/station?lat=${lat}&lon=${lon}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        available: boolean;
        station?: TideStationInfo;
      };
      if (!json.available || !json.station) {
        set({ station: null, stationStatus: "unavailable" });
        return;
      }
      get().setStation(json.station);
    } catch {
      set({ station: null, stationStatus: "unavailable" });
    }
  },

  loadPredictions: async (stationId) => {
    set({ predictionsStatus: "loading" });
    try {
      const res = await fetch(apiUrl(`/tides/${stationId}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        windowStart: string;
        windowEnd: string;
        predictions: RawTideSample[];
      };
      const samples = prepareTideSamples(json.predictions ?? []);
      if (samples.length === 0) {
        set({ samples: null, predictionsStatus: "unavailable" });
        return;
      }
      // Ignore stale responses if the station changed mid-flight.
      if (get().station?.id !== stationId) return;
      set({
        samples,
        predictionsStatus: "ready",
        windowStartMs: Date.parse(json.windowStart) || samples[0]!.tMs,
        windowEndMs: Date.parse(json.windowEnd) || samples[samples.length - 1]!.tMs,
      });
    } catch {
      if (get().station?.id !== stationId) return;
      set({ samples: null, predictionsStatus: "unavailable" });
    }
  },

  reset: () =>
    set({
      station: null,
      stationStatus: "idle",
      samples: null,
      predictionsStatus: "idle",
      windowStartMs: null,
      windowEndMs: null,
    }),
}));
