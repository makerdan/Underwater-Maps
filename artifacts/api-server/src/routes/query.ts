/**
 * POST /api/query — Natural-language terrain query via OpenAI tool calling.
 *
 * Receives a free-text query and terrain context from the frontend.
 * Builds a tool schema for the 11 terrain tools, sends to GPT with
 * tool_choice="auto", then returns { toolCalls, textResponse } to the client
 * which executes the tools locally.
 */
import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

type ToolParam = {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required?: string[];
};
type TerrainTool = { type: "function"; function: { name: string; description: string; parameters: ToolParam } };
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const TERRAIN_TOOLS: TerrainTool[] = [
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
// Route
// ---------------------------------------------------------------------------

router.post("/query", async (req, res): Promise<void> => {
  const body = req.body as {
    query?: string;
    context?: {
      datasetName?: string;
      minDepth?: number;
      maxDepth?: number;
      cameraLon?: number | null;
      cameraLat?: number | null;
      cameraDepth?: number | null;
      topZones?: string[];
    };
  };

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    res.status(400).json({ error: "missing_field", message: "query is required" });
    return;
  }

  const ctx = body.context ?? {};
  const datasetName = ctx.datasetName ?? "unknown dataset";
  const minDepth = ctx.minDepth ?? 0;
  const maxDepth = ctx.maxDepth ?? 1000;
  const cameraLon = ctx.cameraLon ?? null;
  const cameraLat = ctx.cameraLat ?? null;
  const cameraDepth = ctx.cameraDepth ?? null;
  const topZones = ctx.topZones ?? [];

  const systemPrompt = [
    "You are an expert marine geologist and bathymetric guide for BathyScan, a 3D seafloor exploration app.",
    `Current dataset: "${datasetName}" (depth range: ${minDepth.toFixed(0)} m – ${maxDepth.toFixed(0)} m).`,
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

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: query },
  ];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      max_completion_tokens: 512,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: TERRAIN_TOOLS as any,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    if (!choice) {
      res.status(502).json({ error: "no_response", message: "LLM returned no choices" });
      return;
    }

    const message = choice.message;
    type RawToolCall = { function: { name: string; arguments: string } };
    const toolCalls = ((message.tool_calls ?? []) as RawToolCall[]).map((tc) => ({
      name: tc.function.name,
      args: (() => {
        try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
        catch { return {}; }
      })(),
    }));

    const textResponse = message.content ?? null;

    res.json({ toolCalls, textResponse });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[query] OpenAI error:", msg);
    res.status(502).json({ error: "llm_error", message: msg });
  }
});

export default router;
