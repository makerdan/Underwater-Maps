/**
 * trails-rate-limit.test.ts
 *
 * Verifies that POST /api/trails enforces the IP-based rate limit of 10
 * requests per minute. Uses the in-memory rate-limit backend so the test is
 * hermetic (no Postgres required).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "trail-1", pointCount: 1 }]),
      }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) =>
      cb({
        insert: () => ({
          values: () => ({
            returning: () =>
              Promise.resolve([{ id: "trail-1", pointCount: 1 }]),
          }),
        }),
      }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  },
  gpsTrailsTable: {},
  gpsTrailPointsTable: {},
  customDatasetsTable: {},
  userSettingsTable: {},
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
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

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const E2E_USER = "user_trails_rate_limit_test";

const VALID_TRAIL_BODY = {
  datasetId: "glba_main",
  name: "Test Trail",
  colour: "#ff6600",
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T01:00:00.000Z",
  points: [{ lon: -136.0, lat: 58.5, accuracy: 3, timestamp: 1735689600000 }],
};

describe("POST /api/trails — IP rate limit (10 req / min)", () => {
  it("allows the first 10 requests and blocks the 11th with 429", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/api/trails")
        .set("x-e2e-user-id", E2E_USER)
        .set("x-forwarded-for", "203.0.113.42")
        .send(VALID_TRAIL_BODY);

      expect(res.status, `request #${i + 1} should not be rate-limited`).not.toBe(429);
    }

    const blocked = await request(app)
      .post("/api/trails")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", "203.0.113.42")
      .send(VALID_TRAIL_BODY);

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: "rate_limit" });
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("tracks limits per IP — a different IP is not affected by another IP's quota", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/api/trails")
        .set("x-e2e-user-id", E2E_USER)
        .set("x-forwarded-for", "203.0.113.1")
        .send(VALID_TRAIL_BODY);
    }

    const differentIp = await request(app)
      .post("/api/trails")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", "203.0.113.2")
      .send(VALID_TRAIL_BODY);

    expect(differentIp.status).not.toBe(429);
  });

  it("sets X-RateLimit-* headers on allowed requests", async () => {
    const res = await request(app)
      .post("/api/trails")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", "203.0.113.50")
      .send(VALID_TRAIL_BODY);

    expect(res.headers["x-ratelimit-limit"]).toBe("10");
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });
});
