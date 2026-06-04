/**
 * catalog-saves.ts — Dataset Discovery & Download Pipeline routes
 *
 * GET  /api/datasets/catalog           — list all catalog entries (public)
 * GET  /api/datasets/catalog/search    — keyword + filter search (public)
 * POST /api/datasets/catalog/:id/save  — save to user account (auth-gated)
 * GET  /api/datasets/my-saves          — list user's saves (auth-gated)
 * GET  /api/datasets/my-saves/:id/status — poll save status (auth-gated)
 *
 * Materialization model
 * ---------------------
 * "Saving" a catalog dataset means: build the terrain + overview grids
 * server-side and persist them into the user's own dataset store
 * (`custom_datasets`). The resulting row is then linked from the save record
 * via `user_catalog_saves.dataset_id`, so the viewer can load saved catalog
 * datasets through the unified per-user read path
 * (/user/datasets/:id/{terrain,overview}) — no second round-trip to the
 * preset/pipeline endpoint required.
 *
 * preset-* entries materialize directly through `buildTerrainGrid` (which
 * already handles NCEI/GEBCO upstream fetches, disk cache, and synthetic
 * fallback). All other catalog entries (lidar, habitat shapefiles, chart
 * ENCs, generic global bathymetry that isn't wired into the BathyScan
 * preset pipeline) currently mark the save as `failed` with a clear error
 * — wiring up those fetchers is tracked separately.
 */

import { Router } from "express";
import { eq, and, lt } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { CatalogSearchQuerySchema } from "./schemas.js";
import { db, userCatalogSavesTable, customDatasetsTable, type StoredTerrainJson } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
  getCatalogEntries,
  searchCatalog,
  seedDatasetCatalog,
  type CatalogSeedEntry,
} from "../lib/catalogSeeder.js";
import {
  buildTerrainGrid,
  buildGebcoTerrainForBbox,
  buildNceiTerrainForBbox,
  ALL_PRESET_DATASETS,
} from "../lib/terrain.js";
import {
  SALTWATER_EFH_BY_DATASET,
  type EfhFeature,
  type EfhFeatureCollection,
} from "../lib/efhData.js";
import {
  fetchNoaaAlaskaEfh,
  buildCollectionFromLiveFeatures,
} from "../lib/efhFetcher.js";

const router = Router();

// Kick off catalog seed on first request (non-blocking fallback — server
// startup also calls this, but it's idempotent so calling it twice is fine).
void seedDatasetCatalog();

// ---------------------------------------------------------------------------
// Startup sweeper: recover saves that are permanently stuck in "processing"
// ---------------------------------------------------------------------------
// Any save row that has been in "processing" for longer than 10 minutes has
// certainly lost its background job (e.g. the process was killed mid-flight).
// Mark those rows "failed" so users can see a clear error state and retry
// rather than waiting forever. Called once at module load (server startup)
// and not on a recurring schedule — the fire-and-forget materializeSave
// function always transitions to "ready" or "failed" on its own, so rows
// only get permanently stuck across process restarts.
async function recoverStuckSaves(): Promise<void> {
  const STUCK_THRESHOLD_MS = 10 * 60 * 1000;
  try {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const updated = await db
      .update(userCatalogSavesTable)
      .set({
        status: "failed",
        errorMessage:
          "Materialization timed out (the server was likely restarted while this save was processing). Please retry.",
      })
      .where(
        and(
          eq(userCatalogSavesTable.status, "processing"),
          lt(userCatalogSavesTable.requestedAt, cutoff),
        ),
      )
      .returning({ id: userCatalogSavesTable.id });
    if (updated.length > 0) {
      logger.warn(
        { count: updated.length },
        `[catalog-saves] recoverStuckSaves: marked ${updated.length} stuck processing row(s) as failed`,
      );
    }
  } catch (err) {
    logger.warn({ err }, `[catalog-saves] recoverStuckSaves failed: ${(err as Error).message}`);
  }
}
void recoverStuckSaves();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toCatalogResponse(entry: CatalogSeedEntry, createdAt?: string) {
  return {
    id: entry.id,
    name: entry.name,
    sourceAgency: entry.sourceAgency,
    dataType: entry.dataType,
    resolutionMMin: entry.resolutionMMin ?? null,
    resolutionMMax: entry.resolutionMMax ?? null,
    coverageBbox: entry.coverageBbox,
    endpointUrl: entry.endpointUrl ?? null,
    accessNotes: entry.accessNotes ?? null,
    description: entry.description ?? null,
    keywords: entry.keywords ?? null,
    lastUpdated: entry.lastUpdated ?? null,
    waterType: entry.waterType,
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /datasets/catalog
// ---------------------------------------------------------------------------

router.get("/datasets/catalog", asyncHandler(async (req, res): Promise<void> => {
  const rawDataType = req.query["dataType"] as string | undefined;
  const rawWaterType = req.query["waterType"] as string | undefined;

  const entries = await getCatalogEntries();

  const filtered = entries.filter((e) => {
    if (rawDataType && e.dataType !== rawDataType) return false;
    if (rawWaterType && e.waterType !== rawWaterType) return false;
    return true;
  });

  res.json(filtered.map((e) => toCatalogResponse(e)));
}));

// ---------------------------------------------------------------------------
// GET /datasets/catalog/search
// ---------------------------------------------------------------------------

router.get("/datasets/catalog/search", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = CatalogSearchQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({
      error: "invalid_param",
      details: queryParsed.error.issues[0]?.message ?? "Invalid query parameter",
    });
    return;
  }
  const { q, dataType, waterType, minLon, minLat, maxLon, maxLat } = queryParsed.data;

  const results = await searchCatalog({ q, dataType, waterType, minLon, minLat, maxLon, maxLat });
  res.json(
    results.map((r) => ({
      ...toCatalogResponse(r, r.createdAt),
      relevanceScore: r.relevanceScore,
    })),
  );
}));

// ---------------------------------------------------------------------------
// POST /datasets/bbox-query
//
// "Give me datasets for this area" — returns catalog entries whose coverage
// bbox intersects the request bbox. Validates bbox shape (zero-area,
// antimeridian, oversize) up-front so clients can show a clean error.
// ---------------------------------------------------------------------------

const BboxQueryBody = z.object({
  north: z.number().finite(),
  south: z.number().finite(),
  east: z.number().finite(),
  west: z.number().finite(),
  dataType: z.enum(["bathymetry", "substrate", "habitat", "lidar", "chart"]).optional(),
  waterType: z.enum(["saltwater", "freshwater"]).optional(),
});

function normalizeLon(lon: number): number {
  if (lon > -180 && lon <= 180) return lon;
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

const MIN_BBOX_DEG = 1e-4;
const MAX_BBOX_LON_DEG = 180;
const MAX_BBOX_LAT_DEG = 170;

router.post("/datasets/bbox-query", asyncHandler(async (req, res): Promise<void> => {
  const parsed = BboxQueryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_param",
      details: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
    });
    return;
  }

  const { dataType, waterType } = parsed.data;
  const north = Math.max(-90, Math.min(90, parsed.data.north));
  const south = Math.max(-90, Math.min(90, parsed.data.south));
  const east = normalizeLon(parsed.data.east);
  const west = normalizeLon(parsed.data.west);

  if (north <= south) {
    res.status(400).json({ error: "invalid_bbox", details: "north must be greater than south" });
    return;
  }
  if (east <= west) {
    res.status(400).json({
      error: "invalid_bbox",
      details: "east must be greater than west (antimeridian-crossing bboxes are not supported)",
    });
    return;
  }
  if (north - south < MIN_BBOX_DEG || east - west < MIN_BBOX_DEG) {
    res.status(400).json({ error: "invalid_bbox", details: "bbox has zero or near-zero area" });
    return;
  }
  if (east - west > MAX_BBOX_LON_DEG || north - south > MAX_BBOX_LAT_DEG) {
    res.status(400).json({
      error: "invalid_bbox",
      details: `bbox too large (max ${MAX_BBOX_LON_DEG}° lon × ${MAX_BBOX_LAT_DEG}° lat)`,
    });
    return;
  }

  const results = await searchCatalog({
    dataType,
    waterType,
    minLon: west,
    minLat: south,
    maxLon: east,
    maxLat: north,
  });
  res.json({
    bbox: { north, south, east, west },
    datasets: results.map((r) => ({
      ...toCatalogResponse(r, r.createdAt),
      relevanceScore: r.relevanceScore,
    })),
  });
}));

// ---------------------------------------------------------------------------
// POST /datasets/catalog/:id/save  (auth-gated)
// ---------------------------------------------------------------------------

router.post("/datasets/catalog/:id/save", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const catalogId = String(req.params["id"] ?? "");

  // Validate the catalog entry exists
  const entries = await getCatalogEntries();
  const entry = entries.find((e) => e.id === catalogId);
  if (!entry) {
    res.status(404).json({ error: "not_found", details: `Catalog entry '${catalogId}' not found` });
    return;
  }

  // Idempotent: if the user already has a save row for this catalog entry,
  // return it as-is. Callers can re-issue a save to retry a failed job via
  // a separate DELETE + re-POST flow (out of scope here).
  const existing = await db
    .select()
    .from(userCatalogSavesTable)
    .where(
      and(
        eq(userCatalogSavesTable.userId, userId),
        eq(userCatalogSavesTable.catalogId, catalogId),
      ),
    );

  if (existing.length > 0 && existing[0]) {
    res.status(200).json(formatSaveRow(existing[0], entry));
    return;
  }

  // Create new save record in processing state.
  const [created] = await db
    .insert(userCatalogSavesTable)
    .values({
      userId,
      catalogId,
      status: "processing",
    })
    .returning();

  if (!created) {
    res.status(500).json({ error: "db_error", details: "Failed to create save record" });
    return;
  }

  // Kick off materialization. Fire-and-forget so the HTTP response returns
  // quickly; clients poll /my-saves/:id/status (or refetch /my-saves) for
  // the eventual ready/failed status.
  void materializeSave(created.id, userId, entry);

  res.status(201).json(formatSaveRow(created, entry));
}));

/**
 * Background materialization: builds the terrain + overview grids for the
 * catalog entry and persists them into the user's `custom_datasets` store.
 * On success, links `user_catalog_saves.dataset_id` to the new row and
 * marks the save as `ready`. On failure, marks it `failed` with a
 * human-readable `error_message`.
 *
 * Two-layer error containment:
 *  - Inner try/catch: handles expected materializer errors (grid build failures,
 *    unsupported entry types) and writes a descriptive `failed` status.
 *  - Outer try/catch: unconditional safety net that catches anything the inner
 *    handler itself might throw (e.g. the DB update in the catch block failing)
 *    and makes a last-ditch attempt to mark the row `failed`.
 */
export async function materializeSave(
  saveId: string,
  userId: string,
  entry: CatalogSeedEntry,
): Promise<void> {
  try {
    try {
      const materialized = await buildCatalogGrids(entry);
      if (!materialized) {
        throw new Error(
          `Materialization is not yet implemented for catalog entries of type '${entry.dataType}' ` +
            `from source '${entry.sourceAgency}'. preset-* entries are supported today.`,
        );
      }

      const { terrain, overview } = materialized;

      // Insert the materialized grids into the user's dataset store. We let
      // Postgres allocate the row UUID, then patch the in-memory grid copies
      // to carry that same id so the /user/datasets/:id/{terrain,overview}
      // responses validate against the schema's datasetId field.
      const [created] = await db
        .insert(customDatasetsTable)
        .values({
          userId,
          name: entry.name,
          minDepth: terrain.minDepth,
          maxDepth: terrain.maxDepth,
          terrainJson: terrain as unknown as StoredTerrainJson,
          overviewJson: overview as unknown as StoredTerrainJson,
        })
        .returning({ id: customDatasetsTable.id });

      if (!created) {
        throw new Error("custom_datasets insert returned no row");
      }

      // Rewrite the stored grids so their datasetId matches the new row id.
      const terrainStamped = { ...terrain, datasetId: created.id };
      const overviewStamped = { ...overview, datasetId: created.id };
      await db
        .update(customDatasetsTable)
        .set({
          terrainJson: terrainStamped as unknown as StoredTerrainJson,
          overviewJson: overviewStamped as unknown as StoredTerrainJson,
        })
        .where(eq(customDatasetsTable.id, created.id));

      await db
        .update(userCatalogSavesTable)
        .set({
          status: "ready",
          readyAt: new Date(),
          cacheKey: `catalog:${entry.id}`,
          datasetId: created.id,
          errorMessage: null,
        })
        .where(eq(userCatalogSavesTable.id, saveId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Materialization failed";
      logger.warn({ saveId, entryId: entry.id, message }, `[catalog-saves] materialize ${saveId} (${entry.id}) failed: ${message}`);
      await db
        .update(userCatalogSavesTable)
        .set({ status: "failed", errorMessage: message })
        .where(eq(userCatalogSavesTable.id, saveId));
    }
  } catch (outerErr) {
    // Safety net: the inner catch itself threw (e.g. the DB update in the
    // error handler failed). Make one unconditional last-ditch attempt to
    // surface a visible error state rather than leaving the row stuck in
    // "processing" indefinitely.
    logger.error(
      { err: outerErr, saveId },
      `[catalog-saves] materialize ${saveId} outer-catch (status update may have failed)`,
    );
    try {
      await db
        .update(userCatalogSavesTable)
        .set({ status: "failed", errorMessage: "Unexpected internal error; please retry." })
        .where(eq(userCatalogSavesTable.id, saveId));
    } catch {
      /* truly nothing more we can do */
    }
  }
}

/**
 * Build the terrain + overview grids for a catalog entry. Returns null when
 * the entry has no materializer wired up (e.g. raw lidar/shapefile downloads).
 *
 * preset-* entries reuse the existing terrain pipeline (NCEI WCS → GEBCO →
 * synthetic fbm), which already provides disk caching and source fallback.
 *
 * Exported for tests.
 */
type TerrainGrid = NonNullable<Awaited<ReturnType<typeof buildTerrainGrid>>>;

export async function buildCatalogGrids(
  entry: CatalogSeedEntry,
): Promise<{ terrain: TerrainGrid; overview: TerrainGrid } | null> {
  if (entry.id.startsWith("preset-")) {
    const presetId = entry.id.replace(/^preset-/, "");
    // Sanity check: the catalog seeder only emits preset-<id> entries for
    // ids present in ALL_PRESET_DATASETS, but guard so unknown ids surface
    // a clear error instead of a generic "Dataset not found".
    if (!ALL_PRESET_DATASETS.some((d) => d.id === presetId)) {
      throw new Error(`Preset catalog entry references unknown dataset id '${presetId}'`);
    }
    const terrain = await buildTerrainGrid(presetId, 256, { smoothing: true });
    const overview = await buildTerrainGrid(presetId, 64, { smoothing: true });
    if (!terrain || !overview) {
      throw new Error(`Terrain pipeline returned no grid for preset '${presetId}'`);
    }
    return { terrain, overview };
  }

  // NOAA EFH (Essential Fish Habitat) species polygons — materialize as a
  // habitat polygon overlay. The bundled SE Alaska EFH feature collections
  // (`SALTWATER_EFH_BY_DATASET`) are filtered by the species encoded in the
  // catalog id suffix (pcod / halibut / rockfish) and clipped to the entry's
  // coverage bbox, then bundled into a flat synthetic terrain grid so the
  // result still satisfies the user-dataset terrain/overview contract. The
  // EFH FeatureCollection is preserved on the stored grid under
  // `habitatPolygons` so future read paths can serve the polygons back even
  // though the terrain GET endpoint currently strips unknown fields.
  if (entry.id.startsWith("noaa-efh-")) {
    const collection = await buildEfhHabitatCollection(entry);
    const terrain = buildHabitatGrid(entry, collection, 256);
    const overview = buildHabitatGrid(entry, collection, 64);
    return { terrain, overview };
  }

  // GEBCO 2024 global grid — fetched directly from the GEBCO WCS using the
  // entry's coverageBbox. The same fetcher already backs the preset pipeline
  // as its global-fallback source, so behaviour matches what users see when
  // a preset falls through to GEBCO. Any bathymetry entry sourced from GEBCO
  // is routed here so future GEBCO sub-regions Just Work without code edits.
  if (isGebcoBathymetryEntry(entry)) {
    const meta = {
      datasetId: entry.id,
      name: entry.name,
      waterType: entry.waterType,
      bbox: entry.coverageBbox,
    };
    const terrain = await buildGebcoTerrainForBbox(meta, 256, { smoothing: true });
    const overview = await buildGebcoTerrainForBbox(meta, 64, { smoothing: true });
    return { terrain, overview };
  }

  // NCEI bathymetry entries — high-resolution multibeam (BAG mosaic) and
  // integrated community DEMs (DEM Global Mosaic). Both are fetched from
  // an NCEI WCS using the entry's `coverageBbox`. The fetcher already
  // throws a clear "coverage unavailable" / "near-flat grid — likely no
  // coverage" error when the bbox falls outside actual NCEI survey
  // coverage; the materializer catches that and writes it into the save
  // row's `errorMessage`, producing the "clear failed message" path.
  const nceiCoverageKey = nceiCoverageForEntry(entry);
  if (nceiCoverageKey) {
    const meta = {
      datasetId: entry.id,
      name: entry.name,
      waterType: entry.waterType,
      bbox: entry.coverageBbox,
      coverageKey: nceiCoverageKey,
    };
    const terrain = await buildNceiTerrainForBbox(meta, 256, { smoothing: true });
    const overview = await buildNceiTerrainForBbox(meta, 64, { smoothing: true });
    return { terrain, overview };
  }

  return null;
}

// ---------------------------------------------------------------------------
// NOAA EFH habitat overlay materializer
// ---------------------------------------------------------------------------

/** Map a `noaa-efh-<suffix>` id to a species-matcher used to filter features. */
function efhSpeciesMatcher(catalogId: string): (f: EfhFeature) => boolean {
  const suffix = catalogId.replace(/^noaa-efh-(?:alaska-)?/, "").toLowerCase();
  if (suffix === "pcod" || suffix === "cod" || suffix === "pacific-cod") {
    return (f) => f.properties.species === "gadus_macrocephalus";
  }
  if (suffix === "halibut" || suffix === "pacific-halibut") {
    return (f) => f.properties.species === "hippoglossus_stenolepis";
  }
  if (suffix === "rockfish") {
    return (f) => f.properties.species.startsWith("sebastes_");
  }
  if (suffix === "pollock" || suffix === "walleye-pollock") {
    return (f) => f.properties.species === "gadus_chalcogrammus";
  }
  if (suffix === "sablefish") {
    return (f) => f.properties.species === "anoplopoma_fimbria";
  }
  if (suffix === "arrowtooth" || suffix === "arrowtooth-flounder") {
    return (f) => f.properties.species === "atheresthes_stomias";
  }
  // Unknown suffix — accept every feature so the user still gets a non-empty
  // overlay rather than a silently empty save.
  return () => true;
}

function polygonBbox(coordinates: number[][][]): [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const ring of coordinates) {
    for (const [lon, lat] of ring) {
      if (lon === undefined || lat === undefined) continue;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

function bboxesIntersect(
  a: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  b: [number, number, number, number],
): boolean {
  const [bMinLon, bMinLat, bMaxLon, bMaxLat] = b;
  return !(
    bMaxLon < a.minLon ||
    bMinLon > a.maxLon ||
    bMaxLat < a.minLat ||
    bMinLat > a.maxLat
  );
}

/**
 * Build the EFH habitat polygon collection for a catalog entry.
 *
 * First attempts to use real NOAA Alaska EFH species GeoJSON data fetched
 * (and disk-cached) by `fetchNoaaAlaskaEfh`. If the upstream is unreachable
 * or returns no usable features, falls back to the bundled hand-simplified
 * SE Alaska regional polygons from `efhData.ts` so materialization always
 * produces a non-empty overlay.
 *
 * The returned FeatureCollection is filtered to the catalog entry's species
 * suffix and clipped to its coverage bbox.
 */
export async function buildEfhHabitatCollection(
  entry: CatalogSeedEntry,
): Promise<EfhFeatureCollection> {
  const matches = efhSpeciesMatcher(entry.id);
  const creditUrl =
    entry.endpointUrl ??
    "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles";
  const lastUpdated = entry.lastUpdated ?? "2024";

  // --- Attempt 1: real NOAA upstream / disk cache -------------------------
  try {
    const liveFeatures = await fetchNoaaAlaskaEfh();
    if (liveFeatures !== null && liveFeatures.length > 0) {
      const collection = buildCollectionFromLiveFeatures(
        liveFeatures,
        entry.coverageBbox,
        matches,
        entry.name,
        creditUrl,
        lastUpdated,
      );
      // If the live data yielded features for this species, use it.
      if (collection.features.length > 0) {
        logger.info(
          { featureCount: collection.features.length, entryId: entry.id },
          `[efh] Using ${collection.features.length} real NOAA features for ${entry.id}.`,
        );
        return collection;
      }
      logger.info(
        { entryId: entry.id },
        `[efh] Live NOAA data had 0 matching features for ${entry.id}; falling back to bundled data.`,
      );
    }
  } catch (err) {
    logger.warn(
      { err, entryId: entry.id },
      `[efh] Live NOAA fetch error for ${entry.id}: ${(err as Error).message}; falling back to bundled data.`,
    );
  }

  // --- Fallback: bundled hand-simplified SE Alaska polygons ---------------
  logger.info({ entryId: entry.id }, `[efh] Building ${entry.id} from bundled EFH data.`);
  const features: EfhFeature[] = [];
  for (const region of Object.values(SALTWATER_EFH_BY_DATASET)) {
    for (const feature of region.features) {
      if (!matches(feature)) continue;
      const fbbox = polygonBbox(feature.geometry.coordinates);
      if (!bboxesIntersect(entry.coverageBbox, fbbox)) continue;
      features.push(feature);
    }
  }
  return {
    type: "FeatureCollection",
    features,
    metadata: {
      region: entry.name,
      bbox: [
        entry.coverageBbox.minLon,
        entry.coverageBbox.minLat,
        entry.coverageBbox.maxLon,
        entry.coverageBbox.maxLat,
      ],
      creditUrl,
      lastUpdated,
    },
  };
}

/**
 * Build a TerrainGrid wrapper around a habitat polygon overlay. The depth
 * grid itself is a flat zero-depth surface (habitat layers carry no
 * bathymetry); the EFH FeatureCollection rides along on `habitatPolygons`
 * so the persisted jsonb preserves the overlay even though the current
 * /user/datasets terrain GET strips unknown fields.
 */
function buildHabitatGrid(
  entry: CatalogSeedEntry,
  collection: EfhFeatureCollection,
  resolution: number,
): TerrainGrid {
  const { minLon, minLat, maxLon, maxLat } = entry.coverageBbox;
  const depths = new Array<number>(resolution * resolution).fill(0);
  const grid: TerrainGrid & { habitatPolygons?: EfhFeatureCollection } = {
    datasetId: entry.id,
    name: entry.name,
    waterType: entry.waterType,
    resolution,
    width: resolution,
    height: resolution,
    depths,
    minDepth: 0,
    maxDepth: 0,
    minLon,
    maxLon,
    minLat,
    maxLat,
    centerLon: (minLon + maxLon) / 2,
    centerLat: (minLat + maxLat) / 2,
    habitatPolygons: collection,
  };
  return grid;
}

function isGebcoBathymetryEntry(entry: CatalogSeedEntry): boolean {
  if (entry.dataType !== "bathymetry") return false;
  if (entry.id === "gebco-2024-global") return true;
  // Catch any future GEBCO sub-region entries seeded into the catalog.
  return /\bGEBCO\b/i.test(entry.sourceAgency);
}

/**
 * Returns the NCEI WCS coverage key that should be used to materialize the
 * given catalog entry, or null if the entry isn't an NCEI bathymetry layer.
 *
 *   `bagMosaic`        — high-resolution multibeam BAG composite. Used for
 *                        `ncei-bag-mosaic-*` entries (SE Alaska + future
 *                        BAG sub-regions).
 *   `demGlobalMosaic`  — best-available integrated DEM. Used for the global
 *                        mosaic entry plus each `ncei-community-dem-*`
 *                        sub-region (Juneau / Sitka / Ketchikan / Craig /
 *                        Skagway / Wrangell-Petersburg), which the catalog
 *                        accesses via the DEM Global Mosaic WCS.
 */
function nceiCoverageForEntry(
  entry: CatalogSeedEntry,
): "bagMosaic" | "demGlobalMosaic" | null {
  if (entry.dataType !== "bathymetry") return null;
  if (!/\bNCEI\b/i.test(entry.sourceAgency)) return null;
  if (entry.id.startsWith("ncei-bag-mosaic")) return "bagMosaic";
  if (entry.id === "ncei-dem-global-mosaic") return "demGlobalMosaic";
  if (entry.id.startsWith("ncei-community-dem-")) return "demGlobalMosaic";
  // NCEI Bathymetry Geoportal portal entries: prefer the high-resolution BAG
  // mosaic for fine-grained surveys (≤ 50 m); fall back to the DEM Global
  // Mosaic for coarser or unknown-resolution entries (covers global oceans).
  if (entry.id.startsWith("ncei-portal-")) {
    const minRes = entry.resolutionMMin ?? 100;
    return minRes <= 50 ? "bagMosaic" : "demGlobalMosaic";
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /datasets/my-saves/:id/retry  (auth-gated)
//
// Re-runs materialization for a save row that previously failed. Flips the
// row back to `processing` (clearing the prior error_message) and kicks off
// `materializeSave` again. Idempotent-ish: if the row is already processing
// or ready, returns the current row unchanged.
// ---------------------------------------------------------------------------

router.post("/datasets/my-saves/:id/retry", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const saveId = String(req.params["id"] ?? "");

  const rows = await db
    .select()
    .from(userCatalogSavesTable)
    .where(and(eq(userCatalogSavesTable.id, saveId), eq(userCatalogSavesTable.userId, userId)));

  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "not_found", details: `Save record '${saveId}' not found` });
    return;
  }

  const entries = await getCatalogEntries();
  const entry = entries.find((e) => e.id === row.catalogId);
  if (!entry) {
    res.status(404).json({
      error: "not_found",
      details: `Catalog entry '${row.catalogId}' no longer exists`,
    });
    return;
  }

  // Only failed saves are retryable. Already-processing or ready rows are a
  // no-op so accidental double-clicks don't kick off duplicate jobs.
  if (row.status !== "failed") {
    res.status(200).json(formatSaveRow(row, entry));
    return;
  }

  const [updated] = await db
    .update(userCatalogSavesTable)
    .set({ status: "processing", errorMessage: null, readyAt: null })
    .where(eq(userCatalogSavesTable.id, saveId))
    .returning();

  if (!updated) {
    res.status(500).json({ error: "db_error", details: "Failed to update save record" });
    return;
  }

  void materializeSave(updated.id, userId, entry);

  res.status(200).json(formatSaveRow(updated, entry));
}));

// ---------------------------------------------------------------------------
// GET /datasets/my-saves  (auth-gated)
// ---------------------------------------------------------------------------

router.get("/datasets/my-saves", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const rows = await db
    .select()
    .from(userCatalogSavesTable)
    .where(eq(userCatalogSavesTable.userId, userId));

  const entries = await getCatalogEntries();
  const entryMap = new Map(entries.map((e) => [e.id, e]));

  const result = rows.map((row) => {
    const entry = entryMap.get(row.catalogId);
    return formatSaveRow(row, entry ?? null);
  });

  res.json(result);
}));

// ---------------------------------------------------------------------------
// GET /datasets/my-saves/:id/status  (auth-gated)
// ---------------------------------------------------------------------------

router.get("/datasets/my-saves/:id/status", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const saveId = String(req.params["id"] ?? "");

  const rows = await db
    .select()
    .from(userCatalogSavesTable)
    .where(and(eq(userCatalogSavesTable.id, saveId), eq(userCatalogSavesTable.userId, userId)));

  if (!rows[0]) {
    res.status(404).json({ error: "not_found", details: `Save record '${saveId}' not found` });
    return;
  }

  const entries = await getCatalogEntries();
  const entry = entries.find((e) => e.id === rows[0]!.catalogId) ?? null;
  res.json(formatSaveRow(rows[0], entry));
}));

// ---------------------------------------------------------------------------
// DELETE /datasets/my-saves/:id  (auth-gated)
//
// Removes the user's save row and, when a materialized dataset is linked,
// the corresponding custom_datasets row (which carries the terrain +
// overview grids). Ownership is enforced on both rows — a user cannot
// delete another user's save or the dataset it points to.
// ---------------------------------------------------------------------------

router.delete("/datasets/my-saves/:id", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const saveId = String(req.params["id"] ?? "");

  const [save] = await db
    .select({ id: userCatalogSavesTable.id, datasetId: userCatalogSavesTable.datasetId })
    .from(userCatalogSavesTable)
    .where(
      and(eq(userCatalogSavesTable.id, saveId), eq(userCatalogSavesTable.userId, userId)),
    );

  if (!save) {
    res.status(404).json({ error: "not_found", details: `Save record '${saveId}' not found` });
    return;
  }

  await db
    .delete(userCatalogSavesTable)
    .where(
      and(eq(userCatalogSavesTable.id, saveId), eq(userCatalogSavesTable.userId, userId)),
    );

  if (save.datasetId) {
    await db
      .delete(customDatasetsTable)
      .where(
        and(
          eq(customDatasetsTable.id, save.datasetId),
          eq(customDatasetsTable.userId, userId),
        ),
      );
  }

  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// Shared formatter
// ---------------------------------------------------------------------------

export function formatSaveRow(
  row: typeof userCatalogSavesTable.$inferSelect,
  entry: CatalogSeedEntry | null,
) {
  return {
    id: row.id,
    catalogId: row.catalogId,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    readyAt: row.readyAt?.toISOString() ?? null,
    cacheKey: row.cacheKey ?? null,
    errorMessage: row.errorMessage ?? null,
    datasetId: row.datasetId ?? null,
    catalog: entry ? { ...toCatalogResponse(entry), createdAt: new Date().toISOString() } : null,
  };
}

export default router;
