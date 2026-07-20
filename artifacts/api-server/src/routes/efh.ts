/**
 * /efh — Essential Fish Habitat (EFH) zones.
 *
 * Returns GeoJSON feature collections for EFH zones in the requested area.
 * Covers the SE Alaska Inside Passage saltwater regions (NOAA federal EFH)
 * plus Texas freshwater reservoirs (TPWD priority habitat, EFH-equivalent —
 * NOT federal EFH; the source string makes that explicit).
 *
 * Data credits:
 *   Saltwater — NOAA Fisheries / NMFS Alaska Region
 *     https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles
 *   Freshwater — Texas Parks & Wildlife Department lake pages
 *
 * Auth rules (mirrors the substrate / intertidal-spots route pattern):
 *  - Preset/catalog dataset IDs → public, no auth required.
 *  - UUID-format (custom) dataset IDs → require auth + ownership check.
 *    Non-owner / non-existent custom datasets return 404 (not 403) to avoid
 *    confirming existence to unauthenticated or cross-user callers.
 */

import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, customDatasetsTable } from "@workspace/db";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { logger } from "../lib/logger.js";
import { ALL_PRESET_DATASETS } from "../lib/terrain.js";
import {
  SALTWATER_EFH_BY_DATASET,
  type EfhFeatureCollection,
} from "../lib/efhData.js";
import { TX_FRESHWATER_EFH_BY_DATASET } from "../lib/txFreshwaterEfhData.js";

const EfhQuerySchema = z.object({
  datasetId: z.string().optional(),
  species: z.string().optional(),
});

const EfhByIdQuerySchema = z.object({
  species: z.string().optional(),
});

const router = Router();

/** Merged lookup of every dataset id that has bundled EFH data. */
export const EFH_BY_DATASET: Record<string, EfhFeatureCollection> = {
  ...SALTWATER_EFH_BY_DATASET,
  ...TX_FRESHWATER_EFH_BY_DATASET,
};

/** All dataset ids with bundled EFH data — exported for the dataset metadata. */
export const EFH_DATASET_IDS: ReadonlySet<string> = new Set(
  Object.keys(EFH_BY_DATASET),
);

// UUID pattern for custom (user-uploaded) dataset IDs.
const CUSTOM_DATASET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Filter an EfhFeatureCollection by a comma-separated species query string.
 * Returns the original features array when no filter is requested.
 */
function filterBySpecies(
  features: EfhFeatureCollection["features"],
  species: string | undefined,
): EfhFeatureCollection["features"] {
  if (!species) return features;
  const requested = new Set(
    species.split(",").map((s) => s.trim().toLowerCase()),
  );
  return features.filter(
    (f) =>
      requested.has(f.properties.species.toLowerCase()) ||
      requested.has(f.properties.commonName.toLowerCase().replace(/ /g, "_")) ||
      requested.has(f.properties.commonName.toLowerCase()),
  );
}

const EfhResponseSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.unknown()),
  metadata: z.record(z.unknown()),
});

function warnEfhShape(data: unknown): void {
  const _p = EfhResponseSchema.safeParse(data);
  if (!_p.success) logger.warn({ err: _p.error }, "GET /api/efh — response shape mismatch");
}

/** Build an empty-EFH response (no bundled data for this dataset). */
function emptyEfhResponse(datasetId: string | undefined) {
  const r = {
    type: "FeatureCollection" as const,
    features: [] as unknown[],
    metadata: {
      note: `No EFH data bundled for dataset '${datasetId}'.`,
      creditUrl:
        "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    },
  };
  warnEfhShape(r);
  return r;
}

/**
 * GET /efh
 * Query params:
 *   datasetId  — filter to the AOI matching a known preset dataset
 *   species    — comma-separated list to filter (optional)
 */
router.get("/efh", (req, res) => {
  const parsed = EfhQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: parsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }
  const { datasetId, species } = parsed.data;

  const collection = datasetId ? EFH_BY_DATASET[datasetId] : undefined;

  if (!collection) {
    res.json(emptyEfhResponse(datasetId));
    return;
  }

  {
    const _r = {
      type: "FeatureCollection" as const,
      features: filterBySpecies(collection.features, species),
      metadata: collection.metadata,
    };
    warnEfhShape(_r);
    res.json(_r);
  }
});

/**
 * GET /efh/:id
 *
 * UUID-format dataset IDs require auth + ownership check (mirrors the
 * intertidal-spots and substrate route patterns).  Preset IDs are public.
 *
 * If the authenticated owner has a UUID dataset with no bundled EFH data,
 * the response is an empty FeatureCollection (HTTP 200, no error) — there
 * is simply no EFH coverage for that custom upload area.
 *
 * Query params:
 *   species — comma-separated list to filter (optional)
 */
router.get("/efh/:id", asyncHandler(async (req, res) => {
  const datasetId = String(req.params["id"]);

  // ── UUID / custom-upload path ─────────────────────────────────────────────
  if (CUSTOM_DATASET_UUID_RE.test(datasetId) && !ALL_PRESET_DATASETS.some((d) => d.id === datasetId)) {
    const callerId = getAuth(req)?.userId ?? null;
    if (!callerId) {
      res.status(401).json({ error: "unauthenticated", details: "Authentication required" });
      return;
    }

    const [ownRow] = await db
      .select({ userId: customDatasetsTable.userId })
      .from(customDatasetsTable)
      .where(and(eq(customDatasetsTable.id, datasetId), eq(customDatasetsTable.userId, callerId)));

    if (!ownRow) {
      res.status(404).json({ error: "not_found", details: `Dataset '${datasetId}' not found` });
      return;
    }

    const queryParsed = EfhByIdQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(400).json({
        error: "invalid_params",
        details: queryParsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    const collection = EFH_BY_DATASET[datasetId];
    if (!collection) {
      res.json(emptyEfhResponse(datasetId));
      return;
    }

    {
      const _r = {
        type: "FeatureCollection" as const,
        features: filterBySpecies(collection.features, queryParsed.data.species),
        metadata: collection.metadata,
      };
      warnEfhShape(_r);
      res.json(_r);
    }
    return;
  }

  // ── Preset dataset path ───────────────────────────────────────────────────
  const meta = ALL_PRESET_DATASETS.find((d) => d.id === datasetId);
  if (!meta) {
    res.status(404).json({ error: "not_found", details: `Dataset '${datasetId}' not found` });
    return;
  }

  const queryParsed = EfhByIdQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: queryParsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }

  const collection = EFH_BY_DATASET[datasetId];
  if (!collection) {
    res.json(emptyEfhResponse(datasetId));
    return;
  }

  {
    const _r = {
      type: "FeatureCollection" as const,
      features: filterBySpecies(collection.features, queryParsed.data.species),
      metadata: collection.metadata,
    };
    warnEfhShape(_r);
    res.json(_r);
  }
}));

export default router;
