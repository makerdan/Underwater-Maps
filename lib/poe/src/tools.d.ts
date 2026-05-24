import type { PoeToolSchema, ToolCall } from "./types.js";
import type OpenAI from "openai";
export declare function buildToolSchema(name: string, description: string, paramsJsonSchema: Record<string, unknown>): PoeToolSchema;
export declare function parseToolCalls(message: OpenAI.ChatCompletionMessage): ToolCall[];
export declare function hasToolCalls(message: OpenAI.ChatCompletionMessage): boolean;
export declare function buildToolResultMessage(toolCallId: string, result: string): {
    role: "tool";
    tool_call_id: string;
    content: string;
};
