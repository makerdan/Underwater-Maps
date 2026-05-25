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
