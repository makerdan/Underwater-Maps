/**
 * queryLLM — calls the server-side /api/query endpoint which runs OpenAI
 * tool-calling against the terrain query tool schema.
 *
 * Returns the list of tool calls the LLM selected plus any text response.
 */

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

export async function queryLLM(
  query: string,
  context: QueryContext,
): Promise<QueryLLMResult> {
  const resp = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ query, context }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Query failed: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as {
    toolCalls: ToolCall[];
    textResponse: string | null;
  };
  return data;
}
