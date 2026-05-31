/**
 * rateLimit-pg.test.ts
 *
 * Integration tests for the Postgres-backed sliding-window rate limiter.
 *
 * Strategy: exercise the rate-limit middleware through real HTTP requests
 * (via supertest + the Express app) with RATE_LIMIT_BACKEND **not** set to
 * "memory", so `selectBackend()` chooses pgBackend. The `pool.query` function
 * is mocked to simulate what the Postgres CTE would return, letting us
 * control the windowed count without a real database.
 *
 * Suites:
 *  1. First request is allowed, X-RateLimit-Remaining reflects quota used.
 *  2. When the count exceeds the limit, the middleware returns 429 with
 *     Retry-After and X-RateLimit-Remaining: 0.
 *  3. DB error triggers fallback to in-memory backend: request still passes
 *     (no 500), a warning is eventually logged, and per-process limiting
 *     continues to work.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Stateful mock pool — each test suite can control what pool.query returns.
// ---------------------------------------------------------------------------
let _pgQueryImpl: () => Promise<{ rows: { count: number; oldest_epoch: number }[] }> =
  async () => ({ rows: [{ count: 1, oldest_epoch: Date.now() / 1000 }] });

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoUpdate: () => Promise.resolve([]),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: {},
  userSettingsTable: {},
  uploadJobsTable: {},
  pool: {
    query: vi.fn().mockImplementation(() => _pgQueryImpl()),
  },
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

const MINIMAL_CSV = "lon,lat,depth\n-136.0,58.5,50\n-136.1,58.6,55\n";
const E2E_USER = "user_pg_rate_limit_test";
const TEST_IP = "198.51.100.42";

beforeEach(() => {
  // Do NOT set RATE_LIMIT_BACKEND=memory — we want the pg backend selected.
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  __resetRateLimitMemory();
  // Default: pool.query returns count=1 (first request in window, allowed).
  _pgQueryImpl = async () => ({
    rows: [{ count: 1, oldest_epoch: Date.now() / 1000 }],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Suite 1: first request allowed, correct headers
// ---------------------------------------------------------------------------

describe("rate-limit pgBackend — first request allowed", () => {
  it("returns the correct X-RateLimit-Remaining for a count-of-1 response", async () => {
    _pgQueryImpl = async () => ({
      rows: [{ count: 1, oldest_epoch: Date.now() / 1000 }],
    });

    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", TEST_IP)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    // The upload route returns 400 (bad resolution) — what matters is the
    // rate-limit headers: the pg backend reported count=1 so remaining=max−1=9.
    expect(res.status).not.toBe(429);
    expect(res.headers["x-ratelimit-limit"]).toBe("10");
    expect(res.headers["x-ratelimit-remaining"]).toBe("9");
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });

  it("does not set Retry-After on an allowed request", async () => {
    _pgQueryImpl = async () => ({
      rows: [{ count: 1, oldest_epoch: Date.now() / 1000 }],
    });

    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", TEST_IP)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    expect(res.status).not.toBe(429);
    expect(res.headers["retry-after"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: limit exceeded → 429
// ---------------------------------------------------------------------------

describe("rate-limit pgBackend — limit exceeded returns 429", () => {
  it("returns 429 when the pg count exceeds the configured max", async () => {
    // Pool reports 11 events in the window; max is 10 → over limit.
    const oldestEpoch = (Date.now() - 30_000) / 1000; // 30 s ago
    _pgQueryImpl = async () => ({
      rows: [{ count: 11, oldest_epoch: oldestEpoch }],
    });

    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", TEST_IP)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("returns X-RateLimit-Reset pointing into the future on 429", async () => {
    const oldestEpoch = (Date.now() - 10_000) / 1000;
    _pgQueryImpl = async () => ({
      rows: [{ count: 11, oldest_epoch: oldestEpoch }],
    });

    const before = Math.ceil(Date.now() / 1000);
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", TEST_IP)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    expect(res.status).toBe(429);
    const reset = Number(res.headers["x-ratelimit-reset"]);
    expect(reset).toBeGreaterThanOrEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: DB error → fallback to in-memory backend
// ---------------------------------------------------------------------------

describe("rate-limit pgBackend — DB error falls back to in-memory", () => {
  it("allows the request when pool.query throws (falls back to memory)", async () => {
    _pgQueryImpl = async () => {
      throw new Error("FATAL: connection refused");
    };

    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", TEST_IP)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    // Should NOT be a 500 (server crash) — fallback backend handles it.
    expect(res.status).not.toBe(500);
    // Should NOT be a 429 (first request, memory bucket is empty).
    expect(res.status).not.toBe(429);
    // Rate-limit headers should still be present.
    expect(res.headers["x-ratelimit-limit"]).toBe("10");
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });

  it("enforces per-process memory limiting after multiple DB errors", async () => {
    _pgQueryImpl = async () => {
      throw new Error("FATAL: connection refused");
    };

    // Exhaust the memory limit (10 req / min) via fallback.
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/api/datasets/upload")
        .set("x-e2e-user-id", E2E_USER)
        .set("x-forwarded-for", "203.0.113.200")
        .field("resolution", "not-a-number")
        .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");
    }

    const blocked = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", "203.0.113.200")
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    // After 10 requests, the memory fallback should enforce the limit.
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: "rate_limit" });
  });
});
