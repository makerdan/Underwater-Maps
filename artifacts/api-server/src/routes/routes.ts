import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, routesTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";

const router = Router();

const RouteWaypointSchema = z.object({
  lon: z.number(),
  lat: z.number(),
  depth: z.number(),
});

const GetRoutesQuerySchema = z.object({
  datasetId: z.string().min(1),
});

const PostRouteBodySchema = z.object({
  datasetId: z.string().min(1),
  name: z.string().min(1).max(120),
  waypoints: z.array(RouteWaypointSchema).min(2).max(20),
  totalDistanceM: z.number().min(0),
});

const RouteIdParamSchema = z.object({
  id: z.string().uuid(),
});

const PatchRouteBodySchema = z.object({
  name: z.string().min(1).max(120),
});

// GET /routes?datasetId=
router.get("/routes", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = GetRoutesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "datasetId query parameter is required" });
    return;
  }

  const { datasetId } = parsed.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const rows = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.userId, userId), eq(routesTable.datasetId, datasetId)))
    .orderBy(routesTable.createdAt);

  res.json(rows);
}));

router.post("/routes", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = PostRouteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.message });
    return;
  }

  const { datasetId, name, waypoints, totalDistanceM } = parsed.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const [created] = await db
    .insert(routesTable)
    .values({
      userId,
      datasetId,
      name,
      waypoints,
      waypointCount: waypoints.length,
      totalDistanceM,
    })
    .returning();

  res.status(201).json(created);
}));

// PATCH /routes/:id
router.patch("/routes/:id", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const params = RouteIdParamSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid route id" });
    return;
  }
  const body = PatchRouteBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid_request", details: body.error.message });
    return;
  }

  const { id } = params.data;
  const { name } = body.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const [updated] = await db
    .update(routesTable)
    .set({ name })
    .where(and(eq(routesTable.id, id), eq(routesTable.userId, userId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "not_found", details: `Route '${id}' not found` });
    return;
  }

  res.json(updated);
}));

// DELETE /routes/:id
router.delete("/routes/:id", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = RouteIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid route id" });
    return;
  }

  const { id } = parsed.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const deleted = await db
    .delete(routesTable)
    .where(and(eq(routesTable.id, id), eq(routesTable.userId, userId)))
    .returning({ id: routesTable.id });

  if (!deleted.length) {
    res.status(404).json({ error: "not_found", details: `Route '${id}' not found` });
    return;
  }

  res.status(204).send();
}));

export default router;
