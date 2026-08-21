/**
 * Environmental observations domain service.
 *
 * Routes depend on this module for observation operations instead of importing
 * upstream/provider adapters directly. Provider modules remain deliberately
 * small and independently replaceable; their existing caches and fallback
 * behavior are not duplicated here.
 */

import {
  fetchStationObsAt,
  fetchWeatherStations,
  NoaaUnavailableError,
  type WeatherStation,
  type WeatherStationsResult,
} from "../../lib/noaaWeatherFetcher.js";
import { findBundledTemperatureProfile } from "../../lib/temperatureProfiles.js";
import type { TemperatureProfilePayload } from "../../routes/temperature-profile.js";
import {
  getStationList,
  getTidePredictions,
  getStationDatums,
  getHighLowEvents,
  getCurrentsPeak,
} from "./providers/noaaTides.js";

export type { WeatherStation, WeatherStationsResult, TemperatureProfilePayload };
export { NoaaUnavailableError };

export const environmentalObservations = {
  weather: {
    stations: (lat: number, lon: number, radiusMiles = 75): Promise<WeatherStationsResult> =>
      fetchWeatherStations(lat, lon, radiusMiles),
    stationAt: (
      stationId: string,
      targetTime: Date,
    ): ReturnType<typeof fetchStationObsAt> => fetchStationObsAt(stationId, targetTime),
  },

  temperature: {
    bundledProfile: (
      lat: number,
      lon: number,
      datasetId?: string | null,
    ): TemperatureProfilePayload | null => findBundledTemperatureProfile(lat, lon, datasetId),
  },
};

export async function tideStationList(
  type: "waterlevels" | "currentpredictions",
) {
  return getStationList(type);
}

export async function tidePredictions(stationId: string, now?: Date) {
  return getTidePredictions(stationId, now);
}

export async function tideDatums(stationId: string) {
  return getStationDatums(stationId);
}

export async function waterLevelEvents(
  stationId: string,
  refTime: Date,
  beforeDays?: number,
  afterDays?: number,
) {
  return getHighLowEvents(stationId, refTime, beforeDays, afterDays);
}

export async function currentPeak(stationId: string, refTime: Date) {
  return getCurrentsPeak(stationId, refTime);
}

export interface MarineSstResponse {
  hourly?: {
    time?: string[];
    sea_surface_temperature?: (number | null)[];
  };
}

export function pickCurrentSst(
  json: MarineSstResponse,
  now: Date = new Date(),
): { sst: number; timestamp: string } | null {
  const times = json.hourly?.time ?? [];
  const ssts = json.hourly?.sea_surface_temperature ?? [];
  if (times.length === 0 || ssts.length === 0) return null;

  const target = new Date(now);
  target.setUTCMinutes(0, 0, 0);
  const targetIso = target.toISOString().slice(0, 13);
  let exactIdx = -1;
  let lastFiniteIdx = -1;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const v = ssts[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    lastFiniteIdx = i;
    if (typeof t === "string" && t.slice(0, 13) === targetIso) {
      exactIdx = i;
      break;
    }
  }
  const idx = exactIdx !== -1 ? exactIdx : lastFiniteIdx;
  if (idx === -1) return null;
  const tsDate = typeof times[idx] === "string" ? new Date(`${times[idx]}Z`) : target;
  return {
    sst: Math.round((ssts[idx] as number) * 100) / 100,
    timestamp: tsDate.toISOString(),
  };
}

export async function fetchCurrentSst(
  lat: number,
  lon: number,
): Promise<{ sst: number; timestamp: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const url =
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
      "&hourly=sea_surface_temperature&forecast_days=1&timezone=UTC";
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return pickCurrentSst((await response.json()) as MarineSstResponse);
  } finally {
    clearTimeout(timeout);
  }
}