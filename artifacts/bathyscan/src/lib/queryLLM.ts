/**
 * queryLLM — calls the server-side /api/query endpoint which runs OpenAI
 * tool-calling against the terrain query tool schema.
 *
 * Returns the list of tool calls the LLM selected plus any text response.
 */

import { z } from "zod";

export interface QueryContext {
  datasetName: string;
  waterType?: "saltwater" | "freshwater";
  minDepth: number;
  maxDepth: number;
  cameraLon: number | null;
  cameraLat: number | null;
  cameraDepth: number | null;
  topZones: string[];
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface QueryLLMResult {
  toolCalls: ToolCall[];
  textResponse: string | null;
}

const ToolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.unknown()),
});

const QueryLLMResultSchema = z.object({
  toolCalls: z.array(ToolCallSchema).default([]),
  textResponse: z.string().nullable().default(null),
});

export async function queryLLM(
  query: string,
  context: QueryContext,
  signal?: AbortSignal,
): Promise<QueryLLMResult> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const resp = await fetch(`${base}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ query, context }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Query failed: ${resp.status} ${text}`);
  }

  const raw = await resp.json();
  const parsed = QueryLLMResultSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[queryLLM] Unexpected response shape:", parsed.error.message, raw);
    throw new Error(
      "The AI assistant returned an unexpected response. Please try again.",
    );
  }
  return parsed.data;
}
