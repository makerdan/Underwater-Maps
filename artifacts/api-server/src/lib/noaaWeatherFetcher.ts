/**
 * noaaWeatherFetcher.ts — NOAA Aviation Weather station observation fetcher
 *
 * Uses the NOAA Weather API (api.weather.gov) to find nearby ASOS/AWOS stations
 * and fetch their latest observations. Results are cached in-memory for 10 minutes
 * since NOAA updates hourly. Successful results are also persisted to the
 * `weather_station_cache` DB table so the API can serve stale-but-valid data
 * during NOAA outages or server restarts (fallback window: 1 hour).
 *
 * Flow:
 *   1. GET /points/{lat},{lon}             → resolve US state code
 *   2. GET /stations?point={lat},{lon}&limit=20 → nearby station IDs
 *   3. GET /stations/{id}/observations/latest  → per-station obs (parallel)
 *
 * Normalized into WeatherStation shape (see below).
 */

import { registerCache } from "./cacheRegistry.js";
import { db, weatherStationCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const NOAA_API_BASE = "https://api.weather.gov";
const FETCH_TIMEOUT_MS = 12_000;
const OBS_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DB_STALE_FALLBACK_MS = 60 * 60 * 1000; // 1 hour

export interface WeatherStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Wind speed in knots (null if not reported). */
  windSpeedKnots: number | null;
  /** Wind direction in degrees true (null if variable/calm/not reported). */
  windDirDeg: number | null;
  /** Visibility in statute miles (null if not reported). */
  visibilityMiles: number | null;
  /** Ceiling height in feet AGL (null if unlimited/not reported). */
  ceilingFt: number | null;
  /** Temperature in Celsius (null if not reported). */
  tempC: number | null;
  /** ISO 8601 observation time (null if unavailable). */
  observedAt: string | null;
}

export interface WeatherStationsResult {
  stations: WeatherStation[];
  stateCode: string | null;
  faaWeatherCamsUrl: string | null;
  /** True when serving cached data due to a NOAA API error. */
  stale?: boolean;
}

// ---------------------------------------------------------------------------
// Haversine distance helper
// ---------------------------------------------------------------------------

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// In-memory cache keyed by "lat,lon,radius"
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: WeatherStationsResult;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
registerCache(() => cache.clear());

function cacheKey(lat: number, lon: number, radiusMiles: number): string {
  // Round to 2 decimal places (~1 km grid) to get reasonable cache hits
  return `${lat.toFixed(2)},${lon.toFixed(2)},${radiusMiles}`;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "BathyScan/1.0 (bathyscan@example.com)" },
    });
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// Step 1: Resolve US state code via /points
// ---------------------------------------------------------------------------

async function resolveStateCode(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `${NOAA_API_BASE}/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      properties?: { relativeLocation?: { properties?: { state?: string } } };
    };
    return json.properties?.relativeLocation?.properties?.state ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 2: Fetch nearby stations via /stations?point=
// ---------------------------------------------------------------------------

interface RawStation {
  properties: {
    stationIdentifier?: string;
    name?: string;
    geometry?: { coordinates?: [number, number] } | null;
  };
  geometry?: { coordinates?: [number, number] } | null;
}

async function fetchNearbyStations(
  lat: number,
  lon: number,
  limit: number,
): Promise<{ id: string; name: string; lat: number; lon: number }[] | null> {
  const url =
    `${NOAA_API_BASE}/stations?point=${lat.toFixed(4)},${lon.toFixed(4)}&limit=${limit}`;
  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) {
      console.error(`[noaaWeatherFetcher] NOAA stations HTTP ${res.status} for point=${lat.toFixed(4)},${lon.toFixed(4)}`);
      return null;
    }
    const json = (await res.json()) as { features?: RawStation[] };
    return (json.features ?? [])
      .filter((f) => f.properties?.stationIdentifier)
      .map((f) => {
        const coords =
          f.geometry?.coordinates ?? f.properties?.geometry?.coordinates;
        return {
          id: f.properties.stationIdentifier!,
          name: f.properties.name ?? f.properties.stationIdentifier!,
          lon: coords?.[0] ?? lon,
          lat: coords?.[1] ?? lat,
        };
      });
  } catch (err) {
    console.error(`[noaaWeatherFetcher] NOAA stations fetch error for point=${lat.toFixed(4)},${lon.toFixed(4)}:`, (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 3: Fetch latest observation per station
// ---------------------------------------------------------------------------

interface RawObs {
  properties?: {
    timestamp?: string | null;
    windSpeed?: { value?: number | null; unitCode?: string } | null;
    windDirection?: { value?: number | null } | null;
    visibility?: { value?: number | null; unitCode?: string } | null;
    cloudLayers?: Array<{
      base?: { value?: number | null; unitCode?: string } | null;
      amount?: string;
    }> | null;
    temperature?: { value?: number | null } | null;
  };
}

/** Convert a scalar value + unitCode to the target unit. */
function convert(
  value: number | null | undefined,
  unitCode: string | undefined,
  target: "knots" | "miles" | "feet",
): number | null {
  if (value == null || !isFinite(value)) return null;
  const unit = (unitCode ?? "").toLowerCase();
  if (target === "knots") {
    // NOAA reports wind speed in m/s
    if (unit.includes("m_s") || unit.includes("m/s") || unit === "wmounit:m_s-1") {
      return Math.round(value * 1.94384 * 10) / 10;
    }
    // already knots
    return Math.round(value * 10) / 10;
  }
  if (target === "miles") {
    // NOAA visibility in meters
    if (unit.includes("m") && !unit.includes("km")) {
      return Math.round((value / 1609.344) * 10) / 10;
    }
    // km
    if (unit.includes("km")) {
      return Math.round((value / 1.60934) * 10) / 10;
    }
    return Math.round(value * 10) / 10;
  }
  if (target === "feet") {
    // NOAA ceiling in meters
    if (unit.includes("m") && !unit.includes("km")) {
      return Math.round(value * 3.28084);
    }
    return Math.round(value);
  }
  return null;
}

type CloudLayer = { base?: { value?: number | null; unitCode?: string } | null; amount?: string };

/** Pick the lowest broken/overcast cloud layer as the ceiling. */
function pickCeiling(
  layers: CloudLayer[] | null | undefined,
): number | null {
  if (!layers || layers.length === 0) return null;
  const ceiling = layers.find(
    (l: CloudLayer) =>
      l.amount === "BKN" ||
      l.amount === "OVC" ||
      l.amount === "OVX" ||
      l.amount === "VV",
  );
  if (!ceiling) return null;
  return convert(ceiling.base?.value, ceiling.base?.unitCode, "feet");
}

async function fetchStationObs(stationId: string): Promise<Omit<WeatherStation, "id" | "name" | "lat" | "lon"> | null> {
  try {
    const url = `${NOAA_API_BASE}/stations/${encodeURIComponent(stationId)}/observations/latest`;
    const res = await fetchWithTimeout(url, OBS_TIMEOUT_MS);
    if (!res.ok) return null;
    const json = (await res.json()) as RawObs;
    const p = json.properties;
    if (!p) return null;
    return {
      windSpeedKnots: convert(p.windSpeed?.value, p.windSpeed?.unitCode, "knots"),
      windDirDeg:
        p.windDirection?.value != null && isFinite(p.windDirection.value)
          ? Math.round(((p.windDirection.value % 360) + 360) % 360)
          : null,
      visibilityMiles: convert(p.visibility?.value, p.visibility?.unitCode, "miles"),
      ceilingFt: pickCeiling(p.cloudLayers),
      tempC:
        p.temperature?.value != null && isFinite(p.temperature.value)
          ? Math.round(p.temperature.value * 10) / 10
          : null,
      observedAt: p.timestamp ?? null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/** Persist a successful result to the DB (fire-and-forget). */
async function persistToDb(key: string, result: WeatherStationsResult): Promise<void> {
  try {
    await db
      .insert(weatherStationCacheTable)
      .values({
        cacheKey: key,
        result: result as unknown as Record<string, unknown>,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: weatherStationCacheTable.cacheKey,
        set: {
          result: result as unknown as Record<string, unknown>,
          fetchedAt: new Date(),
        },
      });
  } catch (err) {
    console.warn("[noaa-weather] Failed to persist to DB:", (err as Error).message);
  }
}

/** Try to load a DB-cached result. Returns null if missing or too old. */
async function loadFromDb(key: string): Promise<WeatherStationsResult | null> {
  try {
    const rows = await db
      .select()
      .from(weatherStationCacheTable)
      .where(eq(weatherStationCacheTable.cacheKey, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const ageMs = Date.now() - row.fetchedAt.getTime();
    if (ageMs > DB_STALE_FALLBACK_MS) return null;
    return row.result as unknown as WeatherStationsResult;
  } catch (err) {
    console.warn("[noaa-weather] Failed to load from DB:", (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch NOAA ASOS/AWOS weather stations near a point.
 *
 * @param lat - Latitude (decimal degrees)
 * @param lon - Longitude (decimal degrees)
 * @param radiusMiles - Search radius (informational; NOAA API returns closest
 *   stations regardless; we fetch 20 and the API limits by its own proximity).
 * @returns Normalized station list + state code + FAA WeatherCams URL.
 *   `stale: true` is set when the result comes from the DB fallback cache
 *   due to a NOAA API error.
 */
export async function fetchWeatherStations(
  lat: number,
  lon: number,
  radiusMiles = 75,
): Promise<WeatherStationsResult> {
  const key = cacheKey(lat, lon, radiusMiles);

  // 1. In-memory cache (hot path)
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  // 2. Try live NOAA fetch
  try {
    // Resolve state + nearby stations in parallel
    const [stateCode, rawStations] = await Promise.all([
      resolveStateCode(lat, lon),
      fetchNearbyStations(lat, lon, 20),
    ]);

    // fetchNearbyStations returns null on error — treat as NOAA failure so the
    // DB fallback is attempted instead of silently returning empty data.
    if (rawStations === null) {
      throw new Error("NOAA stations fetch failed — triggering DB fallback");
    }

    // Filter by actual distance using haversine
    const filteredStations = rawStations.filter(
      (s) => haversineKm(lat, lon, s.lat, s.lon) <= radiusMiles * 1.60934,
    );

    // Fetch observations for all stations in parallel (failures return null)
    const obsResults = await Promise.all(
      filteredStations.map((s) => fetchStationObs(s.id)),
    );

    const stations: WeatherStation[] = filteredStations
      .map((s, i) => {
        const obs = obsResults[i];
        if (!obs) return null;
        return {
          id: s.id,
          name: s.name,
          lat: s.lat,
          lon: s.lon,
          ...obs,
        };
      })
      .filter((s): s is WeatherStation => s !== null);

    // If stations were within range but every observation fetch failed, that
    // signals NOAA's obs endpoint is degraded — trigger DB fallback.
    if (filteredStations.length > 0 && stations.length === 0) {
      throw new Error(
        `All ${filteredStations.length} station observation fetch(es) failed — NOAA obs endpoint degraded`,
      );
    }

    const faaWeatherCamsUrl = stateCode
      ? `https://weathercams.faa.gov/cameras/state/${stateCode}`
      : null;

    const result: WeatherStationsResult = { stations, stateCode, faaWeatherCamsUrl };

    // Store in memory cache unconditionally.
    cache.set(key, { result, fetchedAt: Date.now() });
    // Only persist to DB when we have real station data — prevents overwriting
    // a previously good row with an outage-shaped empty result.
    if (stations.length > 0) {
      void persistToDb(key, result);
    }

    console.info(
      `[noaa-weather] Fetched ${stations.length} stations near ${lat.toFixed(3)},${lon.toFixed(3)} ` +
      `(state=${stateCode ?? "unknown"})`,
    );

    return result;
  } catch (err) {
    // 3. NOAA failed — try DB fallback (up to 1 hour old)
    console.warn(
      `[noaa-weather] Live fetch failed (${(err as Error).message}), trying DB fallback`,
    );
    const dbResult = await loadFromDb(key);
    if (dbResult) {
      console.info(
        `[noaa-weather] Serving stale DB cache for ${key}`,
      );
      const staleResult: WeatherStationsResult = { ...dbResult, stale: true };
      // Warm the in-memory cache too so concurrent requests don't all hit the DB
      cache.set(key, { result: staleResult, fetchedAt: Date.now() - CACHE_TTL_MS + 60_000 });
      return staleResult;
    }
    // No DB fallback available — re-throw so the route can return 502
    throw err;
  }
}
