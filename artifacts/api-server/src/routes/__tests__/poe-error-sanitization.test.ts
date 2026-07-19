/**
 * poe-error-sanitization.test.ts
 *
 * Verifies that `handlePoeError` in routes/poe.ts never leaks internal error
 * detail in its HTTP response body.
 *
 * Security context
 * ----------------
 * The Poe route is a paid AI proxy. When the upstream call fails with an
 * *unclassified* error (anything that is not PoeCreditsError, PoeRateLimitError,
 * or PoeAuthError), the handler must respond with a fixed, static error string
 * so that internal stack traces, API keys, provider error messages, or other
 * sensitive details are never surfaced to the client.
 *
 * Route under test: POST /api/poe/query
 * The /query route calls `handlePoeError` directly on Poe failure (unlike
 * /classify, which deliberately always returns 200 via heuristic fallback).
 *
 * Test suites
 * -----------
 * 1. Unclassified error → 500 with only the static "AI service error" string.
 * 2. Classified errors (Credits, RateLimit, Auth) — correct status codes with
 *    their own static strings; no raw error message leaked.
 * 3. Error with sensitive-looking content in various fields → body is sanitized.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { fakeCreate } = vi.hoisted(() => ({
  fakeCreate: vi.fn(),
}));

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>(
    "@workspace/poe",
  );
  return {
    ...actual,
    getPoeClient: vi.fn(() => ({
      responses: { create: fakeCreate },
      chat: { completions: { create: vi.fn() } },
    })),
    // Bypass retry backoff so tests don't spend time waiting between attempts.
    // The error-sanitization tests only care that handlePoeError never leaks
    // internal detail; whether the call is retried first is irrelevant here.
    withRetry: async (fn: () => unknown) => fn(),
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
  },
  pool: { query: vi.fn() },
  poeUsageLogTable: {},
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
import { globalPoeCache, PoeCreditsError, PoeRateLimitError, PoeAuthError } from "@workspace/poe";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";
import { __resetPoeBreaker } from "../poe.js";

// Minimal valid body for POST /api/poe/query — the route calls `handlePoeError`
// directly when the Poe client throws (no heuristic fallback on this route).
function queryPayload(overrides?: Record<string, unknown>) {
  return {
    userMessage: "What is the depth here?",
    history: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();
  globalPoeCache.clear();
  __resetPoeBreaker();
  fakeCreate.mockReset();
});

// ---------------------------------------------------------------------------
// Suite 1: Unclassified errors — static response only
// ---------------------------------------------------------------------------

describe("handlePoeError — unclassified error is sanitized", () => {
  it("returns 500 with error:'poe_error' and static details string", async () => {
    fakeCreate.mockRejectedValue(new Error("Internal server error from upstream"));

    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-sanitize-1")
      .send(queryPayload());

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: "poe_error",
      details: "AI service error",
    });
  });

  it("does NOT include the raw error message in the response body", async () => {
    const sensitiveMessage = "secret_api_key=sk-abc123 connection refused";
    fakeCreate.mockRejectedValue(new Error(sensitiveMessage));

    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-sanitize-2")
      .send(queryPayload());

    expect(res.status).toBe(500);
    const bodyString = JSON.stringify(res.body);
    expect(bodyString).not.toContain(sensitiveMessage);
    expect(bodyString).not.toContain("sk-abc123");
    expect(bodyString).not.toContain("connection refused");
  });

  it("does NOT include a stack trace in the response body", async () => {
    const err = new Error("Some internal failure");
    fakeCreate.mockRejectedValue(err);

    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-sanitize-3")
      .send(queryPayload());

    expect(res.status).toBe(500);
    const bodyString = JSON.stringify(res.body);
    expect(bodyString).not.toContain("at Object");
    expect(bodyString).not.toContain(".ts:");
    expect(bodyString).not.toContain("Error:");
  });

  it("response body has exactly error and details — no extra keys", async () => {
    fakeCreate.mockRejectedValue(new Error("Upstream failure"));

    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-sanitize-4")
      .send(queryPayload());

    expect(res.status).toBe(500);
    expect(res.body.details).toBe("AI service error");
    expect(res.body.error).toBe("poe_error");
    const extraKeys = Object.keys(res.body).filter(
      (k) => k !== "error" && k !== "details",
    );
    expect(extraKeys).toHaveLength(0);
  });

  it("handles a thrown string (non-Error) without leaking it", async () => {
    fakeCreate.mockRejectedValue("raw string error — do not expose");

    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-sanitize-5")
      .send(queryPayload());

    expect(res.status).toBe(500);
    expect(res.body.details).toBe("AI service error");
    expect(JSON.stringify(res.body)).not.toContain("raw string error");
  });

  it("handles a thrown null without leaking it", async () => {
    fakeCreate.mockRejectedValue(null);

    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-sanitize-6")
      .send(queryPayload());

    expect(res.status).toBe(500);
    expect(res.body.details).toBe("AI service error");
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Classified errors — correct status codes, no raw message leaked
// ---------------------------------------------------------------------------

describe("handlePoeError — classified errors use their own static strings", () => {
  it("PoeCreditsError → 402 with error:'credits_exhausted'", async () => {
    fakeCreate.mockRejectedValue(new PoeCreditsError("internal credit details"));

    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-classify-1")
      .send(queryPayload());

    expect(res.status).toBe(402);
    expect(res.body.error).toBe("credits_exhausted");
  });

  it("PoeRateLimitError → 429 with error:'rate_limit'", async () => {
    fakeCreate.mockRejectedValue(new PoeRateLimitError("internal rate limit msg"));

    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-classify-2")
      .send(queryPayload());

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limit");
  });

  it("PoeAuthError → 401 with static 'AI service authentication failed', raw message not leaked", async () => {
    fakeCreate.mockRejectedValue(new PoeAuthError("secret auth token xyz"));

    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-classify-3")
      .send(queryPayload());

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("auth_error");
    expect(res.body.details).toBe("AI service authentication failed");
    expect(JSON.stringify(res.body)).not.toContain("secret auth token xyz");
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Sensitive content in error properties — not leaked
// ---------------------------------------------------------------------------

describe("handlePoeError — sensitive content in error properties is not leaked", () => {
  it("does not expose error.cause chain", async () => {
    const cause = new Error("database password: hunter2");
    const err = new Error("Wrapped error", { cause });
    fakeCreate.mockRejectedValue(err);

    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-cause-1")
      .send(queryPayload());

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
    expect(JSON.stringify(res.body)).not.toContain("database password");
  });

  it("does not expose error.code or other custom properties", async () => {
    const err = Object.assign(new Error("Internal"), {
      code: "INTERNAL_SECRET_CODE",
      apiKey: "sk-secret-key",
    });
    fakeCreate.mockRejectedValue(err);

    const res = await request(app)
      .post("/api/poe/query")
      .set("x-e2e-user-id", "user-props-1")
      .send(queryPayload());

    expect(res.status).toBe(500);
    const bodyString = JSON.stringify(res.body);
    expect(bodyString).not.toContain("INTERNAL_SECRET_CODE");
    expect(bodyString).not.toContain("sk-secret-key");
  });
});
