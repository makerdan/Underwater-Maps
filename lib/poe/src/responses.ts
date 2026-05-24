import { getPoeClient } from "./client.js";
import type { PoeRespondParams, PoeResponseResult } from "./types.js";
import { z } from "zod";

export async function poeRespond(params: PoeRespondParams): Promise<PoeResponseResult> {
  const client = getPoeClient();

  const body: Record<string, unknown> = {
    model: params.model,
    input: params.input,
  };

  if (params.instructions) body["instructions"] = params.instructions;
  if (params.reasoning) body["reasoning"] = params.reasoning;
  if (params.maxOutputTokens) body["max_output_tokens"] = params.maxOutputTokens;
  if (params.temperature !== undefined) body["temperature"] = params.temperature;
  if (params.previousResponseId) body["previous_response_id"] = params.previousResponseId;
  if (params.truncation) body["truncation"] = params.truncation;
  if (params.serviceTier) body["service_tier"] = params.serviceTier;
  if (params.metadata) body["metadata"] = params.metadata;
  if (params.include) body["include"] = params.include;
  if (params.tools) body["tools"] = params.tools;

  if (params.jsonSchema) {
    body["text"] = {
      format: {
        type: "json_schema",
        json_schema: {
          name: params.jsonSchema.name,
          schema: params.jsonSchema.schema,
          strict: params.jsonSchema.strict ?? true,
        },
      },
    };
  }

  const response = await (client as unknown as {
    responses: { create: (b: Record<string, unknown>) => Promise<{
      id: string;
      output_text: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>};
  }).responses.create(body);

  const text = response.output_text ?? "";

  if (params.jsonSchema) {
    try {
      JSON.parse(text);
    } catch {
      throw new Error(`Poe returned invalid JSON for schema "${params.jsonSchema.name}": ${text.slice(0, 200)}`);
    }
  }

  return {
    text,
    id: response.id ?? "",
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

export function validateWithSchema<T>(text: string, schema: z.ZodType<T>): T {
  const parsed = JSON.parse(text);
  return schema.parse(parsed);
}
