/**
 * search-federated.ts — GET /search/federated
 *
 * Fans a Find Data search out to the local catalog plus all first-wave
 * external connectors (NCEI Geoportal, USGS ScienceBase, USGS 3DEP
 * coverage, seeded state ArcGIS portals, GitHub allowlist) concurrently
 * with a per-source timeout. Partial results merge; failed sources are
 * reported (non-fatally) in the `sources` summary.
 *
 * Public — no auth required (same posture as /ncei/search).
 */

import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, datasetCatalogTable, userCatalogSavesTable } from "@workspace/db";
import { FederatedSearchQuerySchema } from "@workspace/api-zod";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { validateBody } from "../middlewares/validateBody.js";
import { logger } from "../lib/logger.js";
import { registerCache } from "../lib/cacheRegistry.js";
import { invalidateCatalogCache, type CatalogSeedEntry } from "../lib/catalogSeeder.js";
import { materializeSave, formatSaveRow } from "./catalog-saves.js";
import {
  runFederatedSearch,
  listFederatedSources,
  deriveImportability,
  type FederatedBbox,
  type FederatedSearchResponse,
} from "../lib/federatedSearch/index.js";

const router = Router();

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  response: FederatedSearchResponse;
  expiry: number;
}

const responseCache = new Map<string, CacheEntry>();
registerCache(() => responseCache.clear());

const FederatedResponseShape = z.object({
  results: z.array(
    z.object({
      id: z.string().min(1),
      sourceId: z.string().min(1),
      sourceLabel: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullable(),
      url: z.string().nullable(),
      endpointUrl: z.string().nullable(),
      coverageBbox: z
        .object({
          minLon: z.number(),
          minLat: z.number(),
          maxLon: z.number(),
          maxLat: z.number(),
        })
        .nullable(),
      resolutionMMin: z.number().nullable(),
      resolutionMMax: z.number().nullable(),
      importable: z.boolean(),
      importKind: z.string().nullable(),
    }),
  ),
  sources: z.array(
    z.object({
      sourceId: z.string().min(1),
      label: z.string().min(1),
      status: z.enum(["ok", "error", "timeout"]),
      resultCount: z.number().int().min(0),
      tookMs: z.number().min(0),
      error: z.string().nullable(),
    }),
  ),
});

function parseBbox(bbox: string): FederatedBbox | null {
  if (!bbox) return null;
  const [minLon, minLat, maxLon, maxLat] = bbox.split(",").map((p) => parseFloat(p));
  if (
    minLon === undefined || minLat === undefined ||
    maxLon === undefined || maxLat === undefined ||
    !isFinite(minLon) || !isFinite(minLat) || !isFinite(maxLon) || !isFinite(maxLat)
  ) {
    return null;
  }
  return { minLon, minLat, maxLon, maxLat };
}

router.get("/search/federated", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = FederatedSearchQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: queryParsed.error.issues
        .map((i) => `${i.path.join(".") || "query"}: ${i.message}`)
        .join("; "),
    });
    return;
  }
  const q = queryParsed.data.q.trim();
  const bbox = parseBbox(queryParsed.data.bbox);

  if (!q && !bbox) {
    res.status(400).json({
      error: "invalid_params",
      details: "Provide a search query (q) and/or a bbox",
    });
    return;
  }

  const sourceIds = queryParsed.data.sources
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const cacheKey = `${q.toLowerCase()}|${queryParsed.data.bbox.trim()}|${[...sourceIds].sort().join(",")}`;
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() <= cached.expiry) {
    res.json(cached.response);
    return;
  }
  if (cached) responseCache.delete(cacheKey);

  const response = await runFederatedSearch(q, bbox, { sourceIds });

  responseCache.set(cacheKey, { response, expiry: Date.now() + CACHE_TTL_MS });

  const _rp = FederatedResponseShape.safeParse(response);
  if (!_rp.success) {
    logger.warn({ err: _rp.error }, "GET /api/search/federated — response shape mismatch");
  }
  res.json(response);
}));

// ---------------------------------------------------------------------------
// GET /search/federated/sources — static connector registry (public)
// ---------------------------------------------------------------------------
// Lets the client fan out one request per source so partial results render
// as each source finishes, instead of waiting on the slowest upstream.

router.get("/search/federated/sources", asyncHandler(async (_req, res): Promise<void> => {
  res.json({ sources: listFederatedSources() });
}));

// ---------------------------------------------------------------------------
// POST /search/federated/save — save any importable federated result
// ---------------------------------------------------------------------------

const FederatedSaveResultSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  sourceLabel: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  endpointUrl: z.string().nullable().optional(),
  coverageBbox: z
    .object({
      minLon: z.number().finite(),
      minLat: z.number().finite(),
      maxLon: z.number().finite(),
      maxLat: z.number().finite(),
    })
    .nullable()
    .optional(),
  resolutionMMin: z.number().nullable().optional(),
  resolutionMMax: z.number().nullable().optional(),
});

const FederatedSaveBodySchema = z.object({
  result: FederatedSaveResultSchema,
});

/** Sanitize a federated result id into a URL/DB-safe slug segment. */
function sanitizeFederatedId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9:.-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

router.post(
  "/search/federated/save",
  requireAuth,
  validateBody(FederatedSaveBodySchema, "POST /api/search/federated/save"),
  asyncHandler(async (req, res): Promise<void> => {
    const userId = (req as AuthenticatedRequest).clerkUserId;
    const r = res.locals.parsedBody.result as z.infer<typeof FederatedSaveResultSchema>;

    const coverageBbox = r.coverageBbox ?? null;
    const endpointUrl = r.endpointUrl ?? null;

    // Never trust a client-supplied importable flag: re-derive the fetch
    // strategy server-side from the endpoint URL + bbox (the same single
    // source of truth the search results use for the badge).
    const upstreamId = r.id.includes(":") ? r.id.slice(r.id.indexOf(":") + 1) : r.id;
    const { importable, importKind } = deriveImportability({
      id: upstreamId,
      endpointUrl,
      coverageBbox,
    });
    if (!importable || !coverageBbox) {
      res.status(400).json({
        error: "not_importable",
        details:
          "This result is link-only — BathyScan has no fetcher for its endpoint, so it cannot be materialized as 3D terrain",
      });
      return;
    }

    const catalogId = `fed-${sanitizeFederatedId(r.id)}`;
    const saltwaterKinds = new Set(["ncei-wcs", "gebco-wcs"]);
    const entry: CatalogSeedEntry = {
      id: catalogId,
      name: r.name,
      sourceAgency: r.sourceLabel,
      dataType: "bathymetry",
      resolutionMMin: r.resolutionMMin ?? null,
      resolutionMMax: r.resolutionMMax ?? null,
      coverageBbox,
      endpointUrl,
      accessNotes: `Discovered via federated search (${r.sourceLabel})`,
      description: r.description ?? null,
      keywords: `federated,${r.sourceId},bathymetry`,
      lastUpdated: null,
      waterType: saltwaterKinds.has(importKind ?? "") ? "saltwater" : "freshwater",
    };

    // Upsert into dataset_catalog so retry + getCatalogEntries() can resolve
    // this catalogId in future requests (same pattern as POST /ncei/save).
    await db
      .insert(datasetCatalogTable)
      .values({
        id: catalogId,
        name: entry.name,
        sourceAgency: entry.sourceAgency,
        dataType: entry.dataType,
        resolutionMMin: entry.resolutionMMin,
        resolutionMMax: entry.resolutionMMax,
        coverageBbox: entry.coverageBbox as Record<string, number>,
        endpointUrl: entry.endpointUrl,
        accessNotes: entry.accessNotes,
        description: entry.description,
        keywords: entry.keywords,
        lastUpdated: entry.lastUpdated,
        waterType: entry.waterType,
      })
      .onConflictDoUpdate({
        target: datasetCatalogTable.id,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          coverageBbox: sql`excluded.coverage_bbox`,
          endpointUrl: sql`excluded.endpoint_url`,
        },
      });

    invalidateCatalogCache();

    // Idempotent: return the existing save if one already exists.
    const existing = await db
      .select()
      .from(userCatalogSavesTable)
      .where(
        and(
          eq(userCatalogSavesTable.userId, userId),
          eq(userCatalogSavesTable.catalogId, catalogId),
        ),
      );

    if (existing.length > 0 && existing[0]) {
      res.status(200).json(formatSaveRow(existing[0], entry));
      return;
    }

    const [created] = await db
      .insert(userCatalogSavesTable)
      .values({ userId, catalogId, status: "processing" })
      .returning();

    if (!created) {
      res.status(500).json({ error: "db_error", details: "Failed to create save record" });
      return;
    }

    void materializeSave(created.id, userId, entry);

    res.status(201).json(formatSaveRow(created, entry));
  }),
);

export default router;
