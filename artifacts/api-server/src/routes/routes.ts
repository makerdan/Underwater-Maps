import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, routesTable } from "@workspace/db";
import {
  GetRoutesQuerySchema,
  PostRouteBodySchema,
  RouteIdParamSchema,
  PatchRouteBodySchema,
  GetRoutesResponse,
  GetRoutesResponseItem,
  PatchRouteResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody, validateQuery, validateParams } from "../middlewares/validateBody.js";
import { validateResponse } from "../middlewares/validateResponse.js";
import { logger } from "../lib/logger.js";
import { dataMutationRateLimit } from "../middlewares/dataMutationRateLimit.js";

const router = Router();

// GET /routes?datasetId=
router.get("/routes", requireAuth, validateQuery(GetRoutesQuerySchema, "GET /api/routes", { details: "datasetId query parameter is required" }), asyncHandler(async (req, res): Promise<void> => {
  const { datasetId } = res.locals.parsedQuery;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const rows = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.userId, userId), eq(routesTable.datasetId, datasetId)))
    .orderBy(routesTable.createdAt);

  res.json(validateResponse(GetRoutesResponse, rows, "GET /api/routes"));
}));

router.post("/routes", requireAuth, dataMutationRateLimit, validateBody(PostRouteBodySchema, "POST /api/routes"), asyncHandler(async (req, res): Promise<void> => {
  const { datasetId, name, waypoints, totalDistanceM } = res.locals.parsedBody;
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

  if (!created) {
    logger.error({ userId, datasetId }, "POST /api/routes: insert returned no rows");
    res.status(500).json({ error: "internal_error", details: "Route could not be created" });
    return;
  }

  res.status(201).json(validateResponse(GetRoutesResponseItem, created, "POST /api/routes"));
}));

// PATCH /routes/:id
router.patch("/routes/:id", requireAuth, dataMutationRateLimit, validateParams(RouteIdParamSchema, "PATCH /api/routes/:id", { details: "Invalid route id" }), validateBody(PatchRouteBodySchema, "PATCH /api/routes/:id"), asyncHandler(async (req, res): Promise<void> => {
  const { id } = res.locals.parsedParams;
  const { name } = res.locals.parsedBody;
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

  res.json(validateResponse(PatchRouteResponse, updated, "PATCH /api/routes/:id"));
}));

// DELETE /routes/:id
router.delete("/routes/:id", requireAuth, dataMutationRateLimit, validateParams(RouteIdParamSchema, "DELETE /api/routes/:id", { details: "Invalid route id" }), asyncHandler(async (req, res): Promise<void> => {
  const { id } = res.locals.parsedParams;
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
