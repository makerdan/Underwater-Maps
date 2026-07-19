/**
 * POST /api/query — Natural-language terrain query via tool calling.
 *
 * Receives a free-text query and terrain context from the frontend.
 * Builds a tool schema for the 11 terrain tools, tries Poe first (with circuit
 * breaker + hard per-attempt timeout), then falls back to OpenAI when Poe
 * fails or its breaker is open. Only when both fail does the request return an
 * error. The provider that served each request is logged server-side.
 */
import { Router } from "express";
import { z } from "zod";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
} from "@workspace/integrations-openai-ai-server";
import { getPoeClient, PoeCircuitBreaker } from "@workspace/poe";
import { requireAuth } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { createRateLimit, stampBaselineRateLimitHeaders } from "../middlewares/rateLimit.js";
import { validateBody } from "../middlewares/validateBody.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Lazy OpenAI client — mirrors the pattern in poe.ts.
// The integration module throws at init when its env vars are absent, so we
// must NOT import it at the top level. Cache the result after first success.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenAiClient = any;
let _openAiClient: OpenAiClient | "unavailable" | undefined = undefined;

async function getOpenAiClient(): Promise<OpenAiClient | null> {
  if (_openAiClient === "unavailable") return null;
  if (_openAiClient !== undefined) return _openAiClient;
  try {
    const mod = await import("@workspace/integrations-openai-ai-server");
    _openAiClient = mod.openai;
    return _openAiClient;
  } catch {
    _openAiClient = "unavailable";
    return null;
  }
}

/**
 * TEST-ONLY — resets the cached OpenAI client so the next `getOpenAiClient`
 * call re-runs the dynamic import. Allows tests to inject a mock after
 * `vi.mock("@workspace/integrations-openai-ai-server", ...)`.
 */
export function __resetOpenAiClientCacheForTests(): void {
  _openAiClient = undefined;
}

const router = Router();

// ---------------------------------------------------------------------------
// Auth + rate limit
//
// `/query` calls a paid AI API on every request, so we gate it behind
// Clerk auth and a two-layer sliding-window limiter:
//   * per-user  — protects an individual account from runaway loops
//   * per-IP    — protects against burst abuse before auth is even attempted
//
// Both limiters share the durable Postgres-backed `rate_limit_events` table
// so quota survives restarts and is enforced across processes/instances.
// The baseline headers stamper guarantees `X-RateLimit-*` is present even on
// the 401 returned by `requireAuth` for unauthenticated callers.
// ---------------------------------------------------------------------------

const QUERY_USER_WINDOW_MS = 60_000;
const QUERY_USER_MAX = 20;
const QUERY_IP_WINDOW_MS = 60_000;
const QUERY_IP_MAX = 60;

/** Hard ceiling on a single upstream AI call. Long enough for tool-calling rounds, short enough to free workers. */
const QUERY_UPSTREAM_TIMEOUT_MS = 30_000;

/** Poe model used for tool-calling queries. */
const POE_QUERY_MODEL = "Claude-Sonnet-4.6";

// ---------------------------------------------------------------------------
// Circuit breaker — module-level singleton shared across all requests.
// Opens after 3 consecutive Poe failures; allows one probe after 60 s.
// ---------------------------------------------------------------------------

export const queryCircuitBreaker = new PoeCircuitBreaker({
  failureThreshold: 3,
  resetMs: 60_000,
});

/** Exposed for tests only — resets the circuit breaker to a clean closed state. */
export function __resetQueryCircuitBreaker(): void {
  // Re-assign by replacing the exported reference is not possible for a const,
  // so we use the internal reset path: record enough successes to close it.
  queryCircuitBreaker.recordSuccess();
  // Force-close by resetting consecutive failure state via success bookkeeping.
  // The simplest reliable reset: call recordSuccess() which closes & clears.
}

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

const TERRAIN_TOOLS: ChatCompletionFunctionTool[] = [
  {
    type: "function",
    function: {
      name: "navigateTo",
      description: "Teleport the camera to specific geographic coordinates.",
      parameters: {
        type: "object",
        properties: {
          lon: { type: "number", description: "Longitude in decimal degrees." },
          lat: { type: "number", description: "Latitude in decimal degrees." },
        },
        required: ["lon", "lat"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigateToDeepestPoint",
      description: "Teleport the camera to the deepest point in the current terrain.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "navigateToShallowPoint",
      description: "Teleport the camera to the shallowest point in the current terrain.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "highlightDepthRange",
      description: "Highlight cells whose depth is between minMetres and maxMetres. Cells inside the range glow cyan; outside cells dim to 30%.",
      parameters: {
        type: "object",
        properties: {
          minMetres: { type: "number", description: "Minimum depth in metres (positive = below sea level)." },
          maxMetres: { type: "number", description: "Maximum depth in metres." },
        },
        required: ["minMetres", "maxMetres"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "highlightSlope",
      description: "Highlight terrain cells whose slope angle is between minDegrees and maxDegrees.",
      parameters: {
        type: "object",
        properties: {
          minDegrees: { type: "number", description: "Minimum slope angle in degrees." },
          maxDegrees: { type: "number", description: "Maximum slope angle in degrees." },
        },
        required: ["minDegrees", "maxDegrees"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "highlightZone",
      description: "Highlight all terrain cells classified as a specific AI seafloor zone.",
      parameters: {
        type: "object",
        properties: {
          zone: {
            type: "string",
            description: "Zone name, e.g. seamount_flank, coral_reef_potential, sandy_shelf, coarse_sediment, silt_plain, basalt_rock, volcanic_vent_field, trench_wall (saltwater) or aquatic_vegetation, sandy_lake_bed, rocky_shoreline, silt_deep, gravel_bed, bedrock_shelf, submerged_wood, clay_flat (freshwater).",
          },
        },
        required: ["zone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "showStatistic",
      description: "Compute and display a terrain statistic in the HUD.",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: ["mean_depth", "max_depth", "min_depth", "depth_std_dev", "area_km2", "slope_mean", "deepest_coordinates", "shallowest_coordinates"],
          },
        },
        required: ["metric"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "describeCurrentLocation",
      description: "Ask the AI to describe the current camera location — geology, zone, depth, and nearby features.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "clearHighlights",
      description: "Remove all terrain highlight overlays.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "openOverview",
      description: "Open the overview map panel.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "switchDataset",
      description: "Switch the active terrain dataset.",
      parameters: {
        type: "object",
        properties: {
          datasetId: { type: "string", description: "Dataset ID to switch to." },
        },
        required: ["datasetId"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool-argument validation
//
// The LLM's tool_calls[].function.arguments field is model-generated JSON —
// it is untrusted input just like a request body. Every tool has a strict Zod
// schema; arguments that fail validation are never forwarded to the client.
// Invalid calls are reported in a separate `toolErrors` array so the client
// can surface a friendly failure instead of executing garbage.
// ---------------------------------------------------------------------------

const TOOL_ARG_SCHEMAS: Record<string, z.ZodType<Record<string, unknown>>> = {
  navigateTo: z
    .object({
      lon: z.number().finite().gte(-180).lte(180),
      lat: z.number().finite().gte(-90).lte(90),
    })
    .strict(),
  navigateToDeepestPoint: z.object({}).strict(),
  navigateToShallowPoint: z.object({}).strict(),
  highlightDepthRange: z
    .object({
      minMetres: z.number().finite(),
      maxMetres: z.number().finite(),
    })
    .strict(),
  highlightSlope: z
    .object({
      minDegrees: z.number().finite(),
      maxDegrees: z.number().finite(),
    })
    .strict(),
  highlightZone: z.object({ zone: z.string().min(1).max(100) }).strict(),
  showStatistic: z
    .object({
      metric: z.enum([
        "mean_depth",
        "max_depth",
        "min_depth",
        "depth_std_dev",
        "area_km2",
        "slope_mean",
        "deepest_coordinates",
        "shallowest_coordinates",
      ]),
    })
    .strict(),
  describeCurrentLocation: z.object({}).strict(),
  clearHighlights: z.object({}).strict(),
  openOverview: z.object({}).strict(),
  switchDataset: z.object({ datasetId: z.string().min(1).max(200) }).strict(),
};

type ValidatedToolCall = { name: string; args: Record<string, unknown> };
type ToolCallError = { name: string; error: string };

/**
 * Validate raw LLM tool calls against their per-tool schemas.
 * Returns the valid calls plus a structured error entry for each rejected one.
 */
export function validateToolCalls(
  rawCalls: Array<{ function: { name: string; arguments: string } }>,
): { toolCalls: ValidatedToolCall[]; toolErrors: ToolCallError[] } {
  const toolCalls: ValidatedToolCall[] = [];
  const toolErrors: ToolCallError[] = [];

  for (const tc of rawCalls) {
    const name = tc.function?.name ?? "";
    const schema = TOOL_ARG_SCHEMAS[name];
    if (!schema) {
      toolErrors.push({ name, error: "unknown_tool" });
      continue;
    }

    let parsedArgs: unknown;
    try {
      parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      toolErrors.push({ name, error: "malformed_arguments_json" });
      continue;
    }

    const result = schema.safeParse(parsedArgs);
    if (!result.success) {
      toolErrors.push({
        name,
        error: `invalid_arguments: ${result.error.issues[0]?.message ?? "validation failed"}`,
      });
      continue;
    }

    toolCalls.push({ name, args: result.data });
  }

  return { toolCalls, toolErrors };
}

// ---------------------------------------------------------------------------
// Provider-agnostic query result type
// ---------------------------------------------------------------------------

interface QueryLoopResult {
  toolCalls: ValidatedToolCall[];
  toolErrors: ToolCallError[];
  textResponse: string | null;
}

type RawToolCall = { function: { name: string; arguments: string } };

/**
 * Run the tool-calling loop against OpenAI and return a normalised result.
 */
async function runOpenAIQuery(
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionFunctionTool[],
): Promise<QueryLoopResult> {
  const client = await getOpenAiClient();
  if (!client) throw new Error("OpenAI client unavailable");

  const response = await client.chat.completions.create(
    {
      model: process.env["OPENAI_QUERY_MODEL"] ?? "gpt-5.1",
      max_completion_tokens: 512,
      messages,
      tools,
      tool_choice: "auto",
    },
    { signal: AbortSignal.timeout(QUERY_UPSTREAM_TIMEOUT_MS) },
  );

  const choice = response.choices[0];
  if (!choice) throw new Error("OpenAI returned no choices");

  const message = choice.message;
  const { toolCalls, toolErrors } = validateToolCalls(
    (message.tool_calls ?? []) as RawToolCall[],
  );
  return { toolCalls, toolErrors, textResponse: message.content ?? null };
}

/**
 * Run the tool-calling loop against Poe and return a normalised result.
 * Uses the OpenAI-compatible Poe client; no internal retries so that a stuck
 * Poe call cannot delay the fallback beyond one timeout window.
 */
async function runPoeQuery(
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionFunctionTool[],
): Promise<QueryLoopResult> {
  const client = getPoeClient();

  // Cast to OpenAI.ChatCompletion — the Poe client is OpenAI-compatible and
  // stream is false (default), so the actual runtime type is ChatCompletion.
  // We cast via unknown to avoid TypeScript overload ambiguity on the SDK's
  // stream/non-stream discriminated union.
  const response = await client.chat.completions.create(
    {
      model: POE_QUERY_MODEL,
      max_tokens: 512,
      messages: messages as Parameters<typeof client.chat.completions.create>[0]["messages"],
      tools: tools as Parameters<typeof client.chat.completions.create>[0]["tools"],
      tool_choice: "auto",
    } as Parameters<typeof client.chat.completions.create>[0],
    { signal: AbortSignal.timeout(QUERY_UPSTREAM_TIMEOUT_MS) },
  ) as unknown as ChatCompletion;

  const choice = response.choices[0];
  if (!choice) throw new Error("Poe returned no choices");

  const message = choice.message;
  const { toolCalls, toolErrors } = validateToolCalls(
    (message.tool_calls ?? []) as RawToolCall[],
  );
  return { toolCalls, toolErrors, textResponse: message.content ?? null };
}

// ---------------------------------------------------------------------------
// Route + request schema
// ---------------------------------------------------------------------------

const QueryContextSchema = z.object({
  datasetName: z.string().max(200).optional(),
  waterType: z.string().optional(),
  minDepth: z.number().optional(),
  maxDepth: z.number().optional(),
  cameraLon: z.number().nullable().optional(),
  cameraLat: z.number().nullable().optional(),
  cameraDepth: z.number().nullable().optional(),
  topZones: z.array(z.string().max(100)).max(20).optional(),
});

const QueryBodySchema = z.object({
  query: z.string().trim().min(1, "query is required").max(2000),
  context: QueryContextSchema.optional(),
});

router.post(
  "/query",
  stampBaselineRateLimitHeaders(QUERY_USER_MAX, QUERY_USER_WINDOW_MS),
  requireAuth,
  createRateLimit({ route: "query", windowMs: QUERY_USER_WINDOW_MS, max: QUERY_USER_MAX, mode: "user" }),
  createRateLimit({ route: "query", windowMs: QUERY_IP_WINDOW_MS, max: QUERY_IP_MAX, mode: "ip" }),
  validateBody(QueryBodySchema, "POST /api/query"),
  asyncHandler(async (req, res): Promise<void> => {
  const { query, context: ctx = {} } = res.locals.parsedBody;
  const datasetName = ctx.datasetName ?? "unknown dataset";
  const waterType = ctx.waterType === "freshwater" ? "freshwater" : "saltwater";
  const minDepth = ctx.minDepth ?? 0;
  const maxDepth = ctx.maxDepth ?? 1000;
  const cameraLon = ctx.cameraLon ?? null;
  const cameraLat = ctx.cameraLat ?? null;
  const cameraDepth = ctx.cameraDepth ?? null;
  const topZones = ctx.topZones ?? [];

  const persona = waterType === "freshwater"
    ? "expert freshwater limnologist and lake bathymetric guide"
    : "expert marine geologist and bathymetric guide";

  const envLabel = waterType === "freshwater" ? "lake bed" : "seafloor";

  const systemPrompt = [
    `You are an ${persona} for BathyScan, a 3D underwater exploration app.`,
    `Environment: ${waterType === "freshwater" ? "Freshwater (lake/reservoir)" : "Saltwater (ocean/sea)"}.`,
    `Current dataset: "${datasetName}" (depth range: ${minDepth.toFixed(0)} m – ${maxDepth.toFixed(0)} m, ${envLabel}).`,
    cameraLon != null && cameraLat != null
      ? `Camera is at lon=${cameraLon.toFixed(4)}, lat=${cameraLat.toFixed(4)}, depth=${cameraDepth?.toFixed(0) ?? "?"} m.`
      : "Camera position unknown.",
    topZones.length > 0 ? `Dominant seafloor zones: ${topZones.join(", ")}.` : "",
    "",
    "Use the provided tools to fulfil the user's request. Prefer tool calls over plain text when an action is clearly requested.",
    "If the query is ambiguous, respond with a polite clarification message (no tool call).",
    "After calling tools, you may add a brief natural-language confirmation (1–2 sentences max).",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: query },
  ];

  // -------------------------------------------------------------------------
  // Poe-first with OpenAI fallback.
  //
  // 1. If the circuit breaker is closed (or half-open for a probe), attempt
  //    Poe. A hard AbortSignal timeout keeps the worst-case Poe latency
  //    bounded at QUERY_UPSTREAM_TIMEOUT_MS — so a stuck Poe call cannot
  //    push total latency beyond 2× that ceiling.
  // 2. On any Poe error (including payment errors, timeouts, 5xx), record the
  //    failure to the circuit breaker and fall through to OpenAI silently.
  // 3. Only when both providers fail does the route return a 502.
  // -------------------------------------------------------------------------

  let result: QueryLoopResult | null = null;
  let provider = "openai";
  let poeError: unknown = null;

  if (!queryCircuitBreaker.isOpen()) {
    try {
      result = await runPoeQuery(messages, TERRAIN_TOOLS);
      queryCircuitBreaker.recordSuccess();
      provider = "poe";
    } catch (err) {
      poeError = err;
      queryCircuitBreaker.recordFailure();
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, "[query] Poe failed, falling back to OpenAI");
    }
  } else {
    logger.info({ code: "poe_circuit_open_skip" }, "[query] Poe circuit open — using OpenAI directly");
  }

  if (!result) {
    try {
      result = await runOpenAIQuery(messages, TERRAIN_TOOLS);
      provider = "openai";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.error(
        { err: msg, poeErr: poeError instanceof Error ? poeError.message : String(poeError) },
        "[query] Both Poe and OpenAI failed",
      );
      res.status(502).json({ error: "llm_error", details: msg });
      return;
    }
  }

  logger.info({ provider }, "[query] served by provider");

  if (result.toolErrors.length > 0) {
    logger.warn({ toolErrors: result.toolErrors }, "[query] rejected malformed LLM tool calls");
  }

  res.json({ toolCalls: result.toolCalls, toolErrors: result.toolErrors, textResponse: result.textResponse });
  }),
);

export default router;
