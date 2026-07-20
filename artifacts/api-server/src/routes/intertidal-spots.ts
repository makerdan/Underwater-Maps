/**
 * /intertidal-spots/:id — Tidepool & beachcombing hotspot polygons.
 *
 * Returns a GeoJSON FeatureCollection of intertidal substrate polygons that
 * have been scored for recreational tidepool exploration and/or beachcombing.
 * Features are sourced from SE Alaska substrate bundles (ShoreZone +
 * AOOS Prince of Wales Island intertidal) and scored by `intertidalScorer.ts`.
 *
 * Only SE Alaska sources are eligible for intertidal scoring. Datasets whose
 * substrate slice contains no SE Alaska features (e.g. TX reservoirs) receive
 * an empty FeatureCollection rather than nonsensical freshwater scores.
 *
 * Auth rules (mirrors the substrate route pattern):
 *  - Preset/catalog dataset IDs → public, no auth required.
 *  - UUID-format (custom) dataset IDs → require auth + ownership check.
 *    Non-owner / non-existent custom datasets return 404 (not 403) to avoid
 *    confirming existence to unauthenticated or cross-user callers.
 *
 * Query params:
 *   type     — "tidepool" | "beachcombing" | "both" (default: "both")
 *   minScore — integer 0–100, inclusive filter (default: 0)
 *
 * Each returned feature carries two additional properties:
 *   tidepoolScore      — 0–100 integer
 *   beachcombingScore  — 0–100 integer
 *   scoreSignals       — { substrate, bioband, debris, energy, humanUse, whySummary }
 */

import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, customDatasetsTable } from "@workspace/db";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateResponse } from "../middlewares/validateResponse.js";
import { ALL_PRESET_DATASETS } from "../lib/terrain.js";
import {
  getSubstrateForDataset,
  type ShoreZoneFeature,
  type SubstrateSource,
} from "../lib/shoreZoneData.js";
import { scoreTidepool, scoreBeachcombing, buildScoreSignals } from "../lib/intertidalScorer.js";
import type { IntertidalScoringProps } from "../lib/intertidalScorer.js";
import { GetIntertidalSpotsResponse } from "@workspace/api-zod";

const IntertidalSpotsQuerySchema = z.object({
  type: z.enum(["tidepool", "beachcombing", "both"]).optional().default("both"),
  minScore: z.coerce
    .number({ invalid_type_error: "minScore must be a number" })
    .int("minScore must be an integer")
    .min(0, "minScore must be between 0 and 100")
    .max(100, "minScore must be between 0 and 100")
    .optional()
    .default(0),
});

const router = Router();

/** SE Alaska sources that are meaningful for intertidal scoring. */
const SE_ALASKA_SOURCES = new Set<SubstrateSource>([
  "alaska-shorezone",
  "noaa-enc-coastal",
  "aoos-intertidal-pow",
]);

// UUID pattern for custom (user-uploaded) dataset IDs.
const CUSTOM_DATASET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function featureToScoringProps(f: ShoreZoneFeature): IntertidalScoringProps {
  const p = f.properties;
  return {
    substrate:   p.substrate   ?? null,
    szMaterial:  p.szMaterial  ?? null,
    szForm:      p.szForm      ?? null,
    itzSubclass: p.itzSubclass ?? null,
    rockSzLo:    p.rockSzLo    ?? null,
    rockSzMed:   p.rockSzMed   ?? null,
    rockSzHi:    p.rockSzHi    ?? null,
    znRelief:    p.znRelief    ?? null,
    znBioAlg:    p.znBioAlg    ?? null,
    znBioInv:    p.znBioInv    ?? null,
    znDebris:    p.znDebris    ?? null,
    roundness:   p.roundness   ?? null,
    znEnergy:    p.znEnergy    ?? null,
    znDynamic:   p.znDynamic   ?? null,
    znUse:       p.znUse       ?? null,
  };
}

/**
 * Shared scoring + response logic — converts a substrate slice into a scored
 * intertidal FeatureCollection and writes the JSON response.
 */
function buildAndSendResponse(
  res: Parameters<Parameters<typeof router.get>[1]>[1],
  datasetId: string,
  slice: ReturnType<typeof getSubstrateForDataset>,
  typeParam: "tidepool" | "beachcombing" | "both",
  minScore: number,
): void {
  const seAlaskaFeatures = slice.features.filter((f) => SE_ALASKA_SOURCES.has(f.properties.source));

  if (seAlaskaFeatures.length === 0) {
    res.json(validateResponse(GetIntertidalSpotsResponse, {
      type: "FeatureCollection",
      features: [],
      metadata: {
        datasetId,
        type: typeParam,
        minScore,
        featureCount: 0,
        sources: slice.sources,
        sourceCredit:
          "Alaska ShoreZone (NOAA AKR / ADF&G) and AOOS Alaska Coastal Habitats — both public domain.",
      },
    }, "GET /api/intertidal-spots/:id"));
    return;
  }

  const scored = seAlaskaFeatures.map((f) => {
    const props = featureToScoringProps(f);
    const tidepoolScore = f.properties.tidepoolScore ?? scoreTidepool(props);
    const beachcombingScore = f.properties.beachcombingScore ?? scoreBeachcombing(props);
    return { f, tidepoolScore, beachcombingScore, props };
  });

  const filtered = scored.filter(({ tidepoolScore, beachcombingScore }) => {
    if (typeParam === "tidepool") return tidepoolScore >= minScore;
    if (typeParam === "beachcombing") return beachcombingScore >= minScore;
    return tidepoolScore >= minScore || beachcombingScore >= minScore;
  });

  const sortKey = typeParam === "tidepool"
    ? (s: typeof filtered[number]) => s.tidepoolScore
    : typeParam === "beachcombing"
    ? (s: typeof filtered[number]) => s.beachcombingScore
    : (s: typeof filtered[number]) => Math.max(s.tidepoolScore, s.beachcombingScore);

  filtered.sort((a, b) => sortKey(b) - sortKey(a));

  const features = filtered.map(({ f, tidepoolScore, beachcombingScore, props }) => ({
    type: "Feature" as const,
    geometry: f.geometry,
    properties: {
      ...f.properties,
      tidepoolScore,
      beachcombingScore,
      scoreSignals: {
        tidepool: buildScoreSignals(props, "tidepool"),
        beachcombing: buildScoreSignals(props, "beachcombing"),
      },
    },
  }));

  res.json(validateResponse(GetIntertidalSpotsResponse, {
    type: "FeatureCollection",
    features,
    metadata: {
      datasetId,
      type: typeParam,
      minScore,
      featureCount: features.length,
      sources: slice.sources,
      sourceCredit:
        "Alaska ShoreZone (NOAA AKR / ADF&G) and AOOS Alaska Coastal Habitats — both public domain.",
    },
  }, "GET /api/intertidal-spots/:id"));
}

/**
 * GET /intertidal-spots/:id
 *
 * UUID-format dataset IDs require auth + ownership. Preset IDs are public.
 * For SE Alaska datasets returns a scored FeatureCollection sorted by
 * dominant score. Non-SE-Alaska datasets receive an empty FeatureCollection
 * (HTTP 200, no error) since there is simply no intertidal coverage there.
 */
router.get("/intertidal-spots/:id", asyncHandler(async (req, res) => {
  const datasetId = String(req.params["id"]);

  // ── UUID / custom-upload path ─────────────────────────────────────────────
  if (CUSTOM_DATASET_UUID_RE.test(datasetId) && !ALL_PRESET_DATASETS.some((d) => d.id === datasetId)) {
    const callerId = getAuth(req)?.userId ?? null;
    if (!callerId) {
      res.status(401).json({ error: "unauthenticated", details: "Authentication required" });
      return;
    }

    const [ownRow] = await db
      .select({
        userId:      customDatasetsTable.userId,
        terrainJson: customDatasetsTable.terrainJson,
      })
      .from(customDatasetsTable)
      .where(and(eq(customDatasetsTable.id, datasetId), eq(customDatasetsTable.userId, callerId)));

    if (!ownRow) {
      res.status(404).json({ error: "not_found", details: `Dataset '${datasetId}' not found` });
      return;
    }

    const queryParsed = IntertidalSpotsQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(400).json({
        error: "invalid_params",
        details: queryParsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    const tj = ownRow.terrainJson;
    const customBbox = {
      minLon: tj.minLon,
      minLat: tj.minLat,
      maxLon: tj.maxLon,
      maxLat: tj.maxLat,
    };

    const slice = getSubstrateForDataset(datasetId, customBbox);
    buildAndSendResponse(res, datasetId, slice, queryParsed.data.type, queryParsed.data.minScore);
    return;
  }

  // ── Preset dataset path ───────────────────────────────────────────────────
  const meta = ALL_PRESET_DATASETS.find((d) => d.id === datasetId);
  if (!meta) {
    res.status(404).json({ error: "not_found", details: `Dataset '${datasetId}' not found` });
    return;
  }

  const queryParsed = IntertidalSpotsQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: queryParsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }

  const slice = getSubstrateForDataset(datasetId, meta.bbox);
  buildAndSendResponse(res, datasetId, slice, queryParsed.data.type, queryParsed.data.minScore);
}));

export default router;
