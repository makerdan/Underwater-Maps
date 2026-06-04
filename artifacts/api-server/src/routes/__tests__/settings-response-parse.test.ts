/**
 * settings-response-parse.test.ts
 *
 * Confirms that GET /api/settings returns a structured 500 — not a crash or
 * an unhandled exception — when the stored + merged settings object fails
 * GetSettingsResponse.parse().
 *
 * The test injects a malformed row via the DB mock: the `fogDensity` field is
 * set to a string ("bad") which the Zod schema rejects. Without the try/catch
 * wrapper added in settings.ts this would silently crash the request; with it,
 * a structured { error: "internal" } response is returned instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { getAuth } from "@clerk/express";

const state: { settingsRow: Record<string, unknown> | null } = {
  settingsRow: null,
};

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve(
            state.settingsRow
              ? [{ userId: "user-settings-parse-test", settings: state.settingsRow }]
              : [],
          ),
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
  getAuth: vi.fn(() => ({ userId: "user-settings-parse-test" })),
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

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  state.settingsRow = null;
});

describe("GET /api/settings — response-parse failure → structured 500", () => {
  it("returns 200 with valid defaults when the DB row is absent", async () => {
    state.settingsRow = null;
    const res = await request(app)
      .get("/api/settings")
      .set("x-e2e-user-id", "user-settings-parse-test");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("fogDensity");
  });

  it("returns 200 for a valid stored row", async () => {
    state.settingsRow = { fogDensity: 0.02, textureQuality: "high" };
    const res = await request(app)
      .get("/api/settings")
      .set("x-e2e-user-id", "user-settings-parse-test");
    expect(res.status).toBe(200);
    expect(res.body.fogDensity).toBe(0.02);
  });

  it("returns 500 with error: internal when stored row violates the response schema", async () => {
    state.settingsRow = {
      fogDensity: "this-should-be-a-number",
      textureQuality: "high",
    };
    const res = await request(app)
      .get("/api/settings")
      .set("x-e2e-user-id", "user-settings-parse-test");
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "internal" });
    expect(typeof res.body.details).toBe("string");
  });

  it("returns 401 when not authenticated", async () => {
    vi.unstubAllEnvs();
    vi.mocked(getAuth).mockReturnValueOnce({ userId: null } as ReturnType<typeof getAuth>);
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(401);
  });
});
