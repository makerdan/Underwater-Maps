import { Router } from "express";
import { getPoeClient } from "@workspace/poe";
import { withRetry } from "@workspace/poe";
import { PoeCreditsError, PoeRateLimitError, PoeAuthError } from "@workspace/poe";
import { hashCacheKey, globalPoeCache } from "@workspace/poe";
import { buildVisionInput } from "@workspace/poe";
import { POE_MODELS } from "@workspace/poe";
import { pipeStreamToResponse } from "@workspace/poe";
import { db } from "@workspace/db";
import { poeUsageLogTable } from "@workspace/db/schema";

const router = Router();

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

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const userRequestCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = userRequestCounts.get(userId);
  if (!entry || now > entry.resetAt) {
    userRequestCounts.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function getUserId(req: import("express").Request): string {
  return (req as unknown as { auth?: { userId?: string } }).auth?.userId ?? "anonymous";
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

function handlePoeError(err: unknown, res: import("express").Response): void {
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
  const userId = getUserId(req);

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "rate_limit", message: "Too many AI requests — please wait a moment" });
    return;
  }

  const { gridBase64, waterType = "saltwater", datasetId } = req.body as {
    gridBase64: string;
    waterType?: "saltwater" | "freshwater";
    datasetId?: string;
  };

  if (!gridBase64) {
    res.status(400).json({ error: "missing_field", message: "gridBase64 is required" });
    return;
  }

  const cacheKey = hashCacheKey(datasetId ?? "unknown", waterType, gridBase64.slice(0, 100));
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
        responses: { create: (b: Record<string, unknown>) => Promise<{ id: string; output_text: string; usage?: { input_tokens?: number; output_tokens?: number } }> };
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

router.post("/query", async (req, res) => {
  const userId = getUserId(req);

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "rate_limit", message: "Too many AI requests" });
    return;
  }

  const { userMessage, context, history = [], previousResponseId } = req.body as {
    userMessage: string;
    context?: Record<string, unknown>;
    history?: Array<{ role: string; content: string }>;
    previousResponseId?: string;
  };

  if (!userMessage) {
    res.status(400).json({ error: "missing_field", message: "userMessage is required" });
    return;
  }

  const systemPrompt = context
    ? `You are BathyScan's AI guide for underwater terrain exploration. Dataset: "${context["datasetName"] ?? "Unknown"}". Water type: ${context["waterType"] ?? "saltwater"}. Depth range: ${context["minDepth"] ?? 0}m to ${context["maxDepth"] ?? 0}m. Camera position: lon ${context["lon"] ?? 0}, lat ${context["lat"] ?? 0}, depth ${context["cameraDepth"] ?? 0}m. Zone: "${context["zoneName"] ?? "unknown"}". When the user asks to do something, call the appropriate tool. Answer geological questions directly in text. Be concise.`
    : "You are BathyScan's AI terrain guide. Help the user explore and understand the seafloor.";

  try {
    const client = getPoeClient();

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...history.slice(-10).map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
      { role: "user" as const, content: userMessage },
    ];

    const response = await withRetry(() =>
      client.chat.completions.create({
        model: POE_MODELS.QUERY_TOOLS,
        messages,
        temperature: 0.3,
        max_tokens: 1024,
        stream: false,
      }),
    3);

    const message = response.choices[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).map((tc) => ({
      name: tc.function.name,
      args: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
      id: tc.id,
    }));

    await logUsage(
      userId,
      POE_MODELS.QUERY_TOOLS,
      "query",
      response.usage?.prompt_tokens ?? 0,
      response.usage?.completion_tokens ?? 0,
    );

    res.json({
      toolCalls,
      text: message?.content ?? null,
      responseId: response.id ?? null,
    });
  } catch (err) {
    handlePoeError(err, res);
  }
});

router.post("/describe", async (req, res) => {
  const userId = getUserId(req);

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "rate_limit", message: "Too many AI requests" });
    return;
  }

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

  try {
    await pipeStreamToResponse(
      {
        model: POE_MODELS.DESCRIBE_QUICK,
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
        maxTokens: 300,
        temperature: 0.5,
      },
      res,
    );

    await logUsage(userId, POE_MODELS.DESCRIBE_QUICK, "describe", 100, 150);
  } catch (err) {
    if (!res.headersSent) {
      handlePoeError(err, res);
    }
  }
});

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
  } catch (err) {
    res.status(502).json({ error: "models_unavailable", message: "Could not fetch Poe models list" });
  }
});

export default router;
