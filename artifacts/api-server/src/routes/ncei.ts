/**
 * ncei.ts — NCEI Bathymetry Geoportal search proxy
 *
 * NCEI Geoportal REST Search API (used by ncei.noaa.gov/maps/bathymetry/)
 * -------------------------------------------------------------------------
 * Endpoint: https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/search
 * Method:   GET
 *
 * Query parameters forwarded by our proxy:
 *   q      — keyword search; when blank we default to "bathymetry" so only
 *             bathymetric records are returned (the NCEI geoportal spans many
 *             disciplines — weather, climate, oceanography, etc.)
 *   bbox   — "minLon,minLat,maxLon,maxLat" spatial filter (optional)
 *   f      — "json" (always)
 *   max    — 20 (v1 fixed page size; no pagination in this release)
 *   from   — 1 (v1 first page only)
 *
 * Response shape (Elasticsearch wire format proxied by geoportal):
 *   {
 *     hits: {
 *       total: { value: N } | N,
 *       hits: [{
 *         _id: string,
 *         _source: {
 *           title: string,
 *           abstract?: string,
 *           modified?: string,
 *           extent?: { spatial?: { bbox?: number[][] } },
 *           links?: [{ href: string, rel?: string, title?: string }]
 *         }
 *       }]
 *     }
 *   }
 *
 * WCS coverage used for materialization (ncei-portal-* save flow):
 *   bagMosaic        — NCEI Multibeam BAG composite, 1–50 m, US coastal waters
 *   demGlobalMosaic  — NCEI best-available integrated DEM, 8–90 m, global
 *
 * wcsAvailable is true when the result has a valid non-zero bbox — the DEM
 * Global Mosaic covers global ocean areas; the BAG Mosaic adds high-
 * resolution coverage for US and Alaskan coastal waters where multibeam
 * surveys exist.
 */

import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { NceiSearchQuerySchema } from "@workspace/api-zod";
import { db, datasetCatalogTable, userCatalogSavesTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody } from "../middlewares/validateBody.js";
import { invalidateCatalogCache, type CatalogSeedEntry } from "../lib/catalogSeeder.js";
import { materializeSave, formatSaveRow } from "./catalog-saves.js";
import { registerCache } from "../lib/cacheRegistry.js";

const router = Router();

// ---------------------------------------------------------------------------
// NCEI Geoportal upstream constants
// ---------------------------------------------------------------------------

const NCEI_GEOPORTAL_URL =
  "https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/search";
const NCEI_CACHE_TTL_MS = 10 * 60 * 1000;
const NCEI_REQUEST_TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// NCEI WCS mosaic coverage footprints
//
// These are the *approximate* geographic extents of the two NCEI WCS mosaics
// BathyScan can query. A dataset's bbox must intersect at least one footprint
// for it to be materialisable (wcsAvailable = true). Both footprints are
// unions of rectangular coverage regions — detailed geometry is not available
// without a full coastline dataset, so we use conservative bounding rectangles
// that match the documented coverage of each product.
//
// BAG Mosaic  — NCEI Multibeam Bathymetry BAG Composite. Covers US territorial
//               and EEZ waters: contiguous coasts, Alaska, Hawaii, USVI, Puerto
//               Rico, and Guam/CNMI. Resolution 1–50 m.
//
// DEM Global Mosaic — NCEI Best-Available Integrated DEM. Near-global ocean
//                     coverage at 8–90 m. Documented geographic extent is
//                     effectively the full oceanic domain.
// ---------------------------------------------------------------------------

interface BboxRect {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Return true if two bbox rectangles overlap (touch counts as overlap).
 * Standard 2-D AABB intersection test.
 */
function bboxIntersects(a: BboxRect, b: BboxRect): boolean {
  return (
    a.maxLon >= b.minLon &&
    a.minLon <= b.maxLon &&
    a.maxLat >= b.minLat &&
    a.minLat <= b.maxLat
  );
}

/**
 * Known approximate coverage regions for the NCEI BAG Mosaic
 * (NCEI Multibeam Bathymetry BAG Composite, 1–50 m resolution, US EEZ).
 */
const BAG_MOSAIC_REGIONS: BboxRect[] = [
  // US West Coast + near-shore Pacific
  { minLon: -135, minLat: 32, maxLon: -116, maxLat: 50 },
  // Alaska — main arc + Aleutians (incl. antimeridian region)
  { minLon: -180, minLat: 50, maxLon: -130, maxLat: 72 },
  // Aleutian / Bering Sea east (crosses antimeridian)
  { minLon: 160, minLat: 50, maxLon: 180, maxLat: 72 },
  // US East Coast continental shelf (east of the coastline — avoids US inland)
  // Starting at -79°W keeps Ohio/WV/VA interior outside this box while still
  // covering the outer shelf from North Carolina northward.
  { minLon: -79, minLat: 24, maxLon: -60, maxLat: 46 },
  // Gulf of Mexico coastal waters (below 30°N — well south of US interior)
  { minLon: -98, minLat: 17, maxLon: -80, maxLat: 30 },
  // Caribbean Sea
  { minLon: -90, minLat: 8, maxLon: -58, maxLat: 24 },
  // Hawaii
  { minLon: -164, minLat: 18, maxLon: -154, maxLat: 24 },
  // Guam / CNMI
  { minLon: 144, minLat: 13, maxLon: 146, maxLat: 21 },
];

/**
 * Known approximate coverage regions for the NCEI DEM Global Mosaic
 * (Best-Available Integrated DEM, 8–90 m, near-global ocean coverage).
 * Documented as spanning all major ocean basins.
 *
 * Regions are deliberately conservative: we only claim ocean areas where
 * the mosaic is documented to exist. Landlocked continental interiors
 * (Central Asia, Sahara, etc.) are intentionally excluded so wcsAvailable
 * stays false for truly non-marine datasets.
 */
const DEM_GLOBAL_MOSAIC_REGIONS: BboxRect[] = [
  // Open North Atlantic (east of 65°W — avoids the North American interior)
  // The 65°W meridian runs through Bermuda and well east of the US coast,
  // so inland US states such as Kansas (-100°W) and Ohio (-84°W) are excluded.
  { minLon: -65, minLat: 25, maxLon: -20, maxLat: 78 },
  // South Atlantic
  { minLon: -60, minLat: -65, maxLon: 25, maxLat: 5 },
  // Deep Pacific (well offshore west of the Americas — east boundary at 120°W
  // sits ~500 km off the California coast, safely excluding US inland areas)
  { minLon: -180, minLat: -65, maxLon: -120, maxLat: 70 },
  // Japan / Korea / west Pacific (east of the Asian continental coast ≈ 130°E)
  { minLon: 130, minLat: 20, maxLon: 180, maxLat: 65 },
  // Southeast Asia / South Pacific offshore (115°E eastward, below 20°N)
  { minLon: 115, minLat: -50, maxLon: 180, maxLat: 20 },
  // Indian Ocean + Arabian Sea (45°E to 100°E, south of 25°N)
  { minLon: 45, minLat: -70, maxLon: 100, maxLat: 25 },
  // Red Sea / Gulf of Aden / Persian Gulf
  { minLon: 32, minLat: 12, maxLon: 62, maxLat: 30 },
  // Southern Ocean / Antarctica
  { minLon: -180, minLat: -90, maxLon: 180, maxLat: -65 },
  // Arctic Ocean
  { minLon: -180, minLat: 65, maxLon: 180, maxLat: 90 },
];

/**
 * Return true when the supplied bbox intersects the coverage footprint of
 * at least one NCEI WCS mosaic (BAG or DEM Global). This determines whether
 * a portal result can be materialised in BathyScan.
 */
export function computeWcsAvailable(bbox: BboxRect): boolean {
  for (const region of BAG_MOSAIC_REGIONS) {
    if (bboxIntersects(bbox, region)) return true;
  }
  for (const region of DEM_GLOBAL_MOSAIC_REGIONS) {
    if (bboxIntersects(bbox, region)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Raw response types from the NCEI Geoportal (Elasticsearch wire format)
// ---------------------------------------------------------------------------

interface NceiGeoportalSource {
  title?: string;
  abstract?: string;
  modified?: string;
  extent?: {
    spatial?: {
      bbox?: number[][];
    };
  };
  bbox?: number[];
  /** Abstract in the current (2026) geoportal index schema. */
  description?: string;
  /**
   * Current (2026) geoportal index spatial field — an array of GeoJSON-like
   * envelopes: { type: "envelope", coordinates: [[minLon, maxLat], [maxLon, minLat]] }.
   */
  envelope_geo?: Array<{
    type?: string;
    coordinates?: number[][];
  }>;
  links?: Array<{ href: string; rel?: string; title?: string }>;
  /**
   * ISO 19115 spatial resolution — NCEI Geoportal exposes this as an array;
   * each element may carry `value` (number) and `uomName` or `denomination`.
   * Typical forms:
   *   [{value: 0.0002778, uomName: "degree"}]       ← 1 arc-second
   *   [{denomination: 50000, uomName: "scaleDenom"}] ← scale-denominator (ignored)
   *   [{value: 10, uomName: "m"}]                    ← direct metres
   */
  spatialResolution?: Array<{
    value?: number;
    denomination?: number;
    uomName?: string;
  }>;
  /** Legacy NCEI index field — integer arc-seconds. */
  sys_resolution_i?: number;
}

interface NceiGeoportalHit {
  _id: string;
  _source: NceiGeoportalSource;
}

interface NceiGeoportalResponse {
  hits?: {
    total?: { value?: number } | number;
    hits?: NceiGeoportalHit[];
  };
}

// ---------------------------------------------------------------------------
// Normalised result shape (matches OpenAPI NceiPortalResult schema)
// ---------------------------------------------------------------------------

export interface NceiPortalResult {
  id: string;
  name: string;
  description: string | null;
  sourceAgency: string;
  resolutionMMin: number | null;
  resolutionMMax: number | null;
  coverageBbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  metadataUrl: string | null;
  wcsAvailable: boolean;
}

/** 1 arc-second at the equator in metres (NOAA standard conversion). */
const ARC_SECOND_M = 30.87;

/**
 * Attempt to extract a spatial resolution in metres from an NCEI Geoportal
 * source record. Returns the resolved value in metres, or null when no
 * recognisable resolution data is found.
 *
 * Resolution sources tried in priority order:
 *  1. `sys_resolution_i`  — legacy NCEI integer field, arc-seconds
 *  2. `spatialResolution[]` — ISO 19115 structured field (value + uomName)
 *  3. Abstract text — regex scan for common NOAA/NCEI resolution phrases
 *     (e.g. "1/3 arc-second", "1 arc-second", "90 m", "3 arc-minute")
 */
function extractResolutionM(source: NceiGeoportalSource): number | null {
  // 1. Legacy integer arc-seconds field
  if (typeof source.sys_resolution_i === "number" && source.sys_resolution_i > 0) {
    return Math.round(source.sys_resolution_i * ARC_SECOND_M);
  }

  // 2. ISO 19115 spatialResolution array
  const sr = source.spatialResolution?.[0];
  if (sr && typeof sr.value === "number" && sr.value > 0) {
    const unit = (sr.uomName ?? "").toLowerCase().trim();
    if (unit === "m" || unit === "meter" || unit === "meters" || unit === "metre" || unit === "metres") {
      return Math.round(sr.value);
    }
    if (unit === "km" || unit === "kilometer" || unit === "kilometre") {
      return Math.round(sr.value * 1_000);
    }
    if (unit === "degree" || unit === "degrees" || unit === "deg") {
      return Math.round(sr.value * 111_120);
    }
    if (unit.includes("arc") && unit.includes("second")) {
      return Math.round(sr.value * ARC_SECOND_M);
    }
    if (unit.includes("arc") && unit.includes("minute")) {
      return Math.round(sr.value * ARC_SECOND_M * 60);
    }
  }

  // 3. Abstract text — common NOAA resolution patterns
  const text = source.abstract ?? source.description ?? "";
  if (!text) return null;

  // "1/3 arc-second", "1/9 arc-second" — fractional forms
  const fracMatch = text.match(/(\d+)\/(\d+)\s*arc[- ]?second/i);
  if (fracMatch) {
    const value = Number(fracMatch[1]) / Number(fracMatch[2]);
    return Math.round(value * ARC_SECOND_M);
  }

  // "1 arc-second", "3 arc-second", "0.5 arc-second"
  const arcSecMatch = text.match(/(\d+(?:\.\d+)?)\s*arc[- ]?second/i);
  if (arcSecMatch) {
    return Math.round(Number(arcSecMatch[1]) * ARC_SECOND_M);
  }

  // "1 arc-minute" — low-resolution global products
  const arcMinMatch = text.match(/(\d+(?:\.\d+)?)\s*arc[- ]?minute/i);
  if (arcMinMatch) {
    return Math.round(Number(arcMinMatch[1]) * ARC_SECOND_M * 60);
  }

  // "90 m", "90m", "90-m resolution"
  const mMatch = text.match(/\b(\d+(?:\.\d+)?)\s*-?\s*m(?:eter|etre)?s?\b/i);
  if (mMatch && Number(mMatch[1]) < 10_000) {
    return Math.round(Number(mMatch[1]));
  }

  return null;
}

/**
 * Normalise a raw NCEI Geoportal hit into an NceiPortalResult.
 *
 * Returns null when the hit lacks a valid non-zero bounding box — the bbox
 * is required for WCS materialisation and for the bbox mini-map in the UI.
 *
 * Exported so unit tests can drive this function directly without spinning up
 * an HTTP server or mocking the fetch layer.
 */
export function normalizeNceiHit(hit: NceiGeoportalHit): NceiPortalResult | null {
  const source = hit._source;
  const name = source.title?.trim();
  if (!name) return null;

  let rawBbox: number[] | undefined =
    source.extent?.spatial?.bbox?.[0] ??
    source.bbox ??
    undefined;

  // Current (2026) geoportal index schema: envelope_geo carries
  // [[minLon, maxLat], [maxLon, minLat]] (upper-left, lower-right).
  if (!rawBbox || rawBbox.length < 4) {
    const env = source.envelope_geo?.find(
      (e) => e?.type === "envelope" && Array.isArray(e.coordinates) && e.coordinates.length >= 2,
    );
    const ul = env?.coordinates?.[0];
    const lr = env?.coordinates?.[1];
    if (ul && lr && ul.length >= 2 && lr.length >= 2) {
      rawBbox = [ul[0]!, lr[1]!, lr[0]!, ul[1]!]; // minLon, minLat, maxLon, maxLat
    }
  }

  if (!rawBbox || rawBbox.length < 4) return null;

  const [minLon, minLat, maxLon, maxLat] = rawBbox;
  if (
    !isFinite(minLon!) ||
    !isFinite(minLat!) ||
    !isFinite(maxLon!) ||
    !isFinite(maxLat!) ||
    maxLon! <= minLon! ||
    maxLat! <= minLat!
  ) {
    return null;
  }

  const coverageBbox = {
    minLon: minLon!,
    minLat: minLat!,
    maxLon: maxLon!,
    maxLat: maxLat!,
  };

  const metadataLink =
    source.links?.find((l) => l.rel === "describedBy") ??
    source.links?.find((l) => l.rel === "alternate") ??
    source.links?.find((l) => l.href.includes("ncei.noaa.gov")) ??
    source.links?.[0];

  const metadataUrl =
    metadataLink?.href ??
    `https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/${encodeURIComponent(hit._id)}/html`;

  const wcsAvailable = computeWcsAvailable(coverageBbox);

  return {
    id: hit._id,
    name,
    description: (source.abstract ?? source.description)?.trim() ?? null,
    sourceAgency: "NOAA/NCEI",
    resolutionMMin: extractResolutionM(source),
    resolutionMMax: extractResolutionM(source),
    coverageBbox,
    metadataUrl,
    wcsAvailable,
  };
}

// ---------------------------------------------------------------------------
// In-process search result cache (avoids hammering NCEI for repeated queries)
// ---------------------------------------------------------------------------

interface SearchCacheEntry {
  results: NceiPortalResult[];
  expiry: number;
}

const searchCache = new Map<string, SearchCacheEntry>();
registerCache(() => searchCache.clear());

function makeCacheKey(q: string, bbox: string, from: number, max: number, broad: boolean): string {
  return `${q.toLowerCase().trim()}|${bbox.trim()}|${from}|${max}|${broad ? "broad" : "bathy"}`;
}

function getCachedResults(cacheKey: string): NceiPortalResult[] | null {
  const entry = searchCache.get(cacheKey);
  if (!entry || Date.now() > entry.expiry) {
    searchCache.delete(cacheKey);
    return null;
  }
  return entry.results;
}

function setCachedResults(cacheKey: string, results: NceiPortalResult[]): void {
  searchCache.set(cacheKey, { results, expiry: Date.now() + NCEI_CACHE_TTL_MS });
}

// NceiSearchQuerySchema is imported from @workspace/api-zod above.

// ---------------------------------------------------------------------------
// Reusable NCEI Geoportal search helper (used by the /ncei/search route and
// the federated-search NCEI connector)
// ---------------------------------------------------------------------------

/** Structured upstream failure thrown by searchNceiGeoportal. */
export class NceiUpstreamError extends Error {
  constructor(
    message: string,
    public readonly kind: "http" | "timeout" | "network",
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "NceiUpstreamError";
  }
}

export interface NceiSearchOptions {
  q: string;
  bbox: string;
  from: number;
  max: number;
  broad: boolean;
}

/**
 * Query the NCEI Geoportal and normalise the hits. Throws NceiUpstreamError
 * on HTTP / timeout / network failures. Does NOT consult or populate the
 * route-level cache — callers manage their own caching.
 */
export async function searchNceiGeoportal(
  opts: NceiSearchOptions,
  externalSignal?: AbortSignal,
): Promise<NceiPortalResult[]> {
  const params = new URLSearchParams({
    // `broad` skips the implicit "bathymetry" keyword so the reference
    // listing ("Other data in this area") can surface all record types.
    // NOTE: no `f` param — the geoportal returns the raw Elasticsearch wire
    // format (hits.hits) by default, which is what we parse. `f=json` now
    // yields an atom-style shape with a `results` array instead.
    q: opts.q || (opts.broad ? "" : "bathymetry"),
    max: String(opts.max),
    from: String(opts.from),
  });
  if (opts.bbox) params.set("bbox", opts.bbox);

  const url = `${NCEI_GEOPORTAL_URL}?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NCEI_REQUEST_TIMEOUT_MS);
  const onExternalAbort = (): void => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  let raw: NceiGeoportalResponse;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new NceiUpstreamError(
        `NCEI Geoportal returned HTTP ${resp.status}`,
        "http",
        resp.status,
      );
    }
    raw = (await resp.json()) as NceiGeoportalResponse;
  } catch (err) {
    if (err instanceof NceiUpstreamError) throw err;
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (controller.signal.aborted) {
      throw new NceiUpstreamError(
        "NCEI Geoportal timed out — try again shortly",
        "timeout",
      );
    }
    throw new NceiUpstreamError(
      `Could not reach NCEI Geoportal: ${msg}`,
      "network",
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }

  const hits: NceiGeoportalHit[] = raw.hits?.hits ?? [];
  return hits
    .map(normalizeNceiHit)
    .filter((r): r is NceiPortalResult => r !== null);
}

// ---------------------------------------------------------------------------
// GET /ncei/search  (public — no auth required)
// ---------------------------------------------------------------------------

router.get("/ncei/search", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = NceiSearchQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: queryParsed.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; "),
    });
    return;
  }
  const { q: rawQ, bbox, from, max, broad } = queryParsed.data;
  const q = rawQ.trim();

  const cacheKey = makeCacheKey(q, bbox, from, max, broad);
  const cached = getCachedResults(cacheKey);
  if (cached) {
    const _cp = z.array(NceiPortalResultSchema).safeParse(cached);
    if (!_cp.success) logger.warn({ err: _cp.error }, "GET /api/ncei/search — cached response shape mismatch");
    res.json(cached);
    return;
  }

  let results: NceiPortalResult[];
  try {
    results = await searchNceiGeoportal({ q, bbox, from, max, broad });
  } catch (err) {
    if (err instanceof NceiUpstreamError) {
      res.status(503).json({
        error: err.kind === "http" ? "ncei_upstream_error" : "ncei_unreachable",
        details: err.message,
      });
      return;
    }
    throw err;
  }

  setCachedResults(cacheKey, results);
  const _rp = z.array(NceiPortalResultSchema).safeParse(results);
  if (!_rp.success) logger.warn({ err: _rp.error }, "GET /api/ncei/search — response shape mismatch");
  res.json(results);
}));

// ---------------------------------------------------------------------------
// POST /ncei/save  (auth-gated)
// ---------------------------------------------------------------------------

const NceiPortalResultSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  sourceAgency: z.string().optional(),
  resolutionMMin: z.number().nullable().optional(),
  resolutionMMax: z.number().nullable().optional(),
  coverageBbox: z.object({
    minLon: z.number().finite(),
    minLat: z.number().finite(),
    maxLon: z.number().finite(),
    maxLat: z.number().finite(),
  }),
  metadataUrl: z.string().nullable().optional(),
  wcsAvailable: z.boolean(),
});

const NceiSaveBodySchema = z.object({
  result: NceiPortalResultSchema,
});

/** Sanitize an NCEI record id into a URL/DB-safe slug segment. */
function sanitizeNceiId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9:.-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/** Convert an NceiPortalResult into a CatalogSeedEntry for DB upsert. */
function portalResultToCatalogEntry(result: NceiPortalResult): CatalogSeedEntry {
  const slug = sanitizeNceiId(result.id);
  return {
    id: `ncei-portal-${slug}`,
    name: result.name,
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: result.resolutionMMin ?? null,
    resolutionMMax: result.resolutionMMax ?? null,
    coverageBbox: result.coverageBbox,
    endpointUrl: result.metadataUrl ?? null,
    accessNotes: "Discovered via NCEI Bathymetry Geoportal",
    description: result.description ?? null,
    keywords: "NCEI,bathymetry,portal,survey",
    lastUpdated: null,
    waterType: "saltwater",
  };
}

router.post("/ncei/save", requireAuth, validateBody(NceiSaveBodySchema, "POST /api/ncei/save"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;

  // Coerce optional Zod fields (undefined) → null to satisfy NceiPortalResult
  const r = res.locals.parsedBody.result;

  // Re-compute wcsAvailable server-side from the bbox rather than trusting
  // the client-supplied flag. This prevents a crafted request from forcing
  // a materialisation job for a dataset whose bbox lies outside any NCEI
  // WCS mosaic footprint, which would produce a failing terrain fetch.
  const serverWcsAvailable = computeWcsAvailable(r.coverageBbox);
  if (!serverWcsAvailable) {
    res.status(400).json({
      error: "not_available",
      details:
        "This dataset's bounding box does not intersect any NCEI WCS mosaic coverage area and cannot be materialized in BathyScan",
    });
    return;
  }

  const coercedResult: NceiPortalResult = {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    sourceAgency: r.sourceAgency ?? "NOAA/NCEI",
    resolutionMMin: r.resolutionMMin ?? null,
    resolutionMMax: r.resolutionMMax ?? null,
    coverageBbox: r.coverageBbox,
    metadataUrl: r.metadataUrl ?? null,
    wcsAvailable: true, // already verified above
  };
  const entry = portalResultToCatalogEntry(coercedResult);
  const catalogId = entry.id;

  // Upsert portal entry into dataset_catalog so the retry endpoint and
  // getCatalogEntries() can resolve this catalogId in future requests.
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
      },
    });

  // Bust in-memory cache so getCatalogEntries() picks up the new row.
  invalidateCatalogCache();

  // Idempotent: return existing save if one already exists (any status).
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
}));

export default router;
