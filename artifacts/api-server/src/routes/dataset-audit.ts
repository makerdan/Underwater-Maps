import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, customDatasetsTable } from "@workspace/db";
import {
  GetDatasetsIdAuditResponse,
  GetUserDatasetsIdAuditResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { validateResponse } from "../middlewares/validateResponse.js";
import { auditDatasetIntegrity, type DatasetAuditOptions } from "../lib/datasetIntegrityAudit.js";
import { ALL_PRESET_DATASETS, buildTerrainGrid, NoDataError } from "../lib/terrain.js";
import { DatasetIdParamSchema } from "./schemas.js";

const PublicDatasetIdParamSchema = z
  .string()
  .min(1, "Dataset id is required")
  .max(128, "Dataset id must be at most 128 characters")
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
    "Dataset id must start with an alphanumeric character and contain only alphanumeric characters, hyphens, or underscores",
  );

const DATASET_AUDIT_SOURCES = new Set([
  "ncei",
  "gebco",
  "twdb",
  "usace",
  "usgs-3dep",
  "usgs-sciencebase",
  "noaa-great-lakes",
  "nysdec",
  "mn-dnr",
]);

type AuditRecord = Record<string, unknown>;

function asRecord(value: unknown): AuditRecord {
  return typeof value === "object" && value !== null
    ? value as AuditRecord
    : Object.create(null) as AuditRecord;
}

function copyIfPresent(target: AuditRecord, source: AuditRecord, key: string): void {
  if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
}

/**
 * Keep the report boundary deliberately smaller than the stored terrain
 * boundary.  In particular, credit URLs, endpoint URLs, object paths, and
 * arbitrary nested source metadata must never become report evidence.
 */
function safeAuditInput(raw: unknown, datasetId: string): AuditRecord {
  const source = asRecord(raw);
  const safe: AuditRecord = { datasetId };

  for (const key of [
    "width",
    "height",
    "depths",
    "topography",
    "bbox",
    "minLon",
    "maxLon",
    "minLat",
    "maxLat",
    "centerLon",
    "centerLat",
    "minDepth",
    "maxDepth",
    "nodata",
    "noData",
    "nodataValue",
    "noDataValue",
    "nodataValues",
    "orientation",
    "rowOrder",
    "servedOrientation",
    "sourceOrientation",
    "sourceRowOrder",
    "crs",
    "coordinateReferenceSystem",
    "servedCrs",
    "sourceCrs",
    "sourceCoordinateReferenceSystem",
  ]) {
    copyIfPresent(safe, source, key);
  }

  for (const key of ["dataSource", "bathymetrySource", "topographySource"]) {
    const value = source[key];
    if (typeof value === "string" && DATASET_AUDIT_SOURCES.has(value)) {
      safe[key] = value;
    }
  }

  return safe;
}

function auditOptions(raw: unknown): DatasetAuditOptions {
  const source = asRecord(raw);
  const hasServedOrientation = source.orientation !== undefined ||
    source.rowOrder !== undefined ||
    source.servedOrientation !== undefined;
  const hasServedCrs = source.crs !== undefined ||
    source.coordinateReferenceSystem !== undefined ||
    source.servedCrs !== undefined;
  const hasSourceOrientation = source.sourceOrientation !== undefined ||
    source.sourceRowOrder !== undefined;
  const hasSourceCrs = source.sourceCrs !== undefined ||
    source.sourceCoordinateReferenceSystem !== undefined;

  return {
    artifactKind: "served",
    // Stored and built-in grids use the canonical geographic frame unless a
    // record explicitly declares a different frame. Explicit bad metadata
    // must remain visible to the auditor.
    ...(hasServedOrientation
      ? {}
      : { servedOrientation: { row0: "south", columns: "west-to-east" } }),
    ...(hasServedCrs ? {} : { servedCrs: "EPSG:4326" }),
    ...(hasSourceOrientation
      ? {}
      : { sourceOrientation: { row0: "south", columns: "west-to-east" } }),
    ...(hasSourceCrs ? {} : { sourceCrs: "EPSG:4326" }),
  };
}

function reportFor(raw: unknown, datasetId: string) {
  return auditDatasetIntegrity(
    safeAuditInput(raw, datasetId),
    auditOptions(raw),
  );
}

function invalidDatasetId(res: import("express").Response, route: string, rawId: unknown): boolean {
  const parsed = DatasetIdParamSchema.safeParse(rawId);
  if (parsed.success) return false;
  res.status(400).json({
    error: "invalid_param",
    details: parsed.error.issues[0]?.message ?? `Invalid dataset id for ${route}`,
  });
  return true;
}

export const publicDatasetAuditRouter = Router();
export const userDatasetAuditRouter = Router();

// ── GET /datasets/:id/audit ───────────────────────────────────────────────────
// Only the public built-in registry is reachable from this route. UUID-backed
// datasets must use the authenticated owner route below, preventing this
// endpoint from becoming an ownership or existence oracle.
publicDatasetAuditRouter.get("/datasets/:id/audit", asyncHandler(async (req, res): Promise<void> => {
  const parsed = PublicDatasetIdParamSchema.safeParse(req.params["id"]);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_param",
      details: parsed.error.issues[0]?.message ?? "Invalid dataset id",
    });
    return;
  }
  const id = String(req.params["id"]);
  if (!ALL_PRESET_DATASETS.some((dataset) => dataset.id === id)) {
    res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
    return;
  }

  let terrain;
  try {
    terrain = await buildTerrainGrid(id, 256);
  } catch (error) {
    if (error instanceof NoDataError) {
      res.status(503).json({ error: "no_data", details: error.message });
      return;
    }
    throw error;
  }
  if (!terrain) {
    res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
    return;
  }

  res.json(validateResponse(
    GetDatasetsIdAuditResponse,
    reportFor(terrain, id),
    "GET /api/datasets/:id/audit",
  ));
}));

// ── GET /user/datasets/:id/audit ──────────────────────────────────────────────
userDatasetAuditRouter.get("/user/datasets/:id/audit", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  if (invalidDatasetId(res, "GET /api/user/datasets/:id/audit", req.params["id"])) return;
  const id = String(req.params["id"]);
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const [row] = await db
    .select({ terrainJson: customDatasetsTable.terrainJson })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!row) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  // Do not run StoredTerrainJsonSchema here: the purpose of this endpoint is
  // to explain malformed stored terrain as a blocked report rather than hide
  // the finding behind a generic schema failure.
  res.json(validateResponse(
    GetUserDatasetsIdAuditResponse,
    reportFor(row.terrainJson, id),
    "GET /api/user/datasets/:id/audit",
  ));
}));

export default publicDatasetAuditRouter;