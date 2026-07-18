/**
 * quickDrop.ts — Conditions-snapshot gathering for the one-tap GPS catch drop.
 *
 * `gatherConditionsSnapshot` assembles a frozen snapshot of the conditions at
 * the moment of the drop: GPS quality (accuracy/speed/heading), terrain depth
 * under the position, and cached tide/current/weather values from offline
 * packs only — it NEVER performs a live network fetch. Missing sources never
 * block the drop; each field simply reports "unavailable".
 *
 * The offline-pack lookup is bounded by a time budget (default 800 ms) so a
 * slow IndexedDB read can't delay the drop.
 */

import type { TerrainData } from "@workspace/api-client-react";
import type { GpsPosition } from "./gpsStore";
import {
  getPackForLocation,
  getOfflineTideValue,
  getOfflineWeatherValue,
} from "./offlinePackStore";

export interface ConditionsSnapshot {
  capturedAt: string;
  gpsAccuracyM: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  depthM: number | null;
  depthSource: "terrain" | "unavailable";
  tideHeightM: number | null;
  currentSpeedKt: number | null;
  currentDirDeg: number | null;
  tideSource: "pack" | "unavailable";
  windSpeedKnots: number | null;
  windDirDeg: number | null;
  tempC: number | null;
  weatherObservedAt: string | null;
  weatherSource: "pack" | "unavailable";
}

/**
 * Bilinear-interpolated terrain depth at (lat, lon). Returns null when the
 * position falls outside the terrain bounds.
 */
export function sampleTerrainDepth(
  lat: number,
  lon: number,
  terrain: TerrainData,
): number | null {
  const { minLon, maxLon, minLat, maxLat, resolution: N, depths } = terrain;
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return null;
  const u = Math.max(0, Math.min(1, (lon - minLon) / ((maxLon - minLon) || 1)));
  const v = Math.max(0, Math.min(1, (lat - minLat) / ((maxLat - minLat) || 1)));
  const col = u * (N - 1);
  const row = v * (N - 1);
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(N - 1, c0 + 1);
  const r1 = Math.min(N - 1, r0 + 1);
  const fc = col - c0;
  const fr = row - r0;
  const d00 = depths[r0 * N + c0];
  const d10 = depths[r0 * N + c1];
  const d01 = depths[r1 * N + c0];
  const d11 = depths[r1 * N + c1];
  if (d00 == null || d10 == null || d01 == null || d11 == null) return null;
  return (
    d00 * (1 - fc) * (1 - fr) +
    d10 * fc * (1 - fr) +
    d01 * (1 - fc) * fr +
    d11 * fc * fr
  );
}

/** Resolves to `null` if `promise` doesn't settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function gatherConditionsSnapshot(
  gps: GpsPosition,
  terrain: TerrainData | null,
  opts: { timeBudgetMs?: number; now?: Date } = {},
): Promise<ConditionsSnapshot> {
  const timeBudgetMs = opts.timeBudgetMs ?? 800;
  const now = opts.now ?? new Date();

  const snapshot: ConditionsSnapshot = {
    capturedAt: now.toISOString(),
    gpsAccuracyM: Number.isFinite(gps.accuracy) ? gps.accuracy : null,
    speedMps: gps.speed != null && Number.isFinite(gps.speed) ? gps.speed : null,
    headingDeg: gps.heading != null && Number.isFinite(gps.heading) ? gps.heading : null,
    depthM: null,
    depthSource: "unavailable",
    tideHeightM: null,
    currentSpeedKt: null,
    currentDirDeg: null,
    tideSource: "unavailable",
    windSpeedKnots: null,
    windDirDeg: null,
    tempC: null,
    weatherObservedAt: null,
    weatherSource: "unavailable",
  };

  if (terrain) {
    const depth = sampleTerrainDepth(gps.latitude, gps.longitude, terrain);
    if (depth != null && Number.isFinite(depth)) {
      snapshot.depthM = depth;
      snapshot.depthSource = "terrain";
    }
  }

  // Offline packs only — cached values, no live fetch.
  try {
    const pack = await withTimeout(
      getPackForLocation(gps.latitude, gps.longitude),
      timeBudgetMs,
    );
    if (pack) {
      try {
        const tide = getOfflineTideValue(pack, now);
        snapshot.tideHeightM = tide.tideHeight;
        snapshot.currentSpeedKt = tide.currentSpeed;
        snapshot.currentDirDeg = tide.currentDirection;
        snapshot.tideSource = "pack";
      } catch {
        // tide pack unreadable — leave unavailable
      }
      try {
        const weather = getOfflineWeatherValue(pack);
        if (weather) {
          snapshot.windSpeedKnots = weather.windSpeedKnots;
          snapshot.windDirDeg = weather.windDirDeg;
          snapshot.tempC = weather.tempC;
          snapshot.weatherObservedAt = weather.observedAt;
          snapshot.weatherSource = "pack";
        }
      } catch {
        // weather pack unreadable — leave unavailable
      }
    }
  } catch {
    // pack lookup failed — all sources stay unavailable
  }

  return snapshot;
}
