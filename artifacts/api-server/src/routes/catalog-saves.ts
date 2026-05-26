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
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, userCatalogSavesTable, customDatasetsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import {
  getCatalogEntries,
  searchCatalog,
  seedDatasetCatalog,
  type CatalogSeedEntry,
} from "../lib/catalogSeeder.js";
import { buildTerrainGrid, ALL_PRESET_DATASETS } from "../lib/terrain.js";

const router = Router();

// Kick off catalog seed on first request (non-blocking fallback — server
// startup also calls this, but it's idempotent so calling it twice is fine).
void seedDatasetCatalog();

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

router.get("/datasets/catalog", async (req, res): Promise<void> => {
  const rawDataType = req.query["dataType"] as string | undefined;
  const rawWaterType = req.query["waterType"] as string | undefined;

  try {
    const entries = await getCatalogEntries();

    const filtered = entries.filter((e) => {
      if (rawDataType && e.dataType !== rawDataType) return false;
      if (rawWaterType && e.waterType !== rawWaterType) return false;
      return true;
    });

    res.json(filtered.map((e) => toCatalogResponse(e)));
  } catch (err) {
    res.status(500).json({ error: "catalog_error", details: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /datasets/catalog/search
// ---------------------------------------------------------------------------

router.get("/datasets/catalog/search", async (req, res): Promise<void> => {
  const q = req.query["q"] as string | undefined;
  const dataType = req.query["dataType"] as string | undefined;
  const waterType = req.query["waterType"] as string | undefined;
  const minLon = req.query["minLon"] !== undefined ? Number(req.query["minLon"]) : undefined;
  const minLat = req.query["minLat"] !== undefined ? Number(req.query["minLat"]) : undefined;
  const maxLon = req.query["maxLon"] !== undefined ? Number(req.query["maxLon"]) : undefined;
  const maxLat = req.query["maxLat"] !== undefined ? Number(req.query["maxLat"]) : undefined;

  try {
    const results = await searchCatalog({ q, dataType, waterType, minLon, minLat, maxLon, maxLat });
    res.json(
      results.map((r) => ({
        ...toCatalogResponse(r, r.createdAt),
        relevanceScore: r.relevanceScore,
      })),
    );
  } catch (err) {
    res.status(500).json({ error: "search_error", details: (err as Error).message });
  }
});

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

router.post("/datasets/bbox-query", async (req, res): Promise<void> => {
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

  try {
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
  } catch (err) {
    res.status(500).json({ error: "search_error", details: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /datasets/catalog/:id/save  (auth-gated)
// ---------------------------------------------------------------------------

router.post("/datasets/catalog/:id/save", requireAuth, async (req, res): Promise<void> => {
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
});

/**
 * Background materialization: builds the terrain + overview grids for the
 * catalog entry and persists them into the user's `custom_datasets` store.
 * On success, links `user_catalog_saves.dataset_id` to the new row and
 * marks the save as `ready`. On failure, marks it `failed` with a
 * human-readable `error_message`.
 */
async function materializeSave(
  saveId: string,
  userId: string,
  entry: CatalogSeedEntry,
): Promise<void> {
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
        terrainJson: terrain as unknown as Record<string, unknown>,
        overviewJson: overview as unknown as Record<string, unknown>,
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
        terrainJson: terrainStamped as unknown as Record<string, unknown>,
        overviewJson: overviewStamped as unknown as Record<string, unknown>,
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
    console.warn(`[catalog-saves] materialize ${saveId} (${entry.id}) failed: ${message}`);
    await db
      .update(userCatalogSavesTable)
      .set({ status: "failed", errorMessage: message })
      .where(eq(userCatalogSavesTable.id, saveId))
      .catch(() => {
        /* best effort; nothing more we can do here */
      });
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

router.post("/datasets/my-saves/:id/retry", requireAuth, async (req, res): Promise<void> => {
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
});

// ---------------------------------------------------------------------------
// GET /datasets/my-saves  (auth-gated)
// ---------------------------------------------------------------------------

router.get("/datasets/my-saves", requireAuth, async (req, res): Promise<void> => {
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
});

// ---------------------------------------------------------------------------
// GET /datasets/my-saves/:id/status  (auth-gated)
// ---------------------------------------------------------------------------

router.get("/datasets/my-saves/:id/status", requireAuth, async (req, res): Promise<void> => {
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
});

// ---------------------------------------------------------------------------
// Shared formatter
// ---------------------------------------------------------------------------

function formatSaveRow(
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
