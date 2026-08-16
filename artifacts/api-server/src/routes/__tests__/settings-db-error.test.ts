/**
 * settings-db-error.test.ts — regression test for GET /api/settings when the
 * DB connection pool is temporarily unavailable on cold start.
 *
 * Covers:
 *  - DB select() rejection → 503 with { error: "service_unavailable" }
 *  - next(err) is NOT called (error is handled in-route, not forwarded)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── DB mock — default path succeeds; individual tests can override ─────────
const mockWhere = vi.fn(() => Promise.resolve([]));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockWhere,
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve([]),
        returning: () => Promise.resolve([]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  userSettingsTable: { userId: "__col__" },
  markersTable: {},
  routesTable: {},
  gpsTrailsTable: {},
  gpsTrailPointsTable: {},
  customDatasetsTable: {},
  datasetFoldersTable: {},
  userCatalogSavesTable: {
    id: "id",
    userId: "userId",
    catalogId: "catalogId",
    status: "status",
    requestedAt: "requestedAt",
    readyAt: "readyAt",
    cacheKey: "cacheKey",
    errorMessage: "errorMessage",
    folderId: "folderId",
    datasetId: "datasetId",
  },
  datasetCatalogTable: {},
  trollingPresetsTable: {},
  trollingPresetFoldersTable: {},
  poeUsageLogTable: {},
  pool: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: "user-db-error-test" })),
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
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  // Reset to healthy default
  mockWhere.mockResolvedValue([]);
});

describe("GET /api/settings — DB error handling", () => {
  it("returns 503 with { error: 'service_unavailable' } when the DB select throws", async () => {
    mockWhere.mockRejectedValueOnce(new Error("Connection pool timeout"));

    const res = await request(app)
      .get("/api/settings")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-db-error-test");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "service_unavailable" });
  });

  it("returns 200 with defaults when the DB select succeeds with an empty row", async () => {
    mockWhere.mockResolvedValueOnce([]);

    const res = await request(app)
      .get("/api/settings")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-db-error-test");

    expect(res.status).toBe(200);
    // Spot-check one default field
    expect(res.body).toHaveProperty("textureQuality", "high");
  });

  it("does NOT call next(err) when DB throws — the 503 is sent in-route", async () => {
    // Verify the error is handled within the route handler (not forwarded to
    // the global error middleware, which would return 500 "Internal server error").
    mockWhere.mockRejectedValueOnce(new Error("Connection pool timeout"));

    const res = await request(app)
      .get("/api/settings")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-db-error-test");

    // 503 means the route caught the error itself; 500 would mean it escaped
    // to the global error handler.
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "service_unavailable" });
  });
});
