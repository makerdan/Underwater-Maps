import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, trollingPresetsTable } from "@workspace/db";
import {
  PostTrollingPresetsBody,
  DeleteTrollingPresetsIdParams,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router = Router();

router.get("/trolling-presets", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const rows = await db
    .select()
    .from(trollingPresetsTable)
    .where(eq(trollingPresetsTable.userId, userId))
    .orderBy(trollingPresetsTable.createdAt);
  res.json(rows);
});

router.post("/trolling-presets", requireAuth, async (req, res): Promise<void> => {
  const parsed = PostTrollingPresetsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.message });
    return;
  }
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { name, headingDeg, speedKnots, startLat, startLon, waypoints } = parsed.data;

  const [created] = await db
    .insert(trollingPresetsTable)
    .values({
      userId,
      name,
      headingDeg,
      speedKnots,
      startLat: startLat ?? null,
      startLon: startLon ?? null,
      waypoints: waypoints ?? [],
    })
    .returning();

  res.status(201).json(created);
});

router.delete("/trolling-presets/:id", requireAuth, async (req, res): Promise<void> => {
  const parsed = DeleteTrollingPresetsIdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid preset id" });
    return;
  }
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { id } = parsed.data;

  const deleted = await db
    .delete(trollingPresetsTable)
    .where(and(eq(trollingPresetsTable.id, id), eq(trollingPresetsTable.userId, userId)))
    .returning({ id: trollingPresetsTable.id });

  if (!deleted.length) {
    res.status(404).json({ error: "not_found", details: `Preset '${id}' not found` });
    return;
  }

  res.status(204).send();
});

export default router;
