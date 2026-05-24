import { describe, it, expect, vi, beforeEach } from "vitest";
import { poeRespond, validateWithSchema } from "../responses.js";
import { ZoneParseError } from "../errors.js";
import { z } from "zod";
vi.mock("../client.js", () => ({
    getPoeClient: vi.fn(),
}));
import { getPoeClient } from "../client.js";
function makeMockClient(outputText, usage = { input_tokens: 100, output_tokens: 50 }) {
    return {
        responses: {
            create: vi.fn().mockResolvedValue({
                id: "resp-test-1",
                output_text: outputText,
                usage,
            }),
        },
    };
}
describe("poeRespond", () => {
    beforeEach(() => {
        vi.mocked(getPoeClient).mockReturnValue(makeMockClient("Hello from Poe"));
    });
    it("returns text, id, and usage", async () => {
        const result = await poeRespond({
            model: "Claude-Sonnet-4.6",
            input: "Tell me about the Mariana Trench",
        });
        expect(result.text).toBe("Hello from Poe");
        expect(result.id).toBe("resp-test-1");
        expect(result.usage.inputTokens).toBe(100);
        expect(result.usage.outputTokens).toBe(50);
    });
    it("accepts valid JSON when jsonSchema is set", async () => {
        vi.mocked(getPoeClient).mockReturnValue(makeMockClient(JSON.stringify({ zones: ["sandy_shelf"] })));
        const result = await poeRespond({
            model: "Claude-Sonnet-4.6",
            input: "Classify",
            jsonSchema: {
                name: "zone_result",
                schema: { type: "object", properties: { zones: { type: "array", items: { type: "string" } } }, required: ["zones"] },
            },
        });
        expect(result.text).toContain("sandy_shelf");
    });
    it("throws ZoneParseError when Poe returns invalid JSON with a jsonSchema", async () => {
        vi.mocked(getPoeClient).mockReturnValue(makeMockClient("NOT_JSON_AT_ALL"));
        await expect(poeRespond({
            model: "Claude-Sonnet-4.6",
            input: "Classify",
            jsonSchema: {
                name: "zone_result",
                schema: {},
            },
        })).rejects.toBeInstanceOf(ZoneParseError);
    });
    it("throws ZoneParseError when Zod validation fails", async () => {
        const zones = ["bad_zone"];
        vi.mocked(getPoeClient).mockReturnValue(makeMockClient(JSON.stringify({ zones })));
        const zodSchema = z.object({
            zones: z.array(z.enum(["sandy_shelf", "trench_wall"])),
        });
        await expect(poeRespond({
            model: "Claude-Sonnet-4.6",
            input: "Classify",
            jsonSchema: {
                name: "zone_result",
                schema: {},
                zodSchema,
            },
        })).rejects.toBeInstanceOf(ZoneParseError);
    });
    it("passes when Zod validation succeeds", async () => {
        vi.mocked(getPoeClient).mockReturnValue(makeMockClient(JSON.stringify({ zones: ["sandy_shelf", "trench_wall"] })));
        const zodSchema = z.object({
            zones: z.array(z.enum(["sandy_shelf", "trench_wall"])),
        });
        const result = await poeRespond({
            model: "Claude-Sonnet-4.6",
            input: "Classify",
            jsonSchema: {
                name: "zone_result",
                schema: {},
                zodSchema,
            },
        });
        expect(result.text).toContain("sandy_shelf");
    });
});
describe("validateWithSchema", () => {
    it("parses and validates valid JSON", () => {
        const schema = z.object({ name: z.string(), depth: z.number() });
        const result = validateWithSchema('{"name":"Trench","depth":11000}', schema);
        expect(result.name).toBe("Trench");
        expect(result.depth).toBe(11000);
    });
    it("throws ZoneParseError for invalid JSON", () => {
        const schema = z.object({ name: z.string() });
        expect(() => validateWithSchema("NOT_JSON", schema)).toThrow(ZoneParseError);
    });
    it("throws ZoneParseError for JSON that fails schema", () => {
        const schema = z.object({ name: z.string(), depth: z.number() });
        expect(() => validateWithSchema('{"name":42}', schema)).toThrow(ZoneParseError);
    });
});
