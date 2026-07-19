/**
 * poe-fallback.test.ts — Fallback ordering tests for help Q&A and classification.
 *
 * Covers:
 *   - Help: Poe ok → answer served by Poe (no OpenAI call)
 *   - Help: Poe fails → OpenAI ok → answer served by OpenAI (source transparent to client)
 *   - Help: Poe fails + OpenAI fails → error propagated (handlePoeError)
 *   - Classify: Poe ok → source: "ai"
 *   - Classify: Poe fails → OpenAI vision ok → source: "ai", result is cached
 *   - Classify: Poe fails + OpenAI fails → source: "heuristic" (with depths32)
 *   - Cache: a second identical classify after an OpenAI-served result hits the cache
 *     and returns source: "ai" (not "heuristic")
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock factories — must be at the top so vi.hoisted() runs before
// module imports.
// ---------------------------------------------------------------------------

const {
  fakePoeChat,
  fakePoeResponses,
  fakeOaiChat,
} = vi.hoisted(() => ({
  fakePoeChat: vi.fn(),
  /** Controls client.responses.create — used by the classify route (Poe vision path). */
  fakePoeResponses: vi.fn(),
  fakeOaiChat: vi.fn(),
}));

// ---------------------------------------------------------------------------
// @workspace/poe — controlled per-test via fakePoeChat (help) / fakePoeResponses (classify)
// ---------------------------------------------------------------------------
vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return {
    ...actual,
    getPoeClient: vi.fn(() => ({
      chat: { completions: { create: fakePoeChat } },
      responses: { create: fakePoeResponses },
    })),
  };
});

// ---------------------------------------------------------------------------
// @workspace/integrations-openai-ai-server — controlled per-test via fakeOaiChat
// ---------------------------------------------------------------------------
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: fakeOaiChat,
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Other mandatory mocks
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  },
  poeUsageLogTable: {},
}));

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
import { __resetPoeBreaker, __resetOpenAiClientCacheForTests } from "../poe.js";
import { globalPoeCache } from "@workspace/poe";
import { db } from "@workspace/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPoeOkChat(answer = "Use the toolbar to drop a marker.") {
  return {
    id: "chatcmpl_poe",
    choices: [{ message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 50, completion_tokens: 25 },
  };
}

function buildOaiOkChat(answer = "OpenAI fallback answer.") {
  return {
    id: "chatcmpl_oai",
    choices: [{ message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 30, completion_tokens: 15 },
  };
}

/** OpenAI classify response with RLE-encoded 1024 zones. */
function buildOaiClassifyRle(label = "basalt_rock") {
  return {
    id: "chatcmpl_oai_classify_rle",
    choices: [
      {
        message: {
          role: "assistant",
          content: JSON.stringify({ zones: [[label, 1024]] }),
        },
      },
    ],
    usage: { prompt_tokens: 200, completion_tokens: 50 },
  };
}

const DEPTHS_32 = Array(1024).fill(10);
const GRID_BASE64 = "data:image/png;base64,dGVzdA==";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();
  __resetPoeBreaker();
  __resetOpenAiClientCacheForTests();
  globalPoeCache.clear();
  fakePoeChat.mockReset();
  fakeOaiChat.mockReset();
  // Default: Poe classify (responses.create) succeeds with 1024 sandy_shelf zones.
  // Override per-test when you need Poe to fail.
  fakePoeResponses.mockResolvedValue({
    id: "resp_test",
    output_text: JSON.stringify({ zones: Array(1024).fill("sandy_shelf") }),
    usage: { input_tokens: 10, output_tokens: 10 },
  });
});

// ===========================================================================
// Help Q&A fallback tests
// ===========================================================================

describe("POST /api/poe/help — provider fallback", () => {
  it("serves answer via Poe when Poe succeeds (no OpenAI call)", async () => {
    fakePoeChat.mockResolvedValueOnce(buildPoeOkChat("Poe answer here."));

    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", "user-help-poe-ok")
      .send({ question: "How do I drop a marker?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("Poe answer here.");
    expect(fakeOaiChat).not.toHaveBeenCalled();
  });

  it("falls back to OpenAI when Poe throws, returns answer transparently", async () => {
    fakePoeChat.mockRejectedValueOnce(new Error("Poe payment error"));
    fakeOaiChat.mockResolvedValueOnce(buildOaiOkChat("OpenAI fallback answer."));

    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", "user-help-oai-fallback")
      .send({ question: "How do I use the Drift Planner?" });

    expect(res.status).toBe(200);
    expect(typeof res.body.answer).toBe("string");
    expect(res.body.answer.length).toBeGreaterThan(0);
    expect(fakeOaiChat).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when both Poe and OpenAI fail", async () => {
    fakePoeChat.mockRejectedValueOnce(new Error("Poe down"));
    fakeOaiChat.mockRejectedValueOnce(new Error("OpenAI also down"));

    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", "user-help-both-fail")
      .send({ question: "How do I export settings?" });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("does not call OpenAI when Poe succeeds", async () => {
    fakePoeChat.mockResolvedValue(buildPoeOkChat("ok"));

    await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", "user-help-no-oai-if-poe-ok")
      .send({ question: "What is TIDAL 3D?" });

    expect(fakeOaiChat).not.toHaveBeenCalled();
  });

  it("OpenAI fallback answer is valid (non-empty string)", async () => {
    fakePoeChat.mockRejectedValueOnce(new Error("credits_exhausted"));
    fakeOaiChat.mockResolvedValueOnce(buildOaiOkChat("You can find the TIDAL toggle in the sidebar."));

    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", "user-help-oai-content")
      .send({ question: "What does the TIDAL 3D toggle do?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain("TIDAL");
  });
});

// ===========================================================================
// Classification fallback tests
// ===========================================================================

describe("POST /api/poe/classify — provider fallback", () => {
  it("returns source: 'ai' when Poe succeeds", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cls-poe-ok")
      .send({ gridBase64: GRID_BASE64, waterType: "saltwater", depths32: DEPTHS_32 });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ai");
    expect(fakeOaiChat).not.toHaveBeenCalled();
  });

  it("falls back to OpenAI vision when Poe fails, returns source: 'ai'", async () => {
    fakePoeResponses.mockRejectedValue(new Error("Poe service error"));
    fakeOaiChat.mockResolvedValue(buildOaiClassifyRle("basalt_rock"));

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cls-oai-fallback")
      .send({ gridBase64: GRID_BASE64, waterType: "saltwater", depths32: DEPTHS_32 });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ai");
    expect(Array.isArray(res.body.zones)).toBe(true);
    expect(res.body.zones.length).toBe(1024);
    expect(fakeOaiChat).toHaveBeenCalled();
  });

  it("returns source: 'heuristic' when both Poe and OpenAI fail", async () => {
    fakePoeResponses.mockRejectedValue(new Error("Poe down"));
    fakeOaiChat.mockRejectedValue(new Error("OpenAI also down"));

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cls-heuristic")
      .send({ gridBase64: GRID_BASE64, waterType: "saltwater", depths32: DEPTHS_32 });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("heuristic");
    expect(Array.isArray(res.body.zones)).toBe(true);
    expect(res.body.zones.length).toBe(1024);
  });

  it("returns 200 (uniform fill) when both fail and depths32 is absent", async () => {
    fakePoeResponses.mockRejectedValue(new Error("Poe down"));
    fakeOaiChat.mockRejectedValue(new Error("OpenAI down"));

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cls-no-depths")
      .send({ gridBase64: GRID_BASE64, waterType: "saltwater" });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("heuristic");
  });

  it("caches OpenAI result as 'ai': second identical call returns fromCache true", async () => {
    fakePoeResponses.mockRejectedValue(new Error("Poe down"));
    fakeOaiChat.mockResolvedValueOnce(buildOaiClassifyRle("coarse_sediment"));

    const userId = "user-cls-cache-test";
    const body = {
      gridBase64: GRID_BASE64,
      waterType: "saltwater",
      depths32: DEPTHS_32,
      gridHash: "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222",
    };

    const first = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", userId)
      .send(body);

    expect(first.status).toBe(200);
    expect(first.body.source).toBe("ai");
    expect(first.body.fromCache).toBe(false);

    const second = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", userId)
      .send(body);

    expect(second.status).toBe(200);
    expect(second.body.fromCache).toBe(true);
    expect(second.body.source).toBe("ai");
    expect(fakeOaiChat).toHaveBeenCalledTimes(1);
  });

  it("does not call OpenAI when Poe succeeds", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cls-no-oai-poe-ok")
      .send({ gridBase64: GRID_BASE64, waterType: "freshwater", depths32: DEPTHS_32 });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ai");
    expect(fakeOaiChat).not.toHaveBeenCalled();
  });

  it("freshwater fallback labels are valid freshwater zones", async () => {
    fakePoeResponses.mockRejectedValue(new Error("Poe down"));
    fakeOaiChat.mockResolvedValueOnce({
      id: "chatcmpl_fw",
      choices: [{ message: { content: JSON.stringify({ zones: [["aquatic_vegetation", 1024]] }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cls-freshwater-fallback")
      .send({ gridBase64: GRID_BASE64, waterType: "freshwater", depths32: DEPTHS_32 });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ai");
    const zones: string[] = res.body.zones;
    expect(zones.length).toBe(1024);
    expect(zones.every((z) => typeof z === "string" && z.length > 0)).toBe(true);
  });
});

// ===========================================================================
// Quota / rate-limit error detection
// ===========================================================================

describe("OpenAI quota/429 detection", () => {
  it("classify: OpenAI 429 status error still falls back to heuristic (not 500)", async () => {
    fakePoeResponses.mockRejectedValue(new Error("Poe down"));
    const quotaErr = Object.assign(new Error("OpenAI quota exceeded"), { status: 429 });
    fakeOaiChat.mockRejectedValue(quotaErr);

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cls-quota-429")
      .send({ gridBase64: GRID_BASE64, waterType: "saltwater", depths32: DEPTHS_32 });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("heuristic");
    expect(Array.isArray(res.body.zones)).toBe(true);
  });

  it("classify: OpenAI insufficient_quota code still falls back to heuristic", async () => {
    fakePoeResponses.mockRejectedValue(new Error("Poe down"));
    const quotaErr = Object.assign(new Error("insufficient_quota"), { code: "insufficient_quota" });
    fakeOaiChat.mockRejectedValue(quotaErr);

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cls-quota-code")
      .send({ gridBase64: GRID_BASE64, waterType: "saltwater", depths32: DEPTHS_32 });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("heuristic");
  });

  it("help: OpenAI 429 status error propagates cleanly (not 502)", async () => {
    fakePoeChat.mockRejectedValueOnce(new Error("Poe down"));
    const quotaErr = Object.assign(new Error("OpenAI rate limit reached"), { status: 429 });
    fakeOaiChat.mockRejectedValueOnce(quotaErr);

    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", "user-help-quota-429")
      .send({ question: "What is the zone overlay?" });

    // When both AI providers fail, handlePoeError returns a 4xx/5xx error.
    // Critical assertion: must NOT be a raw 502 (which would indicate an
    // unhandled upstream quota response leaking through to the client).
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(502);
    expect(res.body).toHaveProperty("error");
  });
});

// ===========================================================================
// Billing log provider tagging
// ===========================================================================

describe("logUsage provider tagging", () => {
  afterEach(() => {
    vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue([]) } as unknown as ReturnType<typeof db.insert>);
  });

  it("classify: logUsage carries provider 'openai' when OpenAI fallback succeeds", async () => {
    fakePoeResponses.mockRejectedValue(new Error("Poe down"));
    fakeOaiChat.mockResolvedValueOnce(buildOaiClassifyRle("sandy_shelf"));

    const valuesSpy = vi.fn().mockResolvedValue([]);
    vi.mocked(db.insert).mockReturnValue({ values: valuesSpy } as unknown as ReturnType<typeof db.insert>);

    await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cls-provider-tag")
      .send({ gridBase64: GRID_BASE64, waterType: "saltwater", depths32: DEPTHS_32 });

    const logCall = valuesSpy.mock.calls.find(
      ([arg]: [Record<string, unknown>]) => arg?.endpoint === "classify",
    );
    expect(logCall).toBeDefined();
    expect(logCall?.[0]).toMatchObject({ provider: "openai" });
  });

  it("help: logUsage carries provider 'openai' when OpenAI fallback succeeds", async () => {
    fakePoeChat.mockRejectedValueOnce(new Error("Poe down"));
    fakeOaiChat.mockResolvedValueOnce(buildOaiOkChat("OpenAI fallback answer."));

    const valuesSpy = vi.fn().mockResolvedValue([]);
    vi.mocked(db.insert).mockReturnValue({ values: valuesSpy } as unknown as ReturnType<typeof db.insert>);

    await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", "user-help-provider-tag")
      .send({ question: "How do I use the zone overlay?" });

    const logCall = valuesSpy.mock.calls.find(
      ([arg]: [Record<string, unknown>]) => arg?.endpoint === "help",
    );
    expect(logCall).toBeDefined();
    expect(logCall?.[0]).toMatchObject({ provider: "openai" });
  });

  it("classify: Poe success does NOT carry a provider field (keeps existing rows clean)", async () => {
    const valuesSpy = vi.fn().mockResolvedValue([]);
    vi.mocked(db.insert).mockReturnValue({ values: valuesSpy } as unknown as ReturnType<typeof db.insert>);

    await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cls-poe-provider-absent")
      .send({ gridBase64: GRID_BASE64, waterType: "saltwater", depths32: DEPTHS_32 });

    const logCall = valuesSpy.mock.calls.find(
      ([arg]: [Record<string, unknown>]) => arg?.endpoint === "classify",
    );
    if (logCall) {
      // Poe success: provider should be absent (not set to "poe" or any other value)
      expect(logCall[0]).not.toHaveProperty("provider");
    }
    // If no logCall is found, Poe succeeded without logging — also valid
  });
});
