/**
 * /api/me — account-level operations: data export and account deletion.
 *
 * Used by the Settings → Account & Privacy section.
 */
import { Router } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  userSettingsTable,
  markersTable,
  customDatasetsTable,
  gpsTrailsTable,
  gpsTrailPointsTable,
} from "@workspace/db";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";

const router = Router();

const GetMeExportQuerySchema = z.object({}).strict();
const DeleteMeQuerySchema = z.object({}).strict();

router.get("/me/export", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const qParsed = GetMeExportQuerySchema.safeParse(req.query);
  if (!qParsed.success) {
    res.status(400).json({ error: "invalid_params", details: "No query parameters are accepted on this endpoint." });
    return;
  }
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const [settingsRow] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId));

  const markers = await db
    .select()
    .from(markersTable)
    .where(eq(markersTable.userId, userId));

  const datasets = await db
    .select()
    .from(customDatasetsTable)
    .where(eq(customDatasetsTable.userId, userId));

  const trails = await db
    .select()
    .from(gpsTrailsTable)
    .where(eq(gpsTrailsTable.userId, userId));

  // For each trail, fetch its points (small loop is fine; users typically have few trails).
  const trailsWithPoints = await Promise.all(
    trails.map(async (t) => {
      const points = await db
        .select()
        .from(gpsTrailPointsTable)
        .where(eq(gpsTrailPointsTable.trailId, t.id));
      return { ...t, points };
    }),
  );

  const payload = {
    exportedAt: new Date().toISOString(),
    userId,
    settings: settingsRow?.settings ?? null,
    markers,
    customDatasets: datasets.map((d) => ({
      id: d.id,
      name: d.name,
      minDepth: d.minDepth,
      maxDepth: d.maxDepth,
      createdAt: d.createdAt,
    })),
    trails: trailsWithPoints,
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="bathyscan-export-${Date.now()}.json"`,
  );
  res.json(payload);
}));

router.delete("/me", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const qParsed = DeleteMeQuerySchema.safeParse(req.query);
  if (!qParsed.success) {
    res.status(400).json({ error: "invalid_params", details: "No query parameters are accepted on this endpoint." });
    return;
  }
  const userId = (req as AuthenticatedRequest).clerkUserId;

  // Order matters: trail points cascade via FK; explicit deletes for safety.
  const userTrails = await db
    .select({ id: gpsTrailsTable.id })
    .from(gpsTrailsTable)
    .where(eq(gpsTrailsTable.userId, userId));

  if (userTrails.length > 0) {
    await db
      .delete(gpsTrailPointsTable)
      .where(inArray(gpsTrailPointsTable.trailId, userTrails.map((t) => t.id)));
  }
  await db.delete(gpsTrailsTable).where(eq(gpsTrailsTable.userId, userId));
  await db.delete(markersTable).where(eq(markersTable.userId, userId));
  await db.delete(customDatasetsTable).where(eq(customDatasetsTable.userId, userId));
  await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, userId));

  res.json({ ok: true, deletedAt: new Date().toISOString() });
}));

export default router;
