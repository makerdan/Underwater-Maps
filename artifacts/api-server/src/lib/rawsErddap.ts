/**
 * rawsErddap.ts — AOOS RAWS per-station observation fetcher.
 *
 * Given a RAWS datasetId, fetches the latest observation from the AOOS ERDDAP
 * server using a `time>=now-2hours` filter and `orderByMax("time")` to return
 * a single most-recent row.
 *
 * Variables are negotiated dynamically per dataset: we first fetch the ERDDAP
 * metadata for the dataset (cached per-dataset) to discover which of our
 * desired variables are actually present, then request only those. This
 * prevents a 400 error when a station lacks a particular sensor.
 *
 * Per-station metadata: GET /erddap/info/{datasetId}/index.json
 * Per-station obs:      GET /erddap/tabledap/{datasetId}.json?time,{vars}&time>=now-2hours&orderByMax("time")
 *
 * Resilience: successful observations are persisted to the `raws_observation_cache`
 * DB table. When ERDDAP is unreachable the last-good observation is returned
 * with `stale: true` so the UI can indicate the data may be outdated.
 */

import { registerCache } from "./cacheRegistry.js";
import { db, rawsObservationCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

const ERDDAP_BASE = "https://erddap.aoos.org/erddap";
const FETCH_TIMEOUT_MS = 8_000;
const META_FETCH_TIMEOUT_MS = 6_000;
const POSITIVE_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 2 * 60_000;
const META_TTL_MS = 60 * 60_000; // 1 hour — schema rarely changes
const STALE_THRESHOLD_MS = 10 * 60_000; // mark stale after 10 min

/**
 * Variables we want to extract, in preference order.
 * Only those present in a given dataset will be requested.
 */
const DESIRED_VARS = [
  "air_temperature",
  // alternate name used by some RAWS datasets
  "air_temperature_cm_time__mean_over_pt24h",
  "wind_speed",
  "wind_from_direction",
  "wind_speed_of_gust",
  "relative_humidity",
  "solar_irradiance",
  "lwe_thickness_of_precipitation_amount",
  "fuel_temperature",
  "battery_voltage",
] as const;

export interface RawsObservation {
  time: string | null;
  airTemperatureC: number | null;
  windSpeedMs: number | null;
  windFromDirectionDeg: number | null;
  windGustMs: number | null;
  relativeHumidityPct: number | null;
  solarIrradianceWm2: number | null;
  precipitationMm: number | null;
  fuelTemperatureC: number | null;
  batteryVoltageV: number | null;
}

/**
 * Result shape returned by `fetchRawsObservation`.
 * `stale: true` means the observation comes from the DB fallback cache and
 * is older than 10 minutes — ERDDAP was unreachable at request time.
 */
export interface RawsObservationResult {
  observation: RawsObservation;
  stale: boolean;
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

interface ObsCacheEntry {
  value: RawsObservation | null;
  /** True when this entry was populated from the DB fallback, not a live ERDDAP fetch. */
  stale: boolean;
  expiresAt: number;
}

interface MetaCacheEntry {
  /** Set of variable names available in this dataset. */
  variables: Set<string>;
  expiresAt: number;
}

const obsCache = new Map<string, ObsCacheEntry>();
registerCache(() => obsCache.clear());

const metaCache = new Map<string, MetaCacheEntry>();
registerCache(() => metaCache.clear());

/** Test helper — drop all cached RAWS observation entries. */
export function __clearRawsObsCache(): void {
  obsCache.clear();
  metaCache.clear();
}

// ---------------------------------------------------------------------------
// ERDDAP table response shape
// ---------------------------------------------------------------------------

interface ErddapTableResponse {
  table?: {
    columnNames?: string[];
    rows?: unknown[][];
  };
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function getNum(row: unknown[], cols: string[], name: string): number | null {
  const i = cols.indexOf(name);
  if (i < 0) return null;
  const v = Number(row[i]);
  return Number.isFinite(v) ? v : null;
}

function getStr(row: unknown[], cols: string[], name: string): string | null {
  const i = cols.indexOf(name);
  if (i < 0) return null;
  const v = row[i];
  return typeof v === "string" ? v : null;
}

function parseRow(row: unknown[], cols: string[]): RawsObservation {
  const tempC =
    getNum(row, cols, "air_temperature") ??
    getNum(row, cols, "air_temperature_cm_time__mean_over_pt24h");
  return {
    time: getStr(row, cols, "time"),
    airTemperatureC: tempC,
    windSpeedMs: getNum(row, cols, "wind_speed"),
    windFromDirectionDeg: getNum(row, cols, "wind_from_direction"),
    windGustMs: getNum(row, cols, "wind_speed_of_gust"),
    relativeHumidityPct: getNum(row, cols, "relative_humidity"),
    solarIrradianceWm2: getNum(row, cols, "solar_irradiance"),
    precipitationMm: getNum(row, cols, "lwe_thickness_of_precipitation_amount"),
    fuelTemperatureC: getNum(row, cols, "fuel_temperature"),
    batteryVoltageV: getNum(row, cols, "battery_voltage"),
  };
}

/** Parse the first row of an ERDDAP table response (used for latest-obs queries). */
function parseObservation(json: ErddapTableResponse): RawsObservation | null {
  const cols = json.table?.columnNames ?? [];
  const rows = json.table?.rows ?? [];
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, cols);
}

/**
 * Parse all rows of an ERDDAP table response.
 * Used by fetchRawsObservationAt to select the nearest observation client-side.
 */
function parseAllObservations(json: ErddapTableResponse): RawsObservation[] {
  const cols = json.table?.columnNames ?? [];
  const rows = json.table?.rows ?? [];
  return rows.map((row) => parseRow(row, cols));
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// Schema-dynamic variable negotiation
// ---------------------------------------------------------------------------

/**
 * Fetch the set of variable names available for `datasetId` from the ERDDAP
 * `/info/{datasetId}/index.json` endpoint. Returns an empty Set on failure so
 * callers can degrade gracefully.
 */
async function fetchDatasetVariables(datasetId: string): Promise<Set<string>> {
  try {
    const url = `${ERDDAP_BASE}/info/${encodeURIComponent(datasetId)}/index.json`;
    const res = await fetchWithTimeout(url, META_FETCH_TIMEOUT_MS);
    if (!res.ok) return new Set();

    const json = (await res.json()) as ErddapTableResponse;
    const cols = json.table?.columnNames ?? [];
    const rows = json.table?.rows ?? [];

    const rowTypeIdx = cols.indexOf("Row Type");
    const varNameIdx = cols.indexOf("Variable Name");
    if (rowTypeIdx < 0 || varNameIdx < 0) return new Set();

    const vars = new Set<string>();
    for (const row of rows) {
      if (row[rowTypeIdx] === "variable") {
        const name = row[varNameIdx];
        if (typeof name === "string") vars.add(name);
      }
    }
    return vars;
  } catch {
    return new Set();
  }
}

/**
 * Return the cached variable set for `datasetId`, fetching from ERDDAP if
 * needed. Returns null when the fetch fails so the caller can fall back to
 * requesting all desired vars (ERDDAP will 400 for missing ones, but we
 * handle that with a graceful null return).
 */
async function getDatasetVariables(datasetId: string): Promise<Set<string> | null> {
  const now = Date.now();
  const cached = metaCache.get(datasetId);
  if (cached && cached.expiresAt > now) return cached.variables;

  const vars = await fetchDatasetVariables(datasetId);
  if (vars.size === 0) return null; // fetch failed — caller will degrade

  metaCache.set(datasetId, { variables: vars, expiresAt: now + META_TTL_MS });
  return vars;
}

// ---------------------------------------------------------------------------
// Observation fetch
// ---------------------------------------------------------------------------

async function fetchObsUncached(datasetId: string): Promise<RawsObservation | null> {
  // Discover which of our desired variables this dataset actually provides.
  const available = await getDatasetVariables(datasetId);

  // Filter desired vars to those the dataset supports. If metadata failed,
  // fall back to the full set (ERDDAP may still succeed; we return null on 4xx).
  const requestedVars =
    available !== null
      ? DESIRED_VARS.filter((v) => available.has(v))
      : [...DESIRED_VARS];

  // Always include "time" (required for orderByMax).
  const varList = ["time", ...requestedVars].join(",");

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const url =
    `${ERDDAP_BASE}/tabledap/${encodeURIComponent(datasetId)}.json` +
    `?${varList}&time>=${twoHoursAgo}&orderByMax("time")`;

  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    const json = (await res.json()) as ErddapTableResponse;
    return parseObservation(json);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/** Persist a successful observation to the DB (fire-and-forget). */
async function persistToDb(datasetId: string, observation: RawsObservation): Promise<void> {
  try {
    await db
      .insert(rawsObservationCacheTable)
      .values({
        datasetId,
        observation: observation as unknown as Record<string, unknown>,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: rawsObservationCacheTable.datasetId,
        set: {
          observation: observation as unknown as Record<string, unknown>,
          fetchedAt: new Date(),
        },
      });
  } catch (err) {
    logger.warn({ err }, "[raws-erddap] Failed to persist to DB");
  }
}

/**
 * Try to load the last-good observation from the DB.
 * Returns null if no row exists for this datasetId.
 * The caller decides whether to mark the result stale based on `fetchedAt`.
 */
async function loadFromDb(
  datasetId: string,
): Promise<{ observation: RawsObservation; fetchedAt: Date } | null> {
  try {
    const rows = await db
      .select()
      .from(rawsObservationCacheTable)
      .where(eq(rawsObservationCacheTable.datasetId, datasetId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      observation: row.observation as unknown as RawsObservation,
      fetchedAt: row.fetchedAt,
    };
  } catch (err) {
    logger.warn({ err }, "[raws-erddap] Failed to load from DB");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the observation nearest to `targetTime` for a RAWS station.
 *
 * Queries ERDDAP for observations in a ±2-hour window around the target time
 * and returns the latest one within that window (closest from below).
 *
 * Falls back to `fetchRawsObservation` (live/latest) when ERDDAP returns no
 * rows for the requested window — this preserves graceful degradation when
 * historical data is unavailable for older timestamps.
 *
 * Not cached server-side (historical queries are inherently varied); the
 * client-side hook performs its own hour-bucketed caching.
 */
export async function fetchRawsObservationAt(
  datasetId: string,
  targetTime: Date,
): Promise<RawsObservationResult | null> {
  const available = await getDatasetVariables(datasetId);
  const requestedVars =
    available !== null
      ? DESIRED_VARS.filter((v) => available.has(v))
      : [...DESIRED_VARS];
  const varList = ["time", ...requestedVars].join(",");

  // ±2-hour window; cap end at now so we don't query the future.
  // No orderByMax — fetch all rows in window, then pick nearest client-side
  // (mirrors the NOAA nearest-feature strategy).
  const windowStart = new Date(targetTime.getTime() - 2 * 60 * 60_000).toISOString();
  const windowEnd   = new Date(Math.min(targetTime.getTime() + 2 * 60 * 60_000, Date.now())).toISOString();

  const url =
    `${ERDDAP_BASE}/tabledap/${encodeURIComponent(datasetId)}.json` +
    `?${varList}&time>=${windowStart}&time<=${windowEnd}`;

  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (res.ok) {
      const json = (await res.json()) as ErddapTableResponse;
      const observations = parseAllObservations(json);
      if (observations.length > 0) {
        const targetMs = targetTime.getTime();
        // Select the observation whose timestamp is closest to targetTime
        let nearest = observations[0]!;
        let nearestDiff = Infinity;
        for (const obs of observations) {
          if (!obs.time) continue;
          const diff = Math.abs(new Date(obs.time).getTime() - targetMs);
          if (diff < nearestDiff) {
            nearestDiff = diff;
            nearest = obs;
          }
        }
        return { observation: nearest, stale: false };
      }
    }
  } catch {
    // fall through to live latest below
  }

  // No historical row found for the requested window — degrade to latest
  return fetchRawsObservation(datasetId);
}

/**
 * Fetch the latest observation for a RAWS station identified by `datasetId`.
 *
 * Returns null when the station is unreachable and no DB fallback exists.
 * Returns `{ observation, stale: true }` when serving the DB fallback because
 * ERDDAP was unreachable; `stale` is set whenever the cached data is older
 * than 10 minutes so the UI can indicate the data may be outdated.
 */
export async function fetchRawsObservation(
  datasetId: string,
): Promise<RawsObservationResult | null> {
  const now = Date.now();

  // 1. In-memory cache (hot path)
  const cached = obsCache.get(datasetId);
  if (cached && cached.expiresAt > now) {
    if (cached.value === null) return null;
    return { observation: cached.value, stale: cached.stale };
  }

  // 2. Try live ERDDAP fetch
  const observation = await fetchObsUncached(datasetId);

  if (observation !== null) {
    // Success — warm in-memory cache and persist to DB
    obsCache.set(datasetId, { value: observation, stale: false, expiresAt: now + POSITIVE_TTL_MS });
    void persistToDb(datasetId, observation);
    return { observation, stale: false };
  }

  // 3. ERDDAP returned nothing — try DB fallback BEFORE writing anything to
  //    the in-memory cache. Writing a null entry first would cause every
  //    subsequent request within NEGATIVE_TTL to bypass the DB and return null.
  const dbEntry = await loadFromDb(datasetId);
  if (dbEntry) {
    const ageMs = now - dbEntry.fetchedAt.getTime();
    const stale = ageMs > STALE_THRESHOLD_MS;
    logger.info(
      { datasetId, ageMs, stale },
      `[raws-erddap] Serving DB fallback for ${datasetId} (age=${Math.round(ageMs / 1000)}s, stale=${stale})`,
    );
    // Cache the fallback result (not null) so concurrent/subsequent requests
    // also get the fallback data for the duration of NEGATIVE_TTL.
    obsCache.set(datasetId, { value: dbEntry.observation, stale, expiresAt: now + NEGATIVE_TTL_MS });
    return { observation: dbEntry.observation, stale };
  }

  // No live data and no DB fallback — station is truly unavailable.
  // Cache the negative result briefly to avoid hammering ERDDAP.
  obsCache.set(datasetId, { value: null, stale: false, expiresAt: now + NEGATIVE_TTL_MS });
  return null;
}
