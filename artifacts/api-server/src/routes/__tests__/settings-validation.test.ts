/**
 * settings-validation.test.ts — HTTP validation tests for PUT /api/settings
 *
 * Covers:
 *  - 401 when the caller is not authenticated
 *  - 200 when the body is valid (all-defaults empty body)
 *  - 400 when a required-type field has the wrong type (fogDensity as string)
 *  - 400 when an enum field has an invalid value (textureQuality)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
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
  getAuth: vi.fn(() => ({ userId: currentUserId })),
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

let currentUserId: string | null = "user-settings-test";

beforeEach(() => {
  currentUserId = "user-settings-test";
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
});

describe("PUT /api/settings — HTTP validation", () => {
  it("returns 401 when the caller is not authenticated", async () => {
    vi.unstubAllEnvs();
    currentUserId = null;
    const res = await request(app)
      .put("/api/settings")
      .send({ textureQuality: "high" });
    expect(res.status).toBe(401);
  });

  it("returns 200 with a valid body (empty body uses all defaults)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-ok")
      .send({});
    expect(res.status).toBe(200);
  });

  it("returns 200 with a partial valid body (single field)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-ok")
      .send({ textureQuality: "low" });
    expect(res.status).toBe(200);
  });

  it("returns 400 when fogDensity is a string (wrong type)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-bad-type")
      .send({ fogDensity: "very-foggy" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when textureQuality has an invalid enum value", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-bad-enum")
      .send({ textureQuality: "ultra" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when colormapTheme has an invalid enum value", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-bad-enum-2")
      .send({ colormapTheme: "neon" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when bandBoundaries are invalid (not starting with 0)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-bad-boundaries")
      .send({ bandBoundaries: [1, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });
});
