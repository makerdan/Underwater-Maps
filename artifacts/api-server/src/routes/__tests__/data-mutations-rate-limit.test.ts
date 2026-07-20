/**
 * data-mutations-rate-limit.test.ts
 *
 * Verifies that per-user rate limits are applied to data mutation routes:
 *  - markers   (POST /api/markers) — 120/min per user
 *  - catches   (POST /api/markers/:markerId/catches) — 120/min per user
 *  - routes    (POST /api/routes) — 120/min per user
 *  - settings  (PUT /api/settings) — 30/min per user (tighter ceiling)
 *  - folders   (POST /api/user/folders) — 120/min per user
 *  - catalog   (POST /api/datasets/catalog/:id/save) — 120/min per user
 *
 * All tests use the in-memory rate-limit backend (hermetic — no Postgres
 * required) and __prefillRateLimitMemory() to avoid sending max-1 real HTTP
 * requests to exhaust each bucket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve([]),
          limit: () => Promise.resolve([]),
        }),
        limit: () => Promise.resolve([]),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "row-1", lastSeq: 1 }]),
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve([{ lastSeq: 1 }]),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  markersTable: { __tableName: "markers" as const },
  catchEntriesTable: {
    __tableName: "catch_entries" as const,
    id: "id",
    markerId: "markerId",
    userId: "userId",
    createdAt: "createdAt",
    photos: "photos",
  },
  catchCountersTable: {
    __tableName: "catch_counters" as const,
    userId: "userId",
    lastSeq: "lastSeq",
  },
  routesTable: { __tableName: "routes" as const },
  userSettingsTable: { __tableName: "user_settings" as const },
  datasetFoldersTable: { __tableName: "dataset_folders" as const },
  customDatasetsTable: { __tableName: "custom_datasets" as const },
  userCatalogSavesTable: { __tableName: "user_catalog_saves" as const },
  datasetCatalogTable: { __tableName: "dataset_catalog" as const },
  uploadJobsTable: { __tableName: "upload_jobs" as const },
  disabledPresetsTable: { __tableName: "disabled_presets" as const },
  uploadCalibrationTable: { __tableName: "upload_calibration" as const },
  trollingPresetFoldersTable: { __tableName: "trolling_preset_folders" as const },
  trollingPresetsTable: { __tableName: "trolling_presets" as const },
  gpsTrailsTable: { __tableName: "gps_trails" as const },
  gpsTrailPointsTable: { __tableName: "gps_trail_points" as const },
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
  DATA_MUTATION_ROUTE,
  DATA_MUTATION_WINDOW_MS,
  DATA_MUTATION_MAX,
  SETTINGS_MUTATION_ROUTE,
  SETTINGS_MUTATION_WINDOW_MS,
  SETTINGS_MUTATION_MAX,
} from "../../middlewares/dataMutationRateLimit.js";

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── helpers ─────────────────────────────────────────────────────────────────

function userKey(userId: string): string {
  return `u:${DATA_MUTATION_ROUTE}:${userId}`;
}

function settingsKey(userId: string): string {
  return `u:${SETTINGS_MUTATION_ROUTE}:${userId}`;
}

// ── markers ──────────────────────────────────────────────────────────────────

describe("POST /api/markers — per-user rate limit (120/min)", () => {
  const USER = "user_markers_rl_test";

  it("allows request when under limit", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set("x-e2e-user-id", USER)
      .send({ lon: -136.0, lat: 58.5, depth: 50, label: "Test", type: "custom" });

    expect(res.status).not.toBe(429);
    expect(res.headers["x-ratelimit-limit"]).toBe(String(DATA_MUTATION_MAX));
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });

  it("returns 429 when the per-user limit is exhausted", async () => {
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .post("/api/markers")
      .set("x-e2e-user-id", USER)
      .send({ lon: -136.0, lat: 58.5, depth: 50, label: "Test", type: "custom" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("tracks limits per user — a different user is unaffected", async () => {
    const OTHER = "user_markers_rl_other";
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const exhausted = await request(app)
      .post("/api/markers")
      .set("x-e2e-user-id", USER)
      .send({ lon: -136.0, lat: 58.5, depth: 50, label: "Test", type: "custom" });
    expect(exhausted.status).toBe(429);

    const fresh = await request(app)
      .post("/api/markers")
      .set("x-e2e-user-id", OTHER)
      .send({ lon: -136.0, lat: 58.5, depth: 50, label: "Test", type: "custom" });
    expect(fresh.status).not.toBe(429);
  });
});

// ── catches ───────────────────────────────────────────────────────────────────

describe("POST /api/markers/:markerId/catches — per-user rate limit (120/min)", () => {
  const USER = "user_catches_rl_test";
  const MARKER_ID = "00000000-0000-0000-0000-000000000001";

  it("returns 429 when the per-user limit is exhausted", async () => {
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .post(`/api/markers/${MARKER_ID}/catches`)
      .set("x-e2e-user-id", USER)
      .send({ symbol: "🐟", symbolName: "Salmon", notes: "" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
  });
});

// ── routes ────────────────────────────────────────────────────────────────────

describe("POST /api/routes — per-user rate limit (120/min)", () => {
  const USER = "user_routes_rl_test";

  it("allows request when under limit and sets X-RateLimit headers", async () => {
    const res = await request(app)
      .post("/api/routes")
      .set("x-e2e-user-id", USER)
      .send({
        datasetId: "glba_main",
        name: "My Route",
        waypoints: [{ lon: -136.0, lat: 58.5 }],
        totalDistanceM: 0,
      });

    expect(res.status).not.toBe(429);
    expect(res.headers["x-ratelimit-limit"]).toBe(String(DATA_MUTATION_MAX));
  });

  it("returns 429 when the per-user limit is exhausted", async () => {
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .post("/api/routes")
      .set("x-e2e-user-id", USER)
      .send({
        datasetId: "glba_main",
        name: "My Route",
        waypoints: [{ lon: -136.0, lat: 58.5 }],
        totalDistanceM: 0,
      });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
  });
});

// ── settings ──────────────────────────────────────────────────────────────────

describe("PUT /api/settings — per-user rate limit (30/min, tighter ceiling)", () => {
  const USER = "user_settings_rl_test";

  it("allows request when under the settings limit and sets X-RateLimit headers", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", USER)
      .send({ depthUnit: "metres" });

    expect(res.status).not.toBe(429);
    expect(res.headers["x-ratelimit-limit"]).toBe(String(SETTINGS_MUTATION_MAX));
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });

  it("returns 429 when the settings-mutations limit is exhausted", async () => {
    __prefillRateLimitMemory(
      settingsKey(USER),
      SETTINGS_MUTATION_MAX,
      SETTINGS_MUTATION_WINDOW_MS,
    );

    const res = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", USER)
      .send({ depthUnit: "metres" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("settings limit is independent of data-mutation limit — exhausting one does not affect the other", async () => {
    const OTHER_USER = "user_settings_rl_other";
    __prefillRateLimitMemory(
      settingsKey(USER),
      SETTINGS_MUTATION_MAX,
      SETTINGS_MUTATION_WINDOW_MS,
    );

    const settingsBlocked = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", USER)
      .send({ depthUnit: "metres" });
    expect(settingsBlocked.status).toBe(429);

    const markersOk = await request(app)
      .post("/api/markers")
      .set("x-e2e-user-id", USER)
      .send({ lon: -136.0, lat: 58.5, depth: 50, label: "Test", type: "custom" });
    expect(markersOk.status).not.toBe(429);

    const otherSettingsOk = await request(app)
      .put("/api/settings")
      .set("x-e2e-user-id", OTHER_USER)
      .send({ depthUnit: "metres" });
    expect(otherSettingsOk.status).not.toBe(429);
  });
});

// ── folders ───────────────────────────────────────────────────────────────────

describe("POST /api/user/folders — per-user rate limit (120/min)", () => {
  const USER = "user_folders_rl_test";

  it("returns 429 when the per-user limit is exhausted", async () => {
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .post("/api/user/folders")
      .set("x-e2e-user-id", USER)
      .send({ name: "My Folder" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });
});

// ── catalog-saves ─────────────────────────────────────────────────────────────

describe("POST /api/datasets/catalog/:id/save — per-user rate limit (120/min)", () => {
  const USER = "user_catalog_rl_test";

  it("returns 429 when the per-user limit is exhausted", async () => {
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .post("/api/datasets/catalog/preset-glba_main/save")
      .set("x-e2e-user-id", USER);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
  });
});
