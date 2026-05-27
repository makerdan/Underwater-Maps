import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { fakeChatCompletionsCreate } = vi.hoisted(() => ({
  fakeChatCompletionsCreate: vi.fn(),
}));

// Mock the OpenAI integration so no real API call is made.
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

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>(
    "@workspace/poe",
  );
  return { ...actual, getPoeClient: vi.fn(() => ({})) };
});

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
  fakeChatCompletionsCreate.mockReset();
  fakeChatCompletionsCreate.mockResolvedValue(buildOkLLMResponse());
});

describe("POST /api/query", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    const res = await request(app)
      .post("/api/query")
      .send({ query: "where is the deepest point" });

    expect(res.status).toBe(401);
    // Baseline rate-limit headers are stamped even on the 401 so clients can
    // reason about quota before signing in.
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(fakeChatCompletionsCreate).not.toHaveBeenCalled();
  });

  it("returns 200 with toolCalls/textResponse on a valid authenticated request", async () => {
    const res = await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-query-ok")
      .send({ query: "navigate to the deepest point", context: { datasetName: "test" } });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.toolCalls)).toBe(true);
    expect(fakeChatCompletionsCreate).toHaveBeenCalledTimes(1);
  });

  it("passes an AbortSignal to the OpenAI SDK so a stuck upstream cannot pin a worker", async () => {
    await request(app)
      .post("/api/query")
      .set("x-e2e-user-id", "user-query-signal")
      .send({ query: "anything" });

    const optsArg = fakeChatCompletionsCreate.mock.calls[0]?.[1] as
      | { signal?: AbortSignal }
      | undefined;
    expect(optsArg?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 429 once the per-user rate limit is exceeded and surfaces Retry-After", async () => {
    const userId = "user-query-ratelimit";
    // The per-user limit is 20 req/min — burn through it.
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
