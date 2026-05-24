import type OpenAI from "openai";
import type { z } from "zod";
export type MessageRole = "system" | "user" | "assistant" | "tool";
export interface PoeMessage {
    role: MessageRole;
    content: string | PoeContentBlock[];
    name?: string;
    tool_call_id?: string;
}
export interface PoeContentBlock {
    type: "text" | "image_url";
    text?: string;
    image_url?: {
        url: string;
    };
}
export interface PoeToolSchema {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
export interface ToolCall {
    name: string;
    args: unknown;
    id?: string;
}
export interface PoeCompleteParams {
    model: string;
    messages: PoeMessage[];
    temperature?: number;
    maxTokens?: number;
    tools?: PoeToolSchema[];
    toolChoice?: "auto" | "required" | "none" | {
        type: "function";
        function: {
            name: string;
        };
    };
    stream?: boolean;
    stop?: string | string[];
}
export interface PoeCompleteResult {
    text: string | null;
    toolCalls: ToolCall[];
    rawMessage: OpenAI.ChatCompletionMessage;
}
export type ResponsesInputItem = {
    type: "input_text";
    text: string;
} | {
    type: "input_image";
    image_url: string;
};
export interface PoeReasoningConfig {
    effort: "low" | "medium" | "high";
    summary?: "auto" | "none";
}
export interface PoeJsonSchema {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
    zodSchema?: z.ZodTypeAny;
}
export interface PoeRespondParams {
    model: string;
    input: string | ResponsesInputItem[];
    instructions?: string;
    reasoning?: PoeReasoningConfig;
    jsonSchema?: PoeJsonSchema;
    tools?: Array<PoeToolSchema | {
        type: "web_search_preview";
    }>;
    maxOutputTokens?: number;
    temperature?: number;
    previousResponseId?: string;
    truncation?: "auto" | "disabled";
    serviceTier?: "auto" | "default" | "flex" | "priority";
    metadata?: Record<string, string>;
    include?: string[];
}
export interface PoeResponseResult {
    text: string;
    id: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}
export interface TerrainGrid {
    depths: Float32Array | number[];
    width: number;
    height: number;
    minDepth: number;
    maxDepth: number;
    lonMin: number;
    lonMax: number;
    latMin: number;
    latMax: number;
}
