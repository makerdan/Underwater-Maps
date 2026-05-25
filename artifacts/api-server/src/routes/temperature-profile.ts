/**
 * temperature-profile.ts — Depth-resolved temperature profile for a lat/lon
 * point.
 *
 * GET /api/temperature-profile?lat=&lon=
 *
 * Strategy: real per-location data when we have it, `{ available: false }`
 * otherwise so the client can fall back to its surface-anchored thermocline
 * model (see artifacts/bathyscan/src/lib/waterTemp.ts).
 *
 * The "real data" path is intentionally a pluggable provider registry — the
 * task description lists Argo float casts, Copernicus Marine reanalysis, and
 * per-dataset CTD metadata uploaded with the bathymetry as candidate sources.
 * Each provider is a function that returns either a `{ samples, source, ... }`
 * payload or null. The first provider that returns a payload wins. Bundled
 * CTD casts are checked first because they ship with preset datasets, then
 * any future Argo/reanalysis providers can be appended without touching the
 * route itself.
 */

import { Router } from "express";
import { findBundledTemperatureProfile } from "../lib/temperatureProfiles";

const router = Router();

export interface TemperatureProfileSample {
  depthM: number;
  temperatureC: number;
}

export interface TemperatureProfilePayload {
  samples: TemperatureProfileSample[];
  source: string;
  sourceUrl: string | null;
  timestamp: string | null;
  provider: string;
}

export type TemperatureProfileProvider = (
  lat: number,
  lon: number,
) => Promise<TemperatureProfilePayload | null> | TemperatureProfilePayload | null;

// Registry of providers consulted in order. Exported so tests (and future
// integrations) can register/unregister real data sources.
export const profileProviders: TemperatureProfileProvider[] = [
  // 1. Per-dataset CTD casts bundled with the preset bathymetry.
  (lat, lon) => findBundledTemperatureProfile(lat, lon),
  // 2. (future) Argo float lookup via ERDDAP
  // 3. (future) Copernicus Marine reanalysis
];

router.get("/temperature-profile", async (req, res): Promise<void> => {
  const lat = parseFloat(req.query["lat"] as string);
  const lon = parseFloat(req.query["lon"] as string);

  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < -90 || lat > 90 || lon < -180 || lon > 180
  ) {
    res.status(400).json({
      error: "invalid_params",
      details: "lat and lon are required and must be valid coordinates",
    });
    return;
  }

  // Cache for 1h — climatology and bundled casts change very slowly.
  res.setHeader("Cache-Control", "public, max-age=3600");

  for (const provider of profileProviders) {
    try {
      const payload = await provider(lat, lon);
      if (payload && payload.samples.length >= 2) {
        // Defensive: ensure samples are sorted shallow→deep so clients can
        // plot them without re-sorting.
        const samples = [...payload.samples].sort((a, b) => a.depthM - b.depthM);
        res.json({
          available: true,
          lat,
          lon,
          samples,
          source: payload.source,
          sourceUrl: payload.sourceUrl ?? undefined,
          timestamp: payload.timestamp ?? undefined,
          provider: payload.provider,
        });
        return;
      }
    } catch {
      // Individual provider failures must never break the chain; just try
      // the next one.
    }
  }

  res.json({
    available: false,
    lat,
    lon,
    samples: [],
    provider: "none",
  });
});

export default router;
