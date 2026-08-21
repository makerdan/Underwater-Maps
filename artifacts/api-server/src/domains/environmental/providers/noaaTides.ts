import { logger } from "../../../lib/logger.js";
import { registerCache } from "../../../lib/cacheRegistry.js";
import type { TideEvent } from "../../../lib/slack.js";

const NOAA_BASE = "https://api.tidesandcurrents.noaa.gov";
const KM_TO_MILES = 0.621371;
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface NoaaStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}
export type StationListType = "waterlevels" | "currentpredictions";
export type CurrentsPeakResult = { peakSpeedKnots: number; floodBearingDeg: number } | null;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json() as Promise<T>;
}
function dateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

const stationCache = new Map<StationListType, { data: NoaaStation[]; ts: number }>();
const stationFailures = new Map<StationListType, number>();
const STATION_TTL = 24 * 60 * 60 * 1000;
const EMPTY_STATION_TTL = 5 * 60 * 1000;
const STATION_FAILURE_TTL = 60 * 1000;
registerCache(() => { stationCache.clear(); stationFailures.clear(); });

export function __clearStationListCachesForTests(): void {
  stationCache.clear();
  stationFailures.clear();
}

export function refreshStationLists(): number {
  const cleared = stationCache.size;
  stationCache.clear();
  stationFailures.clear();
  return cleared;
}

export async function getStationList(type: StationListType): Promise<NoaaStation[] | null> {
  const now = Date.now();
  const cached = stationCache.get(type);
  if (cached && now - cached.ts < (cached.data.length ? STATION_TTL : EMPTY_STATION_TTL)) return cached.data;
  const failedAt = stationFailures.get(type);
  if (failedAt != null && now - failedAt < STATION_FAILURE_TTL) return cached?.data ?? null;
  try {
    const resp = await fetchJson<{ stations: Array<{ id: string; name: string; lat: number; lng: number }> }>(
      `${NOAA_BASE}/mdapi/prod/webapi/stations.json?type=${type}&units=metric`,
    );
    const data = resp.stations.map((s) => ({ id: s.id, name: s.name, lat: Number(s.lat), lng: Number(s.lng) }));
    stationFailures.delete(type);
    stationCache.set(type, { data, ts: now });
    return data;
  } catch (err) {
    logger.warn({ err, type }, "Failed to fetch NOAA station list");
    stationFailures.set(type, now);
    return cached?.data ?? null;
  }
}

export async function findNearestStation(
  lat: number, lon: number, type: StationListType, maxKm = Infinity,
): Promise<NoaaStation | null> {
  const stations = await getStationList(type);
  let nearest: NoaaStation | null = null;
  let distance = Infinity;
  for (const station of stations ?? []) {
    const km = haversineKm(lat, lon, station.lat, station.lng);
    if (km < distance && km <= maxKm) { distance = km; nearest = station; }
  }
  return nearest;
}

const highLowCache = new Map<string, { result: TideEvent[] | null; ts: number }>();
const currentCache = new Map<string, { result: CurrentsPeakResult; ts: number }>();
const TIDE_TTL = 30 * 60 * 1000;
registerCache(() => { highLowCache.clear(); currentCache.clear(); });

export function __clearHighLowEventsCacheForTests(): void { highLowCache.clear(); }

export async function getHighLowEvents(
  stationId: string, refTime: Date, beforeDays = 1, afterDays = 2,
): Promise<TideEvent[] | null> {
  const start = new Date(refTime.getTime() - beforeDays * 86400000);
  const end = new Date(refTime.getTime() + afterDays * 86400000);
  const key = `${stationId}|${dateStr(start)}|${dateStr(end)}`;
  const now = Date.now();
  const cached = highLowCache.get(key);
  if (cached && now - cached.ts < TIDE_TTL) return cached.result;
  try {
    const resp = await fetchJson<{ predictions?: Array<{ t: string; v: string; type: "H" | "L" }> }>(
      `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=predictions&datum=MLLW&time_zone=GMT&units=metric&format=json&interval=hilo&begin_date=${dateStr(start)}&end_date=${dateStr(end)}`,
    );
    const events = (resp.predictions ?? []).map((p) => ({
      type: (p.type === "H" ? "high" : "low") as "high" | "low",
      time: new Date(p.t.replace(" ", "T") + "Z").getTime(),
      height: parseFloat(p.v),
    })).filter((e) => Number.isFinite(e.height) && Math.abs(e.height) < 100).sort((a, b) => a.time - b.time);
    const result = events.length ? events : null;
    highLowCache.set(key, { result, ts: now });
    return result;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch tidal hi/lo predictions");
    return null;
  }
}

export async function getCurrentsPeak(stationId: string, refTime: Date): Promise<CurrentsPeakResult> {
  const start = new Date(refTime.getTime() - 86400000);
  const end = new Date(refTime.getTime() + 2 * 86400000);
  const key = `${stationId}|${dateStr(start)}|${dateStr(end)}`;
  const now = Date.now();
  const cached = currentCache.get(key);
  if (cached && now - cached.ts < TIDE_TTL) return cached.result;
  try {
    const resp = await fetchJson<{ current_predictions?: { cp?: Array<Record<string, string | number>> } }>(
      `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=currents_predictions&time_zone=GMT&interval=MAX_SLACK&units=english&format=json&vel_type=speed_dir&begin_date=${dateStr(start)}&end_date=${dateStr(end)}`,
    );
    let max = 0; let flood: number | null = null;
    for (const cp of resp.current_predictions?.cp ?? []) {
      const speed = cp.Speed ?? cp.Velocity_Major;
      if (speed != null) { const n = Math.abs(parseFloat(String(speed))); if (Number.isFinite(n)) max = Math.max(max, n); }
      const mean = cp.meanFloodDir != null ? parseFloat(String(cp.meanFloodDir)) : NaN;
      if (flood == null && Number.isFinite(mean)) flood = mean;
      if (flood == null && String(cp.Type ?? "").toLowerCase() === "flood" && cp.Direction != null) {
        const n = parseFloat(String(cp.Direction)); if (Number.isFinite(n)) flood = n;
      }
    }
    const result = max > 0 && flood != null ? { peakSpeedKnots: Math.max(0.1, Math.min(8, max)), floodBearingDeg: ((flood % 360) + 360) % 360 } : null;
    currentCache.set(key, { result, ts: now });
    return result;
  } catch (err) {
    logger.warn({ err, stationId }, "Failed to fetch NOAA currents predictions");
    return null;
  }
}

export interface TidePredictionSample { t: string; v: number }
export interface TidePredictionsResult {
  stationId: string; windowStart: string; windowEnd: string; datum: "MLLW"; units: "feet"; predictions: TidePredictionSample[];
}
export interface TideStationDatums {
  stationId: string; mhwFt: number | null; mhhwFt: number | null; datum: "MLLW"; units: "feet";
}
const predictionCache = new Map<string, { result: TidePredictionsResult; ts: number }>();
const predictionFlight = new Map<string, Promise<TidePredictionsResult | null>>();
const datumCache = new Map<string, { result: TideStationDatums; ts: number }>();
const datumFlight = new Map<string, Promise<TideStationDatums | null>>();
const DAY = 24 * 60 * 60 * 1000;
registerCache(() => { predictionCache.clear(); predictionFlight.clear(); datumCache.clear(); datumFlight.clear(); });
export const TIDES_PREDICTIONS_TTL_MS = DAY;
export const TIDES_DATUMS_TTL_MS = DAY;
export const TIDES_WINDOW_DAYS = 31;
export function __clearTidesPredictionsCacheForTests(): void { predictionCache.clear(); }
export function __tidesPredictionsCacheSizeForTests(): number { return predictionCache.size; }
export function __clearTidesDatumsCacheForTests(): void { datumCache.clear(); }

export async function getTidePredictions(stationId: string, now = new Date()): Promise<TidePredictionsResult | null> {
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + TIDES_WINDOW_DAYS * DAY);
  const key = `${stationId}|${start.toISOString()}`; const nowMs = Date.now();
  const cached = predictionCache.get(key);
  if (cached && nowMs - cached.ts < DAY) return cached.result;
  const existing = predictionFlight.get(key); if (existing) return existing;
  const flight = (async () => {
    try {
      const resp = await fetchJson<{ predictions?: Array<{ t: string; v: string }>; error?: { message?: string } }>(
        `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=predictions&datum=MLLW&time_zone=GMT&units=english&format=json&interval=6&begin_date=${dateStr(start)}&end_date=${dateStr(end)}`,
      );
      if (resp.error) throw new Error(resp.error.message ?? "NOAA error response");
      const predictions = (resp.predictions ?? []).map((p) => ({ t: new Date(p.t.replace(" ", "T") + "Z").toISOString(), v: parseFloat(p.v) })).filter((p) => Number.isFinite(p.v));
      if (!predictions.length) return null;
      const result = { stationId, windowStart: start.toISOString(), windowEnd: end.toISOString(), datum: "MLLW" as const, units: "feet" as const, predictions };
      predictionCache.set(key, { result, ts: nowMs }); return result;
    } catch (err) { logger.warn({ err, stationId }, "Failed to fetch NOAA tide predictions window"); return null; }
    finally { predictionFlight.delete(key); }
  })();
  predictionFlight.set(key, flight); return flight;
}

export async function getStationDatums(stationId: string): Promise<TideStationDatums | null> {
  const now = Date.now(); const cached = datumCache.get(stationId);
  if (cached && now - cached.ts < DAY) return cached.result;
  const existing = datumFlight.get(stationId); if (existing) return existing;
  const flight = (async () => {
    try {
      const resp = await fetchJson<{ datums?: Array<{ name?: string; value?: number }> }>(
        `${NOAA_BASE}/mdapi/prod/webapi/stations/${stationId}/datums.json?units=english`,
      );
      const find = (name: string) => { const d = (resp.datums ?? []).find((x) => x.name === name); return d && typeof d.value === "number" && Number.isFinite(d.value) ? d.value : null; };
      const result = { stationId, mhwFt: find("MHW"), mhhwFt: find("MHHW"), datum: "MLLW" as const, units: "feet" as const };
      if (result.mhwFt === null && result.mhhwFt === null) return null;
      datumCache.set(stationId, { result, ts: now }); return result;
    } catch (err) { logger.warn({ err, stationId }, "Failed to fetch NOAA station datums"); return null; }
    finally { datumFlight.delete(stationId); }
  })();
  datumFlight.set(stationId, flight); return flight;
}

export interface TideCurrentPrediction { t: string; speed: number; dir: number }
export async function getPredictionWindow(
  stationId: string, now: Date, days: number,
): Promise<TidePredictionSample[]> {
  const end = new Date(now.getTime() + days * DAY);
  try {
    const resp = await fetchJson<{ predictions?: Array<{ t: string; v: string }> }>(
      `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=predictions&datum=MLLW&time_zone=GMT&units=metric&format=json&interval=6&begin_date=${dateStr(now)}&end_date=${dateStr(end)}`,
    );
    return (resp.predictions ?? []).map((p) => ({
      t: new Date(p.t.replace(" ", "T") + "Z").toISOString(), v: parseFloat(p.v),
    })).filter((p) => Number.isFinite(p.v));
  } catch (err) {
    logger.warn({ err }, "[tidal/pack] Failed to fetch height predictions");
    return [];
  }
}

export async function getCurrentPredictionWindow(
  stationId: string, now: Date, days: number,
): Promise<TideCurrentPrediction[]> {
  const end = new Date(now.getTime() + days * DAY);
  try {
    const resp = await fetchJson<{ current_predictions?: { cp?: Array<Record<string, string | number>> } }>(
      `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=currents_predictions&time_zone=GMT&units=metric&format=json&interval=MAX_SLACK&begin_date=${dateStr(now)}&end_date=${dateStr(end)}`,
    );
    return (resp.current_predictions?.cp ?? []).map((cp) => {
      const rawSpeed = cp.Speed ?? cp.Velocity_Major;
      const speed = rawSpeed != null ? Math.abs(parseFloat(String(rawSpeed))) : 0;
      const dir = cp.Direction != null ? parseFloat(String(cp.Direction)) : 0;
      return {
        t: new Date(String(cp.Time).replace(" ", "T") + "Z").toISOString(),
        speed: Number.isFinite(speed) ? speed : 0,
        dir: Number.isFinite(dir) ? dir : 0,
      };
    });
  } catch (err) {
    logger.warn({ err }, "[tidal/pack] Failed to fetch current predictions");
    return [];
  }
}

export function toNoaaDateStr(d: Date): string { return dateStr(d); }
export { haversineKm, KM_TO_MILES };