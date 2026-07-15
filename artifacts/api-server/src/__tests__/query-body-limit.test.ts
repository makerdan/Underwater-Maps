/**
 * Regression test: POST /api/query enforces a 16 KB body limit.
 *
 * A payload that exceeds 16 KB must be rejected with HTTP 413 before
 * the Zod validator or any business logic runs.  This guards against
 * the former global 50 MB ceiling which allowed attackers to force the
 * server to fully parse arbitrarily large JSON bodies.
 */
import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by vitest before imports)
// ---------------------------------------------------------------------------

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => ({
    userId: req.headers["x-mock-clerk-user-id"] || null,
  })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

// The query route uses OpenAI — mock it so tests never hit the network.
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "ok", tool_calls: [] } }],
        }),
      },
    },
  },
}));

// Rate-limit middleware uses Postgres — bypass it in unit tests.
vi.mock("../middlewares/rateLimit.js", () => ({
  createRateLimit: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  stampBaselineRateLimitHeaders: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

import app from "../app.js";

const AUTHED_HEADER = { "x-mock-clerk-user-id": "user_test_limit" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a JSON body whose serialised form is at least `targetBytes` bytes. */
function oversizedBody(targetBytes: number): Record<string, unknown> {
  const padding = "x".repeat(targetBytes);
  return { query: padding };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/query — body size limit", () => {
  it("returns 413 for a payload larger than 16 KB (unauthenticated)", async () => {
    const body = oversizedBody(17 * 1024);
    const res = await request(app)
      .post("/api/query")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(body));

    expect(res.status).toBe(413);
  });

  it("returns 413 for a payload larger than 16 KB (authenticated)", async () => {
    const body = oversizedBody(17 * 1024);
    const res = await request(app)
      .post("/api/query")
      .set({ ...AUTHED_HEADER, "Content-Type": "application/json" })
      .send(JSON.stringify(body));

    expect(res.status).toBe(413);
  });

  it("accepts a valid payload well below 16 KB when authenticated", async () => {
    const body = { query: "show me the deepest point" };
    const res = await request(app)
      .post("/api/query")
      .set({ ...AUTHED_HEADER, "Content-Type": "application/json" })
      .send(JSON.stringify(body));

    // 200 means the limit did not fire; the mocked OpenAI returned a result.
    expect(res.status).toBe(200);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await request(app)
      .post("/api/query")
      .set("Content-Type", "application/json")
      .send('{"query": "unterminated');

    expect(res.status).toBe(400);
  });
});
