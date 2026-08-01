/**
 * reverseGeocode — best-effort place-name lookup for a lat/lon point.
 *
 * Used to name auto-created area-request folders after a recognizable
 * nearby place ("Sitka, Alaska") instead of raw coordinates. Strictly
 * best-effort: any failure (timeout, upstream error, nothing found)
 * returns null and the caller falls back to its coordinate label.
 *
 * Source: OSM Nominatim reverse endpoint (public, ~1 req/s policy). Folder
 * creation is a rare event (fires once per area search crossing the save
 * threshold), so a per-process result cache plus a single low-zoom lookup
 * keeps us comfortably inside the usage policy.
 */
import { logger } from "./logger.js";
import { registerCache } from "./cacheRegistry.js";

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const FETCH_TIMEOUT_MS = 3500;
const USER_AGENT = "BathyScan/1.0 (area-folder naming)";
/** zoom=10 ≈ city / bay level — the granularity folder names want. */
const REVERSE_ZOOM = 10;

/** Cache keyed by rounded coords so repeat searches don't re-hit upstream. */
const cache = new Map<string, string | null>();
const CACHE_MAX = 200;
registerCache(() => cache.clear());

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

/** Nominatim /reverse response subset we consume. */
interface NominatimReverse {
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
  error?: string;
}

/**
 * Pick the most recognizable locality-level name from a Nominatim address
 * object, in descending preference order.
 */
const LOCALITY_KEYS = [
  "bay",
  "strait",
  "water",
  "city",
  "town",
  "village",
  "hamlet",
  "municipality",
  "island",
  "county",
] as const;

export function placeNameFromNominatim(body: NominatimReverse): string | null {
  const address = body.address ?? {};
  let locality: string | undefined;
  for (const key of LOCALITY_KEYS) {
    if (address[key]) {
      locality = address[key];
      break;
    }
  }
  // `name` is the feature's own name (often the bay/sound itself) — prefer
  // it when present, then the locality, then the first display_name segment.
  const primary =
    body.name?.trim() ||
    locality?.trim() ||
    body.display_name?.split(",")[0]?.trim();
  if (!primary) return null;

  const region = address.state?.trim() || address.country?.trim();
  if (region && region !== primary) return `${primary}, ${region}`;
  return primary;
}

/**
 * Resolve a nearby place name for a point, or null when none can be found.
 * Never throws; failures are logged at debug level and swallowed.
 */
export async function placeNameForPoint(
  lat: number,
  lon: number,
): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const key = cacheKey(lat, lon);
  if (cache.has(key)) return cache.get(key) ?? null;

  let result: string | null = null;
  try {
    const url =
      `${NOMINATIM_REVERSE_URL}?format=jsonv2&zoom=${REVERSE_ZOOM}` +
      `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as NominatimReverse;
      if (!body.error) result = placeNameFromNominatim(body);
    }
  } catch (err) {
    logger.debug({ err, lat, lon }, "[reverse-geocode] lookup failed");
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, result);
  return result;
}

/** Test helper — clear the module-level result cache. */
export function __clearReverseGeocodeCache(): void {
  cache.clear();
}
