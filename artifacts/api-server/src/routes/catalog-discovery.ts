/**
 * Public catalog discovery routes.
 *
 * GET  /api/datasets/catalog           — list all catalog entries
 * GET  /api/datasets/catalog/search    — keyword + filter search
 * POST /api/datasets/bbox-query         — catalog coverage intersection
 * POST /api/datasets/point-radius-query — catalog coverage near a point
 */

import { Router } from "express";
import { z } from "zod";
import { CatalogSearchQuerySchema } from "./schemas.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody } from "../middlewares/validateBody.js";
import { validateResponse } from "../middlewares/validateResponse.js";
import {
  GetDatasetsCatalogResponse,
  GetDatasetsCatalogSearchResponse,
  PostDatasetsBboxQueryResponse,
  PostDatasetsPointRadiusQueryResponse,
} from "@workspace/api-zod";
import {
  catalogService,
  type CatalogSeedEntry,
} from "../domains/catalog-search/catalog-service.js";
import { createRateLimit } from "../middlewares/rateLimit.js";

const router = Router();

// ---------------------------------------------------------------------------
// Per-IP rate limit for public catalog read endpoints (no auth required).
// 60 requests/minute per IP — generous enough for legitimate browsing but
// finite enough to deter unauthenticated enumeration scrapers.
// ---------------------------------------------------------------------------

export const CATALOG_READ_ROUTE = "catalog-read";
export const CATALOG_READ_WINDOW_MS = 60_000;
export const CATALOG_READ_MAX = 60;

const catalogReadRateLimit = createRateLimit({
  route: CATALOG_READ_ROUTE,
  windowMs: CATALOG_READ_WINDOW_MS,
  max: CATALOG_READ_MAX,
  mode: "ip",
});

/**
 * Extract the real created date from a catalog entry. Rows loaded from the DB
 * carry a `created_at` timestamp (Date at runtime) even though the
 * CatalogSeedEntry interface doesn't declare it.
 */
export function entryCreatedAtIso(entry: CatalogSeedEntry): string | undefined {
  const raw = (entry as CatalogSeedEntry & { createdAt?: Date | string }).createdAt;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "string") return raw;
  return undefined;
}

export function toCatalogResponse(entry: CatalogSeedEntry, createdAt?: string) {
  return {
    id: entry.id,
    name: entry.name,
    sourceAgency: entry.sourceAgency,
    dataType: entry.dataType,
    resolutionMMin: entry.resolutionMMin ?? null,
    resolutionMMax: entry.resolutionMMax ?? null,
    coverageBbox: entry.coverageBbox,
    endpointUrl: entry.endpointUrl ?? null,
    accessNotes: entry.accessNotes ?? null,
    description: entry.description ?? null,
    keywords: entry.keywords ?? null,
    lastUpdated: entry.lastUpdated ?? null,
    waterType: entry.waterType,
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /datasets/catalog
// ---------------------------------------------------------------------------

router.get("/datasets/catalog", catalogReadRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const rawDataType = req.query["dataType"] as string | undefined;
  const rawWaterType = req.query["waterType"] as string | undefined;

  const entries = await catalogService.getEntries();

  const filtered = entries.filter((e) => {
    if (rawDataType && e.dataType !== rawDataType) return false;
    if (rawWaterType && e.waterType !== rawWaterType) return false;
    return true;
  });

  res.json(validateResponse(GetDatasetsCatalogResponse, filtered.map((e) => toCatalogResponse(e, entryCreatedAtIso(e))), "GET /api/datasets/catalog"));
}));

// ---------------------------------------------------------------------------
// GET /datasets/catalog/search
// ---------------------------------------------------------------------------

router.get("/datasets/catalog/search", catalogReadRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = CatalogSearchQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({
      error: "invalid_param",
      details: queryParsed.error.issues[0]?.message ?? "Invalid query parameter",
    });
    return;
  }
  const { dataType, waterType, minLon, minLat, maxLon, maxLat } = queryParsed.data;

  const results = await catalogService.search({
    dataType,
    waterType,
    minLon,
    minLat,
    maxLon,
    maxLat,
  });
  res.json(
    validateResponse(
      GetDatasetsCatalogSearchResponse,
      results.map((r) => ({
        ...toCatalogResponse(r, r.createdAt),
        relevanceScore: r.relevanceScore,
      })),
      "GET /api/datasets/catalog/search",
    ),
  );
}));

// ---------------------------------------------------------------------------
// POST /datasets/bbox-query
// ---------------------------------------------------------------------------

const BboxQueryBody = z.object({
  north: z.number().finite(),
  south: z.number().finite(),
  east: z.number().finite(),
  west: z.number().finite(),
  dataType: z.enum(["bathymetry", "substrate", "habitat", "lidar", "chart"]).optional(),
  waterType: z.enum(["saltwater", "freshwater"]).optional(),
});

function normalizeLon(lon: number): number {
  if (lon > -180 && lon <= 180) return lon;
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

const MIN_BBOX_DEG = 1e-4;
const MAX_BBOX_LON_DEG = 180;
const MAX_BBOX_LAT_DEG = 170;

router.post("/datasets/bbox-query", catalogReadRateLimit, validateBody(BboxQueryBody, "POST /api/datasets/bbox-query"), asyncHandler(async (req, res): Promise<void> => {
  const { dataType, waterType, north, south, east, west } = res.locals.parsedBody;

  if (east - west > MAX_BBOX_LON_DEG) {
    res.status(400).json({
      error: "invalid_bbox",
      details: `bbox is too large — longitude span must not exceed ${MAX_BBOX_LON_DEG}°`,
    });
    return;
  }
  if (east > 180 || west < -180) {
    res.status(400).json({
      error: "invalid_bbox",
      details: "search circle crosses the antimeridian (antimeridian-crossing queries are not supported)",
    });
    return;
  }

  if (north > 90 || north < -90) {
    res.status(422).json({
      error: "validation_error",
      field: "north",
      message: "north must be a finite latitude between -90 and 90",
    });
    return;
  }
  if (south < -90 || south > 90) {
    res.status(422).json({
      error: "validation_error",
      field: "south",
      message: "south must be a finite latitude between -90 and 90",
    });
    return;
  }

  if (east <= west) {
    res.status(400).json({
      error: "invalid_bbox",
      details: "east must be greater than west (antimeridian-crossing queries are not supported)",
    });
    return;
  }
  if (north <= south) {
    res.status(400).json({
      error: "invalid_bbox",
      details: "north must be greater than south",
    });
    return;
  }
  if (north - south < MIN_BBOX_DEG || east - west < MIN_BBOX_DEG) {
    res.status(400).json({
      error: "invalid_bbox",
      details: `bbox has (near-)zero area — each side must span at least ${MIN_BBOX_DEG}°`,
    });
    return;
  }
  if (north - south > MAX_BBOX_LAT_DEG) {
    res.status(400).json({
      error: "invalid_bbox",
      details: `bbox is too large — latitude span must not exceed ${MAX_BBOX_LAT_DEG}°`,
    });
    return;
  }

  const results = await catalogService.search({
    dataType,
    waterType,
    minLon: west,
    minLat: south,
    maxLon: east,
    maxLat: north,
  });
  res.json(validateResponse(PostDatasetsBboxQueryResponse, {
    bbox: { north, south, east, west },
    datasets: results.map((r) => ({
      ...toCatalogResponse(r, r.createdAt),
      relevanceScore: r.relevanceScore,
    })),
  }, "POST /api/datasets/bbox-query"));
}));

// ---------------------------------------------------------------------------
// POST /datasets/point-radius-query
// ---------------------------------------------------------------------------

const PointRadiusQueryBody = z.object({
  lat: z.number().finite(),
  lon: z.number().finite(),
  radius: z.number().finite(),
  unit: z.enum(["km", "nmi"]).optional().default("km"),
  dataType: z.enum(["bathymetry", "substrate", "habitat", "lidar", "chart"]).optional(),
  waterType: z.enum(["saltwater", "freshwater"]).optional(),
});

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQUATOR = 111.32;
const KM_PER_NMI = 1.852;
const MIN_RADIUS_KM = (MIN_BBOX_DEG / 2) * KM_PER_DEG_LAT;
const MAX_RADIUS_KM = (MAX_BBOX_LAT_DEG / 2) * KM_PER_DEG_LAT;

router.post("/datasets/point-radius-query", catalogReadRateLimit, validateBody(PointRadiusQueryBody, "POST /api/datasets/point-radius-query"), asyncHandler(async (req, res): Promise<void> => {
  const { dataType, waterType, unit, lat, lon: rawLon, radius: rawRadius } = res.locals.parsedBody;
  const lon = normalizeLon(rawLon);
  const radiusKm = unit === "nmi" ? rawRadius * KM_PER_NMI : rawRadius;

  if (lat < -90 || lat > 90) {
    res.status(400).json({ error: "invalid_point", details: "lat must be between -90 and 90" });
    return;
  }
  if (radiusKm < MIN_RADIUS_KM) {
    res.status(400).json({
      error: "invalid_radius",
      details: `radius too small (min ${MIN_RADIUS_KM.toFixed(4)} km)`,
    });
    return;
  }
  if (radiusKm > MAX_RADIUS_KM) {
    res.status(400).json({
      error: "invalid_radius",
      details: `radius too large (max ${Math.floor(MAX_RADIUS_KM)} km)`,
    });
    return;
  }

  const latDelta = radiusKm / KM_PER_DEG_LAT;
  const kmPerDegLon = KM_PER_DEG_LON_EQUATOR * Math.cos((lat * Math.PI) / 180);
  const lonDelta = kmPerDegLon > 0 ? radiusKm / kmPerDegLon : Infinity;

  const north = Math.min(90, lat + latDelta);
  const south = Math.max(-90, lat - latDelta);
  const east = lon + lonDelta;
  const west = lon - lonDelta;

  if (!isFinite(lonDelta) || east - west > MAX_BBOX_LON_DEG) {
    res.status(400).json({
      error: "invalid_radius",
      details: `radius spans more than ${MAX_BBOX_LON_DEG}° of longitude at this latitude — reduce the radius or move away from the pole`,
    });
    return;
  }
  if (east > 180 || west < -180) {
    res.status(400).json({
      error: "invalid_bbox",
      details: "search circle crosses the antimeridian (antimeridian-crossing queries are not supported)",
    });
    return;
  }

  const results = await catalogService.search({
    dataType,
    waterType,
    minLon: west,
    minLat: south,
    maxLon: east,
    maxLat: north,
  });
  res.json(validateResponse(PostDatasetsPointRadiusQueryResponse, {
    center: { lat, lon },
    radiusKm,
    bbox: { north, south, east, west },
    datasets: results.map((r) => ({
      ...toCatalogResponse(r, r.createdAt),
      relevanceScore: r.relevanceScore,
    })),
  }, "POST /api/datasets/point-radius-query"));
}));

export default router;