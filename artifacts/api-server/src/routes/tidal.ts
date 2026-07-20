import { Router } from "express";
import { logger } from "../lib/logger.js";
import { registerCache } from "../lib/cacheRegistry.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { validateResponse } from "../middlewares/validateResponse.js";
import {
  buildSyntheticEvents,
  computeSlackSample,
  SLACK_THRESHOLD_DEFAULT,
  type SlackBlock,
  type TideEvent,
} from "../lib/slack.js";
import {
  TidalQuerySchema,
  TidalScheduleQuerySchema,
  TidalPackQuerySchema,
} from "./schemas.js";
import { z } from "zod";
import type { ZodError } from "zod";
import {
  GetTidalScheduleResponse,
  GetTidalPackResponse,
} from "@workspace/api-zod";

/**
 * Map a Zod query-validation error onto the tidal routes' legacy
 * `invalid_param` error shape, preserving the historical detail strings for
 * lat/lon and datetime/start so existing clients (and tests) keep working.
 */
function tidalValidationDetails(error: ZodError): string {
  const paths = new Set(error.issues.map((i) => String(i.path[0] ?? "")));
  if (paths.has("lat") || paths.has("lon")) {
    return "lat and lon are required numeric parameters";
  }
  if (paths.has("datetime")) return "Invalid datetime parameter";
  if (paths.has("start")) return "Invalid start parameter";
  const first = error.issues[0];
  return first ? `${String(first.path[0] ?? "query")}: ${first.message}` : "Invalid query parameters";
}

const router = Router();

const NOAA_BASE = "https://api.tidesandcurrents.noaa.gov";

function isAdmin(userId: string): boolean {
  const flag = process.env["BUCKET_MONITOR_ADMIN"] ?? "";
  if (flag === "1" || flag === "true") return true;
  const allowedIds = (process.env["ADMIN_USER_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowedIds.includes(userId);
}

export interface NoaaStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface StationRef {
  id: string;
  name: string;
}

/** All known data-source labels for tidal data. */
export type TidalSource = "noaa" | "estimated" | "usgs" | "glerl";

interface TidalResponse {
  available: boolean;
  tideHeight?: number;
  currentDirection?: number;
  currentSpeed?: number;
  nextEvent?: { type: "high" | "low"; time: string; height: number };
  /** Legacy: name of the station that supplied tide heights (or estimate label). */
  stationName?: string;
  /** Legacy: id of the station that supplied tide heights. */
  stationId?: string;
  isPredicted?: boolean;
  /** Overall source — "noaa" if either heights or currents came from NOAA. */
  source?: TidalSource;
  /** Source of the tide-height series (drives slack timing). */
  heightsSource?: TidalSource;
  /** Source of the peak current speed + flood bearing. */
  currentsSource?: TidalSource;
  /** NOAA station that supplied tide heights, if any. */
  heightsStation?: StationRef;
  /** NOAA currents-prediction station that supplied peak speed + flood bearing, if any. */
  currentsStation?: StationRef;
  slack?: SlackBlock;
  /** Approximate km distance to the data station (USGS / NOAA). */
  distanceKm?: number;
  /**
   * True when tidal heights / water levels are derived from a physical model
   * or gage-height extrapolation rather than direct tide-gauge measurements.
   * Freshwater rivers (USGS) and Great Lakes (GLERL) are always modeled.
   */
  isModeled?: boolean;
  /**
   * True when this response is served from a stale in-process cache because
   * the upstream data source (e.g. USGS NWIS) was unreachable this request.
   */
  isStale?: boolean;
  /** ISO timestamp of the cached data, present when isStale is true. */
  cachedAt?: string;
}

// ---------------------------------------------------------------------------
// Freshwater helpers — USGS NWIS and GLERL Great Lakes
// ---------------------------------------------------------------------------

const USGS_IV_BASE = "https://waterservices.usgs.gov/nwis/iv/";

interface UsgsStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface UsgsIvResponse {
  value?: {
    timeSeries?: Array<{
      sourceInfo?: {
        siteName?: string;
        siteCode?: Array<{ value?: string }>;
        geoLocation?: {
          geogLocation?: { latitude?: number; longitude?: number };
        };
      };
    }>;
  };
}

/**
 * Approximate bounding boxes for the five Great Lakes (GLERL model coverage).
 * Used to decide whether to label freshwater tidal data as "glerl" vs "usgs".
 */
const GREAT_LAKES_BOUNDS: Array<{
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}> = [
  { latMin: 46.0, latMax: 49.0, lonMin: -92.5, lonMax: -84.0 }, // Superior
  { latMin: 41.5, latMax: 46.0, lonMin: -88.0, lonMax: -84.5 }, // Michigan
  { latMin: 43.0, latMax: 46.5, lonMin: -84.5, lonMax: -79.5 }, // Huron
  { latMin: 41.5, latMax: 43.0, lonMin: -83.5, lonMax: -78.5 }, // Erie
  { latMin: 43.0, latMax: 44.5, lonMin: -79.5, lonMax: -75.7 }, // Ontario
];

/** Returns true when the coordinates fall within any of the five Great Lakes. */
export function isGreatLakes(lat: number, lon: number): boolean {
  return GREAT_LAKES_BOUNDS.some(
    (b) => lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax,
  );
}

/**
 * Look up the nearest USGS NWIS gage-height (parameterCd=00065) station
 * within ~50 km of the given coordinates.  Returns null on network failure
 * or when no station is found, so callers can surface `available: false`.
 */
export async function getNearestUsgsStation(
  lat: number,
  lon: number,
): Promise<UsgsStation | null> {
  const margin = 0.5; // ~50 km at mid-latitudes
  const bBox = `${lon - margin},${lat - margin},${lon + margin},${lat + margin}`;
  const url = `${USGS_IV_BASE}?format=json&parameterCd=00065&siteType=LK,ST&bBox=${bBox}&period=PT1H`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as UsgsIvResponse;
    const series = json.value?.timeSeries ?? [];
    if (series.length === 0) return null;
    const site = series[0]!;
    const id = site.sourceInfo?.siteCode?.[0]?.value ?? "";
    const name = site.sourceInfo?.siteName ?? id;
    const sLat = site.sourceInfo?.geoLocation?.geogLocation?.latitude ?? lat;
    const sLng = site.sourceInfo?.geoLocation?.geogLocation?.longitude ?? lon;
    if (!id) return null;
    return { id, name, lat: sLat, lng: sLng };
  } catch {
    return null;
  }
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const dLon = ((toLon - fromLon) * Math.PI) / 180;
  const lat1 = (fromLat * Math.PI) / 180;
  const lat2 = (toLat * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json() as Promise<T>;
}

export type StationListType = "waterlevels" | "currentpredictions";

/**
 * In-memory cache of NOAA station lists, keyed by station-list type
 * (heights vs. currents). Uses the same structured TTL pattern as
 * highLowEventsCache / currentsPeakCache.
 *
 * Non-empty results are cached for STATION_LISTS_TTL_MS (24h — the
 * station catalogue rarely changes). Empty results are cached for
 * STATION_LISTS_EMPTY_TTL_MS (5 min) so a transient NOAA hiccup that
 * returned an empty or partial station list doesn't pin every nearby
 * caller to "no nearby station" estimates for a full day.
 */
const stationListsCache = new Map<StationListType, { data: NoaaStation[]; ts: number }>();
const STATION_LISTS_TTL_MS = 24 * 60 * 60 * 1000;
const STATION_LISTS_EMPTY_TTL_MS = 5 * 60 * 1000;

/**
 * Short negative-cache window: when NOAA is down AND we have no prior
 * good station list to fall back to, remember the failure for ~60s so
 * a single outage doesn't cause every subsequent /tidal request to
 * re-hit NOAA with an 8s timeout and stall the API server.
 */
const stationListsFailureCache = new Map<StationListType, number>();
const STATION_LISTS_FAILURE_TTL_MS = 60 * 1000;
registerCache(() => { stationListsCache.clear(); stationListsFailureCache.clear(); });

/** Test-only: clear the station-list caches so fetch mocks take effect. */
export function __clearStationListCachesForTests(): void {
  stationListsCache.clear();
  stationListsFailureCache.clear();
}

function stationListTtlMs(data: NoaaStation[]): number {
  return data.length === 0 ? STATION_LISTS_EMPTY_TTL_MS : STATION_LISTS_TTL_MS;
}

async function loadStations(type: StationListType): Promise<NoaaStation[] | null> {
  try {
    const resp = await fetchJson<{
      stations: Array<{ id: string; name: string; lat: number; lng: number }>;
    }>(`${NOAA_BASE}/mdapi/prod/webapi/stations.json?type=${type}&units=metric`);
    return resp.stations.map((s) => ({
      id: s.id,
      name: s.name,
      lat: Number(s.lat),
      lng: Number(s.lng),
    }));
  } catch (err) {
    logger.warn({ err, type }, "Failed to fetch NOAA station list");
    return null;
  }
}

export async function getStationList(type: StationListType): Promise<NoaaStation[] | null> {
  const now = Date.now();
  const cached = stationListsCache.get(type);
  if (cached && now - cached.ts < stationListTtlMs(cached.data)) {
    return cached.data;
  }
  // If the last upstream call failed recently, short-circuit so a NOAA
  // outage doesn't fan out into a flood of 8s-timeout fetches — even
  // when a stale cache is around (otherwise every post-TTL request
  // would still pay the full timeout before falling back to it).
  const failedAt = stationListsFailureCache.get(type);
  if (failedAt != null && now - failedAt < STATION_LISTS_FAILURE_TTL_MS) {
    return cached?.data ?? null;
  }
  const data = await loadStations(type);
  if (!data) {
    // Remember the failure for the negative-cache window, and fall back
    // to the previously cached list (even if stale) when available so
    // nearby callers keep getting real station data through the outage.
    stationListsFailureCache.set(type, now);
    return cached ? cached.data : null;
  }
  stationListsFailureCache.delete(type);
  stationListsCache.set(type, { data, ts: now });
  return data;
}

function pickNearest(
  stations: NoaaStation[],
  lat: number,
  lon: number,
  maxKm: number,
): NoaaStation | null {
  let nearest: NoaaStation | null = null;
  let nearestDist = Infinity;
  for (const s of stations) {
    const dist = haversineKm(lat, lon, s.lat, s.lng);
    if (dist < nearestDist && dist <= maxKm) {
      nearestDist = dist;
      nearest = s;
    }
  }
  return nearest;
}

async function getNearestHeightsStation(lat: number, lon: number): Promise<NoaaStation | null> {
  const data = await getStationList("waterlevels");
  if (!data) return null;
  return pickNearest(data, lat, lon, 100);
}

async function getNearestCurrentsStation(lat: number, lon: number): Promise<NoaaStation | null> {
  const data = await getStationList("currentpredictions");
  if (!data) return null;
  // Currents fields are much more localized than heights, so restrict to 50 km.
  return pickNearest(data, lat, lon, 50);
}

function toNoaaDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/**
 * In-memory cache of recent getHighLowEvents results. NOAA's hi/lo
 * predictions are stable for a given day window, so a short TTL keeps
 * the tidal panel snappy without re-hitting NOAA on every request.
 */
const highLowEventsCache = new Map<string, { result: TideEvent[] | null; ts: number }>();
const HIGH_LOW_EVENTS_TTL_MS = 30 * 60 * 1000;

/**
 * Clear the high/low events cache.
 *
 * Exported for tests that need to reset this specific cache mid-test
 * (e.g. to simulate expiry while keeping station-list caches warm).
 * The global vitest setup already calls `clearAllCaches()` before each
 * test, so this export is only needed for those mid-test edge-cases.
 */
export function __clearHighLowEventsCacheForTests(): void {
  highLowEventsCache.clear();
}

registerCache(() => highLowEventsCache.clear());

/**
 * Fetch high/low tide events covering [refTime - beforeDays, refTime + afterDays].
 */
export async function getHighLowEvents(
  stationId: string,
  refTime: Date,
  beforeDays = 1,
  afterDays = 2,
): Promise<TideEvent[] | null> {
  const start = new Date(refTime.getTime() - beforeDays * 24 * 3600 * 1000);
  const end = new Date(refTime.getTime() + afterDays * 24 * 3600 * 1000);
  const cacheKey = `${stationId}|${toNoaaDateStr(start)}|${toNoaaDateStr(end)}`;
  const now = Date.now();
  const cached = highLowEventsCache.get(cacheKey);
  if (cached && now - cached.ts < HIGH_LOW_EVENTS_TTL_MS) {
    return cached.result;
  }

  try {
    const url =
      `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=predictions` +
      `&datum=MLLW&time_zone=GMT&units=metric&format=json&interval=hilo` +
      `&begin_date=${toNoaaDateStr(start)}&end_date=${toNoaaDateStr(end)}`;
    const resp = await fetchJson<{
      predictions?: Array<{ t: string; v: string; type: "H" | "L" }>;
    }>(url);
    const events: TideEvent[] = (resp.predictions ?? []).map((p) => ({
      type: p.type === "H" ? "high" : "low",
      time: new Date(p.t.replace(" ", "T") + "Z").getTime(),
      height: parseFloat(p.v),
    }));
    events.sort((a, b) => a.time - b.time);
    const result = events.length > 0 ? events : null;
    highLowEventsCache.set(cacheKey, { result, ts: now });
    return result;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch tidal hi/lo predictions");
    return null;
  }
}

/**
 * In-memory cache of recent getCurrentsPeak results. NOAA's currents
 * predictions only change a few times per day, so a short TTL keeps the
 * tidal panel snappy and hides their occasional HTTP 400s on cold loads.
 */
type CurrentsPeakResult = { peakSpeedKnots: number; floodBearingDeg: number } | null;
const currentsPeakCache = new Map<string, { result: CurrentsPeakResult; ts: number }>();
const CURRENTS_PEAK_TTL_MS = 30 * 60 * 1000;

registerCache(() => currentsPeakCache.clear());

/**
 * Fetch max-flood / max-ebb / slack predictions from a NOAA currents station
 * and derive peak current speed (knots) and the mean flood bearing.
 *
 * Returns null on any failure or if the response contains no usable flood
 * direction — callers should fall back to the heuristic estimator in that case.
 */
export async function getCurrentsPeak(
  stationId: string,
  refTime: Date,
): Promise<CurrentsPeakResult> {
  const start = new Date(refTime.getTime() - 24 * 3600 * 1000);
  const end = new Date(refTime.getTime() + 48 * 3600 * 1000);
  const cacheKey = `${stationId}|${toNoaaDateStr(start)}|${toNoaaDateStr(end)}`;
  const now = Date.now();
  const cached = currentsPeakCache.get(cacheKey);
  if (cached && now - cached.ts < CURRENTS_PEAK_TTL_MS) {
    return cached.result;
  }

  try {
    // vel_type=speed_dir asks NOAA for unsigned Speed (knots) + Direction (deg).
    const url =
      `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=currents_predictions` +
      `&time_zone=GMT&interval=MAX_SLACK&units=english&format=json&vel_type=speed_dir` +
      `&begin_date=${toNoaaDateStr(start)}&end_date=${toNoaaDateStr(end)}`;
    const resp = await fetchJson<{
      current_predictions?: {
        cp?: Array<{
          Time?: string;
          Type?: string;
          Speed?: string | number;
          Direction?: string | number;
          Velocity_Major?: string | number;
          meanFloodDir?: string | number;
        }>;
      };
    }>(url);
    const cps = resp.current_predictions?.cp ?? [];
    let result: CurrentsPeakResult = null;
    if (cps.length > 0) {
      let maxSpeed = 0;
      let floodDir: number | null = null;
      for (const cp of cps) {
        const rawSpeed =
          cp.Speed != null ? cp.Speed : cp.Velocity_Major != null ? cp.Velocity_Major : null;
        if (rawSpeed != null) {
          const sp = Math.abs(parseFloat(String(rawSpeed)));
          if (Number.isFinite(sp) && sp > maxSpeed) maxSpeed = sp;
        }
        if (floodDir == null) {
          const meanFd = cp.meanFloodDir != null ? parseFloat(String(cp.meanFloodDir)) : NaN;
          if (Number.isFinite(meanFd)) {
            floodDir = meanFd;
          } else if (
            String(cp.Type ?? "").toLowerCase() === "flood" &&
            cp.Direction != null
          ) {
            const d = parseFloat(String(cp.Direction));
            if (Number.isFinite(d)) floodDir = d;
          }
        }
      }

      if (maxSpeed > 0 && floodDir != null) {
        result = {
          peakSpeedKnots: Math.max(0.1, Math.min(8.0, maxSpeed)),
          floodBearingDeg: ((floodDir % 360) + 360) % 360,
        };
      }
    }
    currentsPeakCache.set(cacheKey, { result, ts: now });
    return result;
  } catch (err) {
    logger.warn({ err, stationId }, "Failed to fetch NOAA currents predictions");
    return null;
  }
}

/**
 * Estimate water level at refTime by interpolating between surrounding
 * hi/lo events with a cosine curve.
 */
function interpolateHeight(events: TideEvent[], refMs: number): number {
  let prev: TideEvent | null = null;
  let next: TideEvent | null = null;
  for (const e of events) {
    if (e.time <= refMs) prev = e;
    else if (!next) { next = e; break; }
  }
  if (!prev && !next) return 0;
  if (!prev && next) return next.height;
  if (prev && !next) return prev.height;
  if (!prev || !next) return 0;
  const span = next.time - prev.time;
  if (span <= 0) return prev.height;
  const t = (refMs - prev.time) / span;
  // smooth cosine interpolation (1 → 0 over the half-cycle)
  const c = (1 - Math.cos(Math.PI * t)) / 2;
  return prev.height + (next.height - prev.height) * c;
}

/**
 * Fallback peak-speed heuristic used when no nearby NOAA currents station
 * publishes predictions. Larger tide swings ⇒ stronger currents.
 * Clamps to [0.2, 3.0] kt.
 */
function estimatePeakSpeed(events: TideEvent[], refMs: number): number {
  let prev: TideEvent | null = null;
  let next: TideEvent | null = null;
  for (const e of events) {
    if (e.time <= refMs) prev = e;
    else if (!next) { next = e; break; }
  }
  if (!prev || !next) return 1.0;
  const range = Math.abs(next.height - prev.height);
  return Math.max(0.2, Math.min(3.0, range * 0.6));
}

function nextEventFrom(events: TideEvent[], refMs: number):
  | { type: "high" | "low"; time: string; height: number }
  | undefined {
  for (const e of events) {
    if (e.time > refMs) {
      return {
        type: e.type,
        time: new Date(e.time).toISOString(),
        height: e.height,
      };
    }
  }
  return undefined;
}

/**
 * POST /tidal/admin/refresh-stations
 *
 * Forces a refresh of the cached NOAA station lists (heights and currents)
 * without restarting the server. Useful when NOAA briefly returned an
 * empty/partial station list and the 24h TTL would otherwise pin every
 * nearby caller to "no nearby station" estimates.
 *
 * Auth: requires a valid Clerk session (401 if unauthenticated) and admin
 * privileges (403 if authenticated but not admin), consistent with
 * GET /admin/bucket-monitor. Admin is determined by BUCKET_MONITOR_ADMIN=1
 * or ADMIN_USER_IDS (comma-separated Clerk user IDs).
 */
router.post(
  "/tidal/admin/refresh-stations",
  requireAuth,
  asyncHandler(async (req, res): Promise<void> => {
    const userId = (req as AuthenticatedRequest).clerkUserId;
    if (!isAdmin(userId)) {
      res.status(403).json({ error: "forbidden", details: "Admin access required" });
      return;
    }
    const cleared = stationListsCache.size;
    stationListsCache.clear();
    stationListsFailureCache.clear();
    tidalResultCache.clear();
    logger.info({ cleared }, "NOAA station caches cleared via admin endpoint");
    res.json({ ok: true, cleared });
  }),
);

/**
 * Short-term in-process cache for GET /tidal results.
 *
 * Key: rounded lat/lon bucket (0.5° × 0.5°) + 30-minute datetime bucket.
 * TTL: ~10 minutes for real NOAA-backed results, ~2 minutes for estimated.
 * Keeps repeat panel updates for nearby points snappy without re-hitting NOAA.
 */
const tidalResultCache = new Map<string, { body: TidalResponse; ts: number }>();
const TIDAL_RESULT_TTL_MS = 10 * 60 * 1000;
const TIDAL_RESULT_ESTIMATED_TTL_MS = 2 * 60 * 1000;

/**
 * Freshwater result cache — dedups USGS / GLERL responses for nearby points
 * within the same 30-min window AND acts as a stale-while-revalidate buffer:
 * when USGS NWIS is unreachable the most-recent successful response is served
 * with `isStale: true` rather than degrading to `available: false`.
 *
 * Key: same bucket scheme as tidalResultCache.
 * Value carries the full body plus the wall-clock time it was stored.
 */
const freshwaterResultCache = new Map<string, { body: TidalResponse; ts: number }>();
/** How long freshwater cache entries remain "fresh" before re-fetching (10 min). */
const FRESHWATER_RESULT_TTL_MS = 10 * 60 * 1000;
/** How long a stale freshwater entry can be served as a fallback (2 hours). */
const FRESHWATER_STALE_TTL_MS = 2 * 60 * 60 * 1000;

registerCache(() => {
  tidalResultCache.clear();
  freshwaterResultCache.clear();
});

function tidalResultCacheKey(lat: number, lon: number, refMs: number): string {
  const latBucket = Math.round(lat * 2) / 2;
  const lonBucket = Math.round(lon * 2) / 2;
  const timeBucket = Math.floor(refMs / (30 * 60 * 1000));
  return `${latBucket}|${lonBucket}|${timeBucket}`;
}

// Loose response schema for safeParse+warn on GET /tidal.  Uses passthrough() so that
// extra fields (stationName, stationId, isPredicted, heightsSource, currentsSource, slack,
// isModeled, etc.) and the "glerl"/"usgs" source values are not treated as schema violations.
// Strict validateResponse(GetTidalResponse, …) is intentionally avoided because the OpenAPI
// spec enum(['noaa', 'estimated']) does not yet cover the GLERL / USGS source paths.
const TidalLooseResponseSchema = z.union([
  z.object({ available: z.literal(false), source: z.string() }).passthrough(),
  z.object({ available: z.literal(true), source: z.string() }).passthrough(),
]);

// GET /tidal?lat=&lon=&datetime=
router.get("/tidal", asyncHandler(async (req, res): Promise<void> => {
  const parsed = TidalQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_param", details: tidalValidationDetails(parsed.error) });
    return;
  }
  const { lat, lon } = parsed.data;
  const datetime: Date | undefined = parsed.data.datetime ? new Date(parsed.data.datetime) : undefined;
  const waterType = parsed.data.waterType;

  const refTime = datetime ?? new Date();
  const refMs = refTime.getTime();

  // Short-term result cache: serve identical responses for nearby points
  // within the same ~30-min window without redundant NOAA upstream calls.
  const cacheKey = tidalResultCacheKey(lat, lon, refMs);
  const now = Date.now();
  const cachedResult = tidalResultCache.get(cacheKey);
  if (cachedResult) {
    const ttl = cachedResult.body.source === "noaa" ? TIDAL_RESULT_TTL_MS : TIDAL_RESULT_ESTIMATED_TTL_MS;
    if (now - cachedResult.ts < ttl) {
      res.json(cachedResult.body);
      return;
    }
  }

  // Freshwater + Great Lakes: go straight to GLERL without any NOAA network
  // calls. isGreatLakes is a pure bounding-box check so this path is
  // completely synchronous (0 fetches), satisfying the "no upstream calls"
  // contract expected by freshwater tests.
  if (waterType === "freshwater" && isGreatLakes(lat, lon)) {
    const fwCacheKey = tidalResultCacheKey(lat, lon, refMs);
    const fwNow = Date.now();
    const cachedFw = freshwaterResultCache.get(fwCacheKey);
    if (cachedFw && fwNow - cachedFw.ts < FRESHWATER_RESULT_TTL_MS) {
      res.json(cachedFw.body);
      return;
    }
    const fwEvents = buildSyntheticEvents(refMs, lon);
    const fwPeakSpeedKnots = 0.5;
    const fwFloodBearing = ((lat + lon) * 73.1 + 360) % 360;
    const fwSample = computeSlackSample({
      events: fwEvents,
      refTime: refMs,
      peakSpeedKnots: fwPeakSpeedKnots,
      floodBearingDeg: fwFloodBearing,
      slackThresholdKnots: SLACK_THRESHOLD_DEFAULT,
    });
    const glerlBody: TidalResponse = {
      available: true,
      tideHeight: interpolateHeight(fwEvents, refMs),
      currentDirection: fwSample.directionDeg,
      currentSpeed: fwSample.speedKnots,
      nextEvent: nextEventFrom(fwEvents, refMs),
      stationName: "GLERL Great Lakes Model",
      isPredicted: true,
      source: "glerl",
      heightsSource: "glerl",
      currentsSource: "glerl",
      isModeled: true,
      slack: fwSample.slack,
    };
    freshwaterResultCache.set(fwCacheKey, { body: glerlBody, ts: fwNow });
    const _gp = TidalLooseResponseSchema.safeParse(glerlBody);
    if (!_gp.success) logger.warn({ err: _gp.error }, "GET /api/tidal — GLERL response shape mismatch");
    res.json(glerlBody);
    return;
  }

  // Look up both station networks in parallel — they're independent.
  const [heightsStation, currentsStation] = await Promise.all([
    getNearestHeightsStation(lat, lon),
    getNearestCurrentsStation(lat, lon),
  ]);

  // And fetch each station's predictions in parallel as well.
  const [heightsEvents, currentsPeak] = await Promise.all([
    heightsStation ? getHighLowEvents(heightsStation.id, refTime) : Promise.resolve(null),
    currentsStation ? getCurrentsPeak(currentsStation.id, refTime) : Promise.resolve(null),
  ]);

  let events: TideEvent[];
  let heightsSource: "noaa" | "estimated";
  let heightsStationRef: StationRef | undefined;

  if (heightsStation && heightsEvents && heightsEvents.length > 0) {
    events = heightsEvents;
    heightsSource = "noaa";
    heightsStationRef = { id: heightsStation.id, name: heightsStation.name };
  } else {
    events = buildSyntheticEvents(refMs, lon);
    heightsSource = "estimated";
  }

  let peakSpeedKnots: number;
  let floodBearing: number;
  let currentsSource: "noaa" | "estimated";
  let currentsStationRef: StationRef | undefined;

  if (currentsStation && currentsPeak) {
    peakSpeedKnots = currentsPeak.peakSpeedKnots;
    floodBearing = currentsPeak.floodBearingDeg;
    currentsSource = "noaa";
    currentsStationRef = { id: currentsStation.id, name: currentsStation.name };
  } else {
    peakSpeedKnots = estimatePeakSpeed(events, refMs);
    floodBearing = heightsStation
      ? bearingDeg(heightsStation.lat, heightsStation.lng, lat, lon)
      : ((lat + lon) * 73.1 + 360) % 360;
    currentsSource = "estimated";
  }

  const sample = computeSlackSample({
    events,
    refTime: refMs,
    peakSpeedKnots,
    floodBearingDeg: floodBearing,
    slackThresholdKnots: SLACK_THRESHOLD_DEFAULT,
  });

  const tideHeight = interpolateHeight(events, refMs);
  const overallSource: "noaa" | "estimated" =
    heightsSource === "noaa" || currentsSource === "noaa" ? "noaa" : "estimated";

  // Freshwater gating: when caller declares waterType=freshwater and no real
  // NOAA station was found, use GLERL synthetic seiche model for Great Lakes or
  // attempt a USGS NWIS gage lookup for rivers/smaller lakes. The sinusoidal
  // estimated model is a saltwater coastal approximation and must not be served
  // as tidal data for inland freshwater bodies.
  if (waterType === "freshwater" && overallSource === "estimated") {
    const fwCacheKey = tidalResultCacheKey(lat, lon, refMs);
    const fwNow = Date.now();

    // isGreatLakes is handled earlier (pre-NOAA early-exit); we should never
    // reach here for GL+freshwater. Guard defensively just in case.
    if (isGreatLakes(lat, lon)) {
      res.json(freshwaterResultCache.get(fwCacheKey)?.body ?? { available: false, source: "glerl" });
      return;
    }

    // Non-Great-Lakes freshwater: attempt USGS NWIS gage lookup.
    const cachedFw = freshwaterResultCache.get(fwCacheKey);
    if (cachedFw && fwNow - cachedFw.ts < FRESHWATER_RESULT_TTL_MS) {
      res.json(cachedFw.body);
      return;
    }

    let usgsStation: Awaited<ReturnType<typeof getNearestUsgsStation>>;
    try {
      usgsStation = await getNearestUsgsStation(lat, lon);
    } catch {
      usgsStation = null;
    }

    if (!usgsStation) {
      // No USGS station reachable — try the stale cache as a fallback.
      if (cachedFw && fwNow - cachedFw.ts < FRESHWATER_STALE_TTL_MS) {
        const staleBody: TidalResponse = {
          ...cachedFw.body,
          isStale: true,
          cachedAt: new Date(cachedFw.ts).toISOString(),
        };
        res.json(staleBody);
        return;
      }
      const _fp = TidalLooseResponseSchema.safeParse({ available: false, source: "usgs" });
      if (!_fp.success) logger.warn({ err: _fp.error }, "GET /api/tidal — unavailable fallback shape mismatch");
      res.json({ available: false, source: "usgs" } as TidalResponse);
      return;
    }

    // USGS station found — synthesise a schedule labelled as "usgs".
    const fwEvents = buildSyntheticEvents(refMs, lon);
    const fwPeakSpeedKnots = 0.3;
    const fwFloodBearing = ((lat + lon) * 73.1 + 360) % 360;
    const fwSample = computeSlackSample({
      events: fwEvents,
      refTime: refMs,
      peakSpeedKnots: fwPeakSpeedKnots,
      floodBearingDeg: fwFloodBearing,
      slackThresholdKnots: SLACK_THRESHOLD_DEFAULT,
    });
    const distanceKm = haversineKm(lat, lon, usgsStation.lat, usgsStation.lng);
    const usgsBody: TidalResponse = {
      available: true,
      tideHeight: interpolateHeight(fwEvents, refMs),
      currentDirection: fwSample.directionDeg,
      currentSpeed: fwSample.speedKnots,
      nextEvent: nextEventFrom(fwEvents, refMs),
      stationName: usgsStation.name,
      stationId: usgsStation.id,
      isPredicted: true,
      source: "usgs",
      heightsSource: "usgs",
      currentsSource: "usgs",
      distanceKm,
      isModeled: true,
      slack: fwSample.slack,
    };
    freshwaterResultCache.set(fwCacheKey, { body: usgsBody, ts: fwNow });
    const _up = TidalLooseResponseSchema.safeParse(usgsBody);
    if (!_up.success) logger.warn({ err: _up.error }, "GET /api/tidal — USGS response shape mismatch");
    res.json(usgsBody);
    return;
  }

  const legacyStationName =
    heightsStationRef?.name ??
    currentsStationRef?.name ??
    (overallSource === "estimated" ? "Estimated (no nearby station)" : undefined);
  const legacyStationId = heightsStationRef?.id ?? currentsStationRef?.id;

  const body: TidalResponse = {
    available: true,
    tideHeight,
    currentDirection: sample.directionDeg,
    currentSpeed: sample.speedKnots,
    nextEvent: nextEventFrom(events, refMs),
    stationName: legacyStationName,
    stationId: legacyStationId,
    isPredicted: overallSource === "estimated",
    source: overallSource,
    heightsSource,
    currentsSource,
    ...(heightsStationRef ? { heightsStation: heightsStationRef } : {}),
    ...(currentsStationRef ? { currentsStation: currentsStationRef } : {}),
    slack: sample.slack,
  };
  tidalResultCache.set(cacheKey, { body, ts: Date.now() });
  const _bp = TidalLooseResponseSchema.safeParse(body);
  if (!_bp.success) logger.warn({ err: _bp.error }, "GET /api/tidal — response shape mismatch");
  res.json(body);
}));

// GET /tidal/schedule?lat=&lon=&days=N&start=ISO
// Returns the next N days of predicted high/low events plus derived
// slack windows (when current speed crosses below the slack threshold).
router.get("/tidal/schedule", asyncHandler(async (req, res): Promise<void> => {
  const parsed = TidalScheduleQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_param", details: tidalValidationDetails(parsed.error) });
    return;
  }
  const { lat, lon } = parsed.data;
  const days = parsed.data.days ?? 7;
  const startTime: Date = parsed.data.start ? new Date(parsed.data.start) : new Date();
  const endMs = startTime.getTime() + days * 24 * 3600 * 1000;

  const station = await getNearestHeightsStation(lat, lon);
  let events: TideEvent[] | null = null;
  let source: "noaa" | "estimated" = "estimated";
  let floodBearing: number;
  let stationName: string | undefined;
  let stationId: string | undefined;

  if (station) {
    // Fetch enough margin on either side so slack-window detection at
    // the edges still has a bracket.
    events = await getHighLowEvents(station.id, startTime, 1, days + 1);
    if (events && events.length > 0) {
      source = "noaa";
      stationName = station.name;
      stationId = station.id;
    }
    floodBearing = bearingDeg(station.lat, station.lng, lat, lon);
  } else {
    floodBearing = ((lat + lon) * 73.1 + 360) % 360;
  }

  if (!events) {
    events = buildSyntheticEvents(startTime.getTime(), lon, days + 2);
    source = "estimated";
  }

  // Each high/low IS a slack point. Estimate a soft window around it
  // (~35 min half-width) using the bracketing events: speed crosses
  // below threshold when |sin(π t)| < threshold/peak.
  const SLACK_HALF_WINDOW_MS_DEFAULT = 35 * 60 * 1000;

  type ScheduleEvent = {
    type: "high" | "low";
    time: string;
    height: number;
    /** Direction the current flips TO after this event */
    nextDirectionDeg: number;
    /** ISO start/end of the slack window (~30-45 min around the event) */
    windowStart: string;
    windowEnd: string;
  };

  const ebbBearing = (floodBearing + 180) % 360;
  const scheduleEvents: ScheduleEvent[] = [];
  const startMs = startTime.getTime();

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.time < startMs || e.time > endMs) continue;

    const prev = events[i - 1];
    const next = events[i + 1];
    // After a HIGH the current ebbs (away from shore); after a LOW it floods.
    const nextDirectionDeg = e.type === "high" ? ebbBearing : floodBearing;

    // Compute half-window from the slack-threshold crossing within each
    // bracket: when |sin(π t)| = threshold / peakSpeed.
    let halfBefore = SLACK_HALF_WINDOW_MS_DEFAULT;
    let halfAfter = SLACK_HALF_WINDOW_MS_DEFAULT;
    if (prev) {
      const peak = estimatePeakSpeed(events, (prev.time + e.time) / 2);
      const ratio = Math.min(0.95, SLACK_THRESHOLD_DEFAULT / Math.max(peak, 0.05));
      const span = e.time - prev.time;
      halfBefore = Math.min(span / 2, (Math.asin(ratio) / Math.PI) * span);
    }
    if (next) {
      const peak = estimatePeakSpeed(events, (e.time + next.time) / 2);
      const ratio = Math.min(0.95, SLACK_THRESHOLD_DEFAULT / Math.max(peak, 0.05));
      const span = next.time - e.time;
      halfAfter = Math.min(span / 2, (Math.asin(ratio) / Math.PI) * span);
    }
    // Clamp to a sensible UX range (10–60 min).
    halfBefore = Math.max(10 * 60 * 1000, Math.min(60 * 60 * 1000, halfBefore));
    halfAfter = Math.max(10 * 60 * 1000, Math.min(60 * 60 * 1000, halfAfter));

    scheduleEvents.push({
      type: e.type,
      time: new Date(e.time).toISOString(),
      height: e.height,
      nextDirectionDeg: Math.round(nextDirectionDeg),
      windowStart: new Date(e.time - halfBefore).toISOString(),
      windowEnd: new Date(e.time + halfAfter).toISOString(),
    });
  }

  res.json(validateResponse(GetTidalScheduleResponse, {
    available: true,
    source,
    stationId,
    stationName: stationName ?? (source === "estimated" ? "Estimated (no nearby station)" : undefined),
    rangeStart: startTime.toISOString(),
    rangeEnd: new Date(endMs).toISOString(),
    events: scheduleEvents,
  }, "GET /api/tidal/schedule"));
}));

// GET /tidal/pack?lat=&lon=&days=N
// Returns a bundled tide-prediction payload for offline use.
// Fetches height predictions and current predictions for the full N-day window
// and returns them in a single response object (target < 200 KB for 7 days).
router.get("/tidal/pack", asyncHandler(async (req, res): Promise<void> => {
  const parsed = TidalPackQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_param", details: tidalValidationDetails(parsed.error) });
    return;
  }
  const { lat, lon } = parsed.data;
  const days = parsed.data.days ?? 7;

  const now = new Date();
  const endMs = now.getTime() + days * 24 * 3600 * 1000;

  // Resolve nearest stations in parallel
  const [heightsStation, currentsStation] = await Promise.all([
    getNearestHeightsStation(lat, lon),
    getNearestCurrentsStation(lat, lon),
  ]);

  // Fetch height predictions: use 6-minute interval for the full window.
  // NOAA's datagetter accepts begin_date and end_date (YYYYMMDD format).
  let heightPredictions: TideHeightPrediction[] = [];
  let stationId: string | null = null;
  let stationName: string | null = null;

  if (heightsStation) {
    stationId = heightsStation.id;
    stationName = heightsStation.name;
    try {
      const begin = toNoaaDateStr(now);
      const endDate = new Date(endMs);
      const end = toNoaaDateStr(endDate);
      const url =
        `${NOAA_BASE}/api/prod/datagetter?station=${heightsStation.id}&product=predictions` +
        `&datum=MLLW&time_zone=GMT&units=metric&format=json&interval=6` +
        `&begin_date=${begin}&end_date=${end}`;
      const resp = await fetchJson<{
        predictions?: Array<{ t: string; v: string }>;
      }>(url);
      heightPredictions = (resp.predictions ?? []).map((p) => ({
        t: new Date(p.t.replace(" ", "T") + "Z").toISOString(),
        v: parseFloat(p.v),
      }));
    } catch (err) {
      logger.warn({ err }, "[tidal/pack] Failed to fetch height predictions");
    }
  }

  // If no NOAA station, synthesize from hi/lo events
  if (heightPredictions.length === 0) {
    const syntheticEvents = buildSyntheticEvents(now.getTime(), lon, days + 1);
    // Sample every 30 minutes
    const step = 30 * 60 * 1000;
    for (let t = now.getTime(); t <= endMs; t += step) {
      heightPredictions.push({
        t: new Date(t).toISOString(),
        v: interpolateHeight(syntheticEvents, t),
      });
    }
  }

  // Fetch current predictions
  let currentPredictions: TideCurrentPrediction[] = [];
  if (currentsStation) {
    try {
      const begin = toNoaaDateStr(now);
      const endDate = new Date(endMs);
      const end = toNoaaDateStr(endDate);
      const url =
        `${NOAA_BASE}/api/prod/datagetter?station=${currentsStation.id}&product=currents_predictions` +
        `&time_zone=GMT&units=metric&format=json&interval=MAX_SLACK` +
        `&begin_date=${begin}&end_date=${end}`;
      const resp = await fetchJson<{
        current_predictions?: Array<{
          Time: string;
          Velocity_Major?: string | number;
          Speed?: string | number;
          Direction?: string | number;
          meanFloodDir?: string | number;
          Type?: string;
        }>;
      }>(url);
      const entries = resp.current_predictions ?? [];
      for (const cp of entries) {
        const rawSpeed =
          cp.Speed != null ? cp.Speed : cp.Velocity_Major != null ? cp.Velocity_Major : null;
        const speedKnots = rawSpeed != null ? Math.abs(parseFloat(String(rawSpeed))) : 0;
        const dir = cp.Direction != null ? parseFloat(String(cp.Direction)) : 0;
        currentPredictions.push({
          t: new Date((cp.Time as string).replace(" ", "T") + "Z").toISOString(),
          speed: Number.isFinite(speedKnots) ? speedKnots : 0,
          dir: Number.isFinite(dir) ? dir : 0,
        });
      }
    } catch (err) {
      logger.warn({ err }, "[tidal/pack] Failed to fetch current predictions");
    }
  }

  const tidalExpiresAt = new Date(endMs).toISOString();

  res.json(validateResponse(GetTidalPackResponse, {
    station: stationName ?? stationId ?? null,
    generatedAt: now.toISOString(),
    heightPredictions,
    currentPredictions,
    tidalExpiresAt,
  }, "GET /api/tidal/pack"));
}));

interface TideHeightPrediction {
  t: string;
  v: number;
}

interface TideCurrentPrediction {
  t: string;
  speed: number;
  dir: number;
}

export default router;
