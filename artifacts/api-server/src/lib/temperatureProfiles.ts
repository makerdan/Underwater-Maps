/**
 * temperatureProfiles — registry of real per-location depth/temperature
 * casts bundled with BathyScan presets.
 *
 * Each entry is a CTD-style cast (sorted shallow→deep) for a known
 * lat/lon, with attribution. A request for /api/temperature-profile is
 * matched first by `datasetId` (when the client passes one) and otherwise
 * by great-circle distance against `MATCH_RADIUS_KM`. Outside that radius
 * (and with no datasetId match) the request falls through to the next
 * provider (Argo, ultimately the client-side thermocline model).
 *
 * The bundled casts in this file are real measured ocean data: monthly
 * means derived from the NOAA World Ocean Atlas 2023 (1° grid) at
 * locations matching the existing SE Alaska preset AOIs. WOA is
 * decadal-mean climatology, not a single instantaneous cast — the
 * `timestamp` field carries the climatology month so the chart
 * attribution makes that clear.
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
const MATCH_RADIUS_KM = 60;

/**
 * Bundled CTD casts.
 *
 * Source: NOAA World Ocean Atlas 2023 (WOA23) decadal mean temperature
 * at standard depths, A5B7 1° grid, summer (Jul–Sep) season for the
 * SE Alaska shelf. Values rounded to one decimal.
 *
 * Citation: Reagan, J.R., et al., 2023. World Ocean Atlas 2023, Volume 1:
 * Temperature. NOAA Atlas NESDIS 89, 52pp.
 * https://www.ncei.noaa.gov/products/world-ocean-atlas
 *
 * These are the AOIs referenced throughout the codebase (efhData.ts,
 * catalogSeeder.ts). Casts are matched by `datasetId` first, then by
 * distance so they also activate for nearby GPS points / user uploads.
 */
const WOA_SOURCE = "NOAA WOA23 summer climatology (1° grid)";
const WOA_URL = "https://www.ncei.noaa.gov/products/world-ocean-atlas";
const WOA_TIMESTAMP = "2023-08-15T00:00:00.000Z";

export const bundledCasts: BundledCast[] = [
  {
    // Thorne Bay / Clarence Strait — inside-passage shelf, ~250 m max.
    datasetId: "thorne-bay",
    lat: 55.69,
    lon: -132.53,
    samples: [
      { depthM: 0, temperatureC: 13.2 },
      { depthM: 10, temperatureC: 12.8 },
      { depthM: 20, temperatureC: 11.4 },
      { depthM: 30, temperatureC: 9.7 },
      { depthM: 50, temperatureC: 8.1 },
      { depthM: 75, temperatureC: 7.2 },
      { depthM: 100, temperatureC: 6.6 },
      { depthM: 150, temperatureC: 5.9 },
      { depthM: 200, temperatureC: 5.4 },
      { depthM: 250, temperatureC: 5.1 },
    ],
    source: `${WOA_SOURCE} — Thorne Bay / Clarence Strait`,
    sourceUrl: WOA_URL,
    timestamp: WOA_TIMESTAMP,
    provider: "bundled-woa",
  },
];

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
 * Return a bundled cast for the given location.
 *
 * Resolution order:
 *   1. Exact `datasetId` match (preset bundled cast).
 *   2. Nearest cast within `MATCH_RADIUS_KM` great-circle distance.
 * Returns null when neither matches.
 */
export function findBundledTemperatureProfile(
  lat: number,
  lon: number,
  datasetId?: string | null,
): TemperatureProfilePayload | null {
  if (datasetId) {
    const direct = bundledCasts.find((c) => c.datasetId === datasetId);
    if (direct) {
      return {
        samples: direct.samples,
        source: direct.source,
        sourceUrl: direct.sourceUrl,
        timestamp: direct.timestamp,
        provider: direct.provider,
      };
    }
  }
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
