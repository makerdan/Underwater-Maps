import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { parsePositiveIntEnv } from "../lib/env.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { promises as fsPromises } from "fs";
import path from "path";
import { createHash } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { createRateLimit, stampBaselineRateLimitHeaders } from "../middlewares/rateLimit.js";
import { getPoeClient } from "@workspace/poe";
import { withRetry } from "@workspace/poe";
import { PoeCreditsError, PoeRateLimitError, PoeAuthError, ZoneParseError } from "@workspace/poe";
import { hashCacheKey, globalPoeCache } from "@workspace/poe";
import { buildVisionInput } from "@workspace/poe";
import { POE_MODELS } from "@workspace/poe";
import { PoeCircuitBreaker } from "@workspace/poe";
import { logger } from "../lib/logger.js";
import { db } from "@workspace/db";
import { poeUsageLogTable } from "@workspace/db/schema";
import type { PoeToolSchema } from "@workspace/poe";
import {
  sampleSubstrateGrid,
  substrateToZone,
  type SubstrateGridSample,
} from "../lib/substrateGrid.js";
import { registerCache } from "../lib/cacheRegistry.js";
import {
  MAX_TILES_PER_SIDE,
  TILE_CONCURRENCY,
  TILE_SIZE,
  planTiles,
  extractTileDepths32,
  tileFingerprint,
  stitchTileLabels,
  mapWithConcurrency,
  tileDepthsToPngDataUrl,
  type TilePlan,
} from "../lib/tileClassify.js";

const router = Router();

// ---------------------------------------------------------------------------
// Auth + rate limit
//
// Every Poe route is gated by:
//   1. baseline `X-RateLimit-*` header stamping (so 401s still carry headers)
//   2. shared `requireAuth` (Clerk session or env-gated e2e bypass)
//   3. durable sliding-window rate limiter (Postgres-backed via
//      `middlewares/rateLimit.ts`) keyed per-user
//
// The limiter previously lived in an in-process `Map` here, which reset on
// every restart and was bypassed by horizontal scaling. The new limiter
// shares quota across processes via the `rate_limit_events` table.
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

router.use(stampBaselineRateLimitHeaders(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS));
router.use(requireAuth);
router.use(
  createRateLimit({
    route: "poe",
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    mode: "user",
  }),
);

// ---------------------------------------------------------------------------
// Poe circuit breaker — opens after 5 consecutive failures, stays open for
// 30 s, then half-opens to let one probe through. When open, classify routes
// fall through immediately to heuristicClassifyByDepth. State transitions are
// logged with distinct codes so they surface in dashboards.
// ---------------------------------------------------------------------------

const poeBreaker = new PoeCircuitBreaker({
  failureThreshold: 5,
  resetMs: 30_000,
  logger: {
    warn: (obj, msg) => logger.warn(obj, msg),
    info: (obj, msg) => logger.info(obj, msg),
  },
});

/**
 * TEST-ONLY — resets the module-level `poeBreaker` singleton to the closed
 * state. Must be called in `beforeEach` alongside `globalPoeCache.clear()` so
 * test suites that accumulate AI failures (e.g. the tiled-path "all tiles
 * return empty output_text" suite) don't leave the breaker open for later tests.
 * Never imported or called in production code.
 */
export function __resetPoeBreaker(): void {
  poeBreaker.recordSuccess();
}

/** Per-route upstream timeouts (ms) — sized to the expected upstream work. */
const POE_MODELS_TIMEOUT_MS = 10_000;
const POE_CLASSIFY_TIMEOUT_MS = 45_000;
const POE_QUERY_TIMEOUT_MS = 30_000;
const POE_HELP_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// GET /models — Clerk-gated and rate-limited like the other Poe routes
// ---------------------------------------------------------------------------

let modelsCache: { data: unknown; expiresAt: number } | null = null;

router.get("/models", asyncHandler(async (_req, res) => {
  if (modelsCache && Date.now() < modelsCache.expiresAt) {
    res.json(modelsCache.data);
    return;
  }

  try {
    const response = await fetch("https://api.poe.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env["POE_API_KEY"] ?? ""}` },
      // Hard upstream timeout — without this a hung Poe `/models` request
      // would block the worker indefinitely.
      signal: AbortSignal.timeout(POE_MODELS_TIMEOUT_MS),
    });
    const data = await response.json();
    modelsCache = { data, expiresAt: Date.now() + 60 * 60 * 1000 };
    res.json(data);
  } catch {
    res.status(502).json({ error: "models_unavailable", details: "Could not fetch Poe models list" });
  }
}));

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const POINTS_PER_TOKEN: Record<string, number> = {
  "Claude-Opus-4.7": 30,
  "Claude-Sonnet-4.6": 6,
  "Claude-Sonnet-4.5": 6,
  "Claude-Haiku-4.5": 1,
  "GPT-5-Pro": 20,
  "GPT-5.4": 10,
  "Gemini-3.1-Pro": 5,
  "Gemini-2.5-Pro": 5,
  "Grok-4": 8,
  "DeepSeek-R1": 3,
};

function estimatePoints(model: string, totalTokens: number): number {
  const rate = POINTS_PER_TOKEN[model] ?? 5;
  return Math.ceil((totalTokens / 1000) * rate);
}

function getAuthenticatedUserId(req: Request): string {
  // Populated by the shared `requireAuth` middleware in
  // `../middlewares/requireAuth.ts`. Always non-empty by the time a handler
  // runs because requireAuth short-circuits unauthenticated requests with 401.
  return (req as AuthenticatedRequest).clerkUserId;
}

async function logUsage(
  userId: string,
  model: string,
  endpoint: string,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  const totalTokens = promptTokens + completionTokens;
  try {
    await db.insert(poeUsageLogTable).values({
      userId,
      model,
      endpoint,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedPoints: estimatePoints(model, totalTokens),
    });
  } catch (err) {
    logger.warn({ err }, "[poe] logUsage failed");
  }
}

function handlePoeError(err: unknown, res: Response): void {
  if (err instanceof PoeCreditsError) {
    res.status(402).json({ error: "credits_exhausted", details: err.message });
  } else if (err instanceof PoeRateLimitError) {
    res.status(429).json({ error: "rate_limit", details: err.message });
  } else if (err instanceof PoeAuthError) {
    res.status(401).json({ error: "auth_error", details: "AI service authentication failed" });
  } else {
    const msg = err instanceof Error ? err.message : "Unknown Poe API error";
    res.status(500).json({ error: "poe_error", details: msg });
  }
}

// ---------------------------------------------------------------------------
// Dataset zones cache (secondary index — keyed by datasetId for fast GET)
// The primary globalPoeCache is keyed by content hash (datasetId+waterType+gridHash).
// This secondary cache allows a cheap GET /zones/:id lookup without the full PNG.
// ---------------------------------------------------------------------------

interface CachedZones {
  zones: string[];
  waterType: "saltwater" | "freshwater";
  classifiedAt: number;
  /**
   * Provenance of the cached labels. The zone cache stores AI-derived stitched
   * results (a tile that fell back to the heuristic doesn't disqualify the
   * stitched result from being cached — "partial" is a valid cached state).
   * Pure-heuristic results are never persisted.
   */
  source?: "ai" | "heuristic" | "partial";
  /**
   * Strong content fingerprint of the depth grid (sha256 of gridBase64).
   * Stored so a same-bucket FNV-1a 32-bit collision between two different
   * depth payloads is detected and treated as a miss instead of returning
   * the wrong labels.
   */
  contentHash?: string;
  /** Width of the cached zones grid. Defaults to 32 for legacy entries. */
  coarseWidth?: number;
  /** Height of the cached zones grid. Defaults to 32 for legacy entries. */
  coarseHeight?: number;
}

/**
 * Secondary zone cache — keyed by `sha256(gridHash + "|" + waterType)`.
 *
 * Namespacing the cache key by waterType makes cross-waterType collisions
 * impossible (freshwater/saltwater for the same gridHash now occupy two
 * separate entries). The sha256 derivation also gives us a uniform 64-char
 * hex key that's safe as a filename. Different grid content → different
 * gridHash → different cache key, so the synthetic "upload" datasetId can
 * never alias two unrelated uploads either.
 */
const datasetZonesCache = new Map<string, CachedZones>();
registerCache(() => datasetZonesCache.clear());

/** Exported so the /datasets/:id/zones endpoint (datasets.ts) can read it. */
export { datasetZonesCache };

/**
 * Derive the namespaced cache key from a client-supplied gridHash and the
 * water type the grid was classified under. The output is a 64-char lowercase
 * hex sha256 string, safe to use as both an in-memory map key and a filename.
 */
export function zoneCacheKey(
  userId: string,
  gridHash: string,
  waterType: "saltwater" | "freshwater",
  substrateFp: string,
): string {
  return createHash("sha256")
    .update(`${userId}|${gridHash}|${waterType}|${substrateFp}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Disk persistence — survives process restarts
// Files stored at /tmp/zone-cache/<sha256>.json (hex filename, always safe)
// ---------------------------------------------------------------------------

const ZONE_CACHE_DIR = "/tmp/zone-cache";

/**
 * Maximum age (ms) of a zone-cache entry before it is evicted. Entries whose
 * `classifiedAt` timestamp is older than this are removed from disk during
 * hydration. Configurable via ZONE_CACHE_MAX_AGE_MS (default: 7 days).
 */
const ZONE_CACHE_MAX_AGE_MS: number = parsePositiveIntEnv(
  "ZONE_CACHE_MAX_AGE_MS",
  7 * 24 * 60 * 60 * 1000,
  { min: 1000, max: 365 * 24 * 60 * 60 * 1000 },
);

/**
 * Maximum number of .json files to keep in the zone-cache directory. When
 * more files survive the age check than this cap, the oldest (by classifiedAt)
 * are evicted. Configurable via ZONE_CACHE_MAX_FILES (default: 500).
 */
const ZONE_CACHE_MAX_FILES: number = parsePositiveIntEnv("ZONE_CACHE_MAX_FILES", 500, {
  min: 1,
  max: 100_000,
});

/**
 * Sentinel file that marks the cache directory as having been written with the
 * userId-partitioned key scheme. Its absence means the directory may contain
 * files keyed without userId (pre-partitioning), which are now unreachable and
 * waste memory. On first boot after this sentinel is introduced we wipe all
 * `.json` files and create it — a one-time migration.
 */
const ZONE_CACHE_SENTINEL = path.join(ZONE_CACHE_DIR, ".v2");

/**
 * Strict allow-list for zone-cache filenames: exactly 64 lowercase hex chars
 * (the sha256-derived namespaced key). Anything else is rejected before any
 * filesystem access to prevent path traversal.
 */
const ZONE_CACHE_KEY_RE = /^[a-f0-9]{64}$/;

/** Returns true only when `key` is a safe, well-formed sha256 hex string. */
function isValidZoneCacheKey(key: string): boolean {
  return ZONE_CACHE_KEY_RE.test(key);
}

/**
 * Schema for on-disk zone-cache entries. Files under /tmp are outside the
 * process's trust boundary (they survive restarts and could be corrupted or
 * tampered with), so every read is validated before use. Any file that fails
 * validation is treated as a cache miss.
 */
export const CachedZonesSchema = z.object({
  zones: z.array(z.string().max(100)).max(1_048_576),
  waterType: z.enum(["saltwater", "freshwater"]),
  classifiedAt: z.number().finite(),
  source: z.enum(["ai", "heuristic", "partial"]).optional(),
  contentHash: z.string().max(128).optional(),
  coarseWidth: z.number().int().positive().max(4096).optional(),
  coarseHeight: z.number().int().positive().max(4096).optional(),
});

/** Read a single zone cache entry by namespaced cache key from disk. */
export async function readZoneDiskByKey(cacheKey: string): Promise<CachedZones | null> {
  if (!isValidZoneCacheKey(cacheKey)) return null; // reject path traversal attempts
  let raw: string;
  const file = path.join(ZONE_CACHE_DIR, `${cacheKey}.json`);
  // Resolve and verify the path stays inside ZONE_CACHE_DIR
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(ZONE_CACHE_DIR) + path.sep)) return null;
  try {
    raw = await fsPromises.readFile(resolved, "utf8");
  } catch (err) {
    logger.warn({ err, cacheKey }, "[zones] readZoneDiskByKey failed");
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    logger.warn({ err, cacheKey }, "[zones] disk cache entry is corrupt JSON — treating as miss");
    return null;
  }
  const validated = CachedZonesSchema.safeParse(parsedJson);
  if (!validated.success) {
    logger.warn(
      { cacheKey, issue: validated.error.issues[0]?.message },
      "[zones] disk cache entry failed schema validation — treating as miss",
    );
    return null;
  }
  return validated.data;
}

/**
 * Compatibility helper for callers that still hold a (gridHash, waterType,
 * substrateFp) triple. Derives the namespaced sha256 cache key and delegates
 * to `readZoneDiskByKey`. Returned entries are also waterType-validated to
 * guard against on-disk tampering or stale-format files.
 */
export async function readZoneDiskByHash(
  userId: string,
  gridHash: string,
  waterType: "saltwater" | "freshwater",
  substrateFp: string,
): Promise<CachedZones | null> {
  const entry = await readZoneDiskByKey(zoneCacheKey(userId, gridHash, waterType, substrateFp));
  if (!entry) return null;
  if (entry.waterType !== waterType) return null;
  return entry;
}

async function writeZoneDisk(cacheKey: string, data: CachedZones): Promise<void> {
  if (!isValidZoneCacheKey(cacheKey)) {
    logger.warn({ cacheKey }, `[zones] Rejected write for invalid cacheKey: ${JSON.stringify(cacheKey)}`);
    return;
  }
  try {
    await fsPromises.mkdir(ZONE_CACHE_DIR, { recursive: true });
    const file = path.join(ZONE_CACHE_DIR, `${cacheKey}.json`);
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(ZONE_CACHE_DIR) + path.sep)) return;
    await fsPromises.writeFile(resolved, JSON.stringify(data), "utf8");
  } catch (err) {
    logger.warn({ err, cacheKey }, `[zones] Failed to write disk cache for ${cacheKey}: ${(err as Error).message}`);
  }
}

/**
 * Wipe all `.json` files from the zone-cache directory (best-effort, in
 * parallel). Used by the sentinel-based migration to purge stale pre-userId
 * entries that are no longer reachable under the new key scheme.
 */
async function purgeZoneCacheJson(files: string[]): Promise<void> {
  await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map((f) =>
        fsPromises.unlink(path.join(ZONE_CACHE_DIR, f)).catch(() => {
          // best-effort
        }),
      ),
  );
}

/**
 * Evict zone-cache `.json` files that are too old or exceed the max-file cap.
 *
 * Two-phase eviction:
 *   1. **Age eviction** — any entry whose `classifiedAt` field is older than
 *      `ZONE_CACHE_MAX_AGE_MS` is deleted from disk immediately.
 *   2. **Count cap** — if more files survive the age check than
 *      `ZONE_CACHE_MAX_FILES`, the oldest survivors (by `classifiedAt`) are
 *      deleted until the directory is within the cap.
 *
 * Files that cannot be read or parsed are silently skipped (best-effort);
 * individual unlink failures are also swallowed so one bad entry cannot
 * abort the sweep.
 *
 * @param jsonFiles - Basenames of `.json` files currently in ZONE_CACHE_DIR.
 * @returns The set of basenames that survived eviction and should be loaded.
 */
export async function evictStaleCacheEntries(jsonFiles: string[]): Promise<Set<string>> {
  const now = Date.now();

  interface FileEntry {
    name: string;
    classifiedAt: number;
  }

  // Read classifiedAt from each file; entries we cannot parse are omitted
  // (they will be absent from the survivor set and thus skipped on load).
  const entries: FileEntry[] = (
    await Promise.all(
      jsonFiles.map(async (f): Promise<FileEntry | null> => {
        try {
          const raw = await fsPromises.readFile(path.join(ZONE_CACHE_DIR, f), "utf8");
          const parsed = JSON.parse(raw) as { classifiedAt?: unknown };
          const classifiedAt =
            typeof parsed.classifiedAt === "number" ? parsed.classifiedAt : 0;
          return { name: f, classifiedAt };
        } catch {
          return null; // unreadable / unparseable — skip silently
        }
      }),
    )
  ).filter((e): e is FileEntry => e !== null);

  // Phase 1: age eviction
  const survivors: FileEntry[] = [];
  await Promise.all(
    entries.map(async (e) => {
      if (now - e.classifiedAt > ZONE_CACHE_MAX_AGE_MS) {
        await fsPromises.unlink(path.join(ZONE_CACHE_DIR, e.name)).catch(() => {});
        logger.info({ file: e.name }, "[zones] evicted stale cache entry (age limit)");
      } else {
        survivors.push(e);
      }
    }),
  );

  // Phase 2: count cap — evict oldest beyond ZONE_CACHE_MAX_FILES
  if (survivors.length > ZONE_CACHE_MAX_FILES) {
    survivors.sort((a, b) => a.classifiedAt - b.classifiedAt);
    const toEvict = survivors.splice(0, survivors.length - ZONE_CACHE_MAX_FILES);
    await Promise.all(
      toEvict.map(async (e) => {
        await fsPromises.unlink(path.join(ZONE_CACHE_DIR, e.name)).catch(() => {});
        logger.info({ file: e.name }, "[zones] evicted cache entry (file count cap)");
      }),
    );
  }

  return new Set(survivors.map((e) => e.name));
}

/**
 * Hydrate in-memory cache from disk on startup (non-blocking).
 *
 * **Sentinel migration (v2):** If `/tmp/zone-cache/.v2` does not exist the
 * directory may contain entries written before the userId-partitioned cache key
 * was introduced. Those files are keyed by `sha256(gridHash|waterType|substrateFp)`
 * and produce valid 64-char hex names, so they pass the format check — but they
 * will never be matched by new queries (which include userId). We therefore wipe
 * every `.json` file in one pass and create the sentinel so subsequent startups
 * skip the migration.
 *
 * Legacy files with non-hex names (FNV-1a 8-char or `<gridHash>-<substrateFp>`
 * combined keys) are also silently deleted — the cache is intentionally lossy on
 * format change since AI re-classification is the only way to recover the correct
 * (userId, waterType, substrateFp) tuple.
 */
export async function hydrateCacheFromDisk(): Promise<void> {
  try {
    await fsPromises.mkdir(ZONE_CACHE_DIR, { recursive: true });
    const files = await fsPromises.readdir(ZONE_CACHE_DIR);

    // --- One-time migration: purge pre-userId-partitioning entries ---
    const sentinelExists = files.includes(".v2");
    if (!sentinelExists) {
      logger.info("[zones] zone-cache sentinel (.v2) missing — purging stale pre-userId entries");
      await purgeZoneCacheJson(files);
      await fsPromises.writeFile(ZONE_CACHE_SENTINEL, "", "utf8");
      // Cache starts empty; next classify calls will repopulate it.
      return;
    }

    // --- Normal hydration ---

    // Separate valid .json files from non-.json / legacy entries so eviction
    // only operates on well-named candidates.
    const jsonFiles: string[] = [];
    const legacyFiles: string[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const key = f.slice(0, -5);
      if (isValidZoneCacheKey(key)) {
        jsonFiles.push(f);
      } else {
        legacyFiles.push(f);
      }
    }

    // Delete any legacy-format entries first (invalid hex names).
    await Promise.all(
      legacyFiles.map((f) =>
        fsPromises.unlink(path.join(ZONE_CACHE_DIR, f)).catch(() => {}),
      ),
    );

    // Evict stale / excess entries; receive the set of survivors to load.
    const survivors = await evictStaleCacheEntries(jsonFiles);

    // Load surviving entries into the in-memory cache.
    await Promise.all(
      [...survivors].map(async (f) => {
        const key = f.slice(0, -5);
        const data = await readZoneDiskByKey(key);
        if (data && !datasetZonesCache.has(key)) {
          datasetZonesCache.set(key, data);
        }
      }),
    );
  } catch (err) {
    // Non-fatal — cache simply starts empty
    logger.warn({ err }, "[zones] hydrateCacheFromDisk failed — starting with empty cache");
  }
}

/** Exported for tests only — the sentinel path and eviction constants used by hydrateCacheFromDisk. */
export { ZONE_CACHE_SENTINEL, ZONE_CACHE_MAX_AGE_MS, ZONE_CACHE_MAX_FILES };

// Kick off hydration immediately (no await — non-blocking)
void hydrateCacheFromDisk();

// ---------------------------------------------------------------------------
// Classify
// ---------------------------------------------------------------------------

const SALTWATER_ZONES = [
  "sandy_shelf", "coarse_sediment", "silt_plain", "basalt_rock",
  "volcanic_vent_field", "trench_wall", "seamount_flank", "coral_reef_potential",
] as const;

const FRESHWATER_ZONES = [
  "aquatic_vegetation", "sandy_lake_bed", "rocky_shoreline", "silt_deep",
  "gravel_bed", "bedrock_shelf", "submerged_wood", "clay_flat",
] as const;

// ---------------------------------------------------------------------------
// Depth-based heuristic classifier (used when the AI call fails).
//
// Bands depths into four equal-count percentile buckets (shallow → deep) and
// maps each bucket to one of four substrate labels per water type. A second
// pass uses local roughness (mean absolute depth difference to 8-neighbours)
// to override the highest-roughness cells with the rocky/hard substrate label
// for that water type — this breaks up the obvious horizontal quartile bands
// you get from depth alone and surfaces ridges, scarps and isolated rocks.
// Pure / deterministic so it's easy to unit-test. The chosen labels
// intentionally match the representative texture slots used by the client
// shader so the resulting overlay is consistent with paint mode.
// ---------------------------------------------------------------------------

/** Shallow → deep substrate labels for the heuristic classifier. */
export const SALTWATER_HEURISTIC_BANDS = [
  "sandy_shelf",      // shallowest 25%
  "coarse_sediment",
  "silt_plain",
  "basalt_rock",      // deepest 25%
] as const;

export const FRESHWATER_HEURISTIC_BANDS = [
  "aquatic_vegetation", // shallowest 25%
  "gravel_bed",
  "rocky_shoreline",
  "silt_deep",          // deepest 25%
] as const;

/** Label used to mark high-roughness cells regardless of depth band. */
export const SALTWATER_ROUGH_OVERRIDE = "basalt_rock";
export const FRESHWATER_ROUGH_OVERRIDE = "rocky_shoreline";

/**
 * Label used to mark unusually-flat cells (deep sediment basins, lake bottoms)
 * regardless of depth band. Complements the rocky-roughness override so flat
 * silty patches sitting inside otherwise rolling terrain don't get smeared into
 * the deepest depth quartile (which for saltwater is `basalt_rock`).
 */
export const SALTWATER_FLAT_OVERRIDE = "silt_plain";
export const FRESHWATER_FLAT_OVERRIDE = "silt_deep";

const HEURISTIC_GRID_W = 32;
const HEURISTIC_GRID_H = 32;

/**
 * Per-cell roughness = mean absolute depth difference to in-bounds 8-neighbours.
 * Returns one value per cell (length GRID_W*GRID_H). Edge/corner cells average
 * over fewer neighbours but use the same metric, so they're comparable to
 * interior cells without an arbitrary edge weighting.
 */
function computeLocalRoughness(cleaned: number[]): number[] {
  const N = HEURISTIC_GRID_W * HEURISTIC_GRID_H;
  const out = new Array<number>(N);
  for (let row = 0; row < HEURISTIC_GRID_H; row++) {
    for (let col = 0; col < HEURISTIC_GRID_W; col++) {
      const i = row * HEURISTIC_GRID_W + col;
      const d = cleaned[i] as number;
      let sum = 0;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = row + dr;
          const nc = col + dc;
          if (nr < 0 || nr >= HEURISTIC_GRID_H) continue;
          if (nc < 0 || nc >= HEURISTIC_GRID_W) continue;
          sum += Math.abs(d - (cleaned[nr * HEURISTIC_GRID_W + nc] as number));
          count++;
        }
      }
      out[i] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/**
 * Classify `depths` (length 1024, 32×32 row-major) into substrate labels using
 * depth quartiles plus a local-roughness override. Cells whose roughness sits
 * above the 75th percentile (and is strictly positive) are relabeled to the
 * rocky/hard substrate for the water type — so ridges, scarps and isolated
 * hard features show through instead of being smoothed into pure depth bands.
 *
 * Always returns exactly 1024 labels — short inputs are right-padded with the
 * shallowest label and long inputs are truncated. Non-finite values are
 * treated as the minimum depth (shallowest band) so the result is always a
 * valid 1024-string array.
 */
export function heuristicClassifyByDepth(
  depths: number[],
  waterType: "saltwater" | "freshwater",
  substrateLabels?: ReadonlyArray<string | null> | null,
): string[] {
  const bands = waterType === "freshwater"
    ? FRESHWATER_HEURISTIC_BANDS
    : SALTWATER_HEURISTIC_BANDS;
  const roughOverride = waterType === "freshwater"
    ? FRESHWATER_ROUGH_OVERRIDE
    : SALTWATER_ROUGH_OVERRIDE;

  const N = HEURISTIC_GRID_W * HEURISTIC_GRID_H;
  const out = new Array<string>(N);

  // Normalize: take first N, replace NaN/Infinity with a finite minimum.
  const cleaned = new Array<number>(N);
  let minFinite = Number.POSITIVE_INFINITY;
  for (let i = 0; i < N; i++) {
    const v = depths[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      cleaned[i] = v;
      if (v < minFinite) minFinite = v;
    } else {
      cleaned[i] = Number.NaN; // mark, fix in second pass
    }
  }
  if (!Number.isFinite(minFinite)) {
    // All inputs missing/non-finite — every cell becomes the shallowest band.
    return out.fill(bands[0]);
  }
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(cleaned[i] as number)) cleaned[i] = minFinite;
  }

  // Depth percentile thresholds via sorted copy.
  const sorted = cleaned.slice().sort((a, b) => a - b);
  const q1 = sorted[Math.floor(N * 0.25)] as number;
  const q2 = sorted[Math.floor(N * 0.5)] as number;
  const q3 = sorted[Math.floor(N * 0.75)] as number;
  const depthRange = (sorted[N - 1] as number) - (sorted[0] as number);

  // Roughness pass — promote cells with locally-steep gradients to the rocky
  // override label. Threshold is the larger of:
  //   * the 75th-percentile roughness (broadly-noisy fields then promote
  //     roughly their top quartile, with ties on the threshold left alone),
  //   * 5% of the overall depth range (so smooth fields like a global ramp
  //     stay banded by depth — interior roughness equals q3 and isn't strictly
  //     greater — while isolated spikes/ridges in an otherwise flat field
  //     still get picked up because their per-cell roughness is large relative
  //     to the depth range).
  // Comparison is strict (`>`) and the threshold must be > 0, so a perfectly
  // flat grid (roughness 0 everywhere) never triggers an override.
  const roughness = computeLocalRoughness(cleaned);
  const sortedRough = roughness.slice().sort((a, b) => a - b);
  const roughQ1 = sortedRough[Math.floor(N * 0.25)] as number;
  const roughQ3 = sortedRough[Math.floor(N * 0.75)] as number;
  const roughThreshold = Math.max(roughQ3, depthRange * 0.05);

  // Flat-basin pass — promote cells whose local roughness sits in the bottom
  // quartile AND below an absolute floor (1% of the overall depth range) to a
  // soft-sediment label, but only when the field is "otherwise non-flat" (the
  // top-quartile roughness is strictly positive, so there's some rolling
  // terrain elsewhere to contrast against). On a perfectly flat grid every
  // cell has roughness 0 and this guard prevents flagging the whole field.
  const flatOverride = waterType === "freshwater"
    ? FRESHWATER_FLAT_OVERRIDE
    : SALTWATER_FLAT_OVERRIDE;
  const flatFloor = depthRange * 0.01;
  const fieldNonFlat = roughQ3 > 0;

  for (let i = 0; i < N; i++) {
    const d = cleaned[i] as number;
    const r = roughness[i] as number;
    if (roughThreshold > 0 && r > roughThreshold) {
      out[i] = roughOverride;
    } else if (fieldNonFlat && r <= roughQ1 && r < flatFloor) {
      out[i] = flatOverride;
    } else {
      const band = d <= q1 ? 0 : d <= q2 ? 1 : d <= q3 ? 2 : 3;
      out[i] = bands[band] as string;
    }
  }

  // Ground covered cells with the observed substrate label. Substrate-derived
  // labels win over both the rocky-override and the depth-band assignment
  // because they reflect surveyed reality rather than a depth-only proxy.
  if (substrateLabels && substrateLabels.length === N) {
    for (let i = 0; i < N; i++) {
      const lbl = substrateLabels[i];
      if (lbl) out[i] = lbl;
    }
  }
  return out;
}

function buildClassifySystemPrompt(waterType: "saltwater" | "freshwater"): string {
  const rleInstructions = `OUTPUT ONLY VALID JSON. No explanation, no preamble, no markdown, no code fences. Your entire response must be a single JSON object and nothing else.

Use run-length encoding to describe the 32×32 grid (1024 cells, row-major order). The JSON format is:
{"zones": [["label", count], ["label", count], ...]}
where each pair encodes a run of consecutive identical labels, and the total count across all pairs must equal exactly 1024.

Example (for illustration only — do not copy these labels):
{"zones": [["sandy_shelf", 300], ["silt_plain", 400], ["basalt_rock", 324]]}`;

  if (waterType === "freshwater") {
    return `${rleInstructions}

You are an expert limnologist and freshwater bathymetric analyst. You will be shown a greyscale depth map of a lake or reservoir where darker pixels represent shallower depths and lighter pixels represent deeper depths. Classify each cell of the 32×32 grid into one of these freshwater substrate types: aquatic_vegetation, sandy_lake_bed, rocky_shoreline, silt_deep, gravel_bed, bedrock_shelf, submerged_wood, clay_flat. Use limnological reasoning.`;
  }
  return `${rleInstructions}

You are an expert marine geologist and bathymetric data analyst. You will be shown a greyscale depth map where darker pixels represent shallower depths and lighter pixels represent deeper depths. Classify each cell of the 32×32 grid into one of: sandy_shelf, coarse_sediment, silt_plain, basalt_rock, volcanic_vent_field, trench_wall, seamount_flank, coral_reef_potential. Favour geological reasoning over simple depth thresholds.`;
}

/**
 * Render the per-cell substrate ground truth as a compact text block the AI
 * model can consume alongside the depth-map image. Cells without polygon
 * coverage are emitted as `?` so the model knows where it must fall back to
 * pure geological reasoning. Returns `null` when there is no coverage at all
 * — callers should then omit the substrate section entirely.
 */
function renderSubstrateGroundTruth(
  sample: SubstrateGridSample,
  waterType: "saltwater" | "freshwater",
): string | null {
  if (!sample.hasCoverage) return null;
  const lines: string[] = [];
  for (let row = 0; row < 32; row++) {
    let line = "";
    for (let col = 0; col < 32; col++) {
      const lbl = sample.labels[row * 32 + col];
      line += lbl ? substrateToZone(lbl, waterType) : "?";
      if (col < 31) line += ",";
    }
    lines.push(line);
  }
  const pct = (sample.coverageFraction * 100).toFixed(1);
  const counts = sample.counts;
  return [
    `Ground-truth substrate observations cover ${sample.coveredCount}/1024 cells (${pct}%).`,
    `Per-class covered-cell counts: bedrock=${counts.bedrock}, gravel=${counts.gravel}, sand=${counts.sand}, mud=${counts.mud}.`,
    `Cells marked "?" have no surveyed substrate — use geological reasoning for those.`,
    `Substrate grid (row-major, 32 rows × 32 cols, comma-separated):`,
    ...lines,
  ].join("\n");
}

/**
 * Decode a run-length encoded zones array from the AI response into a flat
 * 1024-element label array. Each element in `rle` is [label, count].
 *
 * Tolerates:
 *   • Flat string arrays (legacy / fallback path where model ignores RLE)
 *   • RLE pairs where total count != 1024 (truncate or pad with fallback zone)
 *   • Invalid/unknown zone names (replaced with first valid zone for that water type)
 *
 * Returns null only when the input is completely unparseable (not an array).
 */
function decodeRleZones(
  raw: unknown,
  waterType: "saltwater" | "freshwater",
): string[] | null {
  const validZones = (waterType === "freshwater" ? FRESHWATER_ZONES : SALTWATER_ZONES) as readonly string[];
  const fallback = validZones[0]!;
  const TARGET = 1024;

  if (!Array.isArray(raw)) return null;

  // Detect flat array of strings (model ignored RLE instruction)
  if (raw.length > 0 && typeof raw[0] === "string") {
    const flat = raw as string[];
    if (flat.length >= TARGET) return flat.slice(0, TARGET).map((z) => validZones.includes(z) ? z : fallback);
    // Pad to 1024 with last zone or fallback
    const padded = flat.map((z) => validZones.includes(z) ? z : fallback);
    while (padded.length < TARGET) padded.push(padded[padded.length - 1] ?? fallback);
    return padded;
  }

  // RLE: each element should be [label, count]
  const out: string[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const label = typeof entry[0] === "string" && validZones.includes(entry[0]) ? entry[0] : fallback;
    const count = typeof entry[1] === "number" && entry[1] > 0 ? Math.floor(entry[1]) : 1;
    for (let i = 0; i < count && out.length < TARGET; i++) {
      out.push(label);
    }
    if (out.length >= TARGET) break;
  }

  if (out.length === 0) return null;
  while (out.length < TARGET) out.push(out[out.length - 1] ?? fallback);
  return out;
}

/**
 * Issue a single Poe classify call for one 32×32 greyscale depth tile.
 * Pulled out of the route handler so the tiled path can reuse the exact same
 * model, prompt, and JSON schema as the legacy single-tile path.
 *
 * Returns `{ zones, usage }` on success. Rejects with the underlying error
 * on failure — callers decide whether to fall back to a heuristic.
 */
async function classifyOneTileAi(
  gridBase64: string,
  waterType: "saltwater" | "freshwater",
  datasetId: string,
): Promise<{ zones: string[]; usage: { input_tokens: number; output_tokens: number } }> {
  if (poeBreaker.isOpen()) {
    throw new Error("poe_circuit_open");
  }
  // Resolve the Poe client before entering the retry loop so a missing
  // POE_API_KEY throws immediately (caught by runTiledClassify's per-tile
  // catch → null → heuristic fill) rather than being retried three times.
  const client = getPoeClient();
  try {
    const result = await withRetry(async () => {
      const input = buildVisionInput(
        `Classify the seafloor/lake-bed zones in this depth map.`,
        gridBase64,
      );

      const response = await (client as unknown as {
        responses: {
          create: (
            b: Record<string, unknown>,
            opts?: { signal?: AbortSignal },
          ) => Promise<{
            id: string;
            output_text: string;
            usage?: { input_tokens?: number; output_tokens?: number };
          }>;
        };
      }).responses.create(
        {
          model: POE_MODELS.CLASSIFY,
          input,
          instructions: buildClassifySystemPrompt(waterType),
          max_output_tokens: 2048,
          temperature: 0.1,
          truncation: "auto",
          metadata: { datasetId, waterType },
        },
        { signal: AbortSignal.timeout(POE_CLASSIFY_TIMEOUT_MS) },
      );

      return response;
    }, 3);

    if (!result.output_text || result.output_text.trim() === "") {
      throw new ZoneParseError("content-filtered or empty response from Poe");
    }

    // Try to parse the output text as JSON. If it's wrapped in prose/markdown,
    // extract the first `{...}` block and try again.
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(result.output_text);
    } catch {
      const embeddedMatch = result.output_text.match(/\{[\s\S]*\}/);
      if (embeddedMatch) {
        try {
          rawParsed = JSON.parse(embeddedMatch[0]);
        } catch {
          throw new ZoneParseError(
            `Poe returned invalid JSON for zone classification: ${result.output_text.slice(0, 200)}`,
          );
        }
      } else {
        throw new ZoneParseError(
          `Poe returned invalid JSON for zone classification: ${result.output_text.slice(0, 200)}`,
        );
      }
    }

    const parsed = rawParsed as { zones?: unknown };
    const zones = decodeRleZones(parsed.zones, waterType);
    if (!zones) {
      throw new ZoneParseError(
        `Poe returned unparseable zones payload: ${result.output_text.slice(0, 200)}`,
      );
    }

    poeBreaker.recordSuccess();
    return {
      zones,
      usage: {
        input_tokens: result.usage?.input_tokens ?? 0,
        output_tokens: result.usage?.output_tokens ?? 0,
      },
    };
  } catch (err) {
    // ZoneParseError means the model returned unparseable text (a quality
    // issue), not a service outage. Do NOT count it as a circuit-breaker
    // failure — otherwise 5 consecutive "prose" responses open the breaker
    // and cripple the substrate overlay for the rest of the server's uptime.
    if (
      (err as Error)?.message !== "poe_circuit_open" &&
      !(err instanceof ZoneParseError)
    ) {
      poeBreaker.recordFailure();
    }
    throw err;
  }
}

/**
 * TEST-ONLY — returns whether the module-level `poeBreaker` is currently open.
 * Used in unit tests that verify prose/malformed-JSON responses do not trip
 * the breaker. Never imported or called in production code.
 */
export function __isPoeBreakersOpen(): boolean {
  return poeBreaker.isOpen();
}

/**
 * Tiled-classification driver. Plans a tile grid for `(widthFull, heightFull)`,
 * pulls each tile's 32×32 depths out of `depthsFull`, classifies each tile via
 * the LLM (bounded concurrency, per-tile caching), and stitches the results
 * into a single `coarseWidth × coarseHeight` zones grid.
 *
 * Per-tile failures fall back to the depth-based heuristic for that tile only.
 * The whole-dataset call cap is enforced by `planTiles`' `maxPerSide` argument
 * (defaults to MAX_TILES_PER_SIDE = 4 → 16 tiles max). Identical tiles across
 * different datasets share cache entries via `tileFingerprint`.
 */
async function runTiledClassify(opts: {
  depthsFull: number[];
  widthFull: number;
  heightFull: number;
  waterType: "saltwater" | "freshwater";
  datasetId: string;
  userId: string;
}): Promise<{
  zones: string[];
  source: "ai" | "partial";
  coarseWidth: number;
  coarseHeight: number;
  plan: TilePlan;
  tilesAi: number;
  tilesHeuristic: number;
}> {
  const { depthsFull, widthFull, heightFull, waterType, datasetId, userId } = opts;
  const plan = planTiles(widthFull, heightFull, MAX_TILES_PER_SIDE);

  const tileDepths = plan.tiles.map((bounds) =>
    extractTileDepths32(depthsFull, widthFull, heightFull, bounds),
  );
  const fingerprints = tileDepths.map((d) => tileFingerprint(d));

  let tilesAi = 0;
  let tilesHeuristic = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const perTileLabels = await mapWithConcurrency<number[], string[] | null>(
    tileDepths,
    TILE_CONCURRENCY,
    async (depths, i) => {
      // Per-tile cache, keyed by waterType + tile fingerprint — independent
      // of datasetId so identical tiles across datasets share entries.
      const tileCacheKey = hashCacheKey("tile", waterType, fingerprints[i]!);
      const hit = globalPoeCache.get(tileCacheKey);
      if (hit) {
        try {
          const parsed = JSON.parse(hit) as string[];
          if (Array.isArray(parsed) && parsed.length === TILE_SIZE * TILE_SIZE) {
            tilesAi++;
            return parsed;
          }
        } catch {
          // fall through to live call
        }
      }

      try {
        const gridBase64 = tileDepthsToPngDataUrl(depths);
        const { zones, usage } = await classifyOneTileAi(gridBase64, waterType, datasetId);
        if (!Array.isArray(zones) || zones.length !== TILE_SIZE * TILE_SIZE) {
          throw new Error(`tile classifier returned ${zones?.length ?? 0} labels`);
        }
        globalPoeCache.set(tileCacheKey, JSON.stringify(zones));
        tilesAi++;
        totalInputTokens += usage.input_tokens;
        totalOutputTokens += usage.output_tokens;
        return zones;
      } catch (err) {
        // Partial failure — return null so stitch() can fill this tile from
        // the depth-based heuristic without sinking the whole request.
        logger.warn(
          { err, tileIndex: i, tileRow: plan.tiles[i]?.tileRow, tileCol: plan.tiles[i]?.tileCol },
          `[poe/classify] tile ${i} (${plan.tiles[i]?.tileRow},${plan.tiles[i]?.tileCol}) failed: ${
            (err as Error)?.message ?? "unknown"
          }`,
        );
        tilesHeuristic++;
        return null;
      }
    },
  );

  const zones = stitchTileLabels(
    perTileLabels,
    plan,
    widthFull,
    heightFull,
    (idx) => heuristicClassifyByDepth(tileDepths[idx]!, waterType),
  );

  if (totalInputTokens > 0 || totalOutputTokens > 0) {
    await logUsage(
      userId,
      POE_MODELS.CLASSIFY,
      "classify",
      totalInputTokens,
      totalOutputTokens,
    );
  }

  return {
    zones,
    source: tilesHeuristic === 0 ? "ai" : "partial",
    coarseWidth: plan.coarseWidth,
    coarseHeight: plan.coarseHeight,
    plan,
    tilesAi,
    tilesHeuristic,
  };
}

const ClassifyBodySchema = z.object({
  gridBase64: z.string().min(1, "gridBase64 is required"),
  waterType: z.enum(["saltwater", "freshwater"]).optional().default("saltwater"),
  datasetId: z.string().optional(),
  gridHash: z.string().optional(),
  depths32: z.array(z.number()).optional(),
  depthsFull: z.array(z.number()).optional(),
  widthFull: z.number().optional(),
  heightFull: z.number().optional(),
});

router.post("/classify", asyncHandler(async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  const parsed = ClassifyBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.message });
    return;
  }

  const {
    gridBase64,
    waterType,
    datasetId,
    gridHash,
    depths32,
    depthsFull,
    widthFull,
    heightFull,
  } = parsed.data;

  // Sample bundled ShoreZone + ENC substrate polygons onto the 32×32 grid so
  // covered cells can be grounded in surveyed substrate (vs. inferred from
  // the depth map alone). For datasets without preset bbox / coverage this
  // returns an empty sample with fingerprint "00000000" — keeping behaviour
  // unchanged for uploads and out-of-coverage regions.
  const substrate = datasetId ? sampleSubstrateGrid(datasetId) : sampleSubstrateGrid("");
  const substrateFp = substrate.fingerprint;
  const substratePrompt = renderSubstrateGroundTruth(substrate, waterType);

  // ── Stitched-result cache lookup ───────────────────────────────────────
  // The substrate fingerprint feeds the primary content hash so changing
  // substrate coverage (e.g. a new ShoreZone release) invalidates the
  // globalPoeCache entry even when datasetId / waterType / gridBase64 are
  // unchanged. Both single-tile and tiled paths share this cache; coarse
  // dimensions live on the namespaced secondary entry so a tiled hit can
  // be returned at full fidelity.
  const cacheKey = hashCacheKey(`${datasetId ?? "unknown"}|sub:${substrateFp}`, waterType, gridBase64);
  const cached = globalPoeCache.get(cacheKey);
  if (cached) {
    const zones = JSON.parse(cached) as string[];
    const secondary = gridHash
      ? datasetZonesCache.get(zoneCacheKey(userId, gridHash, waterType, substrateFp))
      : null;
    const coarseWidth = secondary?.coarseWidth ?? TILE_SIZE;
    const coarseHeight = secondary?.coarseHeight ?? TILE_SIZE;
    res.json({
      zones,
      fromCache: true,
      source: secondary?.source ?? "ai",
      substrateFp,
      coarseWidth,
      coarseHeight,
      tilesTotal: (coarseWidth / TILE_SIZE) * (coarseHeight / TILE_SIZE),
    });
    return;
  }

  // Strong content fingerprint of the actual depth payload — used to detect
  // FNV-1a 32-bit collisions on the secondary (gridHash, waterType,
  // substrateFp) cache before serving a cached entry from a different grid.
  const contentHash = createHash("sha256").update(gridBase64).digest("hex");
  if (gridHash) {
    const secondaryKey = zoneCacheKey(userId, gridHash, waterType, substrateFp);
    const inMemoryHit = datasetZonesCache.get(secondaryKey);
    const diskHit = inMemoryHit ?? (await readZoneDiskByKey(secondaryKey));
    if (
      diskHit &&
      diskHit.waterType === waterType &&
      (diskHit.contentHash === undefined || diskHit.contentHash === contentHash)
    ) {
      // Hydrate in-memory cache from a disk hit so subsequent reads skip I/O.
      if (!inMemoryHit) datasetZonesCache.set(secondaryKey, diskHit);
      const coarseWidth = diskHit.coarseWidth ?? TILE_SIZE;
      const coarseHeight = diskHit.coarseHeight ?? TILE_SIZE;
      res.json({
        zones: diskHit.zones,
        fromCache: true,
        source: diskHit.source ?? "ai",
        substrateFp,
        coarseWidth,
        coarseHeight,
        tilesTotal: (coarseWidth / TILE_SIZE) * (coarseHeight / TILE_SIZE),
      });
      return;
    }
  }

  // ── Tiled path ────────────────────────────────────────────────────────
  // Triggered when the client sends a full-resolution depth grid. The
  // planner decides how many tiles to use; if it picks K=1 we still fall
  // through to the single-tile path below so small datasets behave exactly
  // as they did before this change. Substrate reconciliation runs on the
  // 32×32 substrate grid so it only applies on the single-tile path; tiled
  // output stays as the model produced it (substrateFp still namespaces the
  // cache so a substrate update still invalidates entries).
  if (
    Array.isArray(depthsFull) &&
    typeof widthFull === "number" &&
    typeof heightFull === "number" &&
    widthFull > 0 &&
    heightFull > 0 &&
    depthsFull.length === widthFull * heightFull
  ) {
    const plan = planTiles(widthFull, heightFull, MAX_TILES_PER_SIDE);
    if (plan.K > 1) {
      try {
        const out = await runTiledClassify({
          depthsFull,
          widthFull,
          heightFull,
          waterType,
          datasetId: datasetId ?? "unknown",
          userId,
        });

        // Persist the stitched result. Primary content-hash cache stores
        // just the zones (back-compat with single-tile cache entries) and the
        // secondary namespaced cache carries coarse dimensions, provenance,
        // and contentHash for collision detection on read.
        globalPoeCache.set(cacheKey, JSON.stringify(out.zones));
        if (gridHash) {
          const secondaryKey = zoneCacheKey(userId, gridHash, waterType, substrateFp);
          const cachedEntry: CachedZones = {
            zones: out.zones,
            waterType,
            classifiedAt: Date.now(),
            source: out.source,
            contentHash,
            coarseWidth: out.coarseWidth,
            coarseHeight: out.coarseHeight,
          };
          datasetZonesCache.set(secondaryKey, cachedEntry);
          void writeZoneDisk(secondaryKey, cachedEntry);
        }

        res.json({
          zones: out.zones,
          fromCache: false,
          source: out.source,
          substrateFp,
          coarseWidth: out.coarseWidth,
          coarseHeight: out.coarseHeight,
          tilesTotal: out.plan.tiles.length,
          tilesAi: out.tilesAi,
          tilesHeuristic: out.tilesHeuristic,
        });
        return;
      } catch (err) {
        // If the *driver itself* explodes (not just per-tile failures —
        // those are absorbed inside runTiledClassify), drop through to the
        // single-tile/heuristic fallback below.
        logger.warn(
          { err },
          `[poe/classify] tiled path failed, falling back to single-tile: ${
            (err as Error)?.message ?? "unknown"
          }`,
        );
      }
    }
  }

  // ── Single-tile path (substrate-grounded) ────────────────────────────
  try {
    // Circuit breaker — skip the Poe call immediately when the breaker is
    // open (5 consecutive failures within the last 30 s). The error falls
    // into the catch block below and the heuristic takes over if depths32
    // was supplied. On half-open one probe is allowed through so the breaker
    // can self-heal once Poe recovers.
    if (poeBreaker.isOpen()) {
      throw Object.assign(new Error("poe_circuit_open"), { circuitOpen: true });
    }

    // Resolve the Poe client once, *before* entering the withRetry loop.
    // getPoeClient() throws synchronously when POE_API_KEY is absent; doing
    // this outside the retry closure means the missing-key error is caught
    // immediately by the outer try/catch below (→ heuristic fallback or
    // handlePoeError) rather than being retried three times with back-off
    // delays (7 s total), which could race against upstream timeouts and
    // reach the global Express error handler instead.
    const client = getPoeClient();

    const result = await withRetry(async () => {
      const promptText = substratePrompt
        ? `Classify the seafloor/lake-bed zones in this depth map.\n\n${substratePrompt}\n\nFor every cell where a substrate label is provided above, you MUST output that exact label. Only reason from the depth map for cells marked "?".`
        : `Classify the seafloor/lake-bed zones in this depth map.`;
      const input = buildVisionInput(promptText, gridBase64);

      const response = await (client as unknown as {
        responses: {
          create: (
            b: Record<string, unknown>,
            opts?: { signal?: AbortSignal },
          ) => Promise<{
            id: string;
            output_text: string;
            usage?: { input_tokens?: number; output_tokens?: number };
          }>;
        };
      }).responses.create(
        {
          model: POE_MODELS.CLASSIFY,
          input,
          instructions: buildClassifySystemPrompt(waterType),
          max_output_tokens: 2048,
          temperature: 0.1,
          truncation: "auto",
          metadata: { datasetId: datasetId ?? "unknown", waterType },
        },
        { signal: AbortSignal.timeout(POE_CLASSIFY_TIMEOUT_MS) },
      );

      return response;
    }, 3);
    // Note: `client` is shared across retries — this is intentional.
    // The Poe client is a stateless HTTP wrapper (OpenAI-compatible) so
    // re-using the same instance across retry attempts is safe.

    // Try to parse the output text as JSON. Extract the first `{...}` block
    // when the model wraps its payload in prose or markdown.
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(result.output_text);
    } catch {
      const embeddedMatch = result.output_text?.match(/\{[\s\S]*\}/);
      if (embeddedMatch) {
        try {
          rawParsed = JSON.parse(embeddedMatch[0]);
        } catch {
          throw new ZoneParseError(
            `Poe returned invalid JSON for zone classification: ${(result.output_text ?? "").slice(0, 200)}`,
          );
        }
      } else {
        throw new ZoneParseError(
          `Poe returned invalid JSON for zone classification: ${(result.output_text ?? "").slice(0, 200)}`,
        );
      }
    }

    const parsedObj = rawParsed as { zones?: unknown };
    let zones = decodeRleZones(parsedObj.zones, waterType);
    if (!zones) {
      throw new ZoneParseError(
        `Poe returned unparseable zones payload: ${(result.output_text ?? "").slice(0, 200)}`,
      );
    }

    // Post-AI reconciliation — covered cells in surveyed substrate are the
    // source of truth. The prompt instructs the model to honour them, but we
    // enforce it server-side so model drift / hallucination can't override
    // measured reality. Uncovered cells (no polygon coverage) are left as the
    // model produced them.
    if (substrate.hasCoverage && zones.length === substrate.labels.length) {
      const reconciled = zones.slice();
      for (let i = 0; i < substrate.labels.length; i++) {
        const lbl = substrate.labels[i];
        if (lbl) reconciled[i] = substrateToZone(lbl, waterType);
      }
      zones = reconciled;
    }

    globalPoeCache.set(cacheKey, JSON.stringify(zones));

    // Populate secondary zone cache keyed by sha256(gridHash | waterType |
    // substrateFp). The waterType+substrateFp namespacing prevents stale
    // labels surviving across either dimension, and the stored contentHash
    // lets future reads detect FNV-1a 32-bit collisions between two unrelated
    // depth payloads before serving stale labels.
    if (gridHash) {
      const secondaryKey = zoneCacheKey(userId, gridHash, waterType, substrateFp);
      const cachedEntry: CachedZones = {
        zones,
        waterType,
        classifiedAt: Date.now(),
        source: "ai",
        contentHash,
        coarseWidth: TILE_SIZE,
        coarseHeight: TILE_SIZE,
      };
      datasetZonesCache.set(secondaryKey, cachedEntry);
      void writeZoneDisk(secondaryKey, cachedEntry);
    }

    await logUsage(
      userId,
      POE_MODELS.CLASSIFY,
      "classify",
      result.usage?.input_tokens ?? 0,
      result.usage?.output_tokens ?? 0,
    );

    poeBreaker.recordSuccess();
    res.json({
      zones,
      fromCache: false,
      source: "ai",
      substrateFp,
      coarseWidth: TILE_SIZE,
      coarseHeight: TILE_SIZE,
      tilesTotal: 1,
      tilesAi: 1,
      tilesHeuristic: 0,
    });
  } catch (err) {
    // Record Poe failures so the circuit breaker can track consecutive errors.
    // Circuit-open errors are self-inflicted (we threw them above) — don't
    // count those or the breaker would never close.
    // ZoneParseError is a content-quality issue (model returned prose instead
    // of JSON) — NOT a service outage — so it must not trip the breaker either.
    if (
      !(err as { circuitOpen?: boolean }).circuitOpen &&
      !(err instanceof ZoneParseError)
    ) {
      poeBreaker.recordFailure();
    }
    // Depth-based fallback — always return a 200 with *some* overlay so the
    // frontend never sees a non-2xx from this endpoint. Heuristic results are
    // NEVER written to globalPoeCache / datasetZonesCache / disk so a later
    // successful AI call can take over and be cached normally.
    // If depths32 is available (the normal path — client always sends it) we
    // compute a genuine depth-banded heuristic; otherwise we emit a uniform
    // fill of the first zone, which is still a valid 200 response.
    logger.warn(
      { err },
      `[poe/classify] AI unavailable (${(err as Error)?.message ?? "unknown"}) — returning depth-based heuristic`,
    );
    const substrateZoneLabels = substrate.hasCoverage
      ? substrate.labels.map((l) => (l ? substrateToZone(l, waterType) : null))
      : null;
    const validDepths = Array.isArray(depths32) && depths32.length === 1024 ? depths32 : null;
    const fallbackZone = (waterType === "freshwater" ? FRESHWATER_ZONES : SALTWATER_ZONES)[0]!;
    const zones = validDepths
      ? heuristicClassifyByDepth(validDepths, waterType, substrateZoneLabels)
      : new Array<string>(1024).fill(fallbackZone);
    res.json({
      zones,
      fromCache: false,
      source: "heuristic",
      substrateFp,
      coarseWidth: TILE_SIZE,
      coarseHeight: TILE_SIZE,
      tilesTotal: 1,
      tilesAi: 0,
      tilesHeuristic: 1,
    });
    return;
    // NOTE: handlePoeError is intentionally NOT called here. The classify
    // endpoint always returns 200 — either AI labels or a heuristic fill.
    // Surfacing Poe infrastructure errors as 4xx/5xx to the browser causes
    // the frontend to show an error banner even though the overlay is usable.
  }
}));

// ---------------------------------------------------------------------------
// Query (multi-turn, tool-calling via Responses API)
// ---------------------------------------------------------------------------

const BATHYSCAN_TOOLS: PoeToolSchema[] = [
  {
    type: "function",
    function: {
      name: "navigateToLocation",
      description: "Move the 3D camera to a specific geographical location",
      parameters: {
        type: "object",
        properties: {
          lon: { type: "number", description: "Longitude in decimal degrees" },
          lat: { type: "number", description: "Latitude in decimal degrees" },
          depth: { type: "number", description: "Optional target depth in metres below sea level" },
        },
        required: ["lon", "lat"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "setDepthFilter",
      description: "Filter the terrain visualisation to show only a specific depth range",
      parameters: {
        type: "object",
        properties: {
          minDepth: { type: "number", description: "Minimum depth in metres" },
          maxDepth: { type: "number", description: "Maximum depth in metres" },
        },
        required: ["minDepth", "maxDepth"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "highlightZone",
      description: "Highlight all cells of a specific terrain zone type across the dataset",
      parameters: {
        type: "object",
        properties: {
          zoneName: {
            type: "string",
            description: "Zone type name (e.g. volcanic_vent_field, coral_reef_potential, sandy_shelf)",
          },
        },
        required: ["zoneName"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resetView",
      description: "Reset the camera to the default overview position for the current dataset",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "setColormap",
      description: "Change the depth-to-colour mapping used to render the terrain",
      parameters: {
        type: "object",
        properties: {
          colormap: {
            type: "string",
            enum: ["viridis", "plasma", "turbo", "ocean", "terrain", "greys"],
            description: "Named colormap to apply",
          },
        },
        required: ["colormap"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggleWireframe",
      description: "Toggle wireframe mode on or off for the terrain mesh",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "true to show wireframe, false to hide" },
        },
        required: ["enabled"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "setVerticalExaggeration",
      description: "Adjust how much the depth axis is vertically exaggerated in the 3D view",
      parameters: {
        type: "object",
        properties: {
          factor: {
            type: "number",
            description: "Exaggeration multiplier (1 = true scale, 2–10 = exaggerated)",
          },
        },
        required: ["factor"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "showDatasetInfo",
      description: "Display metadata panel for the current dataset (source, resolution, collection date)",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "searchDatasets",
      description:
        "Search the BathyScan public dataset catalog for bathymetry, substrate, habitat (EFH), lidar, or chart data. Use this when the user asks to find data, discover datasets, or look for coverage in a geographic area.",
      parameters: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "Free-text search query derived from the user's request (location names, species, data type keywords, etc.)",
          },
          dataType: {
            type: "string",
            enum: ["bathymetry", "substrate", "habitat", "lidar", "chart"],
            description: "Optional: constrain results to a specific data type",
          },
          waterType: {
            type: "string",
            enum: ["saltwater", "freshwater"],
            description: "Optional: constrain to saltwater or freshwater datasets",
          },
        },
        required: ["q"],
        additionalProperties: false,
      },
    },
  },
];

type ResponsesOutputItem = {
  type: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: Array<{ type: string; text?: string }>;
};

const PoeHistoryEntrySchema = z.object({
  role: z.enum(["user", "assistant"], {
    errorMap: () => ({ message: 'history[].role must be "user" or "assistant"' }),
  }),
  content: z.string(),
});

const PoeQueryBodySchema = z.object({
  userMessage: z.string().min(1, "userMessage is required"),
  context: z.record(z.unknown()).optional(),
  history: z
    .array(PoeHistoryEntrySchema, { invalid_type_error: "history must be an array" })
    .max(50, "history must not exceed 50 entries")
    .optional()
    .default([]),
  previousResponseId: z.string().optional(),
  includeTools: z.boolean().optional().default(true),
});

router.post("/query", asyncHandler(async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  const parsedQuery = PoeQueryBodySchema.safeParse(req.body);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "invalid_request", details: parsedQuery.error.message });
    return;
  }

  const { userMessage, context, history, previousResponseId, includeTools } = parsedQuery.data;

  const systemPrompt = context
    ? `You are BathyScan's AI guide for underwater terrain exploration. Dataset: "${context["datasetName"] ?? "Unknown"}". Water type: ${context["waterType"] ?? "saltwater"}. Depth range: ${context["minDepth"] ?? 0}m to ${context["maxDepth"] ?? 0}m. Camera position: lon ${context["lon"] ?? 0}, lat ${context["lat"] ?? 0}, depth ${context["cameraDepth"] ?? 0}m. Zone: "${context["zoneName"] ?? "unknown"}". When the user asks to navigate, highlight zones, filter depths, change the view, or adjust settings — call the appropriate tool. Answer geological questions directly in text. Be concise and scientific.`
    : "You are BathyScan's AI terrain guide. Help the user explore and understand the seafloor terrain.";

  try {
    const client = getPoeClient();

    const inputMessages: Array<{ role: string; content: string }> = [
      ...history.slice(-10),
      { role: "user", content: userMessage },
    ];

    const body: Record<string, unknown> = {
      model: POE_MODELS.QUERY_TOOLS,
      input: inputMessages,
      instructions: systemPrompt,
      temperature: 0.3,
      max_output_tokens: 1024,
      truncation: "auto",
    };

    if (previousResponseId) {
      body["previous_response_id"] = previousResponseId;
    }

    if (includeTools) {
      body["tools"] = BATHYSCAN_TOOLS;
      body["tool_choice"] = "auto";
    }

    const response = await withRetry(
      () =>
        (client as unknown as {
          responses: {
            create: (
              b: Record<string, unknown>,
              opts?: { signal?: AbortSignal },
            ) => Promise<{
              id: string;
              output_text: string;
              output?: ResponsesOutputItem[];
              usage?: { input_tokens?: number; output_tokens?: number };
            }>;
          };
        }).responses.create(body, {
          signal: AbortSignal.timeout(POE_QUERY_TIMEOUT_MS),
        }),
      3,
    );

    const toolCalls = (response.output ?? [])
      .filter((item) => item.type === "function_call")
      .map((item) => ({
        name: item.name ?? "",
        args: (() => {
          try {
            return JSON.parse(item.arguments ?? "{}");
          } catch {
            return {};
          }
        })(),
        id: item.call_id,
      }));

    await logUsage(
      userId,
      POE_MODELS.QUERY_TOOLS,
      "query",
      response.usage?.input_tokens ?? 0,
      response.usage?.output_tokens ?? 0,
    );

    res.json({
      toolCalls,
      text: response.output_text ?? null,
      responseId: response.id ?? null,
    });
  } catch (err) {
    handlePoeError(err, res);
  }
}));

// ---------------------------------------------------------------------------
// Help Q&A — answers user questions about BathyScan using in-app help
// articles as grounding context. Restricted to app-related topics by the
// system prompt. Auth + rate limit are already applied via router.use above.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";

function resolveHelpDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env["BATHYSCAN_HELP_DIR"],
    path.resolve(here, "../../../bathyscan/help/articles"),
    path.resolve(here, "../../bathyscan/help/articles"),
    path.resolve(process.cwd(), "artifacts/bathyscan/help/articles"),
    path.resolve(process.cwd(), "../bathyscan/help/articles"),
    path.resolve(process.cwd(), "bathyscan/help/articles"),
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && readdirSync(candidate).some((f) => f.endsWith(".md"))) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

let helpContextCache: string | null = null;

function loadHelpContext(): string {
  if (helpContextCache !== null) return helpContextCache;
  const dir = resolveHelpDir();
  if (!dir) {
    logger.warn("[poe/help] Could not locate bathyscan/help/articles directory");
    helpContextCache = "";
    return helpContextCache;
  }
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    const chunks: string[] = [];
    for (const f of files) {
      const raw = readFileSync(path.join(dir, f), "utf8");
      const stripped = raw.replace(/^---[\s\S]*?---\n?/, "").trim();
      chunks.push(`# Article: ${f}\n\n${stripped}`);
    }
    helpContextCache = chunks.join("\n\n---\n\n");
    logger.info({ articleCount: files.length, dir }, `[poe/help] Loaded ${files.length} help articles from ${dir}`);
  } catch (err) {
    logger.warn({ err }, "[poe/help] Could not load help articles");
    helpContextCache = "";
  }
  return helpContextCache;
}

const HELP_SYSTEM_PROMPT = `You are the in-app help assistant for BathyScan, a 3D seafloor and lake-bed exploration web app. Answer the user's question using ONLY the help articles provided below as grounding truth. If the question is not about BathyScan or the answer is not in the articles, politely say you can only answer questions about the BathyScan app. Keep answers concise (3-6 sentences) and refer to specific features, panels, and keyboard shortcuts by name when relevant. Do not invent features that are not described in the articles.`;

const HelpBodySchema = z.object({
  question: z
    .string({ required_error: "question is required", invalid_type_error: "question must be a string" })
    .trim()
    .min(1, "question is required")
    .max(1000, "question must be ≤ 1000 characters"),
  history: z
    .array(PoeHistoryEntrySchema, { invalid_type_error: "history must be an array" })
    .max(50, "history must not exceed 50 entries")
    .optional()
    .default([]),
});

router.post("/help", asyncHandler(async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  const parsedHelp = HelpBodySchema.safeParse(req.body);
  if (!parsedHelp.success) {
    res.status(400).json({ error: "invalid_request", details: parsedHelp.error.message });
    return;
  }

  const { question, history } = parsedHelp.data;

  const helpContext = loadHelpContext();
  const systemPrompt = `${HELP_SYSTEM_PROMPT}\n\n=== BATHYSCAN HELP ARTICLES ===\n\n${helpContext}`;

  const cleanHistory = history
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  try {
    const client = getPoeClient();
    const typedHistory = cleanHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    const completion = await withRetry(
      () =>
        client.chat.completions.create(
          {
            model: POE_MODELS.DESCRIBE_QUICK,
            messages: [
              { role: "system" as const, content: systemPrompt },
              ...typedHistory,
              { role: "user" as const, content: question.trim() },
            ],
            max_tokens: 400,
            temperature: 0.3,
            stream: false,
          },
          { signal: AbortSignal.timeout(POE_HELP_TIMEOUT_MS) },
        ),
      2,
    );

    const answer = completion.choices[0]?.message?.content ?? "";
    const usage = completion.usage;
    await logUsage(
      userId,
      POE_MODELS.DESCRIBE_QUICK,
      "help",
      usage?.prompt_tokens ?? 0,
      usage?.completion_tokens ?? 0,
    );

    res.json({ answer });
  } catch (err) {
    handlePoeError(err, res);
  }
}));

// ---------------------------------------------------------------------------
// POST /upscale — auto-upscale a 2D heatmap PNG via the TopazLabs model on
// Poe. Accepts a base64-encoded PNG and an upscale factor (2 or 4). Returns
// the upscaled image as a base64 PNG. Reuses the module-level circuit breaker.
//
// On failure (network error, circuit open, no image in response) the endpoint
// returns a non-200 status so the frontend can fall back silently to the
// original bitmap. No error toast is surfaced to the user.
// ---------------------------------------------------------------------------

const TOPAZ_MODEL = "TopazLabs";
const POE_UPSCALE_TIMEOUT_MS = 90_000;

/**
 * Strict data-URL allowlist for image extraction from Poe model responses.
 *
 * Only inline data URLs (`data:image/...;base64,...`) are accepted from model
 * output. Remote URL fetching is intentionally omitted to prevent SSRF — LLM
 * output is untrusted and must not be used as a fetch target without a strong
 * hostname/IP allowlist enforced after DNS resolution.
 *
 * Returns the extracted data URL string or null if no safe image was found.
 */
function extractDataUrlFromModelResponse(
  message: { content?: string | Array<{ type: string; image_url?: { url: string } }> | null } | undefined,
): string | null {
  if (!message) return null;

  // 1. Image content blocks (some models return structured image_url blocks)
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block.type === "image_url" && block.image_url?.url?.startsWith("data:image/")) {
        return block.image_url.url;
      }
    }
  }

  // 2. Data URL embedded in plain text content
  if (typeof message.content === "string") {
    const m = message.content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
    if (m?.[0]) return m[0];
  }

  return null;
}

router.post("/upscale", asyncHandler(async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  // `generated` is accepted for spec alignment (reserved for future use by
  // Topaz-specific prompting); `upscaleFactor` is the primary control (2 or 4).
  const { imageBase64, upscaleFactor, generated: _generated } = req.body as {
    imageBase64?: string;
    upscaleFactor?: number;
    generated?: boolean;
  };

  if (!imageBase64) {
    res.status(400).json({ error: "missing_field", details: "imageBase64 is required" });
    return;
  }

  const factor = upscaleFactor === 4 ? 4 : 2;

  if (poeBreaker.isOpen()) {
    res.status(503).json({ error: "circuit_open", details: "Upscale service temporarily unavailable" });
    return;
  }

  const dataUrl = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/png;base64,${imageBase64}`;

  try {
    const client = getPoeClient();

    const completion = await withRetry(
      () =>
        client.chat.completions.create(
          {
            model: TOPAZ_MODEL,
            messages: [
              {
                role: "user" as const,
                content: [
                  {
                    type: "image_url" as const,
                    image_url: { url: dataUrl },
                  },
                  {
                    type: "text" as const,
                    text: `Upscale this image by ${factor}x. Enhance sharpness and fine detail.`,
                  },
                ],
              },
            ],
            max_tokens: 512,
            stream: false,
          },
          { signal: AbortSignal.timeout(POE_UPSCALE_TIMEOUT_MS) },
        ),
      2,
    );

    poeBreaker.recordSuccess();

    const message = completion.choices[0]?.message;

    // Extract image from response — only data URLs are accepted (no remote
    // URL fetching) to prevent SSRF from untrusted model output.
    const resultBase64 = extractDataUrlFromModelResponse(
      message as Parameters<typeof extractDataUrlFromModelResponse>[0],
    );

    const usage = completion.usage;
    await logUsage(
      userId,
      TOPAZ_MODEL,
      "upscale",
      usage?.prompt_tokens ?? 0,
      usage?.completion_tokens ?? 0,
    );

    if (!resultBase64) {
      logger.warn({ model: TOPAZ_MODEL }, "[poe/upscale] TopazLabs returned no image in response");
      res.status(502).json({ error: "no_image_in_response", details: "TopazLabs returned no image" });
      return;
    }

    res.json({ imageBase64: resultBase64 });
  } catch (err) {
    poeBreaker.recordFailure();
    logger.warn({ err }, "[poe/upscale] Upscale request failed");
    handlePoeError(err, res);
  }
}));

export default router;
