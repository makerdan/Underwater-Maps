/**
 * security-rate-limit-gaps.test.ts
 *
 * Regression tests for rate-limit coverage gaps found in the August 2026
 * security audit (findings #1–#7).  Each of the six previously-unguarded
 * mutation routes must return HTTP 429 once the shared dataMutationRateLimit
 * bucket is exhausted.
 *
 * Routes covered:
 *  - POST /api/terrain/bundles
 *  - POST /api/user/datasets/:id/duplicate
 *  - POST /api/user/datasets/:id/georef
 *  - DELETE /api/user/datasets/:id
 *  - POST /api/ncei/save
 *  - POST /api/search/federated/save
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
        orderBy: () => Promise.resolve([]),
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
  terrainBundleJobsTable: { __tableName: "terrain_bundle_jobs" as const },
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
} from "../../middlewares/dataMutationRateLimit.js";

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function userKey(userId: string): string {
  return `u:${DATA_MUTATION_ROUTE}:${userId}`;
}

// ── POST /api/terrain/bundles ─────────────────────────────────────────────────

describe("POST /api/terrain/bundles — per-user rate limit (120/min)", () => {
  const USER = "user_terrain_bundles_rl_test";

  it("returns 429 when the per-user limit is exhausted", async () => {
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .post("/api/terrain/bundles")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER)
      .send({ presetId: "glba_main" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("allows request when under the limit", async () => {
    // Do not prefill — bucket is empty, so the request should pass rate-limit.
    // The route will 400/404 for bad payload, but must NOT be 429.
    const res = await request(app)
      .post("/api/terrain/bundles")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER)
      .send({ presetId: "glba_main" });

    expect(res.status).not.toBe(429);
    expect(res.headers["x-ratelimit-limit"]).toBe(String(DATA_MUTATION_MAX));
  });
});

// ── POST /api/user/datasets/:id/duplicate ────────────────────────────────────

describe("POST /api/user/datasets/:id/duplicate — per-user rate limit (120/min)", () => {
  const USER = "user_duplicate_rl_test";
  const DATASET_ID = "00000000-0000-0000-0000-000000000001";

  it("returns 429 when the per-user limit is exhausted", async () => {
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .post(`/api/user/datasets/${DATASET_ID}/duplicate`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });
});

// ── POST /api/user/datasets/:id/georef ───────────────────────────────────────

describe("POST /api/user/datasets/:id/georef — per-user rate limit (120/min)", () => {
  const USER = "user_georef_rl_test";
  const DATASET_ID = "00000000-0000-0000-0000-000000000002";

  it("returns 429 when the per-user limit is exhausted", async () => {
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .post(`/api/user/datasets/${DATASET_ID}/georef`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER)
      .send({ controlPoints: [] });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });
});

// ── DELETE /api/user/datasets/:id ────────────────────────────────────────────

describe("DELETE /api/user/datasets/:id — per-user rate limit (120/min)", () => {
  const USER = "user_dataset_delete_rl_test";
  const DATASET_ID = "00000000-0000-0000-0000-000000000003";

  it("returns 429 when the per-user limit is exhausted", async () => {
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .delete(`/api/user/datasets/${DATASET_ID}`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });
});

// ── POST /api/ncei/save ───────────────────────────────────────────────────────

describe("POST /api/ncei/save — per-user rate limit (120/min)", () => {
  const USER = "user_ncei_save_rl_test";

  it("returns 429 when the per-user limit is exhausted", async () => {
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .post("/api/ncei/save")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER)
      .send({ csb_id: "some-id", title: "Test" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });
});

// ── POST /api/search/federated/save ──────────────────────────────────────────

describe("POST /api/search/federated/save — per-user rate limit (120/min)", () => {
  const USER = "user_federated_save_rl_test";

  it("returns 429 when the per-user limit is exhausted", async () => {
    __prefillRateLimitMemory(userKey(USER), DATA_MUTATION_MAX, DATA_MUTATION_WINDOW_MS);

    const res = await request(app)
      .post("/api/search/federated/save")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER)
      .send({ sourceId: "ncei", externalId: "some-id", title: "Test" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });
});
