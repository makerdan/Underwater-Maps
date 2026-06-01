/**
 * surface-conditions.ts — Hourly wind + wave + tidal conditions for drift planning.
 *
 * GET /api/surface-conditions?lat=&lon=
 *
 * Data sources:
 *   - Wind:  Open-Meteo Forecast API (free, no key)
 *   - Waves: Open-Meteo Marine API   (free, no key)
 *   - Tidal current:
 *       1. NOAA CO-OPS current predictions for nearest station within
 *          NOAA_STATION_MAX_KM of the requested point ("noaa-coops"), OR
 *       2. Shared slack-tide synthetic model (see lib/slack.ts) using a
 *          semi-diurnal schedule anchored on local solar noon
 *          ("sinusoidal") for points outside NOAA coverage or when the
 *          NOAA fetch fails.
 *   - Tide height (water level):
 *       NOAA CO-OPS hourly water-level predictions for the nearest tide
 *       station (waterlevels network).  Cosine-interpolated from hi/lo events
 *       when the hourly product is unavailable.  Falls back to null when no
 *       station is within NOAA_HEIGHTS_STATION_MAX_KM.
 *
 * Either source yields per-hour `isSlack` + `phase` metadata so the UI can
 * fade arrows, halt drift, and label the timeline at slack tides.
 *
 * The overall response includes an `estimatedConditions` flag for wind/wave
 * estimation and a separate `tidalDataSource` field for the tidal source.
 */

import { Router } from "express";
import { z } from "zod";
import {
  buildSyntheticEvents,
  computeSlackSample,
  SLACK_THRESHOLD_DEFAULT,
  type TidePhase,
} from "../lib/slack.js";
import { registerCache } from "../lib/cacheRegistry.js";
import { LatLonQuerySchema } from "./schemas.js";

const router = Router();

const NOAA_STATION_MAX_KM = 100;
const NOAA_HEIGHTS_STATION_MAX_KM = 100;
const NOAA_STATIONS_URL =
  "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=currentpredictions";
const NOAA_HEIGHTS_STATIONS_URL =
  "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels";
const NOAA_PREDICTIONS_BASE =
  "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

interface HourlySurfaceCondition {
  hour: number;
  windSpeedKnots: number;
  windDegrees: number;
  tidalSpeedKnots: number;
  tidalDegrees: number;
  waveHeightM: number;
  waveDirectionDeg?: number;
  isSlack: boolean;
  phase: TidePhase;
  /** Predicted tide height above chart datum (MLLW, metres). Omitted when no nearby NOAA water-level station is available. */
  tideHeightM?: number;
}

interface NoaaStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface TidalHour {
  tidalSpeedKnots: number;
  tidalDegrees: number;
  isSlack: boolean;
  phase: TidePhase;
}

// ---------------------------------------------------------------------------
// Tidal hourly series using the shared slack model (NOAA-free fallback)
// ---------------------------------------------------------------------------

export function buildSinusoidalTidalHours(
  lat: number,
  lon: number,
  startMs: number = nowTopOfHourMs(),
  count = 24,
): TidalHour[] {
  const peakSpeed = 1.2;
  const floodBearing = ((lat + lon) * 73.1 + 360) % 360;
  const events = buildSyntheticEvents(startMs, lon);
  // Snap any hour within SLACK_SNAP_MIN minutes of an event to slack. At
  // hourly sampling resolution, the natural |sin| slack window (~10–20 min
  // wide for a peak of 1.2 kt and 0.1 kt threshold) is narrower than the
  // sampling interval, so a perfectly valid 24-hour series can end up with
  // zero slack hours by luck of alignment. Widening the snap to ±30 min
  // guarantees each slack event is reflected in at least one hour without
  // distorting the speeds away from the events themselves.
  const SLACK_SNAP_MIN = 30;

  return Array.from({ length: count }, (_, h) => {
    const t = startMs + h * 3600 * 1000;
    const s = computeSlackSample({
      events,
      refTime: t,
      peakSpeedKnots: peakSpeed,
      floodBearingDeg: floodBearing,
      slackThresholdKnots: SLACK_THRESHOLD_DEFAULT,
    });

    let isSlack = s.slack.isSlack;
    let phase = s.slack.phase;
    let speedKnots = s.speedKnots;

    if (!isSlack) {
      // Find the nearest synthetic event to decide if we're in the snap window.
      let nearest: typeof events[number] | null = null;
      let nearestDistMs = Infinity;
      for (const ev of events) {
        const d = Math.abs(ev.time - t);
        if (d < nearestDistMs) {
          nearestDistMs = d;
          nearest = ev;
        }
      }
      if (nearest && nearestDistMs / 60000 <= SLACK_SNAP_MIN) {
        isSlack = true;
        phase = nearest.type === "high" ? "slack-high" : "slack-low";
        speedKnots = 0;
      }
    }

    return {
      tidalSpeedKnots: Math.round(speedKnots * 100) / 100,
      tidalDegrees: Math.round(s.directionDeg) % 360,
      isSlack,
      phase,
    };
  });
}

function nowTopOfHourMs(): number {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return now.getTime();
}

// ---------------------------------------------------------------------------
// Haversine distance (km) between two lat/lon points
// ---------------------------------------------------------------------------

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------
// NOAA CO-OPS station discovery (cached in-memory after first successful fetch)
// ---------------------------------------------------------------------------

let stationCache: NoaaStation[] | null = null;
let stationCacheAt = 0;
const STATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let heightsStationCache: NoaaStation[] | null = null;
let heightsStationCacheAt = 0;

export function _resetNoaaStationCacheForTests(): void {
  stationCache = null;
  stationCacheAt = 0;
  heightsStationCache = null;
  heightsStationCacheAt = 0;
}

async function fetchNoaaStations(): Promise<NoaaStation[]> {
  const now = Date.now();
  if (stationCache && now - stationCacheAt < STATION_CACHE_TTL_MS) {
    return stationCache;
  }
  const res = await fetchWithTimeout(NOAA_STATIONS_URL, 8000);
  if (!res.ok) throw new Error(`noaa stations http ${res.status}`);
  const json = (await res.json()) as { stations?: Array<{ id?: string; name?: string; lat?: number; lng?: number }> };
  const list: NoaaStation[] = (json.stations ?? [])
    .filter((s) => typeof s.id === "string" && typeof s.lat === "number" && typeof s.lng === "number")
    .map((s) => ({ id: s.id as string, name: s.name ?? s.id as string, lat: s.lat as number, lng: s.lng as number }));
  stationCache = list;
  stationCacheAt = now;
  return list;
}

async function fetchNoaaHeightsStations(): Promise<NoaaStation[]> {
  const now = Date.now();
  if (heightsStationCache && now - heightsStationCacheAt < STATION_CACHE_TTL_MS) {
    return heightsStationCache;
  }
  const res = await fetchWithTimeout(NOAA_HEIGHTS_STATIONS_URL, 8000);
  if (!res.ok) throw new Error(`noaa heights stations http ${res.status}`);
  const json = (await res.json()) as { stations?: Array<{ id?: string; name?: string; lat?: number; lng?: number }> };
  const list: NoaaStation[] = (json.stations ?? [])
    .filter((s) => typeof s.id === "string" && typeof s.lat === "number" && typeof s.lng === "number")
    .map((s) => ({ id: s.id as string, name: s.name ?? s.id as string, lat: s.lat as number, lng: s.lng as number }));
  heightsStationCache = list;
  heightsStationCacheAt = now;
  return list;
}

export function findNearestStation(
  stations: NoaaStation[],
  lat: number,
  lon: number,
  maxKm = NOAA_STATION_MAX_KM,
): { station: NoaaStation; distanceKm: number } | null {
  let best: { station: NoaaStation; distanceKm: number } | null = null;
  for (const s of stations) {
    const d = haversineKm(lat, lon, s.lat, s.lng);
    if (d <= maxKm && (best === null || d < best.distanceKm)) {
      best = { station: s, distanceKm: d };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// NOAA CO-OPS current predictions parser
// ---------------------------------------------------------------------------

interface NoaaPredictionRow {
  Time?: string;
  Velocity_Major?: number | string;
  meanFloodDir?: number | string;
  meanEbbDir?: number | string;
}

/**
 * Convert NOAA CO-OPS hourly current predictions into 24 entries matching
 * hours 0..23 UTC for the given UTC date. Velocity_Major is signed knots:
 * positive = flood direction, negative = ebb direction.
 *
 * Per-hour slack metadata is derived from the absolute speed (using
 * SLACK_THRESHOLD_DEFAULT) and the sign of Velocity_Major (positive →
 * flooding, negative → ebbing, slack → slack).
 */
export function parseNoaaPredictions(
  raw: { current_predictions?: { cp?: NoaaPredictionRow[] } },
  utcDate: Date,
): TidalHour[] | null {
  const rows = raw.current_predictions?.cp;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const yyyy = utcDate.getUTCFullYear();
  const mm = utcDate.getUTCMonth();
  const dd = utcDate.getUTCDate();

  const byHour = new Map<number, TidalHour>();
  for (const row of rows) {
    if (!row.Time) continue;
    // NOAA Time format: "YYYY-MM-DD HH:mm" in GMT when time_zone=gmt
    const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(row.Time);
    if (!m) continue;
    const [, ys, ms, ds, hs] = m;
    const ry = parseInt(ys!, 10);
    const rm = parseInt(ms!, 10) - 1;
    const rd = parseInt(ds!, 10);
    const rh = parseInt(hs!, 10);
    if (ry !== yyyy || rm !== mm || rd !== dd) continue;

    const v = typeof row.Velocity_Major === "string" ? parseFloat(row.Velocity_Major) : row.Velocity_Major;
    const floodDir = typeof row.meanFloodDir === "string" ? parseFloat(row.meanFloodDir) : row.meanFloodDir;
    const ebbDir = typeof row.meanEbbDir === "string" ? parseFloat(row.meanEbbDir) : row.meanEbbDir;
    if (typeof v !== "number" || isNaN(v)) continue;

    const speed = Math.abs(v);
    let dir: number;
    if (v >= 0 && typeof floodDir === "number" && !isNaN(floodDir)) {
      dir = floodDir;
    } else if (v < 0 && typeof ebbDir === "number" && !isNaN(ebbDir)) {
      dir = ebbDir;
    } else {
      dir = 0;
    }
    const isSlack = speed < SLACK_THRESHOLD_DEFAULT;
    // Sign of v: ≥0 means flooding (so slack here is the slack-low that
    // precedes flooding); <0 means ebbing (slack here is the slack-high
    // that precedes ebbing).
    const phase: TidePhase = isSlack
      ? v >= 0
        ? "slack-low"
        : "slack-high"
      : v >= 0
        ? "flooding"
        : "ebbing";
    byHour.set(rh, {
      tidalSpeedKnots: Math.round(speed * 10) / 10,
      tidalDegrees: Math.round(((dir % 360) + 360) % 360),
      isSlack,
      phase,
    });
  }

  if (byHour.size === 0) return null;

  // Fill all 24 hours, repeating the last known value for any gaps.
  const out: TidalHour[] = [];
  let last: TidalHour = { tidalSpeedKnots: 0, tidalDegrees: 0, isSlack: true, phase: "slack-low" };
  for (let h = 0; h < 24; h++) {
    const v = byHour.get(h);
    if (v) last = v;
    out.push(last);
  }
  return out;
}

async function fetchNoaaPredictions(stationId: string, utcDate: Date): Promise<TidalHour[] | null> {
  const yyyymmdd = `${utcDate.getUTCFullYear()}${String(utcDate.getUTCMonth() + 1).padStart(2, "0")}${String(utcDate.getUTCDate()).padStart(2, "0")}`;
  const url = `${NOAA_PREDICTIONS_BASE}?product=currents_predictions&station=${encodeURIComponent(stationId)}&begin_date=${yyyymmdd}&end_date=${yyyymmdd}&time_zone=gmt&units=english&interval=h&format=json`;
  const res = await fetchWithTimeout(url, 8000);
  if (!res.ok) return null;
  const json = (await res.json()) as { current_predictions?: { cp?: NoaaPredictionRow[] } };
  return parseNoaaPredictions(json, utcDate);
}

// ---------------------------------------------------------------------------
// NOAA hourly tide height (water-level predictions)
// ---------------------------------------------------------------------------

/**
 * Parse an hourly NOAA water-level predictions response into a 24-entry array
 * (one number per UTC hour 0–23, metres above MLLW).
 *
 * NOAA returns `{ predictions: [{ t: "YYYY-MM-DD HH:mm", v: "1.234" }] }`.
 * Missing hours are filled by carrying the last known value forward.
 * Returns null when the payload is empty or all rows fall outside the target date.
 */
export function parseNoaaTideHeights(
  raw: { predictions?: Array<{ t?: string; v?: string | number }> },
  utcDate: Date,
): number[] | null {
  const rows = raw.predictions;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const yyyy = utcDate.getUTCFullYear();
  const mm = utcDate.getUTCMonth();
  const dd = utcDate.getUTCDate();

  const byHour = new Map<number, number>();
  for (const row of rows) {
    if (!row.t) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(row.t);
    if (!m) continue;
    const ry = parseInt(m[1]!, 10);
    const rm = parseInt(m[2]!, 10) - 1;
    const rd = parseInt(m[3]!, 10);
    const rh = parseInt(m[4]!, 10);
    if (ry !== yyyy || rm !== mm || rd !== dd) continue;
    const v = typeof row.v === "string" ? parseFloat(row.v) : row.v;
    if (typeof v !== "number" || isNaN(v)) continue;
    byHour.set(rh, Math.round(v * 100) / 100);
  }

  if (byHour.size === 0) return null;

  const out: number[] = [];
  let last = 0;
  for (let h = 0; h < 24; h++) {
    const v = byHour.get(h);
    if (v !== undefined) last = v;
    out.push(last);
  }
  return out;
}

// ---------------------------------------------------------------------------
// In-memory cache for NOAA hourly tide-height predictions
// ---------------------------------------------------------------------------

/**
 * Cache of NOAA hourly water-level predictions.
 * Key: `stationId|YYYYMMDD` (UTC date string).
 * TTL: 30 min for non-empty results; 5 min for null (no data / fetch failure).
 * Registered with cacheRegistry so the admin clear endpoint and test setup
 * can flush it.
 */
const tideHeightsPredictionsCache = new Map<string, { result: number[] | null; ts: number }>();
const TIDE_HEIGHTS_CACHE_TTL_MS = 30 * 60 * 1000;
const TIDE_HEIGHTS_EMPTY_CACHE_TTL_MS = 5 * 60 * 1000;

registerCache(() => tideHeightsPredictionsCache.clear());

async function fetchNoaaTideHeightsPredictions(stationId: string, utcDate: Date): Promise<number[] | null> {
  const yyyymmdd = `${utcDate.getUTCFullYear()}${String(utcDate.getUTCMonth() + 1).padStart(2, "0")}${String(utcDate.getUTCDate()).padStart(2, "0")}`;
  const cacheKey = `${stationId}|${yyyymmdd}`;
  const now = Date.now();
  const cached = tideHeightsPredictionsCache.get(cacheKey);
  if (cached) {
    const ttl = cached.result !== null ? TIDE_HEIGHTS_CACHE_TTL_MS : TIDE_HEIGHTS_EMPTY_CACHE_TTL_MS;
    if (now - cached.ts < ttl) {
      return cached.result;
    }
  }

  const url = `${NOAA_PREDICTIONS_BASE}?product=predictions&station=${encodeURIComponent(stationId)}&begin_date=${yyyymmdd}&end_date=${yyyymmdd}&datum=MLLW&time_zone=GMT&units=metric&interval=h&format=json`;
  try {
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) {
      tideHeightsPredictionsCache.set(cacheKey, { result: null, ts: now });
      return null;
    }
    const json = (await res.json()) as { predictions?: Array<{ t?: string; v?: string | number }> };
    const result = parseNoaaTideHeights(json, utcDate);
    tideHeightsPredictionsCache.set(cacheKey, { result, ts: now });
    return result;
  } catch {
    tideHeightsPredictionsCache.set(cacheKey, { result: null, ts: now });
    return null;
  }
}

/**
 * Resolve 24 hourly tide heights for the given position.
 *
 * Tries NOAA CO-OPS water-level predictions from the nearest station within
 * NOAA_HEIGHTS_STATION_MAX_KM. Returns null for every hour when no suitable
 * station is found or the fetch fails — the computeDrift physics already
 * defaults tideHeightM to 0 when the field is absent.
 */
async function resolveTideHeights(
  lat: number,
  lon: number,
  utcDate: Date,
): Promise<{ heights: number[]; stationId: string; stationName: string } | null> {
  try {
    const stations = await fetchNoaaHeightsStations();
    const nearest = findNearestStation(stations, lat, lon, NOAA_HEIGHTS_STATION_MAX_KM);
    if (!nearest) return null;
    const heights = await fetchNoaaTideHeightsPredictions(nearest.station.id, utcDate);
    if (!heights) return null;
    return { heights, stationId: nearest.station.id, stationName: nearest.station.name };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// Tidal resolution — try NOAA, fall back to slack-model synthetic series
// ---------------------------------------------------------------------------

interface ResolvedTidal {
  hours: TidalHour[];
  source: "noaa-coops" | "sinusoidal";
  stationId?: string;
  stationName?: string;
  distanceKm?: number;
}

async function resolveTidal(lat: number, lon: number, startMs: number): Promise<ResolvedTidal> {
  try {
    const stations = await fetchNoaaStations();
    const nearest = findNearestStation(stations, lat, lon);
    if (nearest) {
      const hours = await fetchNoaaPredictions(nearest.station.id, new Date(startMs));
      if (hours) {
        return {
          hours,
          source: "noaa-coops",
          stationId: nearest.station.id,
          stationName: nearest.station.name,
          distanceKm: Math.round(nearest.distanceKm * 10) / 10,
        };
      }
    }
  } catch {
    // fall through to slack-model synthetic series
  }
  return { hours: buildSinusoidalTidalHours(lat, lon, startMs), source: "sinusoidal" };
}

// ---------------------------------------------------------------------------
// ForecastHour — one slot in the 48-hour forecast strip
// ---------------------------------------------------------------------------

export interface ForecastHour {
  /** Relative hours from startMs (0–47). */
  relHour: number;
  /** ISO 8601 UTC timestamp of this hour. */
  isoTime: string;
  windSpeedKnots: number;
  windDegrees: number;
  waveHeightM: number;
  waveDirectionDeg?: number;
  tidalSpeedKnots: number;
  tidalDegrees: number;
  isSlack: boolean;
  phase: TidePhase;
}

// ---------------------------------------------------------------------------
// GET /surface-conditions
// ---------------------------------------------------------------------------

router.get("/surface-conditions", async (req, res): Promise<void> => {
  const parsed = LatLonQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: parsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }
  const { lat, lon } = parsed.data;

  // Anchor the 48-hour series at the top of the current UTC hour so each
  // index aligns with a wall-clock hour.
  const startMs = nowTopOfHourMs();
  const utcDate = new Date(startMs);

  const [tidal, tideHeightsResult] = await Promise.all([
    resolveTidal(lat, lon, startMs),
    resolveTideHeights(lat, lon, utcDate),
  ]);

  // Build a 48-hour sinusoidal tidal baseline for the forecast strip.
  // Hours 0–23 will be overridden by NOAA data when available.
  const tidal48 = buildSinusoidalTidalHours(lat, lon, startMs, 48);
  if (tidal.source === "noaa-coops") {
    for (let h = 0; h < 24; h++) {
      const noaaHour = tidal.hours[h];
      if (noaaHour) tidal48[h] = noaaHour;
    }
  }

  let windData: { windSpeedKnots: number; windDegrees: number }[] | null = null;
  let waveData: { waveHeightM: number; waveDirectionDeg?: number }[] | null = null;
  let estimatedConditions = false;

  try {
    const [forecastRes, marineRes] = await Promise.allSettled([
      fetchWithTimeout(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&forecast_days=2&timezone=UTC`,
      ),
      fetchWithTimeout(
        `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction&forecast_days=2&timezone=UTC`,
      ),
    ]);

    if (forecastRes.status === "fulfilled" && forecastRes.value.ok) {
      const json = await forecastRes.value.json() as {
        hourly?: { wind_speed_10m?: number[]; wind_direction_10m?: number[] };
      };
      const speeds = json.hourly?.wind_speed_10m ?? [];
      const dirs = json.hourly?.wind_direction_10m ?? [];
      if (speeds.length >= 24) {
        windData = Array.from({ length: speeds.length }, (_, h) => ({
          windSpeedKnots: Math.round((speeds[h] ?? 0) * 10) / 10,
          windDegrees: Math.round(dirs[h] ?? 0),
        }));
      }
    }

    if (marineRes.status === "fulfilled" && marineRes.value.ok) {
      const json = await marineRes.value.json() as {
        hourly?: { wave_height?: number[]; wave_direction?: number[] };
      };
      const heights = json.hourly?.wave_height ?? [];
      const directions = json.hourly?.wave_direction ?? [];
      if (heights.length >= 24) {
        waveData = Array.from({ length: heights.length }, (_, h) => ({
          waveHeightM: Math.round((heights[h] ?? 0) * 100) / 100,
          ...(directions[h] !== undefined && directions[h] !== null
            ? { waveDirectionDeg: Math.round(((directions[h]! % 360) + 360) % 360) }
            : {}),
        }));
      }
    }
  } catch {
    estimatedConditions = true;
  }

  if (!windData || !waveData) {
    estimatedConditions = true;
  }

  const hours: HourlySurfaceCondition[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    windSpeedKnots: windData?.[h]?.windSpeedKnots ?? 8,
    windDegrees: windData?.[h]?.windDegrees ?? 225,
    waveHeightM: waveData?.[h]?.waveHeightM ?? 0.3,
    ...(waveData?.[h]?.waveDirectionDeg !== undefined
      ? { waveDirectionDeg: waveData[h]!.waveDirectionDeg }
      : {}),
    tidalSpeedKnots: tidal.hours[h]!.tidalSpeedKnots,
    tidalDegrees: tidal.hours[h]!.tidalDegrees,
    isSlack: tidal.hours[h]!.isSlack,
    phase: tidal.hours[h]!.phase,
    ...(tideHeightsResult !== null
      ? { tideHeightM: tideHeightsResult.heights[h] ?? 0 }
      : {}),
  }));

  const forecast48h: ForecastHour[] = Array.from({ length: 48 }, (_, h) => {
    const slotMs = startMs + h * 3600_000;
    const tidalH = tidal48[h]!;
    return {
      relHour: h,
      isoTime: new Date(slotMs).toISOString(),
      windSpeedKnots: windData?.[h]?.windSpeedKnots ?? 8,
      windDegrees: windData?.[h]?.windDegrees ?? 225,
      waveHeightM: waveData?.[h]?.waveHeightM ?? 0.3,
      ...(waveData?.[h]?.waveDirectionDeg !== undefined
        ? { waveDirectionDeg: waveData[h]!.waveDirectionDeg }
        : {}),
      tidalSpeedKnots: tidalH.tidalSpeedKnots,
      tidalDegrees: tidalH.tidalDegrees,
      isSlack: tidalH.isSlack,
      phase: tidalH.phase,
    };
  });

  res.json({
    available: true,
    lat,
    lon,
    dataSource: estimatedConditions ? "estimated" : "open-meteo",
    tidalDataSource: tidal.source,
    ...(tidal.stationId ? { tidalStationId: tidal.stationId } : {}),
    ...(tidal.stationName ? { tidalStationName: tidal.stationName } : {}),
    ...(typeof tidal.distanceKm === "number" ? { tidalStationDistanceKm: tidal.distanceKm } : {}),
    tideHeightSource: tideHeightsResult !== null ? "noaa-coops" : "none",
    ...(tideHeightsResult ? { tideHeightStationId: tideHeightsResult.stationId } : {}),
    ...(tideHeightsResult ? { tideHeightStationName: tideHeightsResult.stationName } : {}),
    estimatedConditions,
    hours,
    forecast48h,
  });
});

export default router;
