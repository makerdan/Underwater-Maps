import { Router, type Request, type Response, type NextFunction } from "express";
import { promises as fsPromises } from "fs";
import path from "path";
import { getPoeClient } from "@workspace/poe";
import { withRetry } from "@workspace/poe";
import { PoeCreditsError, PoeRateLimitError, PoeAuthError } from "@workspace/poe";
import { hashCacheKey, globalPoeCache } from "@workspace/poe";
import { buildVisionInput } from "@workspace/poe";
import { POE_MODELS } from "@workspace/poe";
import { db } from "@workspace/db";
import { poeUsageLogTable } from "@workspace/db/schema";
import type { PoeToolSchema } from "@workspace/poe";

const router = Router();

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const userRequestCounts = new Map<string, { count: number; resetAt: number }>();

interface RateLimitState {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

function consumeRateLimit(userId: string): RateLimitState {
  const now = Date.now();
  const entry = userRequestCounts.get(userId);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    userRequestCounts.set(userId, { count: 1, resetAt });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count, resetAt: entry.resetAt };
}

function setRateLimitHeaders(res: Response, state: RateLimitState): void {
  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, state.remaining)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(state.resetAt / 1000)));
}

/**
 * Middleware: enforces per-user rate limit and sets X-RateLimit-* headers on
 * every response (including 429s). Must run AFTER requireAuth so userId is real.
 */
function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as unknown as { auth?: { userId?: string } }).auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthenticated", message: "Authentication required" });
    return;
  }
  const state = consumeRateLimit(userId);
  setRateLimitHeaders(res, state);
  if (!state.allowed) {
    const retryAfter = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "rate_limit",
      message: "Too many AI requests — please wait a moment",
    });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Auth middleware — applied to ALL Poe routes (including /models)
// Unauthenticated callers receive 401 before touching the Poe API.
// ---------------------------------------------------------------------------

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as unknown as { auth?: { userId?: string } }).auth?.userId;
  if (userId) {
    next();
    return;
  }

  // Emit baseline rate-limit headers on unauthenticated 401s so every Poe
  // response carries them, per task acceptance criteria. We do NOT consume a
  // bucket entry here (there is no userId to key on).
  setRateLimitHeaders(res, {
    allowed: true,
    remaining: RATE_LIMIT_MAX,
    resetAt: Date.now() + RATE_LIMIT_WINDOW_MS,
  });
  res.status(401).json({
    error: "unauthenticated",
    message: "Authentication required to use AI features",
  });
}

router.use(requireAuth);
router.use(rateLimitMiddleware);

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
  return (req as unknown as { auth: { userId: string } }).auth.userId;
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
}

/**
 * Secondary zone cache — keyed by gridHash (FNV-1a 32-bit of the depth grid).
 *
 * Using gridHash instead of datasetId prevents collisions when multiple unrelated
 * uploads share the synthetic id "upload". Different grid content → different hash
 * → separate, correct cache entries.
 */
const datasetZonesCache = new Map<string, CachedZones>();

/** Exported so the /datasets/:id/zones endpoint (datasets.ts) can read it. */
export { datasetZonesCache };

// ---------------------------------------------------------------------------
// Disk persistence — survives process restarts
// Files stored at /tmp/zone-cache/<gridHash>.json (hex filename, always safe)
// ---------------------------------------------------------------------------

const ZONE_CACHE_DIR = "/tmp/zone-cache";

/**
 * Strict allow-list for gridHash filenames: exactly 8 lowercase hex chars.
 * Anything else is rejected before any filesystem access to prevent path traversal.
 */
const GRID_HASH_RE = /^[a-f0-9]{8}$/;

/** Returns true only when `hash` is a safe, well-formed FNV-1a 32-bit hex string. */
function isValidGridHash(hash: string): boolean {
  return GRID_HASH_RE.test(hash);
}

/** Read a single zone cache entry by gridHash from disk. */
export async function readZoneDiskByHash(gridHash: string): Promise<CachedZones | null> {
  if (!isValidGridHash(gridHash)) return null; // reject path traversal attempts
  try {
    const file = path.join(ZONE_CACHE_DIR, `${gridHash}.json`);
    // Resolve and verify the path stays inside ZONE_CACHE_DIR
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(ZONE_CACHE_DIR) + path.sep)) return null;
    const raw = await fsPromises.readFile(resolved, "utf8");
    return JSON.parse(raw) as CachedZones;
  } catch {
    return null;
  }
}

async function writeZoneDisk(gridHash: string, data: CachedZones): Promise<void> {
  if (!isValidGridHash(gridHash)) {
    console.warn(`[zones] Rejected write for invalid gridHash: ${JSON.stringify(gridHash)}`);
    return;
  }
  try {
    await fsPromises.mkdir(ZONE_CACHE_DIR, { recursive: true });
    const file = path.join(ZONE_CACHE_DIR, `${gridHash}.json`);
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(ZONE_CACHE_DIR) + path.sep)) return;
    await fsPromises.writeFile(resolved, JSON.stringify(data), "utf8");
  } catch (err) {
    console.warn(`[zones] Failed to write disk cache for ${gridHash}: ${(err as Error).message}`);
  }
}

/** Hydrate in-memory cache from disk on startup (non-blocking). */
async function hydrateCacheFromDisk(): Promise<void> {
  try {
    await fsPromises.mkdir(ZONE_CACHE_DIR, { recursive: true });
    const files = await fsPromises.readdir(ZONE_CACHE_DIR);
    await Promise.all(
      files
        // Only load files whose names are valid 8-char hex hashes — skip anything else
        .filter((f) => f.endsWith(".json") && isValidGridHash(f.slice(0, -5)))
        .map(async (f) => {
          const hash = f.slice(0, -5);
          const data = await readZoneDiskByHash(hash);
          if (data && !datasetZonesCache.has(hash)) {
            datasetZonesCache.set(hash, data);
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

function buildClassifySystemPrompt(waterType: "saltwater" | "freshwater"): string {
  if (waterType === "freshwater") {
    return `You are an expert limnologist and freshwater bathymetric analyst. You will be shown a greyscale depth map of a lake or reservoir where darker pixels represent shallower depths and lighter pixels represent deeper depths. Classify each cell of the 32×32 grid into one of these freshwater substrate types: aquatic_vegetation, sandy_lake_bed, rocky_shoreline, silt_deep, gravel_bed, bedrock_shelf, submerged_wood, clay_flat. Return exactly 1024 labels in row-major order. Use limnological reasoning.`;
  }
  return `You are an expert marine geologist and bathymetric data analyst. You will be shown a greyscale depth map where darker pixels represent shallower depths and lighter pixels represent deeper depths. Classify each cell of the 32×32 grid into one of: sandy_shelf, coarse_sediment, silt_plain, basalt_rock, volcanic_vent_field, trench_wall, seamount_flank, coral_reef_potential. Return exactly 1024 labels in row-major order. Favour geological reasoning over simple depth thresholds.`;
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

router.post("/classify", async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  const { gridBase64, waterType = "saltwater", datasetId, gridHash } = req.body as {
    gridBase64: string;
    waterType?: "saltwater" | "freshwater";
    datasetId?: string;
    /** Client-computed FNV-1a 32-bit hash of the depth grid (hex string). */
    gridHash?: string;
  };

  if (!gridBase64) {
    res.status(400).json({ error: "missing_field", message: "gridBase64 is required" });
    return;
  }

  const cacheKey = hashCacheKey(datasetId ?? "unknown", waterType, gridBase64);
  const cached = globalPoeCache.get(cacheKey);
  if (cached) {
    res.json({ zones: JSON.parse(cached), fromCache: true });
    return;
  }

  try {
    const result = await withRetry(async () => {
      const client = getPoeClient();
      const input = buildVisionInput(
        `Classify the seafloor/lake-bed zones in this depth map. Return exactly 1024 zone labels for the 32×32 grid.`,
        gridBase64,
      );

      const response = await (client as unknown as {
        responses: {
          create: (b: Record<string, unknown>) => Promise<{
            id: string;
            output_text: string;
            usage?: { input_tokens?: number; output_tokens?: number };
          }>;
        };
      }).responses.create({
        model: POE_MODELS.CLASSIFY,
        input,
        instructions: buildClassifySystemPrompt(waterType),
        text: {
          format: {
            type: "json_schema",
            json_schema: {
              name: "zone_classification",
              schema: buildClassifyZoneSchema(waterType),
              strict: true,
            },
          },
        },
        max_output_tokens: 8192,
        temperature: 0.1,
        truncation: "auto",
        metadata: { datasetId: datasetId ?? "unknown", waterType },
      });

      return response;
    }, 3);

    const parsed = JSON.parse(result.output_text) as { zones: string[] };
    const zones = parsed.zones;

    globalPoeCache.set(cacheKey, JSON.stringify(zones));

    // Populate secondary zone cache keyed by gridHash (content-addressable).
    // This prevents "upload" datasetId collisions: different grids → different hashes.
    if (gridHash) {
      const cached: CachedZones = { zones, waterType, classifiedAt: Date.now() };
      datasetZonesCache.set(gridHash, cached);
      void writeZoneDisk(gridHash, cached);
    }

    await logUsage(
      userId,
      POE_MODELS.CLASSIFY,
      "classify",
      result.usage?.input_tokens ?? 0,
      result.usage?.output_tokens ?? 0,
    );

    res.json({ zones, fromCache: false });
  } catch (err) {
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
            create: (b: Record<string, unknown>) => Promise<{
              id: string;
              output_text: string;
              output?: ResponsesOutputItem[];
              usage?: { input_tokens?: number; output_tokens?: number };
            }>;
          };
        }).responses.create(body),
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

  try {
    const client = getPoeClient();
    const stream = await withRetry(
      () =>
        client.chat.completions.create({
          model: POE_MODELS.DESCRIBE_QUICK,
          messages: [
            { role: "system", content: systemMsg },
            { role: "user", content: userMsg },
          ],
          max_tokens: 300,
          temperature: 0.5,
          stream: true,
        }),
      3,
    );

    let outputChars = 0;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        outputChars += delta.length;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();

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

export default router;
