/**
 * temperatureProfiles — registry of real per-location depth/temperature
 * casts bundled with BathyScan presets.
 *
 * Each entry is a CTD-style cast (sorted shallow→deep) for a known
 * lat/lon, with attribution. A request for /api/temperature-profile is
 * matched to the nearest cast within `MATCH_RADIUS_KM`; outside that
 * radius the request falls through to the next provider (and ultimately
 * to the client-side thermocline model).
 *
 * The registry is intentionally empty out of the box — bundling real CTD
 * data is a follow-up effort (see follow-up task: "Show real measured
 * temperature profiles from Argo floats or uploaded CTD casts"). The
 * shape, lookup, and route plumbing are wired up here so a real cast can
 * be dropped in without further integration work.
 */

import type { TemperatureProfilePayload } from "../routes/temperature-profile";

export interface BundledCast extends TemperatureProfilePayload {
  /** Cast location (decimal degrees). */
  lat: number;
  lon: number;
  /** Optional preset dataset id this cast was bundled with. */
  datasetId?: string;
}

/** Maximum great-circle distance (km) for matching a request to a bundled cast. */
const MATCH_RADIUS_KM = 25;

/**
 * Bundled CTD casts. Populated as real per-dataset data becomes available
 * — see the follow-up task referenced in the header docblock.
 */
export const bundledCasts: BundledCast[] = [];

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
 * Return the nearest bundled cast within `MATCH_RADIUS_KM` of (lat, lon),
 * or null when no cast is in range.
 */
export function findBundledTemperatureProfile(
  lat: number,
  lon: number,
): TemperatureProfilePayload | null {
  let best: { cast: BundledCast; distKm: number } | null = null;
  for (const cast of bundledCasts) {
    const distKm = haversineKm(lat, lon, cast.lat, cast.lon);
    if (distKm <= MATCH_RADIUS_KM && (!best || distKm < best.distKm)) {
      best = { cast, distKm };
    }
  }
  if (!best) return null;
  return {
    samples: best.cast.samples,
    source: best.cast.source,
    sourceUrl: best.cast.sourceUrl,
    timestamp: best.cast.timestamp,
    provider: best.cast.provider,
  };
}
