/**
 * auth-bypass-production-guard.test.ts
 *
 * Verifies that the E2E auth-bypass header (x-e2e-user-id) is ignored —
 * and therefore returns 401 — whenever E2E_AUTH_BYPASS is not set to "1".
 *
 * In production NODE_ENV=production throws at module load if E2E_AUTH_BYPASS=1
 * is also present, so that combination is caught at startup and never reaches
 * request handling. This test covers the complementary runtime path: a request
 * carrying x-e2e-user-id when E2E_AUTH_BYPASS is absent or "0" must be treated
 * as unauthenticated (401), not silently promoted.
 *
 * The bypass logic in requireAuth.ts:
 *   function readBypassUserId(req): string | null {
 *     if (process.env["E2E_AUTH_BYPASS"] !== "1") return null;
 *     ...
 *   }
 *
 * So when E2E_AUTH_BYPASS !== "1", x-e2e-user-id is unconditionally ignored
 * and Clerk auth takes over — which returns null in our mock → 401.
 *
 * Secondary secret guard tests: when E2E_AUTH_BYPASS=1 is active, the bypass
 * additionally requires an `x-e2e-bypass-secret` header matching the
 * E2E_BYPASS_SECRET env var. Missing or mismatched secrets must return 401.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const mock = createDbMock();
  return { ...mock, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } };
});

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

import app from "../app.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";

// The global setup.ts sets E2E_BYPASS_SECRET="vitest-test-secret" at process
// level. We stub/unstub E2E_AUTH_BYPASS per-test via vi.stubEnv.
const BYPASS_SECRET = "vitest-test-secret";

beforeEach(() => {
  __resetRateLimitMemory();
  vi.unstubAllEnvs();
});

describe("requireAuth — E2E bypass header is rejected when E2E_AUTH_BYPASS is not active", () => {
  it("returns 401 for x-e2e-user-id header when E2E_AUTH_BYPASS env var is absent", async () => {
    const res = await request(app)
      .get("/api/markers?datasetId=test")
      .set("x-e2e-user-id", "user_should_not_bypass");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });

  it("returns 401 for x-e2e-user-id header when E2E_AUTH_BYPASS is set to '0'", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "0");

    const res = await request(app)
      .get("/api/markers?datasetId=test")
      .set("x-e2e-user-id", "user_should_not_bypass");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });

  it("returns 401 when the bypass header carries an empty string and E2E_AUTH_BYPASS is absent", async () => {
    const res = await request(app)
      .get("/api/markers?datasetId=test")
      .set("x-e2e-user-id", "");

    expect(res.status).toBe(401);
  });

  it("does NOT bypass auth when E2E_AUTH_BYPASS is set to '1' but no x-e2e-user-id is provided", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    const res = await request(app).get("/api/markers?datasetId=test");
    expect(res.status).toBe(401);
  });
});

describe("requireAuth — secondary E2E_BYPASS_SECRET guard", () => {
  it("returns 401 when E2E_AUTH_BYPASS=1 but x-e2e-bypass-secret header is missing", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");

    const res = await request(app)
      .get("/api/markers?datasetId=test")
      .set("x-e2e-user-id", "user-should-fail");

    // Secret header absent — bypass must not activate.
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });

  it("returns 401 when E2E_AUTH_BYPASS=1 but x-e2e-bypass-secret does not match", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");

    const res = await request(app)
      .get("/api/markers?datasetId=test")
      .set("x-e2e-bypass-secret", "wrong-secret")
      .set("x-e2e-user-id", "user-should-fail");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });

  it("returns 401 when E2E_AUTH_BYPASS=1 and bypass-secret matches but x-e2e-user-id is empty", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");

    const res = await request(app)
      .get("/api/markers?datasetId=test")
      .set("x-e2e-bypass-secret", BYPASS_SECRET)
      .set("x-e2e-user-id", "");

    expect(res.status).toBe(401);
  });

  it("bypasses auth when E2E_AUTH_BYPASS=1 and x-e2e-bypass-secret matches", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");

    // With a matching secret the bypass activates — the request is authed as
    // the given user. /api/markers returns 200 (empty list) for valid authed
    // requests (db mock returns []).
    const res = await request(app)
      .get("/api/markers?datasetId=test")
      .set("x-e2e-bypass-secret", BYPASS_SECRET)
      .set("x-e2e-user-id", "user-bypass-ok");

    // 200 (authenticated, markers route succeeds with empty array) or at worst
    // a non-401 error — the key assertion is that auth was not rejected.
    expect(res.status).not.toBe(401);
  });
});
