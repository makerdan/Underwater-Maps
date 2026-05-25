import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, markersTable } from "@workspace/db";
import { PostMarkersBody, DeleteMarkersIdParams, GetMarkersQueryParams } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";


const router = Router();

router.get("/markers", async (req, res): Promise<void> => {
  const parsed = GetMarkersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "datasetId query parameter is required" });
    return;
  }

  const { datasetId } = parsed.data;
  const rows = await db
    .select()
    .from(markersTable)
    .where(eq(markersTable.datasetId, datasetId))
    .orderBy(markersTable.createdAt);

  res.json(rows);
});

router.post("/markers", requireAuth, async (req, res): Promise<void> => {
  const parsed = PostMarkersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.message });
    return;
  }

  const { datasetId, lon, lat, depth, type = "custom", label, notes } = parsed.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const [created] = await db
    .insert(markersTable)
    .values({ datasetId, lon, lat, depth, type, label, notes: notes ?? null, userId })
    .returning();

  res.status(201).json(created);
});

router.delete("/markers/mine", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const deleted = await db
    .delete(markersTable)
    .where(eq(markersTable.userId, userId))
    .returning({ id: markersTable.id });

  res.json({ deleted: deleted.length });
});

router.delete("/markers/:id", requireAuth, async (req, res): Promise<void> => {
  const parsed = DeleteMarkersIdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid marker id" });
    return;
  }

  const { id } = parsed.data;
  const deleted = await db
    .delete(markersTable)
    .where(eq(markersTable.id, id))
    .returning({ id: markersTable.id });

  if (!deleted.length) {
    res.status(404).json({ error: "not_found", details: `Marker '${id}' not found` });
    return;
  }

  res.status(204).send();
});

export default router;
