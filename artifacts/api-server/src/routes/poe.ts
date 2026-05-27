import { Router, type Request, type Response } from "express";
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

/** Per-route upstream timeouts (ms) — sized to the expected upstream work. */
const POE_MODELS_TIMEOUT_MS = 10_000;
const POE_CLASSIFY_TIMEOUT_MS = 45_000;
const POE_QUERY_TIMEOUT_MS = 30_000;
const POE_DESCRIBE_TIMEOUT_MS = 60_000;
const POE_HELP_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// GET /models — Clerk-gated and rate-limited like the other Poe routes
// ---------------------------------------------------------------------------

let modelsCache: { data: unknown; expiresAt: number } | null = null;

router.get("/models", async (_req, res) => {
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
    res.status(502).json({ error: "models_unavailable", message: "Could not fetch Poe models list" });
  }
});

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
  } catch {
  }
}

function handlePoeError(err: unknown, res: Response): void {
  if (err instanceof PoeCreditsError) {
    res.status(402).json({ error: "credits_exhausted", message: err.message });
  } else if (err instanceof PoeRateLimitError) {
    res.status(429).json({ error: "rate_limit", message: err.message });
  } else if (err instanceof PoeAuthError) {
    res.status(401).json({ error: "auth_error", message: "AI service authentication failed" });
  } else {
    const msg = err instanceof Error ? err.message : "Unknown Poe API error";
    res.status(500).json({ error: "poe_error", message: msg });
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
  gridHash: string,
  waterType: "saltwater" | "freshwater",
  substrateFp: string,
): string {
  return createHash("sha256")
    .update(`${gridHash}|${waterType}|${substrateFp}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Disk persistence — survives process restarts
// Files stored at /tmp/zone-cache/<sha256>.json (hex filename, always safe)
// ---------------------------------------------------------------------------

const ZONE_CACHE_DIR = "/tmp/zone-cache";

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

/** Read a single zone cache entry by namespaced cache key from disk. */
export async function readZoneDiskByKey(cacheKey: string): Promise<CachedZones | null> {
  if (!isValidZoneCacheKey(cacheKey)) return null; // reject path traversal attempts
  try {
    const file = path.join(ZONE_CACHE_DIR, `${cacheKey}.json`);
    // Resolve and verify the path stays inside ZONE_CACHE_DIR
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(ZONE_CACHE_DIR) + path.sep)) return null;
    const raw = await fsPromises.readFile(resolved, "utf8");
    return JSON.parse(raw) as CachedZones;
  } catch {
    return null;
  }
}

/**
 * Compatibility helper for callers that still hold a (gridHash, waterType,
 * substrateFp) triple. Derives the namespaced sha256 cache key and delegates
 * to `readZoneDiskByKey`. Returned entries are also waterType-validated to
 * guard against on-disk tampering or stale-format files.
 */
export async function readZoneDiskByHash(
  gridHash: string,
  waterType: "saltwater" | "freshwater",
  substrateFp: string,
): Promise<CachedZones | null> {
  const entry = await readZoneDiskByKey(zoneCacheKey(gridHash, waterType, substrateFp));
  if (!entry) return null;
  if (entry.waterType !== waterType) return null;
  return entry;
}

async function writeZoneDisk(cacheKey: string, data: CachedZones): Promise<void> {
  if (!isValidZoneCacheKey(cacheKey)) {
    console.warn(`[zones] Rejected write for invalid cacheKey: ${JSON.stringify(cacheKey)}`);
    return;
  }
  try {
    await fsPromises.mkdir(ZONE_CACHE_DIR, { recursive: true });
    const file = path.join(ZONE_CACHE_DIR, `${cacheKey}.json`);
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(ZONE_CACHE_DIR) + path.sep)) return;
    await fsPromises.writeFile(resolved, JSON.stringify(data), "utf8");
  } catch (err) {
    console.warn(`[zones] Failed to write disk cache for ${cacheKey}: ${(err as Error).message}`);
  }
}

/**
 * Hydrate in-memory cache from disk on startup (non-blocking). Legacy files
 * (FNV-1a 8-char or `<gridHash>-<substrateFp>` combined keys) written before
 * the sha256-namespaced cache-key change are silently deleted — the cache is
 * intentionally lossy on format change (one-off cleanup, not a migration)
 * since AI re-classification is the only way to know the correct
 * (key, waterType, substrateFp) tuple.
 */
async function hydrateCacheFromDisk(): Promise<void> {
  try {
    await fsPromises.mkdir(ZONE_CACHE_DIR, { recursive: true });
    const files = await fsPromises.readdir(ZONE_CACHE_DIR);
    await Promise.all(
      files.map(async (f) => {
        if (!f.endsWith(".json")) return;
        const key = f.slice(0, -5);
        if (!isValidZoneCacheKey(key)) {
          // Stale legacy entry — drop it. We can't deduce the right new key
          // without the original (waterType, substrateFp), so the cache pays
          // a one-time miss.
          try {
            await fsPromises.unlink(path.join(ZONE_CACHE_DIR, f));
          } catch {
            // best-effort
          }
          return;
        }
        const data = await readZoneDiskByKey(key);
        if (data && !datasetZonesCache.has(key)) {
          datasetZonesCache.set(key, data);
        }
      }),
    );
  } catch {
    // Non-fatal — cache simply starts empty
  }
}

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
  if (waterType === "freshwater") {
    return `You are an expert limnologist and freshwater bathymetric analyst. You will be shown a greyscale depth map of a lake or reservoir where darker pixels represent shallower depths and lighter pixels represent deeper depths. Classify each cell of the 32×32 grid into one of these freshwater substrate types: aquatic_vegetation, sandy_lake_bed, rocky_shoreline, silt_deep, gravel_bed, bedrock_shelf, submerged_wood, clay_flat. Return exactly 1024 labels in row-major order. Use limnological reasoning.`;
  }
  return `You are an expert marine geologist and bathymetric data analyst. You will be shown a greyscale depth map where darker pixels represent shallower depths and lighter pixels represent deeper depths. Classify each cell of the 32×32 grid into one of: sandy_shelf, coarse_sediment, silt_plain, basalt_rock, volcanic_vent_field, trench_wall, seamount_flank, coral_reef_potential. Return exactly 1024 labels in row-major order. Favour geological reasoning over simple depth thresholds.`;
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

function buildClassifyZoneSchema(waterType: "saltwater" | "freshwater") {
  const zones = waterType === "freshwater" ? FRESHWATER_ZONES : SALTWATER_ZONES;
  return {
    type: "object",
    properties: {
      zones: {
        type: "array",
        items: { type: "string", enum: zones },
        minItems: 1024,
        maxItems: 1024,
      },
    },
    required: ["zones"],
    additionalProperties: false,
  };
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
  const result = await withRetry(async () => {
    const client = getPoeClient();
    const input = buildVisionInput(
      `Classify the seafloor/lake-bed zones in this depth map. Return exactly 1024 zone labels for the 32×32 grid.`,
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
        output_format: {
          type: "json_schema",
          schema: buildClassifyZoneSchema(waterType),
        },
        max_output_tokens: 8192,
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

  let parsed: { zones: string[] };
  try {
    parsed = JSON.parse(result.output_text) as { zones: string[] };
  } catch {
    throw new ZoneParseError(
      `Poe returned invalid JSON for zone classification: ${result.output_text.slice(0, 200)}`,
    );
  }

  return {
    zones: parsed.zones,
    usage: {
      input_tokens: result.usage?.input_tokens ?? 0,
      output_tokens: result.usage?.output_tokens ?? 0,
    },
  };
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
        console.warn(
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

router.post("/classify", async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  const {
    gridBase64,
    waterType = "saltwater",
    datasetId,
    gridHash,
    depths32,
    depthsFull,
    widthFull,
    heightFull,
  } = req.body as {
    gridBase64: string;
    waterType?: "saltwater" | "freshwater";
    datasetId?: string;
    /** Client-computed FNV-1a 32-bit hash of the depth grid (hex string). */
    gridHash?: string;
    /** Optional 1024-length downsampled depth grid for the heuristic fallback. */
    depths32?: number[];
    /** Optional full-resolution depths — triggers the tiled path when present. */
    depthsFull?: number[];
    widthFull?: number;
    heightFull?: number;
  };

  if (!gridBase64) {
    res.status(400).json({ error: "missing_field", message: "gridBase64 is required" });
    return;
  }

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
      ? datasetZonesCache.get(zoneCacheKey(gridHash, waterType, substrateFp))
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
    const secondaryKey = zoneCacheKey(gridHash, waterType, substrateFp);
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
          const secondaryKey = zoneCacheKey(gridHash, waterType, substrateFp);
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
        console.warn(
          `[poe/classify] tiled path failed, falling back to single-tile: ${
            (err as Error)?.message ?? "unknown"
          }`,
        );
      }
    }
  }

  // ── Single-tile path (substrate-grounded) ────────────────────────────
  try {
    const result = await withRetry(async () => {
      const client = getPoeClient();
      const promptText = substratePrompt
        ? `Classify the seafloor/lake-bed zones in this depth map. Return exactly 1024 zone labels for the 32×32 grid.\n\n${substratePrompt}\n\nFor every cell where a substrate label is provided above, you MUST output that exact label. Only reason from the depth map for cells marked "?".`
        : `Classify the seafloor/lake-bed zones in this depth map. Return exactly 1024 zone labels for the 32×32 grid.`;
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
          output_format: {
            type: "json_schema",
            schema: buildClassifyZoneSchema(waterType),
          },
          max_output_tokens: 8192,
          temperature: 0.1,
          truncation: "auto",
          metadata: { datasetId: datasetId ?? "unknown", waterType },
        },
        { signal: AbortSignal.timeout(POE_CLASSIFY_TIMEOUT_MS) },
      );

      return response;
    }, 3);

    const parsed = JSON.parse(result.output_text) as { zones: string[] };
    let zones = parsed.zones;

    // Post-AI reconciliation — covered cells in surveyed substrate are the
    // source of truth. The prompt instructs the model to honour them, but we
    // enforce it server-side so model drift / hallucination can't override
    // measured reality. Uncovered cells (no polygon coverage) are left as the
    // model produced them.
    if (substrate.hasCoverage && Array.isArray(zones) && zones.length === substrate.labels.length) {
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
      const secondaryKey = zoneCacheKey(gridHash, waterType, substrateFp);
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
    // Depth-based fallback — if the client supplied a 1024-length depth grid
    // we always return *some* overlay so uploads aren't left blank when the
    // AI is unavailable (missing key, rate limit, network error, malformed
    // JSON, etc.). Heuristic results are NEVER written to globalPoeCache /
    // datasetZonesCache / disk so a later successful AI call can still take
    // over and be cached normally. We still ground covered cells in observed
    // substrate so the overlay matches surveyed reality where available.
    if (Array.isArray(depths32) && depths32.length === 1024) {
      console.warn(
        `[poe/classify] AI unavailable (${(err as Error)?.message ?? "unknown"}) — returning depth-based heuristic`,
      );
      const substrateZoneLabels = substrate.hasCoverage
        ? substrate.labels.map((l) => (l ? substrateToZone(l, waterType) : null))
        : null;
      const zones = heuristicClassifyByDepth(depths32, waterType, substrateZoneLabels);
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
    }
    handlePoeError(err, res);
  }
});

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

router.post("/query", async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  const { userMessage, context, history = [], previousResponseId, includeTools = true } = req.body as {
    userMessage: string;
    context?: Record<string, unknown>;
    history?: Array<{ role: string; content: string }>;
    previousResponseId?: string;
    includeTools?: boolean;
  };

  if (!userMessage) {
    res.status(400).json({ error: "missing_field", message: "userMessage is required" });
    return;
  }

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
});

// ---------------------------------------------------------------------------
// Describe (SSE streaming)
// ---------------------------------------------------------------------------

router.post("/describe", async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  const { lon, lat, depth, zoneName, datasetName, waterType = "saltwater" } = req.body as {
    lon?: number;
    lat?: number;
    depth?: number;
    zoneName?: string;
    datasetName?: string;
    waterType?: string;
  };

  const env = waterType === "freshwater" ? "freshwater lake or reservoir" : "ocean seafloor";
  const systemMsg = `You are a concise marine geologist. Describe the ${env} feature in 2–3 sentences. Focus on physical characteristics and what might be found here.`;
  const userMsg = `Depth: ${depth ?? 0}m. Zone: ${zoneName ?? "unknown"}. Dataset: ${datasetName ?? "unknown"}. Location: lat ${lat ?? 0}, lon ${lon ?? 0}. What should I know about this spot?`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Transfer-Encoding", "chunked");

  // Abort the upstream stream as soon as the client disconnects so we don't
  // keep paying for tokens (and pinning a worker) for a response nobody is
  // reading. The controller is also tripped by a hard upstream timeout via
  // AbortSignal.any so a hung upstream can't outlive the worker either.
  const clientAbort = new AbortController();
  const upstreamSignal = AbortSignal.any([
    clientAbort.signal,
    AbortSignal.timeout(POE_DESCRIBE_TIMEOUT_MS),
  ]);
  const onClientClose = (): void => {
    if (!clientAbort.signal.aborted) clientAbort.abort();
  };
  req.on("close", onClientClose);
  res.on("close", onClientClose);

  try {
    const client = getPoeClient();
    const stream = await withRetry(
      () =>
        client.chat.completions.create(
          {
            model: POE_MODELS.DESCRIBE_QUICK,
            messages: [
              { role: "system", content: systemMsg },
              { role: "user", content: userMsg },
            ],
            max_tokens: 300,
            temperature: 0.5,
            stream: true,
          },
          { signal: upstreamSignal },
        ),
      3,
    );

    let outputChars = 0;
    for await (const chunk of stream) {
      if (clientAbort.signal.aborted) break;
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        outputChars += delta.length;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }

    if (!clientAbort.signal.aborted) {
      res.write("data: [DONE]\n\n");
      res.end();
    }

    const inputTokens = Math.ceil((systemMsg.length + userMsg.length) / 4);
    const outputTokens = Math.ceil(outputChars / 4);
    await logUsage(userId, POE_MODELS.DESCRIBE_QUICK, "describe", inputTokens, outputTokens);
  } catch (err) {
    if (!res.headersSent) {
      handlePoeError(err, res);
    } else {
      res.write(`data: ${JSON.stringify({ error: "stream_error" })}\n\n`);
      res.end();
    }
  }
});

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
    console.warn("[poe/help] Could not locate bathyscan/help/articles directory");
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
    console.log(`[poe/help] Loaded ${files.length} help articles from ${dir}`);
  } catch (err) {
    console.warn("[poe/help] Could not load help articles:", (err as Error).message);
    helpContextCache = "";
  }
  return helpContextCache;
}

const HELP_SYSTEM_PROMPT = `You are the in-app help assistant for BathyScan, a 3D seafloor and lake-bed exploration web app. Answer the user's question using ONLY the help articles provided below as grounding truth. If the question is not about BathyScan or the answer is not in the articles, politely say you can only answer questions about the BathyScan app. Keep answers concise (3-6 sentences) and refer to specific features, panels, and keyboard shortcuts by name when relevant. Do not invent features that are not described in the articles.`;

router.post("/help", async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const { question, history = [] } = req.body as {
    question?: string;
    history?: Array<{ role: string; content: string }>;
  };

  if (!question || typeof question !== "string" || !question.trim()) {
    res.status(400).json({ error: "missing_field", message: "question is required" });
    return;
  }
  if (question.length > 1000) {
    res.status(400).json({ error: "too_long", message: "question must be ≤ 1000 characters" });
    return;
  }

  const helpContext = loadHelpContext();
  const systemPrompt = `${HELP_SYSTEM_PROMPT}\n\n=== BATHYSCAN HELP ARTICLES ===\n\n${helpContext}`;

  const cleanHistory = (Array.isArray(history) ? history : [])
    .slice(-8)
    .filter(
      (m) =>
        m &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
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
});

export default router;
