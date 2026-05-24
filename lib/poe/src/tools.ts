import type { PoeToolSchema, ToolCall } from "./types.js";
import type OpenAI from "openai";

export function buildToolSchema(
  name: string,
  description: string,
  paramsJsonSchema: Record<string, unknown>,
): PoeToolSchema {
  return {
    type: "function",
    function: { name, description, parameters: paramsJsonSchema },
  };
}

export function parseToolCalls(
  message: OpenAI.ChatCompletionMessage,
): ToolCall[] {
  if (!message.tool_calls || message.tool_calls.length === 0) return [];

  return message.tool_calls.map((tc) => {
    let args: unknown = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      args = {};
    }
    return { name: tc.function.name, args, id: tc.id };
  });
}

export function hasToolCalls(message: OpenAI.ChatCompletionMessage): boolean {
  return (message.tool_calls?.length ?? 0) > 0;
}

export function buildToolResultMessage(toolCallId: string, result: string): {
  role: "tool";
  tool_call_id: string;
  content: string;
} {
  return { role: "tool", tool_call_id: toolCallId, content: result };
}
