/**
 * catalog-saves.ts — Dataset Discovery & Download Pipeline routes
 *
 * GET  /api/datasets/catalog           — list all catalog entries (public)
 * GET  /api/datasets/catalog/search    — keyword + filter search (public)
 * POST /api/datasets/catalog/:id/save  — save to user account (auth-gated)
 * GET  /api/datasets/my-saves          — list user's saves (auth-gated)
 * GET  /api/datasets/my-saves/:id/status — poll save status (auth-gated)
 */

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, userCatalogSavesTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import {
  getCatalogEntries,
  searchCatalog,
  seedDatasetCatalog,
  type CatalogSeedEntry,
} from "../lib/catalogSeeder.js";

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

// We accept latitudes outside [-90, 90] and longitudes outside [-180, 180]
// at the wire level, then normalize/clamp them before validating the bbox
// shape. This makes the endpoint resilient to clients that send slightly
// out-of-range values from canvas math without forcing them to clamp.
const BboxQueryBody = z.object({
  north: z.number().finite(),
  south: z.number().finite(),
  east: z.number().finite(),
  west: z.number().finite(),
  dataType: z.enum(["bathymetry", "substrate", "habitat", "lidar", "chart"]).optional(),
  waterType: z.enum(["saltwater", "freshwater"]).optional(),
});

/** Wrap a longitude into (-180, 180] using the standard modulo trick.
 * Values already in range are returned untouched to avoid floating-point
 * drift (e.g. ((-132.6 + 180) % 360) - 180 = -132.60000000000002). */
function normalizeLon(lon: number): number {
  if (lon > -180 && lon <= 180) return lon;
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Smallest bbox we accept — anything thinner is treated as a stray click. */
const MIN_BBOX_DEG = 1e-4;
/** Largest bbox we allow — keeps the result set sensible. */
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
  // Clamp latitudes to the valid range and normalize longitudes to (-180, 180].
  const north = Math.max(-90, Math.min(90, parsed.data.north));
  const south = Math.max(-90, Math.min(90, parsed.data.south));
  const east = normalizeLon(parsed.data.east);
  const west = normalizeLon(parsed.data.west);

  if (north <= south) {
    res.status(400).json({ error: "invalid_bbox", details: "north must be greater than south" });
    return;
  }
  if (east <= west) {
    // Note: antimeridian-crossing bboxes (e.g. west=170, east=-170) fall in
    // here. We explicitly reject rather than try to split the query.
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

  // Check for duplicate save (same user + catalogId)
  const existing = await db
    .select({ id: userCatalogSavesTable.id, status: userCatalogSavesTable.status })
    .from(userCatalogSavesTable)
    .where(
      and(
        eq(userCatalogSavesTable.userId, userId),
        eq(userCatalogSavesTable.catalogId, catalogId),
      ),
    );

  if (existing.length > 0) {
    // Return existing record — idempotent
    const row = existing[0]!;
    const dbRow = await db
      .select()
      .from(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.id, row.id));
    if (dbRow[0]) {
      res.status(200).json(formatSaveRow(dbRow[0], entry));
      return;
    }
  }

  // Create new save record in queued state
  const [created] = await db
    .insert(userCatalogSavesTable)
    .values({
      userId,
      catalogId,
      status: "queued",
    })
    .returning();

  if (!created) {
    res.status(500).json({ error: "db_error", details: "Failed to create save record" });
    return;
  }

  // Fire-and-forget: mark as ready immediately for catalog entries that are
  // served by the existing terrain pipeline (preset-* IDs). External-only
  // entries (e.g. lidar, shapefile downloads) stay in "queued" status and
  // require a future background job to fetch the raw data.
  if (catalogId.startsWith("preset-")) {
    void markSaveReady(created.id, catalogId);
  }

  res.status(201).json(formatSaveRow(created, entry));
});

async function markSaveReady(saveId: string, catalogId: string): Promise<void> {
  try {
    const cacheKey = `catalog:${catalogId}`;
    await db
      .update(userCatalogSavesTable)
      .set({ status: "ready", readyAt: new Date(), cacheKey })
      .where(eq(userCatalogSavesTable.id, saveId));
  } catch (err) {
    console.warn(`[catalog-saves] Failed to mark ${saveId} ready: ${(err as Error).message}`);
    await db
      .update(userCatalogSavesTable)
      .set({ status: "failed", errorMessage: (err as Error).message })
      .where(eq(userCatalogSavesTable.id, saveId))
      .catch(() => {});
  }
}

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
    catalog: entry ? { ...toCatalogResponse(entry), createdAt: new Date().toISOString() } : null,
  };
}

export default router;
