/**
 * POST /api/query — Natural-language terrain query via OpenAI tool calling.
 *
 * Receives a free-text query and terrain context from the frontend.
 * Builds a tool schema for the 11 terrain tools, sends to GPT with
 * tool_choice="auto", then returns { toolCalls, textResponse } to the client
 * which executes the tools locally.
 */
import { Router } from "express";
import { z } from "zod";
import {
  openai,
  type ChatCompletionMessageParam,
  type ChatCompletionFunctionTool,
} from "@workspace/integrations-openai-ai-server";
import { requireAuth } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { createRateLimit, stampBaselineRateLimitHeaders } from "../middlewares/rateLimit.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ---------------------------------------------------------------------------
// Auth + rate limit
//
// `/query` calls the paid OpenAI API on every request, so we gate it behind
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

/** Hard ceiling on a single OpenAI call. Long enough for tool-calling rounds, short enough to free workers. */
const QUERY_UPSTREAM_TIMEOUT_MS = 30_000;

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
// Route + request schema
// ---------------------------------------------------------------------------

const QueryContextSchema = z.object({
  datasetName: z.string().optional(),
  waterType: z.string().optional(),
  minDepth: z.number().optional(),
  maxDepth: z.number().optional(),
  cameraLon: z.number().nullable().optional(),
  cameraLat: z.number().nullable().optional(),
  cameraDepth: z.number().nullable().optional(),
  topZones: z.array(z.string()).optional(),
});

const QueryBodySchema = z.object({
  query: z.string().trim().min(1, "query is required"),
  context: QueryContextSchema.optional(),
});

router.post(
  "/query",
  stampBaselineRateLimitHeaders(QUERY_USER_MAX, QUERY_USER_WINDOW_MS),
  requireAuth,
  createRateLimit({ route: "query", windowMs: QUERY_USER_WINDOW_MS, max: QUERY_USER_MAX, mode: "user" }),
  createRateLimit({ route: "query", windowMs: QUERY_IP_WINDOW_MS, max: QUERY_IP_MAX, mode: "ip" }),
  asyncHandler(async (req, res): Promise<void> => {
  const parsed = QueryBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.message });
    return;
  }

  const { query, context: ctx = {} } = parsed.data;
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

  try {
    const response = await openai.chat.completions.create(
      {
        model: "gpt-5.1",
        max_completion_tokens: 512,
        messages,
        tools: TERRAIN_TOOLS,
        tool_choice: "auto",
      },
      // Hard upstream timeout so a stuck OpenAI request cannot pin a worker
      // indefinitely. The SDK accepts an AbortSignal as the second-arg option.
      { signal: AbortSignal.timeout(QUERY_UPSTREAM_TIMEOUT_MS) },
    );

    const choice = response.choices[0];
    if (!choice) {
      res.status(502).json({ error: "no_response", details: "LLM returned no choices" });
      return;
    }

    const message = choice.message;
    type RawToolCall = { function: { name: string; arguments: string } };
    const { toolCalls, toolErrors } = validateToolCalls(
      (message.tool_calls ?? []) as RawToolCall[],
    );
    if (toolErrors.length > 0) {
      logger.warn({ toolErrors }, "[query] rejected malformed LLM tool calls");
    }

    const textResponse = message.content ?? null;

    res.json({ toolCalls, toolErrors, textResponse });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, msg }, "[query] OpenAI error");
    res.status(502).json({ error: "llm_error", details: msg });
  }
  }),
);

export default router;
