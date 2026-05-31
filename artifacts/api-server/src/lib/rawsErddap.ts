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
 */

import { registerCache } from "./cacheRegistry.js";

const ERDDAP_BASE = "https://erddap.aoos.org/erddap";
const FETCH_TIMEOUT_MS = 8_000;
const META_FETCH_TIMEOUT_MS = 6_000;
const POSITIVE_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 2 * 60_000;
const META_TTL_MS = 60 * 60_000; // 1 hour — schema rarely changes

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

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

interface ObsCacheEntry {
  value: RawsObservation | null;
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

function parseObservation(json: ErddapTableResponse): RawsObservation | null {
  const cols = json.table?.columnNames ?? [];
  const rows = json.table?.rows ?? [];
  if (rows.length === 0) return null;

  const row = rows[0]!;

  // Support alternate temperature variable name
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

/**
 * Fetch the latest observation for a RAWS station identified by `datasetId`.
 * Returns null when the station is unreachable or has no recent data.
 */
export async function fetchRawsObservation(
  datasetId: string,
): Promise<RawsObservation | null> {
  const now = Date.now();
  const cached = obsCache.get(datasetId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const value = await fetchObsUncached(datasetId);
  obsCache.set(datasetId, {
    value,
    expiresAt: now + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  return value;
}
