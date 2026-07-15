/**
 * query-tool-validation.test.ts — LLM tool-call argument validation.
 *
 * The model's tool_calls[].function.arguments is untrusted JSON. These tests
 * cover validateToolCalls() directly and the /api/query route surface:
 * unknown tools, malformed JSON, schema violations, and extra keys must all
 * be rejected (moved into toolErrors) instead of being forwarded to clients.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { fakeChatCompletionsCreate } = vi.hoisted(() => ({
  fakeChatCompletionsCreate: vi.fn(),
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: { create: fakeChatCompletionsCreate },
    },
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  },
  pool: { query: vi.fn() },
  poeUsageLogTable: {},
  userCatalogSavesTable: {},
}));

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return { ...actual, getPoeClient: vi.fn(() => ({})) };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../../app.js";
import { validateToolCalls } from "../query.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

function llmResponseWithToolCalls(
  toolCalls: Array<{ name: string; arguments: string }>,
) {
  return {
    choices: [
      {
        message: {
          tool_calls: toolCalls.map((tc) => ({
            function: { name: tc.name, arguments: tc.arguments },
          })),
          content: null,
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();
  fakeChatCompletionsCreate.mockReset();
});

describe("validateToolCalls (unit)", () => {
  it("accepts a valid navigateTo call", () => {
    const { toolCalls, toolErrors } = validateToolCalls([
      { function: { name: "navigateTo", arguments: '{"lon": -132.5, "lat": 55.5}' } },
    ]);
    expect(toolErrors).toEqual([]);
    expect(toolCalls).toEqual([{ name: "navigateTo", args: { lon: -132.5, lat: 55.5 } }]);
  });

  it("rejects an unknown tool name", () => {
    const { toolCalls, toolErrors } = validateToolCalls([
      { function: { name: "execShell", arguments: '{"cmd": "rm -rf /"}' } },
    ]);
    expect(toolCalls).toEqual([]);
    expect(toolErrors).toEqual([{ name: "execShell", error: "unknown_tool" }]);
  });

  it("rejects malformed argument JSON", () => {
    const { toolCalls, toolErrors } = validateToolCalls([
      { function: { name: "navigateTo", arguments: "{lon: nope" } },
    ]);
    expect(toolCalls).toEqual([]);
    expect(toolErrors[0]!.error).toBe("malformed_arguments_json");
  });

  it("rejects out-of-range coordinates", () => {
    const { toolCalls, toolErrors } = validateToolCalls([
      { function: { name: "navigateTo", arguments: '{"lon": 999, "lat": 0}' } },
    ]);
    expect(toolCalls).toEqual([]);
    expect(toolErrors[0]!.error).toMatch(/invalid_arguments/);
  });

  it("rejects extra keys (strict schemas)", () => {
    const { toolCalls, toolErrors } = validateToolCalls([
      {
        function: {
          name: "clearHighlights",
          arguments: '{"__proto__": {"polluted": true}}',
        },
      },
    ]);
    expect(toolCalls).toEqual([]);
    expect(toolErrors[0]!.error).toMatch(/invalid_arguments/);
  });

  it("rejects a wrong-type enum for showStatistic", () => {
    const { toolCalls, toolErrors } = validateToolCalls([
      { function: { name: "showStatistic", arguments: '{"metric": "drop_tables"}' } },
    ]);
    expect(toolCalls).toEqual([]);
    expect(toolErrors).toHaveLength(1);
  });

  it("keeps valid calls while rejecting invalid ones in the same batch", () => {
    const { toolCalls, toolErrors } = validateToolCalls([
      { function: { name: "openOverview", arguments: "{}" } },
      { function: { name: "bogusTool", arguments: "{}" } },
    ]);
    expect(toolCalls).toEqual([{ name: "openOverview", args: {} }]);
    expect(toolErrors).toHaveLength(1);
  });

  it("treats an empty arguments string as {}", () => {
    const { toolCalls, toolErrors } = validateToolCalls([
      { function: { name: "clearHighlights", arguments: "" } },
    ]);
    expect(toolErrors).toEqual([]);
    expect(toolCalls).toEqual([{ name: "clearHighlights", args: {} }]);
  });
});

describe("POST /api/query — tool-call validation (route)", () => {
  it("filters invalid tool calls out of the response and reports toolErrors", async () => {
    fakeChatCompletionsCreate.mockResolvedValue(
      llmResponseWithToolCalls([
        { name: "navigateTo", arguments: '{"lon": 10, "lat": 20}' },
        { name: "notATool", arguments: "{}" },
        { name: "highlightZone", arguments: '{"zone": 5}' },
      ]),
    );

    const res = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-tool-validation")
      .send({ query: "go somewhere" });

    expect(res.status).toBe(200);
    expect(res.body.toolCalls).toEqual([
      { name: "navigateTo", args: { lon: 10, lat: 20 } },
    ]);
    expect(res.body.toolErrors).toHaveLength(2);
  });
});
