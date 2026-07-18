import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { fakePoeCreate, fakeChatCompletionsCreate } = vi.hoisted(() => ({
  fakePoeCreate: vi.fn(),
  fakeChatCompletionsCreate: vi.fn(),
}));

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return {
    ...actual,
    getPoeClient: vi.fn(() => ({
      chat: { completions: { create: fakePoeCreate } },
    })),
  };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: { create: fakeChatCompletionsCreate },
    },
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
  pool: { query: vi.fn() },
  poeUsageLogTable: {},
  userCatalogSavesTable: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";
import { queryCircuitBreaker } from "../query.js";

function buildOkLLMResponse() {
  return {
    choices: [
      {
        message: {
          tool_calls: [],
          content: "ok",
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();

  // Reset circuit breaker to closed state between tests.
  queryCircuitBreaker.recordSuccess();

  fakePoeCreate.mockReset();
  fakeChatCompletionsCreate.mockReset();

  // Default: Poe succeeds; OpenAI is the backup and should not be called
  // unless Poe fails.
  fakePoeCreate.mockResolvedValue(buildOkLLMResponse());
  fakeChatCompletionsCreate.mockResolvedValue(buildOkLLMResponse());
});

describe("POST /api/query", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    const res = await request(app)
      .post("/api/query")
      .send({ query: "where is the deepest point" });

    expect(res.status).toBe(401);
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(fakePoeCreate).not.toHaveBeenCalled();
    expect(fakeChatCompletionsCreate).not.toHaveBeenCalled();
  });

  it("serves requests via Poe when Poe is healthy (primary path)", async () => {
    const res = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-query-poe-ok")
      .send({ query: "navigate to the deepest point", context: { datasetName: "test" } });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.toolCalls)).toBe(true);
    expect(fakePoeCreate).toHaveBeenCalledTimes(1);
    expect(fakeChatCompletionsCreate).not.toHaveBeenCalled();
  });

  it("falls back to OpenAI transparently when Poe throws", async () => {
    fakePoeCreate.mockRejectedValue(new Error("Poe upstream error"));

    const res = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-query-poe-fail")
      .send({ query: "where is the deepest point" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.toolCalls)).toBe(true);
    expect(fakePoeCreate).toHaveBeenCalledTimes(1);
    expect(fakeChatCompletionsCreate).toHaveBeenCalledTimes(1);
  });

  it("returns toolCalls and textResponse identical whether served by Poe or OpenAI (schema unchanged)", async () => {
    const toolCallPayload = {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: "navigateToDeepestPoint",
                  arguments: "{}",
                },
              },
            ],
            content: "Navigating to deepest point.",
          },
        },
      ],
    };

    // Poe path
    fakePoeCreate.mockResolvedValue(toolCallPayload);
    const poRes = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-schema-poe")
      .send({ query: "go deep" });

    expect(poRes.status).toBe(200);
    expect(poRes.body).toMatchObject({
      toolCalls: [{ name: "navigateToDeepestPoint", args: {} }],
      textResponse: "Navigating to deepest point.",
    });

    // Reset breaker state then force Poe failure so OpenAI serves
    queryCircuitBreaker.recordSuccess();
    fakePoeCreate.mockRejectedValue(new Error("poe down"));
    fakeChatCompletionsCreate.mockResolvedValue(toolCallPayload);

    const oaRes = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-schema-openai")
      .send({ query: "go deep" });

    expect(oaRes.status).toBe(200);
    expect(oaRes.body).toMatchObject({
      toolCalls: [{ name: "navigateToDeepestPoint", args: {} }],
      textResponse: "Navigating to deepest point.",
    });

    // The two response bodies must be shape-identical
    expect(poRes.body).toStrictEqual(oaRes.body);
  });

  it("returns 502 only when both Poe and OpenAI fail", async () => {
    fakePoeCreate.mockRejectedValue(new Error("poe down"));
    fakeChatCompletionsCreate.mockRejectedValue(new Error("openai down"));

    const res = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-both-fail")
      .send({ query: "anything" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "llm_error" });
  });

  it("skips Poe and uses OpenAI directly when the circuit breaker is open", async () => {
    // Open the circuit breaker by recording enough failures.
    for (let i = 0; i < 3; i++) queryCircuitBreaker.recordFailure();

    const res = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-breaker-open")
      .send({ query: "anything" });

    expect(res.status).toBe(200);
    // Poe should have been bypassed entirely
    expect(fakePoeCreate).not.toHaveBeenCalled();
    expect(fakeChatCompletionsCreate).toHaveBeenCalledTimes(1);
  });

  it("passes an AbortSignal to the provider SDK so a stuck upstream cannot pin a worker", async () => {
    await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-query-signal")
      .send({ query: "anything" });

    // When Poe is healthy it should receive the signal
    const optsArg = fakePoeCreate.mock.calls[0]?.[1] as
      | { signal?: AbortSignal }
      | undefined;
    expect(optsArg?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 400 with structured error when query field is missing", async () => {
    const res = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-query-no-query")
      .send({ context: { datasetName: "test" } });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
    expect(fakePoeCreate).not.toHaveBeenCalled();
    expect(fakeChatCompletionsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 with structured error when query is an empty string", async () => {
    const res = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-query-empty")
      .send({ query: "" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
    expect(fakePoeCreate).not.toHaveBeenCalled();
    expect(fakeChatCompletionsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 with structured error when query is whitespace only", async () => {
    const res = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-query-whitespace")
      .send({ query: "   " });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
    expect(fakePoeCreate).not.toHaveBeenCalled();
    expect(fakeChatCompletionsCreate).not.toHaveBeenCalled();
  });

  it("returns 429 once the per-user rate limit is exceeded and surfaces Retry-After", async () => {
    const userId = "user-query-ratelimit";
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post("/api/query")
        .set("x-e2e-user-id", userId)
        .send({ query: `q-${i}` });
      expect(res.status).toBe(200);
    }

    const limited = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", userId)
      .send({ query: "one too many" });

    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: "rate_limit" });
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.headers["x-ratelimit-remaining"]).toBe("0");
  });
});
