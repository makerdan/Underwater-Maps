import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, customDatasetsTable, datasetFoldersTable, type StoredTerrainJson } from "@workspace/db";
import { MAX_TERRAIN_JSON_BYTES } from "../lib/constants.js";
import {
  GetUserDatasetsResponse,
  GetUserDatasetsIdTerrainResponse,
  GetUserDatasetsIdOverviewResponse,
  PatchUserDatasetsIdMoveBody,
  PatchUserDatasetsIdMoveResponse,
  PatchUserDatasetsIdRenameBody,
  PatchUserDatasetsIdRenameResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { createRateLimit } from "../middlewares/rateLimit.js";

const router = Router();

const terrainFetchIpRateLimit = createRateLimit({
  route: "terrain-fetch",
  windowMs: 60_000,
  max: 90,
  mode: "ip",
});

const terrainFetchUserRateLimit = createRateLimit({
  route: "terrain-fetch",
  windowMs: 60_000,
  max: 30,
  mode: "user",
});

function metaJson(row: {
  id: string;
  name: string;
  minDepth: number;
  maxDepth: number;
  folderId: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    minDepth: row.minDepth,
    maxDepth: row.maxDepth,
    folderId: row.folderId,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── GET /user/datasets ─────────────────────────────────────────────────────
router.get("/user/datasets", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const rows = await db
    .select({
      id: customDatasetsTable.id,
      name: customDatasetsTable.name,
      minDepth: customDatasetsTable.minDepth,
      maxDepth: customDatasetsTable.maxDepth,
      folderId: customDatasetsTable.folderId,
      createdAt: customDatasetsTable.createdAt,
    })
    .from(customDatasetsTable)
    .where(eq(customDatasetsTable.userId, userId))
    .orderBy(desc(customDatasetsTable.createdAt));

  res.json(GetUserDatasetsResponse.parse(rows.map(metaJson)));
}));

// ── PATCH /user/datasets/:id/move ──────────────────────────────────────────
router.patch("/user/datasets/:id/move", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");
  const parsed = PatchUserDatasetsIdMoveBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.message });
    return;
  }
  const folderId = parsed.data.folderId ?? null;

  if (folderId !== null) {
    const [folder] = await db
      .select({ id: datasetFoldersTable.id })
      .from(datasetFoldersTable)
      .where(and(eq(datasetFoldersTable.id, folderId), eq(datasetFoldersTable.userId, userId)));
    if (!folder) {
      res.status(400).json({ error: "invalid_parent", details: "Folder not found" });
      return;
    }
  }

  const [updated] = await db
    .update(customDatasetsTable)
    .set({ folderId })
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "not_found", details: "Dataset not found" });
    return;
  }
  res.json(PatchUserDatasetsIdMoveResponse.parse(metaJson(updated)));
}));

// ── PATCH /user/datasets/:id/rename ────────────────────────────────────────
router.patch("/user/datasets/:id/rename", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");
  const parsed = PatchUserDatasetsIdRenameBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.message });
    return;
  }
  const name = typeof parsed.data.name === "string" ? parsed.data.name.trim() : "";
  if (!name || name.length > 200) {
    res.status(400).json({ error: "invalid_name", details: "Name must be 1–200 chars" });
    return;
  }

  const [updated] = await db
    .update(customDatasetsTable)
    .set({ name })
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "not_found", details: "Dataset not found" });
    return;
  }
  res.json(PatchUserDatasetsIdRenameResponse.parse(metaJson(updated)));
}));

// ── POST /user/datasets/:id/duplicate ──────────────────────────────────────
router.post("/user/datasets/:id/duplicate", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const [source] = await db
    .select()
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));
  if (!source) {
    res.status(404).json({ error: "not_found", details: "Dataset not found" });
    return;
  }

  const [created] = await db
    .insert(customDatasetsTable)
    .values({
      userId,
      name: `${source.name} (copy)`,
      minDepth: source.minDepth,
      maxDepth: source.maxDepth,
      terrainJson: source.terrainJson,
      overviewJson: source.overviewJson,
      folderId: source.folderId,
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "db_error", details: "Could not duplicate" });
    return;
  }

  // Rewrite the embedded `datasetId` so the duplicated row's grids identify
  // as the new row, not the source. The client's load path treats this id as
  // the source of truth and will rebrand on read, but stamping here keeps the
  // stored payload internally consistent for future tooling.
  const dupTerrain = {
    ...(source.terrainJson as unknown as Record<string, unknown>),
    datasetId: created.id,
  } as unknown as StoredTerrainJson;
  const dupOverview = {
    ...(source.overviewJson as unknown as Record<string, unknown>),
    datasetId: created.id,
  } as unknown as StoredTerrainJson;
  await db
    .update(customDatasetsTable)
    .set({ terrainJson: dupTerrain, overviewJson: dupOverview })
    .where(eq(customDatasetsTable.id, created.id));

  res.status(201).json(metaJson(created));
}));

// ── GET /user/datasets/:id/terrain ─────────────────────────────────────────
router.get("/user/datasets/:id/terrain", terrainFetchIpRateLimit, requireAuth, terrainFetchUserRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  // Size pre-check: read pg_column_size without loading the blob into Node.js
  // heap. A pathologically large blob (e.g. a dense 1024×1024 grid) would
  // spike heap twice (DB result + JSON.stringify) and could OOM the process
  // under concurrent load. Fail fast here before touching the full column.
  const [sizeRow] = await db
    .select({ size: sql<number>`pg_column_size(${customDatasetsTable.terrainJson})` })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!sizeRow) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  if (sizeRow.size > MAX_TERRAIN_JSON_BYTES) {
    console.warn(
      `[terrain] dataset ${id} terrain_json is ${sizeRow.size} bytes ` +
      `(limit ${MAX_TERRAIN_JSON_BYTES}) — returning 413`,
    );
    res.status(413).json({
      error: "payload_too_large",
      details: "Dataset is too large to load in the browser. Please contact support.",
    });
    return;
  }

  const [row] = await db
    .select({ terrainJson: customDatasetsTable.terrainJson })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!row) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  res.json(GetUserDatasetsIdTerrainResponse.parse(row.terrainJson));
}));

// ── GET /user/datasets/:id/overview ────────────────────────────────────────
router.get("/user/datasets/:id/overview", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const [row] = await db
    .select({ overviewJson: customDatasetsTable.overviewJson })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!row) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  res.json(GetUserDatasetsIdOverviewResponse.parse(row.overviewJson));
}));

// ── GET /user/datasets/:id/hyd93-features ──────────────────────────────────
router.get("/user/datasets/:id/hyd93-features", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const [row] = await db
    .select({ hyd93FeaturesJson: customDatasetsTable.hyd93FeaturesJson })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!row) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  // Return an empty array when the dataset has no HYD93 annotation features
  // (e.g. it was not sourced from an a93.gz archive, or contained no annotation rows).
  res.json(row.hyd93FeaturesJson ?? []);
}));

// ── DELETE /user/datasets/:id ───────────────────────────────────────────────
router.delete("/user/datasets/:id", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const deleted = await db
    .delete(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)))
    .returning({ id: customDatasetsTable.id });

  if (!deleted.length) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  res.status(204).send();
}));

export default router;
