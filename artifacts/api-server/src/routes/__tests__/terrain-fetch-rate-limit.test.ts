/**
 * terrain-fetch-rate-limit.test.ts
 *
 * Verifies that GET /api/datasets/:id/terrain and GET /api/user/datasets/:id/terrain
 * enforce per-IP (90 req/min) and per-user (30 req/min) rate limits respectively,
 * using the in-memory backend so the test is hermetic (no Postgres required).
 *
 * Note: GET /datasets/:id/terrain has no requireAuth middleware, so the user
 * rate limiter (skipIfNoUser: true) never fires for unauthenticated callers —
 * only the IP limit (90/min) applies there. GET /user/datasets/:id/terrain
 * enforces both: IP first, then requireAuth, then user limit (30/min).
 *
 * Performance note: instead of exhausting the quota by sending max-1 real HTTP
 * requests, __prefillRateLimitMemory() pre-loads the in-memory bucket with the
 * desired count of synthetic timestamps.  This cuts test time from ~43 s to
 * under 2 s while exercising identical production code paths.
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
  uploadJobsTable: {},
  datasetFoldersTable: {},
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

vi.mock("../../lib/terrain.js", () => ({
  ALL_PRESET_DATASETS: [],
  buildTerrainGrid: vi.fn().mockResolvedValue(null),
  parseXyzCsv: vi.fn().mockReturnValue([]),
  gridPoints: vi.fn().mockReturnValue({}),
  previewDataset: vi.fn().mockResolvedValue(null),
  previewBboxForDownload: vi.fn().mockResolvedValue(null),
  buildBboxCsvRows: vi.fn().mockReturnValue([]),
}));

import app from "../../app.js";
import {
  __resetRateLimitMemory,
  __prefillRateLimitMemory,
} from "../../middlewares/rateLimit.js";

// Route + window constants that match the production createRateLimit() calls
// in routes/datasets.ts and routes/user-datasets.ts.
const TERRAIN_ROUTE = "terrain-fetch";
const WINDOW_MS = 60_000;
const IP_MAX = 90;
const USER_MAX = 30;

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── GET /api/datasets/:id/terrain — IP rate limit (90 req/min) ────────────────
// This route has no requireAuth, so the user limiter (skipIfNoUser: true) always
// skips. Only the IP limiter (90/min) applies.
describe("GET /api/datasets/:id/terrain — IP rate limit (90 req/min)", () => {
  it("allows 90 requests then blocks the 91st with 429", async () => {
    const ip = "198.51.100.70";
    // Pre-fill the bucket to 89 (max - 1) so the next request is the 90th
    // (last allowed) and the one after is the 91st (first blocked).
    __prefillRateLimitMemory(`i:${TERRAIN_ROUTE}:${ip}`, IP_MAX - 1, WINDOW_MS);

    const allowed = await request(app)
      .get("/api/datasets/glba_main/terrain")
      .set("x-forwarded-for", ip);

    expect(allowed.status, "90th request should not be rate-limited").not.toBe(429);

    const blocked = await request(app)
      .get("/api/datasets/glba_main/terrain")
      .set("x-forwarded-for", ip);

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: "rate_limit" });
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("tracks limits per IP — a different IP is unaffected by another IP's quota", async () => {
    const exhaustedIp = "198.51.100.71";
    const freshIp = "198.51.100.72";
    // Exhaust the quota for exhaustedIp entirely (pre-fill to max).
    __prefillRateLimitMemory(`i:${TERRAIN_ROUTE}:${exhaustedIp}`, IP_MAX, WINDOW_MS);

    const exhaustedRes = await request(app)
      .get("/api/datasets/glba_main/terrain")
      .set("x-forwarded-for", exhaustedIp);
    expect(exhaustedRes.status).toBe(429);

    const freshRes = await request(app)
      .get("/api/datasets/glba_main/terrain")
      .set("x-forwarded-for", freshIp);
    expect(freshRes.status).not.toBe(429);
  });

  it("sets X-RateLimit-* headers on allowed requests", async () => {
    const res = await request(app)
      .get("/api/datasets/glba_main/terrain")
      .set("x-forwarded-for", "198.51.100.73");

    expect(res.headers["x-ratelimit-limit"]).toBe("90");
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });
});

// ── GET /api/user/datasets/:id/terrain — user rate limit (30 req/min) ─────────
// This route enforces: IP limit → requireAuth → user limit (30/min).
// With E2E_AUTH_BYPASS the user limit fires first (30 < 90).
describe("GET /api/user/datasets/:id/terrain — user rate limit (30 req/min)", () => {
  const E2E_USER = "user_terrain_rate_limit_test";

  it("allows 30 requests from one user then blocks the 31st with 429", async () => {
    const ip = "198.51.100.80";
    // Pre-fill the user bucket to 29 (max - 1); next request is the 30th
    // (last allowed), and the one after is the 31st (first blocked).
    __prefillRateLimitMemory(`u:${TERRAIN_ROUTE}:${E2E_USER}`, USER_MAX - 1, WINDOW_MS);

    const allowed = await request(app)
      .get("/api/user/datasets/some-dataset-id/terrain")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", ip);

    expect(allowed.status, "30th request should not be rate-limited").not.toBe(429);

    const blocked = await request(app)
      .get("/api/user/datasets/some-dataset-id/terrain")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", ip);

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: "rate_limit" });
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("tracks limits per user — a different user is unaffected by another user's quota", async () => {
    const exhaustedUser = "user_terrain_quota_a";
    const freshUser = "user_terrain_quota_b";
    const ip = "198.51.100.81";
    // Exhaust the quota for exhaustedUser entirely.
    __prefillRateLimitMemory(`u:${TERRAIN_ROUTE}:${exhaustedUser}`, USER_MAX, WINDOW_MS);

    const exhaustedRes = await request(app)
      .get("/api/user/datasets/some-dataset-id/terrain")
      .set("x-e2e-user-id", exhaustedUser)
      .set("x-forwarded-for", ip);
    expect(exhaustedRes.status).toBe(429);

    const freshRes = await request(app)
      .get("/api/user/datasets/some-dataset-id/terrain")
      .set("x-e2e-user-id", freshUser)
      .set("x-forwarded-for", "198.51.100.82");
    expect(freshRes.status).not.toBe(429);
  });

  it("sets X-RateLimit-* headers on allowed requests", async () => {
    const res = await request(app)
      .get("/api/user/datasets/some-dataset-id/terrain")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", "198.51.100.83");

    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });
});
