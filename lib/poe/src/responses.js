import { getPoeClient } from "./client.js";
import { ZoneParseError } from "./errors.js";
export async function poeRespond(params) {
    const client = getPoeClient();
    const body = {
        model: params.model,
        input: params.input,
    };
    if (params.instructions)
        body["instructions"] = params.instructions;
    if (params.reasoning)
        body["reasoning"] = params.reasoning;
    if (params.maxOutputTokens)
        body["max_output_tokens"] = params.maxOutputTokens;
    if (params.temperature !== undefined)
        body["temperature"] = params.temperature;
    if (params.previousResponseId)
        body["previous_response_id"] = params.previousResponseId;
    if (params.truncation)
        body["truncation"] = params.truncation;
    if (params.serviceTier)
        body["service_tier"] = params.serviceTier;
    if (params.metadata)
        body["metadata"] = params.metadata;
    if (params.include)
        body["include"] = params.include;
    if (params.tools)
        body["tools"] = params.tools;
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
    const response = await client.responses.create(body);
    const text = response.output_text ?? "";
    if (params.jsonSchema) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw new ZoneParseError(`Poe returned invalid JSON for schema "${params.jsonSchema.name}": ${text.slice(0, 200)}`);
        }
        if (params.jsonSchema.zodSchema) {
            const result = params.jsonSchema.zodSchema.safeParse(parsed);
            if (!result.success) {
                throw new ZoneParseError(`Poe response failed schema validation for "${params.jsonSchema.name}": ` +
                    result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
            }
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
export function validateWithSchema(text, schema) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new ZoneParseError(`Failed to parse JSON: ${text.slice(0, 200)}`);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
        const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
        throw new ZoneParseError(`Schema validation failed: ${msg}`);
    }
    return result.data;
}
