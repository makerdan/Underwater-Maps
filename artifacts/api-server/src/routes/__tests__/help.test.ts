import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { fakeChatCreate, fakeResponsesCreate } = vi.hoisted(() => ({
  fakeChatCreate: vi.fn(),
  fakeResponsesCreate: vi.fn(),
}));

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>(
    "@workspace/poe",
  );
  return {
    ...actual,
    getPoeClient: vi.fn(() => ({
      chat: { completions: { create: fakeChatCreate } },
      responses: { create: fakeResponsesCreate },
    })),
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
  },
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

function buildOkChat(answer = "Click the marker tool in the toolbar.") {
  return {
    id: "chatcmpl_test_help",
    choices: [{ message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 50, completion_tokens: 25 },
  };
}

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  fakeChatCreate.mockReset();
  fakeChatCreate.mockResolvedValue(buildOkChat());
});

describe("POST /api/poe/help", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/poe/help")
      .send({ question: "How do I drop a marker?" });

    expect(res.status).toBe(401);
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
    expect(fakeChatCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when the question field is missing", async () => {
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", "user-help-missing")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "missing_field" });
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(fakeChatCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when the question is longer than 1000 characters", async () => {
    const longQuestion = "a".repeat(1001);
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", "user-help-long")
      .send({ question: longQuestion });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "too_long" });
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(fakeChatCreate).not.toHaveBeenCalled();
  });

  it("returns 200 with an answer string on a valid request", async () => {
    const res = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", "user-help-ok")
      .send({ question: "How do I drop a marker?" });

    expect(res.status).toBe(200);
    expect(typeof res.body.answer).toBe("string");
    expect(res.body.answer.length).toBeGreaterThan(0);
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
    expect(fakeChatCreate).toHaveBeenCalledTimes(1);
  });

  it("emits rate-limit headers on a 429 once the per-user window is exceeded", async () => {
    const userId = "user-help-ratelimit";

    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .post("/api/poe/help")
        .set("x-e2e-user-id", userId)
        .send({ question: `Question ${i}` });
      expect(res.status).toBe(200);
    }

    const limited = await request(app)
      .post("/api/poe/help")
      .set("x-e2e-user-id", userId)
      .send({ question: "one too many" });

    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: "rate_limit" });
    expect(limited.headers["x-ratelimit-limit"]).toBeDefined();
    expect(limited.headers["x-ratelimit-remaining"]).toBe("0");
    expect(limited.headers["retry-after"]).toBeDefined();
  });
});
