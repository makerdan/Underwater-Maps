import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, customDatasetsTable, datasetFoldersTable } from "@workspace/db";
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

const router = Router();

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
router.get("/user/datasets", requireAuth, async (req, res): Promise<void> => {
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
});

// ── PATCH /user/datasets/:id/move ──────────────────────────────────────────
router.patch("/user/datasets/:id/move", requireAuth, async (req, res): Promise<void> => {
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
});

// ── PATCH /user/datasets/:id/rename ────────────────────────────────────────
router.patch("/user/datasets/:id/rename", requireAuth, async (req, res): Promise<void> => {
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
});

// ── POST /user/datasets/:id/duplicate ──────────────────────────────────────
router.post("/user/datasets/:id/duplicate", requireAuth, async (req, res): Promise<void> => {
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
      terrainJson: source.terrainJson as Record<string, unknown>,
      overviewJson: source.overviewJson as Record<string, unknown>,
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
    ...(source.terrainJson as Record<string, unknown>),
    datasetId: created.id,
  };
  const dupOverview = {
    ...(source.overviewJson as Record<string, unknown>),
    datasetId: created.id,
  };
  await db
    .update(customDatasetsTable)
    .set({ terrainJson: dupTerrain, overviewJson: dupOverview })
    .where(eq(customDatasetsTable.id, created.id));

  res.status(201).json(metaJson(created));
});

// ── GET /user/datasets/:id/terrain ─────────────────────────────────────────
router.get("/user/datasets/:id/terrain", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const [row] = await db
    .select({ terrainJson: customDatasetsTable.terrainJson })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!row) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  res.json(GetUserDatasetsIdTerrainResponse.parse(row.terrainJson));
});

// ── GET /user/datasets/:id/overview ────────────────────────────────────────
router.get("/user/datasets/:id/overview", requireAuth, async (req, res): Promise<void> => {
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
});

// ── DELETE /user/datasets/:id ───────────────────────────────────────────────
router.delete("/user/datasets/:id", requireAuth, async (req, res): Promise<void> => {
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
});

export default router;
