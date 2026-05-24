import { describe, it, expect, vi, beforeEach } from "vitest";
import { poeComplete, poeCompleteText } from "../completions.js";
vi.mock("../client.js", () => ({
    getPoeClient: vi.fn(),
}));
import { getPoeClient } from "../client.js";
function makeMockClient(overrides = {}) {
    return {
        chat: {
            completions: {
                create: vi.fn().mockResolvedValue({
                    choices: [
                        {
                            message: {
                                role: "assistant",
                                content: "  Hello from Poe!  ",
                                tool_calls: null,
                                ...overrides,
                            },
                        },
                    ],
                }),
            },
        },
    };
}
describe("poeComplete", () => {
    beforeEach(() => {
        vi.mocked(getPoeClient).mockReturnValue(makeMockClient());
    });
    it("returns trimmed text content", async () => {
        const result = await poeComplete({
            model: "Claude-Sonnet-4.6",
            messages: [{ role: "user", content: "Hi" }],
        });
        expect(result.text).toBe("Hello from Poe!");
        expect(result.toolCalls).toHaveLength(0);
    });
    it("parses tool_calls when present", async () => {
        const mockClient = makeMockClient({
            content: null,
            tool_calls: [
                {
                    id: "tc-1",
                    type: "function",
                    function: { name: "navigateTo", arguments: '{"lon":142.3,"lat":11.2}' },
                },
            ],
        });
        vi.mocked(getPoeClient).mockReturnValue(mockClient);
        const result = await poeComplete({
            model: "Claude-Sonnet-4.6",
            messages: [{ role: "user", content: "Go to Mariana" }],
            tools: [{ type: "function", function: { name: "navigateTo", description: "nav", parameters: {} } }],
        });
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0]?.name).toBe("navigateTo");
        expect(result.toolCalls[0]?.args).toEqual({ lon: 142.3, lat: 11.2 });
    });
});
describe("poeCompleteText", () => {
    beforeEach(() => {
        vi.mocked(getPoeClient).mockReturnValue(makeMockClient());
    });
    it("returns just the text string", async () => {
        const text = await poeCompleteText({
            model: "Claude-Haiku-4.5",
            messages: [{ role: "user", content: "Describe a seamount." }],
        });
        expect(typeof text).toBe("string");
        expect(text.length).toBeGreaterThan(0);
    });
});
