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

  it("accepts a valid tripMinDurationH and rejects out-of-range / non-integer values", async () => {
    const ok = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-trip")
      .send({ tripMinDurationH: 4 });
    expect(ok.status).toBe(200);

    const tooBig = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-trip")
      .send({ tripMinDurationH: 13 });
    expect(tooBig.status).toBe(400);

    const negative = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-trip")
      .send({ tripMinDurationH: -1 });
    expect(negative.status).toBe(400);

    const fractional = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-trip")
      .send({ tripMinDurationH: 2.5 });
    expect(fractional.status).toBe(400);
  });

  it("accepts valid boat threshold values and rejects out-of-range / non-number values", async () => {
    const okGo = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-boat")
      .send({ boatGoWindKn: 10, boatGoWaveM: 0.5, boatNoGoWindKn: 16, boatNoGoWaveM: 1.0 });
    expect(okGo.status).toBe(200);

    const okLarge = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-boat")
      .send({ boatGoWindKn: 18, boatGoWaveM: 1.2, boatNoGoWindKn: 30, boatNoGoWaveM: 2.5 });
    expect(okLarge.status).toBe(200);

    const windTooHigh = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-boat")
      .send({ boatGoWindKn: 51 });
    expect(windTooHigh.status).toBe(400);

    const waveTooLow = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-boat")
      .send({ boatGoWaveM: 0.0 });
    expect(waveTooLow.status).toBe(400);

    const noGoWindTooHigh = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-boat")
      .send({ boatNoGoWindKn: 71 });
    expect(noGoWindTooHigh.status).toBe(400);

    const noGoWaveTooHigh = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-boat")
      .send({ boatNoGoWaveM: 9.0 });
    expect(noGoWaveTooHigh.status).toBe(400);

    const wrongType = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-boat")
      .send({ boatGoWindKn: "calm" });
    expect(wrongType.status).toBe(400);
  });

  it("accepts a valid followResumeDelaySec and rejects out-of-range values", async () => {
    const ok = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-follow")
      .send({ followResumeDelaySec: 45 });
    expect(ok.status).toBe(200);

    const tooSmall = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-follow")
      .send({ followResumeDelaySec: 2 });
    expect(tooSmall.status).toBe(400);

    const tooBig = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-follow")
      .send({ followResumeDelaySec: 500 });
    expect(tooBig.status).toBe(400);

    const wrongType = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-follow")
      .send({ followResumeDelaySec: "soon" });
    expect(wrongType.status).toBe(400);
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

describe("PUT /api/settings — unknown-key (extras) policy", () => {
  function put(body: Record<string, unknown>) {
    return request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-extras")
      .send(body);
  }

  it("accepts a benign unknown key that matches the identifier policy", async () => {
    const res = await put({ showCompassMinimap: true });
    expect(res.status).toBe(200);
  });

  it("rejects a prototype-pollution key name with 400", async () => {
    // Use raw JSON so the __proto__ key survives object-literal handling.
    const res = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-extras")
      .set("content-type", "application/json")
      .send('{"__proto__": {"polluted": true}}');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("rejects a constructor key with 400", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-extras")
      .set("content-type", "application/json")
      .send('{"constructor": 1}');
    expect(res.status).toBe(400);
  });

  it("rejects key names with illegal characters", async () => {
    const res = await put({ "bad key!": 1 });
    expect(res.status).toBe(400);
    expect(res.body.details).toMatch(/not an allowed key name/);
  });

  it("rejects more than 512 unknown keys", async () => {
    const body: Record<string, unknown> = {};
    for (let i = 0; i < 513; i++) body[`extraKey${i}`] = i;
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(res.body.details).toMatch(/Too many unknown settings keys/);
  });

  it("rejects oversized extras payloads", async () => {
    const res = await put({ bigExtra: "x".repeat(17 * 1024) });
    expect(res.status).toBe(400);
    expect(res.body.details).toMatch(/size cap/);
  });

  it("still allows the server-managed __updatedAt key to pass through", async () => {
    const res = await put({ __updatedAt: 12345 });
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/settings — showLandmass boolean field", () => {
  function put(body: Record<string, unknown>) {
    return request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", "user-settings-landmass")
      .send(body);
  }

  it("accepts { showLandmass: true }", async () => {
    const res = await put({ showLandmass: true });
    expect(res.status).toBe(200);
  });

  it("accepts { showLandmass: false }", async () => {
    const res = await put({ showLandmass: false });
    expect(res.status).toBe(200);
  });

  it("rejects showLandmass as a non-boolean string", async () => {
    const res = await put({ showLandmass: "yes" });
    expect(res.status).toBe(400);
  });
});
