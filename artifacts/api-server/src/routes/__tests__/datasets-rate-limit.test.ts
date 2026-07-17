/**
 * datasets-rate-limit.test.ts
 *
 * Verifies that POST /api/datasets/upload enforces the IP-based rate limit of
 * 10 requests per minute. Uses the in-memory rate-limit backend so the test
 * is hermetic (no Postgres required).
 *
 * Performance note: instead of exhausting the quota by sending max-1 real HTTP
 * requests, __prefillRateLimitMemory() pre-loads the in-memory bucket with the
 * desired count of synthetic timestamps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
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
import {
  __resetRateLimitMemory,
  __prefillRateLimitMemory,
} from "../../middlewares/rateLimit.js";

// Route + window constants matching the production createRateLimit() call
// in routes/datasets.ts.
const UPLOAD_ROUTE = "dataset-upload";
const WINDOW_MS = 60_000;
const IP_MAX = 10;

const MINIMAL_CSV = "lon,lat,depth\n-136.0,58.5,50\n-136.1,58.6,55\n";

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const E2E_USER = "user_datasets_rate_limit_test";

describe("POST /api/datasets/upload — IP rate limit (10 req / min)", () => {
  it("allows the first 10 requests and blocks the 11th with 429", async () => {
    const ip = "198.51.100.7";
    // Pre-fill to 9 (max - 1): the next request is the 10th (last allowed),
    // and the one after is the 11th (first blocked).
    __prefillRateLimitMemory(`i:${UPLOAD_ROUTE}:${ip}`, IP_MAX - 1, WINDOW_MS);

    const allowed = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", ip)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    expect(allowed.status, "10th request should not be rate-limited").not.toBe(429);

    const blocked = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", ip)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: "rate_limit" });
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("tracks limits per IP — a different IP is unaffected by another IP's quota", async () => {
    const exhaustedIp = "198.51.100.10";
    const freshIp = "198.51.100.11";
    // Exhaust quota for exhaustedIp entirely.
    __prefillRateLimitMemory(`i:${UPLOAD_ROUTE}:${exhaustedIp}`, IP_MAX, WINDOW_MS);

    const exhaustedRes = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", exhaustedIp)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");
    expect(exhaustedRes.status).toBe(429);

    const freshRes = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", freshIp)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");
    expect(freshRes.status).not.toBe(429);
  });

  it("sets X-RateLimit-* headers on allowed requests", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", "198.51.100.20")
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    expect(res.headers["x-ratelimit-limit"]).toBe("10");
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });
});
