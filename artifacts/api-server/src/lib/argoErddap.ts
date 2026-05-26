/**
 * argoErddap — Argo float depth-temperature profile provider.
 *
 * Argo is a global array of ~4,000 free-drifting floats that measure
 * temperature/salinity from the surface to 2,000 m every 10 days. The
 * Ifremer ERDDAP server (https://erddap.ifremer.fr) exposes the full
 * archive over a public REST API — no key required.
 *
 * Strategy:
 *   1. Query the `ArgoFloats` tabledap for samples within a small bbox
 *      around (lat, lon) over the last ~60 days, ordered most-recent
 *      first, capped to one float profile worth of rows.
 *   2. Group by (platform_number, cycle_number), pick the cast closest
 *      to the request point, return its samples sorted shallow→deep.
 *
 * Failures (network, timeout, malformed JSON, no rows in range) all
 * resolve to `null` so the route falls through to the next provider.
 */

import type { TemperatureProfilePayload } from "../routes/temperature-profile";

const ERDDAP_BASE = "https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.json";
const SEARCH_RADIUS_DEG = 2.0;
const SEARCH_WINDOW_DAYS = 60;
const FETCH_TIMEOUT_MS = 6000;
const MAX_ROWS = 2000;

// In-process cache: coarse lat/lon bucket → recent ERDDAP result. The bucket
// is large enough that nearby requests share an entry but small enough that a
// distant request won't be served a wildly-off cast. Positive entries live
// long enough to absorb burst load; negative entries (no Argo in range) expire
// sooner so we recheck once a new float drifts into the area.
const CACHE_BUCKET_DEG = 0.5;
const POSITIVE_TTL_MS = 30 * 60_000;
const NEGATIVE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  expiresAt: number;
  value: TemperatureProfilePayload | null;
}

const profileCache = new Map<string, CacheEntry>();

function cacheKey(lat: number, lon: number): string {
  const b = CACHE_BUCKET_DEG;
  const latBucket = Math.round(lat / b) * b;
  const lonBucket = Math.round(lon / b) * b;
  return `${latBucket.toFixed(2)},${lonBucket.toFixed(2)}`;
}

/** Test helper — drop all cached Argo lookups. */
export function __clearArgoCache(): void {
  profileCache.clear();
}

interface ErddapResponse {
  table?: {
    columnNames?: string[];
    rows?: unknown[][];
  };
}

interface ArgoRow {
  platform: string;
  cycle: number;
  time: string;
  lat: number;
  lon: number;
  pres: number;
  temp: number;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Build the ERDDAP tabledap query URL for an Argo profile lookup near
 * `(lat, lon)` over the last `SEARCH_WINDOW_DAYS` days.
 *
 * Exported for tests so we can assert the URL shape without a live HTTP
 * call.
 */
export function buildArgoQueryUrl(lat: number, lon: number, now: Date = new Date()): string {
  const cols = [
    "platform_number",
    "cycle_number",
    "time",
    "latitude",
    "longitude",
    "pres",
    "temp",
  ].join(",");
  const minLat = lat - SEARCH_RADIUS_DEG;
  const maxLat = lat + SEARCH_RADIUS_DEG;
  const minLon = lon - SEARCH_RADIUS_DEG;
  const maxLon = lon + SEARCH_RADIUS_DEG;
  const since = new Date(now.getTime() - SEARCH_WINDOW_DAYS * 86_400_000)
    .toISOString();
  const constraints = [
    `latitude>=${minLat}`,
    `latitude<=${maxLat}`,
    `longitude>=${minLon}`,
    `longitude<=${maxLon}`,
    `time>=${since}`,
    "temp!=NaN",
    "pres!=NaN",
  ].join("&");
  return `${ERDDAP_BASE}?${cols}&${constraints}&orderByLimit("time/1day,${MAX_ROWS}")`;
}

/**
 * Parse an ERDDAP `.json` table response into row objects.
 */
export function parseArgoRows(json: ErddapResponse): ArgoRow[] {
  const cols = json.table?.columnNames ?? [];
  const rows = json.table?.rows ?? [];
  const idx = {
    platform: cols.indexOf("platform_number"),
    cycle: cols.indexOf("cycle_number"),
    time: cols.indexOf("time"),
    lat: cols.indexOf("latitude"),
    lon: cols.indexOf("longitude"),
    pres: cols.indexOf("pres"),
    temp: cols.indexOf("temp"),
  };
  if (Object.values(idx).some((i) => i < 0)) return [];
  const out: ArgoRow[] = [];
  for (const r of rows) {
    const platform = r[idx.platform];
    const cycle = Number(r[idx.cycle]);
    const time = r[idx.time];
    const lat = Number(r[idx.lat]);
    const lon = Number(r[idx.lon]);
    const pres = Number(r[idx.pres]);
    const temp = Number(r[idx.temp]);
    if (
      typeof platform !== "string" && typeof platform !== "number"
    ) continue;
    if (
      !Number.isFinite(cycle) || typeof time !== "string" ||
      !Number.isFinite(lat) || !Number.isFinite(lon) ||
      !Number.isFinite(pres) || !Number.isFinite(temp)
    ) continue;
    // Argo `pres` is decibars; for seawater 1 dbar ≈ 1 m within <0.5%.
    if (pres < 0 || pres > 3000 || temp < -3 || temp > 40) continue;
    out.push({
      platform: String(platform),
      cycle,
      time,
      lat,
      lon,
      pres,
      temp,
    });
  }
  return out;
}

/**
 * Group rows by (platform, cycle), pick the cast geographically closest
 * to (queryLat, queryLon), and return its samples sorted shallow→deep.
 */
export function pickClosestArgoCast(
  rows: ArgoRow[],
  queryLat: number,
  queryLon: number,
): { samples: { depthM: number; temperatureC: number }[]; platform: string; cycle: number; time: string; distKm: number } | null {
  if (rows.length === 0) return null;
  const groups = new Map<
    string,
    { rows: ArgoRow[]; lat: number; lon: number; time: string }
  >();
  for (const r of rows) {
    const key = `${r.platform}#${r.cycle}`;
    const g = groups.get(key);
    if (g) {
      g.rows.push(r);
    } else {
      groups.set(key, { rows: [r], lat: r.lat, lon: r.lon, time: r.time });
    }
  }
  let best: { key: string; group: { rows: ArgoRow[]; lat: number; lon: number; time: string }; distKm: number } | null = null;
  for (const [key, group] of groups) {
    const distKm = haversineKm(queryLat, queryLon, group.lat, group.lon);
    if (!best || distKm < best.distKm) best = { key, group, distKm };
  }
  if (!best) return null;
  const samples = best.group.rows
    .map((r) => ({ depthM: r.pres, temperatureC: Math.round(r.temp * 100) / 100 }))
    .sort((a, b) => a.depthM - b.depthM);
  // Deduplicate near-identical depths (Argo sometimes reports redundant pressures).
  const dedup: { depthM: number; temperatureC: number }[] = [];
  for (const s of samples) {
    const prev = dedup[dedup.length - 1];
    if (!prev || s.depthM - prev.depthM > 0.5) dedup.push(s);
  }
  if (dedup.length < 2) return null;
  const [platform, cycleStr] = best.key.split("#");
  return {
    samples: dedup,
    platform: platform!,
    cycle: Number(cycleStr),
    time: best.group.time,
    distKm: best.distKm,
  };
}

/**
 * Fetch the nearest recent Argo float profile to (lat, lon), or return
 * null when the upstream is unreachable / has no rows in range.
 */
export async function fetchArgoProfile(
  lat: number,
  lon: number,
): Promise<TemperatureProfilePayload | null> {
  const key = cacheKey(lat, lon);
  const now = Date.now();
  const cached = profileCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const value = await fetchArgoProfileUncached(lat, lon);
  profileCache.set(key, {
    value,
    expiresAt: Date.now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  return value;
}

async function fetchArgoProfileUncached(
  lat: number,
  lon: number,
): Promise<TemperatureProfilePayload | null> {
  try {
    const url = buildArgoQueryUrl(lat, lon);
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    const json = (await res.json()) as ErddapResponse;
    const rows = parseArgoRows(json);
    const cast = pickClosestArgoCast(rows, lat, lon);
    if (!cast) return null;
    const distLabel = cast.distKm < 1
      ? `${Math.round(cast.distKm * 1000)} m`
      : `${cast.distKm.toFixed(1)} km`;
    const castDate = cast.time.slice(0, 10);
    return {
      samples: cast.samples,
      source: `Argo float ${cast.platform} cycle ${cast.cycle} (${castDate}, ${distLabel} away)`,
      sourceUrl: `https://fleetmonitoring.euro-argo.eu/float/${cast.platform}`,
      timestamp: cast.time,
      provider: "argo",
    };
  } catch {
    return null;
  }
}
