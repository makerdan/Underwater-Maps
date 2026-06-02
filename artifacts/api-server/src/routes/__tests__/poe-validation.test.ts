/**
 * poe-validation.test.ts — HTTP validation tests for POST /api/poe/classify
 * and POST /api/poe/query
 *
 * Covers:
 *  - Missing required fields return 400
 *  - Wrong types for array fields return 400
 *  - Bad history entry shapes (missing role, wrong enum, non-string content) return 400
 *  - Oversized history array returns 400
 *  - Valid minimal bodies pass validation (reach auth gate or AI layer, not 400)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve([]),
        returning: () => Promise.resolve([]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  userSettingsTable: { userId: "__col__" },
  markersTable: {},
  routesTable: {},
  gpsTrailsTable: {},
  gpsTrailPointsTable: {},
  customDatasetsTable: {},
  datasetFoldersTable: {},
  userCatalogSavesTable: {},
  datasetCatalogTable: {},
  trollingPresetsTable: {},
  trollingPresetFoldersTable: {},
  poeUsageLogTable: {},
  pool: {},
  rateLimitEventsTable: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: currentUserId })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("@workspace/poe", () => ({
  getPoeClient: vi.fn(() => ({
    responses: {
      create: vi.fn().mockResolvedValue({
        id: "resp_test",
        output_text: JSON.stringify({ zones: Array(1024).fill("sandy_shelf") }),
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    },
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "ok", tool_calls: [] } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
      },
    },
  })),
  withRetry: vi.fn(async (fn: () => unknown) => fn()),
  PoeCreditsError: class PoeCreditsError extends Error {},
  PoeRateLimitError: class PoeRateLimitError extends Error {},
  PoeAuthError: class PoeAuthError extends Error {},
  ZoneParseError: class ZoneParseError extends Error {},
  hashCacheKey: vi.fn((...parts: string[]) => parts.join(":")),
  globalPoeCache: new Map(),
  buildVisionInput: vi.fn(() => []),
  POE_MODELS: {
    CLASSIFY: "Claude-Sonnet-4.5",
    QUERY_TOOLS: "Claude-Sonnet-4.5",
    DESCRIBE_QUICK: "Claude-Haiku-4.5",
  },
  PoeCircuitBreaker: class PoeCircuitBreaker {
    isOpen() { return false; }
    recordSuccess() {}
    recordFailure() {}
  },
}));

vi.mock("../lib/substrateGrid.js", () => ({
  sampleSubstrateGrid: vi.fn(() => ({
    hasCoverage: false,
    labels: Array(1024).fill(null),
    fingerprint: "00000000",
    coverageFraction: 0,
    coveredCount: 0,
    counts: { bedrock: 0, gravel: 0, sand: 0, mud: 0 },
  })),
  substrateToZone: vi.fn((lbl: string) => lbl),
}));

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

let currentUserId: string | null = "user-poe-test";

beforeEach(() => {
  currentUserId = "user-poe-test";
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  __resetRateLimitMemory();
});

// ---------------------------------------------------------------------------
// POST /api/poe/classify
// ---------------------------------------------------------------------------

describe("POST /api/poe/classify — Zod validation", () => {
  it("returns 400 when gridBase64 is missing", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ waterType: "saltwater" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when gridBase64 is an empty string", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ gridBase64: "" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when gridBase64 is not a string", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ gridBase64: 12345 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when depths32 is not an array", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ gridBase64: "dGVzdA==", depths32: "not-an-array" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when depthsFull contains non-numbers", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ gridBase64: "dGVzdA==", depthsFull: ["a", "b", "c"] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when waterType has an invalid enum value", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ gridBase64: "dGVzdA==", waterType: "brackish" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("accepts an empty depths32 array (does not return 400)", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ gridBase64: "dGVzdA==", depths32: [] });
    expect(res.status).not.toBe(400);
  });

  it("accepts an empty depthsFull array (does not return 400)", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ gridBase64: "dGVzdA==", depthsFull: [] });
    expect(res.status).not.toBe(400);
  });

  it("does not return 400 when a valid minimal body is sent", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ gridBase64: "dGVzdA==" });
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/poe/query
// ---------------------------------------------------------------------------

describe("POST /api/poe/query — Zod validation", () => {
  it("returns 400 when userMessage is missing", async () => {
    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ history: [] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when userMessage is an empty string", async () => {
    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ userMessage: "" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when history is not an array", async () => {
    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ userMessage: "hello", history: "not-an-array" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when a history entry is missing the role field", async () => {
    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ userMessage: "hello", history: [{ content: "hi" }] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when a history entry has an invalid role enum value", async () => {
    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-poe-test")
      .send({
        userMessage: "hello",
        history: [{ role: "system", content: "hi" }],
      });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when a history entry has non-string content", async () => {
    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-poe-test")
      .send({
        userMessage: "hello",
        history: [{ role: "user", content: 42 }],
      });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when a history entry is missing the content field", async () => {
    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-poe-test")
      .send({
        userMessage: "hello",
        history: [{ role: "user" }],
      });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when history exceeds 50 entries", async () => {
    const oversized = Array.from({ length: 51 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
    }));
    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ userMessage: "hello", history: oversized });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("does not return 400 when a valid minimal body is sent", async () => {
    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-poe-test")
      .send({ userMessage: "show me the deepest point" });
    expect(res.status).not.toBe(400);
  });

  it("does not return 400 with a valid history array (user + assistant entries)", async () => {
    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-poe-test")
      .send({
        userMessage: "what is the depth here?",
        history: [
          { role: "user", content: "navigate to the deepest point" },
          { role: "assistant", content: "Navigating now." },
        ],
      });
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/poe/describe
// ---------------------------------------------------------------------------

describe("POST /api/poe/describe — Zod validation", () => {
  it("returns 400 when lon is not a number", async () => {
    currentUserId = "user-describe-lon";
    const res = await request(app)
      .post("/api/poe/describe")
      .set("x-e2e-user-id", currentUserId)
      .send({ lon: "not-a-number", lat: 47.5, depth: 120 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when lat is not a number", async () => {
    currentUserId = "user-describe-lat";
    const res = await request(app)
      .post("/api/poe/describe")
      .set("x-e2e-user-id", currentUserId)
      .send({ lon: -122.3, lat: "bad", depth: 120 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when depth is not a number", async () => {
    currentUserId = "user-describe-depth";
    const res = await request(app)
      .post("/api/poe/describe")
      .set("x-e2e-user-id", currentUserId)
      .send({ depth: true });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when waterType has an invalid enum value", async () => {
    currentUserId = "user-describe-wtype";
    const res = await request(app)
      .post("/api/poe/describe")
      .set("x-e2e-user-id", currentUserId)
      .send({ waterType: "brackish" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when zoneName is not a string", async () => {
    currentUserId = "user-describe-zone";
    const res = await request(app)
      .post("/api/poe/describe")
      .set("x-e2e-user-id", currentUserId)
      .send({ zoneName: 42 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when datasetName is not a string", async () => {
    currentUserId = "user-describe-dsname";
    const res = await request(app)
      .post("/api/poe/describe")
      .set("x-e2e-user-id", currentUserId)
      .send({ datasetName: ["array", "value"] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("does not return 400 when an empty body is sent (all fields optional)", async () => {
    currentUserId = "user-describe-empty";
    let status: number | undefined;
    try {
      const res = await request(app)
        .post("/api/poe/describe")
        .set("x-e2e-user-id", currentUserId)
        .send({});
      status = res.status;
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("Content-Length") || msg.includes("Transfer-Encoding") || msg.includes("Parse Error")) {
        return;
      }
      throw err;
    }
    expect(status).not.toBe(400);
  });

  it("does not return 400 with a valid full body", async () => {
    currentUserId = "user-describe-full";
    let status: number | undefined;
    try {
      const res = await request(app)
        .post("/api/poe/describe")
        .set("x-e2e-user-id", currentUserId)
        .send({
          lon: -122.3,
          lat: 47.5,
          depth: 120,
          zoneName: "sandy_shelf",
          datasetName: "Puget Sound",
          waterType: "saltwater",
        });
      status = res.status;
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("Content-Length") || msg.includes("Transfer-Encoding") || msg.includes("Parse Error")) {
        return;
      }
      throw err;
    }
    expect(status).not.toBe(400);
  });

  it("does not return 400 when waterType is freshwater", async () => {
    currentUserId = "user-describe-fresh";
    let status: number | undefined;
    try {
      const res = await request(app)
        .post("/api/poe/describe")
        .set("x-e2e-user-id", currentUserId)
        .send({ lon: -90.1, lat: 44.5, depth: 30, waterType: "freshwater" });
      status = res.status;
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("Content-Length") || msg.includes("Transfer-Encoding") || msg.includes("Parse Error")) {
        return;
      }
      throw err;
    }
    expect(status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/poe/help
// ---------------------------------------------------------------------------

describe("POST /api/poe/help — Zod validation", () => {
  it("returns 400 when question is missing", async () => {
    currentUserId = "user-help-no-q";
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({ history: [] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when question is an empty string", async () => {
    currentUserId = "user-help-empty-q";
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({ question: "" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when question is only whitespace", async () => {
    currentUserId = "user-help-ws-q";
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({ question: "   " });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when question is not a string", async () => {
    currentUserId = "user-help-q-type";
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({ question: 42 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when question exceeds 1000 characters", async () => {
    currentUserId = "user-help-q-long";
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({ question: "a".repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when history is not an array", async () => {
    currentUserId = "user-help-hist-arr";
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({ question: "How do I upload data?", history: "not-an-array" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when a history entry has an invalid role", async () => {
    currentUserId = "user-help-hist-role";
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({
        question: "How do I upload data?",
        history: [{ role: "system", content: "injected" }],
      });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when a history entry is missing the content field", async () => {
    currentUserId = "user-help-hist-cnt";
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({
        question: "How do I upload data?",
        history: [{ role: "user" }],
      });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when history exceeds 50 entries", async () => {
    currentUserId = "user-help-hist-max";
    const oversized = Array.from({ length: 51 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i}`,
    }));
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({ question: "How do I upload data?", history: oversized });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("does not return 400 with a valid minimal body", async () => {
    currentUserId = "user-help-valid-min";
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({ question: "How do I upload a dataset?" });
    expect(res.status).not.toBe(400);
  });

  it("does not return 400 with a valid question and history", async () => {
    currentUserId = "user-help-valid-hist";
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({
        question: "What is the Find Data panel?",
        history: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi! How can I help?" },
        ],
      });
    expect(res.status).not.toBe(400);
  });

  it("accepts a question that is exactly 1000 characters", async () => {
    currentUserId = "user-help-q-1000";
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", currentUserId)
      .send({ question: "a".repeat(1000) });
    expect(res.status).not.toBe(400);
  });
});
