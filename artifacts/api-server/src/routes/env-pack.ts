/**
 * env-pack.ts — Environmental Data Pack endpoint.
 *
 * GET /api/env-pack?lat=&lon=&radiusMiles=15&days=14
 *
 * Returns a single JSON blob containing all environmental data useful for
 * offline marine use: NOAA CO-OPS tide predictions, NOAA ASOS/AWOS weather
 * station observations + NWS hourly forecasts, Open-Meteo Marine SST/wave
 * conditions, and a depth-resolved temperature profile (WOA 2023 / Argo).
 *
 * Partial upstream failures are tolerated: any data source that fails
 * contributes null to its field and a message to the top-level `warnings`
 * array.  The endpoint always returns HTTP 200 unless query parameters are
 * invalid.
 *
 * Response is cached server-side for 30 minutes (same pattern as
 * water-temperature.ts).
 */

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { registerCache } from "../lib/cacheRegistry.js";
import { logger } from "../lib/logger.js";
import { fetchTideStationsInRadius } from "../lib/envPackTidal.js";
import { fetchWeatherStationPacks } from "../lib/envPackWeather.js";
import { fetchMarineConditions } from "../lib/envPackMarine.js";
import { fetchArgoProfile } from "../lib/argoErddap.js";
import { findBundledTemperatureProfile } from "../lib/temperatureProfiles.js";
import type { EnvPack, TemperatureProfilePack } from "../lib/envPack.js";
import { GetEnvPackResponse } from "@workspace/api-zod";
import { validateResponse } from "../middlewares/validateResponse.js";

const router = Router();

// ── Query schema ──────────────────────────────────────────────────────────────

const EnvPackQuerySchema = z.object({
  lat: z.coerce
    .number({ invalid_type_error: "lat must be a valid number" })
    .finite("lat must be a finite number")
    .gte(-90, "lat must be between -90 and 90")
    .lte(90, "lat must be between -90 and 90"),
  lon: z.coerce
    .number({ invalid_type_error: "lon must be a valid number" })
    .finite("lon must be a finite number")
    .gte(-180, "lon must be between -180 and 180")
    .lte(180, "lon must be between -180 and 180"),
  radiusMiles: z.coerce
    .number({ invalid_type_error: "radiusMiles must be a valid number" })
    .positive("radiusMiles must be positive")
    .lte(200, "radiusMiles must be ≤ 200")
    .optional()
    .default(15),
  days: z.coerce
    .number({ invalid_type_error: "days must be a valid number" })
    .int("days must be an integer")
    .min(1, "days must be between 1 and 14")
    .max(14, "days must be between 1 and 14")
    .optional()
    .default(14),
});

// ── Server-side response cache ────────────────────────────────────────────────

interface CacheEntry {
  pack: EnvPack;
  fetchedAt: number;
}

const ENV_PACK_TTL_MS = 30 * 60 * 1000; // 30 minutes
const packCache = new Map<string, CacheEntry>();
registerCache(() => packCache.clear());

function cacheKey(lat: number, lon: number, radiusMiles: number, days: number): string {
  // Round coordinates to 2 d.p. (~1 km grid) for reasonable cache reuse.
  return `${lat.toFixed(2)},${lon.toFixed(2)},${radiusMiles},${days}`;
}

/** Test helper — clear the env-pack cache. */
export function __clearEnvPackCacheForTests(): void {
  packCache.clear();
}

// ── Rejection formatting ──────────────────────────────────────────────────────

/**
 * Produce a readable message from a Promise.allSettled rejection reason.
 * Reasons are not guaranteed to be Error instances — strings, objects, or
 * undefined must still yield a useful warning string.
 */
function reasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

// ── Temperature profile helper ────────────────────────────────────────────────

async function fetchTemperatureProfile(
  lat: number,
  lon: number,
): Promise<TemperatureProfilePack> {
  // Try bundled WOA profile first, then Argo.
  for (const { name, fetchFn } of [
    { name: "woa", fetchFn: () => findBundledTemperatureProfile(lat, lon, null) },
    { name: "argo", fetchFn: () => fetchArgoProfile(lat, lon) },
  ]) {
    try {
      const payload = await fetchFn();
      if (payload && payload.samples.length >= 2) {
        const samples = [...payload.samples].sort((a, b) => a.depthM - b.depthM);
        return {
          available: true,
          samples,
          source: payload.source,
          sourceUrl: payload.sourceUrl ?? null,
          timestamp: payload.timestamp ?? null,
          provider: payload.provider,
        };
      }
    } catch (err) {
      logger.warn({ provider: name, err }, "Temperature profile provider failed");
    }
  }
  return {
    available: false,
    samples: [],
    source: "",
    sourceUrl: null,
    timestamp: null,
    provider: "none",
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get(
  "/env-pack",
  asyncHandler(async (req, res): Promise<void> => {
    const parsed = EnvPackQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_params",
        details: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    const { lat, lon, radiusMiles, days } = parsed.data;
    const key = cacheKey(lat, lon, radiusMiles, days);
    const now = Date.now();

    // Serve from cache when fresh.
    const cached = packCache.get(key);
    if (cached && now - cached.fetchedAt < ENV_PACK_TTL_MS) {
      res.setHeader("Cache-Control", "public, max-age=1800");
      res.json(validateResponse(GetEnvPackResponse, cached.pack, "GET /api/env-pack (cache)"));
      return;
    }

    logger.info({ lat, lon, radiusMiles, days }, "[env-pack] Building environmental data pack");

    const generatedAt = new Date().toISOString();
    // expiresAt respects the requested `days` window — not a hardcoded 14-day value.
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    const warnings: string[] = [];

    // Run all four data fetches concurrently; tolerate individual failures.
    const [tidalResult, weatherResult, marineResult, profileResult] =
      await Promise.allSettled([
        fetchTideStationsInRadius(lat, lon, radiusMiles, days),
        fetchWeatherStationPacks(lat, lon, radiusMiles),
        fetchMarineConditions(lat, lon, days),
        fetchTemperatureProfile(lat, lon),
      ]);

    // Tidal data
    let tideStations: EnvPack["tideStations"] = null;
    if (tidalResult.status === "fulfilled") {
      tideStations = tidalResult.value;
      if (tideStations !== null && tideStations.length === 0) {
        warnings.push("No NOAA CO-OPS tide stations found within the requested radius.");
      }
    } else {
      logger.warn({ source: "tidal", err: tidalResult.reason }, "env-pack upstream source failed");
      warnings.push(
        `Tide predictions unavailable: NOAA station catalogue could not be reached (${reasonMessage(tidalResult.reason)}).`,
      );
    }

    // Weather data
    let weatherStations: EnvPack["weatherStations"] = null;
    if (weatherResult.status === "fulfilled") {
      weatherStations = weatherResult.value;
      if (weatherStations !== null && weatherStations.length === 0) {
        warnings.push("No NOAA weather stations found within the requested radius.");
      }
    } else {
      logger.warn({ source: "weather", err: weatherResult.reason }, "env-pack upstream source failed");
      warnings.push(
        `Weather observations unavailable: ${reasonMessage(weatherResult.reason)}.`,
      );
    }

    // Marine conditions
    let marineConditions: EnvPack["marineConditions"] = null;
    if (marineResult.status === "fulfilled") {
      marineConditions = marineResult.value;
      if (marineConditions === null) {
        warnings.push(
          "Open-Meteo Marine conditions unavailable: no usable data was returned for this location.",
        );
      }
    } else {
      logger.warn({ source: "marine", err: marineResult.reason }, "env-pack upstream source failed");
      warnings.push(
        `Marine conditions unavailable: ${reasonMessage(marineResult.reason)}.`,
      );
    }

    // Temperature profile
    let temperatureProfile: EnvPack["temperatureProfile"] = null;
    if (profileResult.status === "fulfilled") {
      temperatureProfile = profileResult.value;
      if (!temperatureProfile.available) {
        warnings.push(
          "No depth-resolved temperature profile found for this location (neither a bundled WOA cast nor a recent Argo float is available).",
        );
      }
    } else {
      warnings.push(
        `Temperature profile unavailable: ${reasonMessage(profileResult.reason)}.`,
      );
    }

    // Complete failure: when every one of the four sources yielded nothing,
    // return a structured 503 instead of a 200 full of nulls so clients can
    // distinguish "partial success with warnings" from "no data at all".
    // The failure is intentionally NOT cached so a transient outage does not
    // poison the 30-minute cache window.
    const hasTides = tideStations !== null && tideStations.length > 0;
    const hasWeather = weatherStations !== null && weatherStations.length > 0;
    const hasMarine = marineConditions !== null;
    const hasProfile = temperatureProfile !== null && temperatureProfile.available;
    if (!hasTides && !hasWeather && !hasMarine && !hasProfile) {
      logger.warn({ lat, lon, radiusMiles, days, warnings }, "[env-pack] All data sources failed — returning 503");
      res.status(503).json({ error: "no_data_available", warnings });
      return;
    }

    const pack: EnvPack = {
      generatedAt,
      expiresAt,
      centerLat: lat,
      centerLon: lon,
      coverageRadiusMiles: radiusMiles,
      tideStations,
      weatherStations,
      marineConditions,
      temperatureProfile,
      warnings,
    };

    packCache.set(key, { pack, fetchedAt: Date.now() });

    res.setHeader("Cache-Control", "public, max-age=1800");
    res.json(validateResponse(GetEnvPackResponse, pack, "GET /api/env-pack"));
  }),
);

export default router;
