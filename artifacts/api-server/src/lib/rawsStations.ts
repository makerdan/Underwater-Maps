/**
 * rawsStations.ts — AOOS RAWS station catalog fetcher.
 *
 * Fetches the full list of RAWS (Remote Automatic Weather Station) stations
 * from the AOOS ERDDAP server and caches the result in-process for 24 hours.
 * The catalog is stable and rarely changes, so a long TTL is appropriate.
 *
 * ERDDAP base: https://erddap.aoos.org/erddap
 * Station catalog: GET /erddap/tabledap/allDatasets.json?datasetID,title,minLongitude,minLatitude&datasetID=~"raws_.*"
 */

import { registerCache } from "./cacheRegistry.js";

const ERDDAP_BASE = "https://erddap.aoos.org/erddap";
const CATALOG_URL =
  `${ERDDAP_BASE}/tabledap/allDatasets.json` +
  `?datasetID,title,minLongitude,minLatitude&datasetID=~"raws_.*"`;

const FETCH_TIMEOUT_MS = 10_000;
const POSITIVE_TTL_MS = 24 * 60 * 60_000;
const NEGATIVE_TTL_MS = 2 * 60_000;

export interface RawsStation {
  datasetId: string;
  name: string;
  lat: number;
  lon: number;
}

interface CacheEntry {
  value: RawsStation[] | null;
  expiresAt: number;
}

const stationCache = new Map<"catalog", CacheEntry>();
registerCache(() => stationCache.clear());

/** Test helper — drop all cached RAWS station catalog entries. */
export function __clearRawsStationCache(): void {
  stationCache.clear();
}

interface ErddapTableResponse {
  table?: {
    columnNames?: string[];
    rows?: unknown[][];
  };
}

function parseStations(json: ErddapTableResponse): RawsStation[] {
  const cols = json.table?.columnNames ?? [];
  const rows = json.table?.rows ?? [];

  const idIdx = cols.indexOf("datasetID");
  const titleIdx = cols.indexOf("title");
  const lonIdx = cols.indexOf("minLongitude");
  const latIdx = cols.indexOf("minLatitude");

  if (idIdx < 0 || titleIdx < 0 || lonIdx < 0 || latIdx < 0) return [];

  const out: RawsStation[] = [];
  for (const r of rows) {
    const datasetId = r[idIdx];
    const name = r[titleIdx];
    const lon = Number(r[lonIdx]);
    const lat = Number(r[latIdx]);
    if (
      typeof datasetId !== "string" ||
      typeof name !== "string" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    )
      continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    out.push({ datasetId, name, lat, lon });
  }
  return out;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchRawsStationsUncached(): Promise<RawsStation[] | null> {
  try {
    const res = await fetchWithTimeout(CATALOG_URL, FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    const json = (await res.json()) as ErddapTableResponse;
    const stations = parseStations(json);
    return stations.length > 0 ? stations : null;
  } catch {
    return null;
  }
}

/** Fetch and cache the full AOOS RAWS station catalog. Returns null on failure. */
export async function fetchRawsStations(): Promise<RawsStation[] | null> {
  const now = Date.now();
  const cached = stationCache.get("catalog");
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const value = await fetchRawsStationsUncached();
  stationCache.set("catalog", {
    value,
    expiresAt: now + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  return value;
}
