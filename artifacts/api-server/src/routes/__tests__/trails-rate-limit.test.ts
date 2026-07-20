/**
 * trails-rate-limit.test.ts
 *
 * Verifies that POST /api/trails enforces its stacked rate limits:
 *   - IP-based limit: 10 requests per minute per IP (trailUploadRateLimit)
 *   - User-based limit: 120 mutations per minute per user (dataMutationRateLimit)
 *
 * Both limiters run in series. Because the user-based limit is applied last
 * (after requireAuth resolves the userId), the X-RateLimit-* headers on allowed
 * responses reflect the user-based limit (120). The IP limit still blocks
 * requests before the user limit is reached.
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
import {
  __resetRateLimitMemory,
  __prefillRateLimitMemory,
} from "../../middlewares/rateLimit.js";
import {
  DATA_MUTATION_MAX,
  DATA_MUTATION_WINDOW_MS,
  DATA_MUTATION_ROUTE,
} from "../../middlewares/dataMutationRateLimit.js";

// Route + window constants matching the production createRateLimit() call
// in routes/trails.ts.
const TRAIL_ROUTE = "trail-upload";
const WINDOW_MS = 60_000;
const IP_MAX = 10;

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
    const ip = "203.0.113.42";
    // Pre-fill to 9 (max - 1): the next request is the 10th (last allowed),
    // and the one after is the 11th (first blocked).
    __prefillRateLimitMemory(`i:${TRAIL_ROUTE}:${ip}`, IP_MAX - 1, WINDOW_MS);

    const allowed = await request(app)
      .post("/api/trails")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", ip)
      .send(VALID_TRAIL_BODY);

    expect(allowed.status, "10th request should not be rate-limited").not.toBe(429);

    const blocked = await request(app)
      .post("/api/trails")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", ip)
      .send(VALID_TRAIL_BODY);

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: "rate_limit" });
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("tracks limits per IP — a different IP is not affected by another IP's quota", async () => {
    const exhaustedIp = "203.0.113.1";
    const freshIp = "203.0.113.2";
    // Exhaust quota for exhaustedIp entirely.
    __prefillRateLimitMemory(`i:${TRAIL_ROUTE}:${exhaustedIp}`, IP_MAX, WINDOW_MS);

    const exhaustedRes = await request(app)
      .post("/api/trails")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", exhaustedIp)
      .send(VALID_TRAIL_BODY);
    expect(exhaustedRes.status).toBe(429);

    const freshRes = await request(app)
      .post("/api/trails")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", freshIp)
      .send(VALID_TRAIL_BODY);
    expect(freshRes.status).not.toBe(429);
  });

  it("sets X-RateLimit-* headers on allowed requests (user-based limit reflected last)", async () => {
    const res = await request(app)
      .post("/api/trails")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", "203.0.113.50")
      .send(VALID_TRAIL_BODY);

    // POST /api/trails stacks two rate limiters: IP (10/min) and user (120/min).
    // The user-based dataMutationRateLimit runs after requireAuth, so its headers
    // overwrite the IP headers on allowed responses. The IP limit is still enforced
    // (see the 429 test above) — it just doesn't show in the response headers when
    // the user limit is what ultimately set them.
    expect(res.headers["x-ratelimit-limit"]).toBe(String(DATA_MUTATION_MAX));
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });

  it("user-based limit is also enforced on POST /api/trails", async () => {
    const userKey = `u:${DATA_MUTATION_ROUTE}:${E2E_USER}`;
    __prefillRateLimitMemory(userKey, DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .post("/api/trails")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", "203.0.113.51")
      .send(VALID_TRAIL_BODY);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
  });
});
