/**
 * temperature-profile.ts — Depth-resolved temperature profile for a lat/lon
 * point.
 *
 * GET /api/temperature-profile?lat=&lon=&datasetId=
 *
 * Strategy: real per-location measured data when we have it,
 * `{ available: false }` otherwise so the client can fall back to its
 * surface-anchored thermocline model (see
 * artifacts/bathyscan/src/lib/waterTemp.ts).
 *
 * Providers are tried in order and the first one that returns a usable
 * payload wins. Current registry:
 *   1. **Bundled WOA climatology** — per-dataset NOAA World Ocean Atlas
 *      2023 monthly-mean casts shipped with the preset AOIs. Matched
 *      first by `datasetId`, then by great-circle distance.
 *   2. **Argo float ERDDAP lookup** — nearest recent Argo float profile
 *      from Ifremer's public ERDDAP. Real, instantaneous, measured CTD
 *      anywhere the global float array has coverage.
 *
 * Provider failures (timeouts, malformed responses, no rows in range) are
 * caught and never break the chain — the next provider is tried, and if
 * none returns data the response is `{ available: false, samples: [] }`.
 */

import { Router } from "express";
import { z } from "zod";
import { findBundledTemperatureProfile } from "../lib/temperatureProfiles";
import { fetchArgoProfile } from "../lib/argoErddap";
import { LatLonQuerySchema } from "./schemas.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { logger } from "../lib/logger.js";
import { validateResponse } from "../middlewares/validateResponse.js";

const router = Router();

const TemperatureProfileSampleSchema = z.object({
  depthM: z.number(),
  temperatureC: z.number(),
});

const TemperatureProfileResponseSchema = z.union([
  z.object({
    available: z.literal(true),
    lat: z.number(),
    lon: z.number(),
    samples: z.array(TemperatureProfileSampleSchema),
    source: z.string(),
    sourceUrl: z.string().optional(),
    timestamp: z.string().optional(),
    provider: z.string(),
  }),
  z.object({
    available: z.literal(false),
    lat: z.number(),
    lon: z.number(),
    samples: z.array(TemperatureProfileSampleSchema),
    provider: z.string(),
  }),
]);

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

export interface TemperatureProfileRequest {
  lat: number;
  lon: number;
  datasetId?: string | null;
}

export type TemperatureProfileProvider = (
  req: TemperatureProfileRequest,
) => Promise<TemperatureProfilePayload | null> | TemperatureProfilePayload | null;

// Registry of providers consulted in order. Exported so tests (and future
// integrations) can register/unregister real data sources.
export const profileProviders: TemperatureProfileProvider[] = [
  // 1. Per-dataset / nearby bundled WOA climatology casts.
  ({ lat, lon, datasetId }) =>
    findBundledTemperatureProfile(lat, lon, datasetId ?? null),
  // 2. Live Argo float lookup via Ifremer ERDDAP.
  ({ lat, lon }) => fetchArgoProfile(lat, lon),
  // 3. (future) Copernicus Marine reanalysis
];

const TemperatureProfileQuerySchema = LatLonQuerySchema.extend({
  datasetId: z.string().optional(),
});

router.get("/temperature-profile", asyncHandler(async (req, res): Promise<void> => {
  const parsed = TemperatureProfileQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: parsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }
  const { lat, lon } = parsed.data;
  const datasetId =
    typeof parsed.data.datasetId === "string" && parsed.data.datasetId.length > 0
      ? parsed.data.datasetId
      : null;

  // Cache for 1h — climatology and bundled casts change very slowly, and
  // a fresh Argo float profile is only published every 10 days.
  res.setHeader("Cache-Control", "public, max-age=3600");

  for (const [index, provider] of profileProviders.entries()) {
    try {
      const payload = await provider({ lat, lon, datasetId });
      if (payload && payload.samples.length >= 2) {
        // Defensive: ensure samples are sorted shallow→deep so clients can
        // plot them without re-sorting.
        const samples = [...payload.samples].sort((a, b) => a.depthM - b.depthM);
        res.json(validateResponse(TemperatureProfileResponseSchema, {
          available: true as const,
          lat,
          lon,
          samples,
          source: payload.source,
          sourceUrl: payload.sourceUrl ?? undefined,
          timestamp: payload.timestamp ?? undefined,
          provider: payload.provider,
        }, "GET /api/temperature-profile"));
        return;
      }
    } catch (err) {
      // Individual provider failures must never break the chain; just try
      // the next one.
      logger.error({ err, lat, lon, datasetId, providerIndex: index }, "[temperature-profile] provider failed");
    }
  }

  res.json(validateResponse(TemperatureProfileResponseSchema, {
    available: false as const,
    lat,
    lon,
    samples: [],
    provider: "none",
  }, "GET /api/temperature-profile"));
}));

export default router;
