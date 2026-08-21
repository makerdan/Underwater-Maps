/**
 * envPackTidal.ts — Fetches all NOAA CO-OPS tide stations within a radius
 * and their prediction windows + datums for the Environmental Data Pack.
 *
 * Reuses the existing station-list cache and prediction/datums fetchers from
 * the tides route so no redundant HTTP requests are made.
 */

import { tideDatums, tidePredictions, tideStationList } from "../domains/environmental/service.js";
import { haversineKm } from "../routes/tidal.js";
import { logger } from "./logger.js";
import type { TideStationPack } from "./envPack.js";

const KM_TO_MILES = 0.621371;

/** Maximum number of tide stations to include in a pack (avoids huge payloads). */
const MAX_TIDE_STATIONS = 10;

/**
 * Returns all NOAA CO-OPS water-level stations within `radiusMiles` of the
 * given point, each with a `days`-day prediction window and datums.
 *
 * Stations are sorted nearest-first.  Stations whose predictions could not be
 * retrieved are silently dropped (the prediction fetch already logs the error).
 * Returns null when the NOAA station catalogue is entirely unreachable.
 */
export async function fetchTideStationsInRadius(
  lat: number,
  lon: number,
  radiusMiles: number,
  days: number,
  now = new Date(),
): Promise<TideStationPack[] | null> {
  const stations = await tideStationList("waterlevels");
  if (stations === null) return null;

  const radiusKm = radiusMiles * 1.60934;

  // Filter to stations within the radius and sort nearest-first.
  const nearby = stations
    .map((s) => ({ s, km: haversineKm(lat, lon, s.lat, s.lng) }))
    .filter(({ km }) => km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, MAX_TIDE_STATIONS);

  if (nearby.length === 0) return [];

  // Fetch predictions + datums in parallel for all nearby stations.
  const results = await Promise.allSettled(
    nearby.map(async ({ s, km }) => {
      const [predResult, datums] = await Promise.all([
        tidePredictions(s.id, now),
        tideDatums(s.id),
      ]);

      if (!predResult) {
        logger.warn(
          { stationId: s.id, stationName: s.name },
          "[envPackTidal] No predictions for station — skipping",
        );
        return null;
      }

      // Trim predictions to the requested number of days.
      const cutoffMs =
        new Date(predResult.windowStart).getTime() + days * 24 * 3600 * 1000;
      const trimmedPredictions = predResult.predictions.filter(
        (p) => new Date(p.t).getTime() < cutoffMs,
      );

      const windowEnd = new Date(cutoffMs).toISOString();

      const pack: TideStationPack = {
        stationId: s.id,
        name: s.name,
        lat: s.lat,
        lon: s.lng,
        distanceMiles: Math.round(km * KM_TO_MILES * 10) / 10,
        windowStart: predResult.windowStart,
        windowEnd,
        datum: "MLLW",
        units: "feet",
        predictions: trimmedPredictions,
        datums: datums ?? null,
      };
      return pack;
    }),
  );

  const packs: TideStationPack[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value !== null) {
      packs.push(r.value);
    }
  }
  return packs;
}
