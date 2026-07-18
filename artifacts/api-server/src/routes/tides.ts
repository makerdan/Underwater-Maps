/**
 * NOAA tide-prediction engine routes (Task: real-time + trip-planning tides).
 *
 * - GET /tides/station?lat=&lon=  → nearest NOAA water-level station to a
 *   dataset centroid, with distance in statute miles (no cutoff — the client
 *   shows a caveat when the station is more than ~30 mi away).
 * - GET /tides/:stationId         → a full 31-day window of 6-minute tide
 *   predictions (feet above MLLW) fetched from NOAA in a single call and
 *   cached in memory for 24 h keyed by `stationId|windowStart`.
 */
import { Router } from "express";
import { logger } from "../lib/logger.js";
import { registerCache } from "../lib/cacheRegistry.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { LatLonQuerySchema } from "./schemas.js";
import {
  getStationList,
  haversineKm,
  type NoaaStation,
} from "./tidal.js";

const router = Router();

const NOAA_BASE = "https://api.tidesandcurrents.noaa.gov";
const KM_TO_MILES = 0.621371;

/** Number of days of 6-minute predictions retrieved per NOAA call. */
export const TIDES_WINDOW_DAYS = 31;

export interface NearestTideStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
}

/**
 * Resolve the nearest NOAA water-level station to a point (e.g. a dataset
 * bbox centroid). Returns null when the NOAA station catalogue is
 * unreachable and no cached copy exists. No distance cutoff is applied —
 * callers decide whether the nearest station is close enough to trust.
 */
export async function findNearestTideStation(
  lat: number,
  lon: number,
): Promise<NearestTideStation | null> {
  const stations = await getStationList("waterlevels");
  if (!stations || stations.length === 0) return null;
  let nearest: NoaaStation | null = null;
  let nearestKm = Infinity;
  for (const s of stations) {
    const km = haversineKm(lat, lon, s.lat, s.lng);
    if (km < nearestKm) {
      nearestKm = km;
      nearest = s;
    }
  }
  if (!nearest) return null;
  return {
    id: nearest.id,
    name: nearest.name,
    lat: nearest.lat,
    lon: nearest.lng,
    distanceMiles: Math.round(nearestKm * KM_TO_MILES * 10) / 10,
  };
}

/** One 6-minute prediction sample: ISO-8601 UTC timestamp + feet above MLLW. */
export interface TidePredictionSample {
  t: string;
  v: number;
}

export interface TidePredictionsResult {
  stationId: string;
  windowStart: string;
  windowEnd: string;
  /** Vertical datum + units of `v`: feet above MLLW. */
  datum: "MLLW";
  units: "feet";
  predictions: TidePredictionSample[];
}

/**
 * In-memory prediction cache. Predictions are deterministic for a given
 * station + window, so 24 h is safe; the window key rolls daily which
 * naturally advances the horizon.
 */
const predictionsCache = new Map<string, { result: TidePredictionsResult; ts: number }>();
export const TIDES_PREDICTIONS_TTL_MS = 24 * 60 * 60 * 1000;
registerCache(() => predictionsCache.clear());

/** Test-only: clear the predictions cache. */
export function __clearTidesPredictionsCacheForTests(): void {
  predictionsCache.clear();
}

/** Test-only: number of entries currently in the predictions cache. */
export function __tidesPredictionsCacheSizeForTests(): number {
  return predictionsCache.size;
}

function toNoaaDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** UTC midnight of "today" — the rolling window anchor / cache-key component. */
function windowStartUtc(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Fetch (or serve from cache) a 31-day window of 6-minute predictions for a
 * station. Returns null when NOAA is unreachable or returns no usable data.
 */
export async function getTidePredictions(
  stationId: string,
  now = new Date(),
): Promise<TidePredictionsResult | null> {
  const start = windowStartUtc(now);
  const end = new Date(start.getTime() + TIDES_WINDOW_DAYS * 24 * 3600 * 1000);
  const cacheKey = `${stationId}|${start.toISOString()}`;
  const nowMs = Date.now();
  const cached = predictionsCache.get(cacheKey);
  if (cached && nowMs - cached.ts < TIDES_PREDICTIONS_TTL_MS) {
    return cached.result;
  }

  try {
    const url =
      `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=predictions` +
      `&datum=MLLW&time_zone=GMT&units=english&format=json&interval=6` +
      `&begin_date=${toNoaaDateStr(start)}&end_date=${toNoaaDateStr(end)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from NOAA datagetter`);
    const json = (await res.json()) as {
      predictions?: Array<{ t: string; v: string }>;
      error?: { message?: string };
    };
    if (json.error) throw new Error(json.error.message ?? "NOAA error response");
    const predictions: TidePredictionSample[] = (json.predictions ?? [])
      .map((p) => ({
        t: new Date(p.t.replace(" ", "T") + "Z").toISOString(),
        v: parseFloat(p.v),
      }))
      .filter((p) => Number.isFinite(p.v));
    if (predictions.length === 0) return null;
    const result: TidePredictionsResult = {
      stationId,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      datum: "MLLW",
      units: "feet",
      predictions,
    };
    predictionsCache.set(cacheKey, { result, ts: nowMs });
    return result;
  } catch (err) {
    logger.warn({ err, stationId }, "Failed to fetch NOAA tide predictions window");
    return null;
  }
}

// ── GET /tides/station ──────────────────────────────────────────────────────
router.get(
  "/tides/station",
  asyncHandler(async (req, res): Promise<void> => {
    const parsed = LatLonQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_param",
        details: "lat and lon are required numeric parameters",
      });
      return;
    }
    const { lat, lon } = parsed.data;
    const station = await findNearestTideStation(lat, lon);
    if (!station) {
      res.json({ available: false });
      return;
    }
    res.json({ available: true, station });
  }),
);

// ── GET /tides/:stationId ───────────────────────────────────────────────────
const STATION_ID_RE = /^\d{7}$/;

router.get(
  "/tides/:stationId",
  asyncHandler(async (req, res): Promise<void> => {
    const stationId = String(req.params["stationId"] ?? "");
    if (!STATION_ID_RE.test(stationId)) {
      res.status(400).json({
        error: "invalid_param",
        details: "stationId must be a 7-digit NOAA station id",
      });
      return;
    }
    const result = await getTidePredictions(stationId);
    if (!result) {
      res.status(502).json({
        error: "noaa_unavailable",
        details: "Could not retrieve tide predictions from NOAA for this station",
      });
      return;
    }
    res.json(result);
  }),
);

export default router;
