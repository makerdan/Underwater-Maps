/**
 * me-validation.test.ts — auth and error-handling tests for /api/me routes
 *
 * Both GET /me/export and DELETE /me are auth-gated. This file specifically
 * tests the 401 path (unauthenticated) that is NOT covered by the existing
 * me.test.ts (which uses a Clerk mock that always returns a userId).
 *
 * Both handlers now use asyncHandler so DB failures surface as 500s rather
 * than hanging requests. A DB-failure case is included for each route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

type TableName = "userSettings" | "markers" | "customDatasets" | "gpsTrails" | "gpsTrailPoints";
const state: { dbThrows: boolean } = { dbThrows: false };

vi.mock("@workspace/db", () => {
  const tag = (name: TableName) => ({ __tableName: name });
  const rowsFor = (_t: TableName) => [];

  const select = () => ({
    from: (table: { __tableName: TableName }) => ({
      where: () => {
        if (state.dbThrows) {
          return Promise.reject(new Error("DB connection lost"));
        }
        return Promise.resolve(rowsFor(table.__tableName));
      },
    }),
  });

  const del = () => ({
    where: () => {
      if (state.dbThrows) return Promise.reject(new Error("DB connection lost"));
      return Promise.resolve([]);
    },
  });

  return {
    db: { select, delete: del },
    userSettingsTable: tag("userSettings"),
    markersTable: tag("markers"),
    customDatasetsTable: tag("customDatasets"),
    gpsTrailsTable: tag("gpsTrails"),
    gpsTrailPointsTable: tag("gpsTrailPoints"),
  };
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

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  state.dbThrows = false;
});

describe("GET /api/me/export — auth, input validation, and error handling", () => {
  it("returns 401 when unauthenticated (no E2E bypass header)", async () => {
    vi.unstubAllEnvs();
    const res = await request(app).get("/api/me/export");
    expect(res.status).toBe(401);
  });

  it("returns 200 with export payload for an authenticated user", async () => {
    const res = await request(app)
      .get("/api/me/export")
      .set("x-e2e-user-id", "user-me-export-ok");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.body).toHaveProperty("userId", "user-me-export-ok");
    expect(res.body).toHaveProperty("exportedAt");
    expect(Array.isArray(res.body.markers)).toBe(true);
    expect(Array.isArray(res.body.trails)).toBe(true);
  });

  it("returns 400 with invalid_params when unexpected query params are passed", async () => {
    const res = await request(app)
      .get("/api/me/export?filter=all&page=2")
      .set("x-e2e-user-id", "user-me-export-invalid-params");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_params" });
  });

  it("returns 500 (not a hang) when the DB throws during export", async () => {
    state.dbThrows = true;
    const res = await request(app)
      .get("/api/me/export")
      .set("x-e2e-user-id", "user-me-export-db-fail");
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/me — auth, input validation, and error handling", () => {
  it("returns 401 when unauthenticated (no E2E bypass header)", async () => {
    vi.unstubAllEnvs();
    const res = await request(app).delete("/api/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 with ok: true for an authenticated user", async () => {
    const res = await request(app)
      .delete("/api/me")
      .set("x-e2e-user-id", "user-me-delete-ok");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(typeof res.body.deletedAt).toBe("string");
  });

  it("returns 400 with invalid_params when unexpected query params are passed", async () => {
    const res = await request(app)
      .delete("/api/me?confirm=true&force=1")
      .set("x-e2e-user-id", "user-me-delete-invalid-params");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_params" });
  });

  it("returns 500 (not a hang) when the DB throws during deletion", async () => {
    state.dbThrows = true;
    const res = await request(app)
      .delete("/api/me")
      .set("x-e2e-user-id", "user-me-delete-db-fail");
    expect(res.status).toBe(500);
  });
});
