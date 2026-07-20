/**
 * terrain-validation.test.ts — param validation tests for GET /datasets/:id/terrain
 *
 * Covers the DatasetIdParamSchema safeParse guard on the terrain route.
 * buildTerrainGrid is stubbed to return null so tests never touch the database.
 *
 * Dataset IDs may be preset slugs (e.g. "thorne-bay", "glba-main") or custom
 * dataset UUIDs. The schema accepts alphanumeric characters, hyphens, and
 * underscores, but requires the first character to be alphanumeric (no leading
 * hyphens). Malformed inputs are rejected with 400 before any downstream
 * processing; valid-format IDs that are not found return 404.
 *
 * Validated reject cases (→ 400):
 *  - Leading-hyphen string ("-1")                    → starts with hyphen, rejected
 *  - Floating-point string ("3.14")                  → dot not in charset
 *  - Path-traversal string ("../etc/passwd")         → slash/dot not in charset
 *  - ID with embedded space ("id with spaces")       → space not in charset
 *  - ID exceeding 128 characters                     → max length exceeded
 *
 * Valid-format IDs not in DB (→ 404, no regression):
 *  - Preset-style slug ("thorne-bay")               → passes schema → 404
 *  - Pure numeric string ("123")                    → passes schema → 404
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { getAuth } from "@clerk/express";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: {},
  userSettingsTable: {},
  uploadJobsTable: {},
  datasetFoldersTable: {},
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

vi.mock("../../lib/terrain.js", () => ({
  BUNDLED_TERRAIN: {},
  NYSDEC_BATHY_FEATURE_SERVICE: "https://example.test/nysdec",
  MN_DNR_BATHY_FEATURE_SERVICE: "https://example.test/mndnr",
  ALL_PRESET_DATASETS: [],
  BUNDLED_TERRAIN: [],
  NYSDEC_BATHY_FEATURE_SERVICE: "https://example.test/nysdec",
  MN_DNR_BATHY_FEATURE_SERVICE: "https://example.test/mndnr",
  buildTerrainGrid: vi.fn().mockResolvedValue(null),
  parseXyzCsv: vi.fn().mockReturnValue([]),
  gridPoints: vi.fn().mockReturnValue({}),
  previewDataset: vi.fn().mockResolvedValue(null),
  previewBboxForDownload: vi.fn().mockResolvedValue(null),
  buildBboxCsvRows: vi.fn().mockReturnValue([]),
}));

import app from "../../app.js";

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/datasets/:id/terrain — param validation", () => {
  it("returns 400 for a leading-hyphen id (e.g. '-1')", async () => {
    const res = await request(app).get("/api/datasets/-1/terrain");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 for a floating-point id containing a dot ('3.14')", async () => {
    const res = await request(app).get("/api/datasets/3.14/terrain");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 for a path-traversal id", async () => {
    const res = await request(app).get("/api/datasets/..%2Fetc%2Fpasswd/terrain");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 for an id containing a space (URL-encoded)", async () => {
    const res = await request(app).get("/api/datasets/id%20with%20spaces/terrain");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 for an id that exceeds 128 characters", async () => {
    const longId = "a".repeat(129);
    const res = await request(app).get(`/api/datasets/${longId}/terrain`);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("includes a descriptive message in the 400 error body", async () => {
    const res = await request(app).get("/api/datasets/bad.id/terrain");
    expect(res.status).toBe(400);
    expect(typeof res.body.details).toBe("string");
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("returns 404 (not 400) for a preset-style slug id not in the database", async () => {
    const res = await request(app).get("/api/datasets/thorne-bay/terrain");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 404 (not 400) for a pure numeric id not in the database", async () => {
    const res = await request(app).get("/api/datasets/123/terrain");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 404 (not 400) for an underscore-delimited slug id not in the database", async () => {
    const res = await request(app).get("/api/datasets/glba_main/terrain");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 404 (not 400) for a UUID-style id not in the database", async () => {
    // UUID-format custom dataset IDs use a 404 (not 401) for unauthenticated or
    // non-owner requests to avoid confirming dataset existence.
    const res = await request(app).get(
      "/api/datasets/550e8400-e29b-41d4-a716-446655440000/terrain",
    );
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });
});

describe("GET /api/datasets/:id/terrain — cross-user ownership guard", () => {
  const OTHER_USER_UUID = "550e8400-e29b-41d4-a716-446655440000";

  it("returns 404 (not 401) for an unauthenticated request to a UUID-style dataset id", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: null } as ReturnType<typeof getAuth>);
    const res = await request(app).get(`/api/datasets/${OTHER_USER_UUID}/terrain`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 404 (not 403) when an authenticated user requests a UUID dataset they do not own", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-requesting" } as ReturnType<typeof getAuth>);
    // DB mock returns [] (no row found for this UUID), so ownership check fails → 404
    const res = await request(app).get(`/api/datasets/${OTHER_USER_UUID}/terrain`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });
});
