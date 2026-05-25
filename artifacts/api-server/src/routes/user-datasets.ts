import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, customDatasetsTable } from "@workspace/db";
import {
  GetUserDatasetsResponse,
  GetUserDatasetsIdTerrainResponse,
  GetUserDatasetsIdOverviewResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";

const router = Router();

// ── GET /user/datasets ─────────────────────────────────────────────────────
router.get("/user/datasets", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const rows = await db
    .select({
      id: customDatasetsTable.id,
      name: customDatasetsTable.name,
      minDepth: customDatasetsTable.minDepth,
      maxDepth: customDatasetsTable.maxDepth,
      createdAt: customDatasetsTable.createdAt,
    })
    .from(customDatasetsTable)
    .where(eq(customDatasetsTable.userId, userId))
    .orderBy(desc(customDatasetsTable.createdAt));

  res.json(GetUserDatasetsResponse.parse(rows));
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
