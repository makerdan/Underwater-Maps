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
  {
    // Sitka Sound — exposed outer coast, deeper shelf-break to ~600 m.
    datasetId: "sitka-sound",
    lat: 57.05,
    lon: -135.45,
    samples: [
      { depthM: 0, temperatureC: 12.6 },
      { depthM: 10, temperatureC: 12.1 },
      { depthM: 20, temperatureC: 10.9 },
      { depthM: 30, temperatureC: 9.4 },
      { depthM: 50, temperatureC: 7.8 },
      { depthM: 75, temperatureC: 6.9 },
      { depthM: 100, temperatureC: 6.3 },
      { depthM: 150, temperatureC: 5.6 },
      { depthM: 200, temperatureC: 5.1 },
      { depthM: 300, temperatureC: 4.6 },
      { depthM: 500, temperatureC: 4.1 },
    ],
    source: `${WOA_SOURCE} — Sitka Sound / outer Baranof shelf`,
    sourceUrl: WOA_URL,
    timestamp: WOA_TIMESTAMP,
    provider: "bundled-woa",
  },
  {
    // Glacier Bay — cold glacial fjord, strong surface freshening.
    datasetId: "glacier-bay",
    lat: 58.65,
    lon: -136.05,
    samples: [
      { depthM: 0, temperatureC: 10.4 },
      { depthM: 10, temperatureC: 8.7 },
      { depthM: 20, temperatureC: 7.2 },
      { depthM: 30, temperatureC: 6.4 },
      { depthM: 50, temperatureC: 5.8 },
      { depthM: 75, temperatureC: 5.4 },
      { depthM: 100, temperatureC: 5.1 },
      { depthM: 150, temperatureC: 4.7 },
      { depthM: 200, temperatureC: 4.4 },
      { depthM: 300, temperatureC: 4.1 },
      { depthM: 400, temperatureC: 4.0 },
    ],
    source: `${WOA_SOURCE} — Glacier Bay / Icy Strait fjord`,
    sourceUrl: WOA_URL,
    timestamp: WOA_TIMESTAMP,
    provider: "bundled-woa",
  },
  {
    // Juneau approaches — Stephens Passage / Lynn Canal mainland fjords.
    datasetId: "juneau",
    lat: 58.30,
    lon: -134.40,
    samples: [
      { depthM: 0, temperatureC: 11.8 },
      { depthM: 10, temperatureC: 11.2 },
      { depthM: 20, temperatureC: 9.8 },
      { depthM: 30, temperatureC: 8.4 },
      { depthM: 50, temperatureC: 7.1 },
      { depthM: 75, temperatureC: 6.4 },
      { depthM: 100, temperatureC: 6.0 },
      { depthM: 150, temperatureC: 5.4 },
      { depthM: 200, temperatureC: 5.0 },
      { depthM: 300, temperatureC: 4.5 },
    ],
    source: `${WOA_SOURCE} — Juneau / Stephens Passage`,
    sourceUrl: WOA_URL,
    timestamp: WOA_TIMESTAMP,
    provider: "bundled-woa",
  },
  {
    // Ketchikan — Revillagigedo Channel / Tongass Narrows.
    datasetId: "ketchikan",
    lat: 55.34,
    lon: -131.65,
    samples: [
      { depthM: 0, temperatureC: 13.4 },
      { depthM: 10, temperatureC: 12.9 },
      { depthM: 20, temperatureC: 11.6 },
      { depthM: 30, temperatureC: 9.9 },
      { depthM: 50, temperatureC: 8.3 },
      { depthM: 75, temperatureC: 7.3 },
      { depthM: 100, temperatureC: 6.7 },
      { depthM: 150, temperatureC: 5.9 },
      { depthM: 200, temperatureC: 5.4 },
    ],
    source: `${WOA_SOURCE} — Ketchikan / Revillagigedo Channel`,
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
