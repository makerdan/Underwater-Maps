/**
 * terrain-no-data-error.test.ts
 *
 * Verifies that GET /api/datasets/:id/terrain and GET /api/datasets/:id/overview
 * return HTTP 503 with `{ error: "no_data" }` when `buildTerrainGrid` throws a
 * `NoDataError` (i.e. the dataset exists in the registry but every ranked
 * upstream bathymetry source failed).
 *
 * Prior to this fix the server would silently serve synthetic FBM noise as if
 * it were real bathymetric data.  This test pins the correct 503 behaviour so
 * it cannot regress.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

// ── Module mocks ─────────────────────────────────────────────────────────────

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

// Mock terrain.js so buildTerrainGrid throws a real NoDataError.
// We use createTerrainMock to stay in sync with the full export surface,
// then override buildTerrainGrid in individual tests via vi.mocked().
vi.mock("../../lib/terrain.js", async () => {
  const { createTerrainMock } = await import(
    "../../__tests__/helpers/terrainMock.js"
  );
  return createTerrainMock({
    buildTerrainGrid: vi.fn().mockResolvedValue(null),
    parseXyzCsv: vi.fn().mockReturnValue([]),
    gridPoints: vi.fn().mockReturnValue({}),
    previewDataset: vi.fn().mockResolvedValue(null),
    previewBboxForDownload: vi.fn().mockResolvedValue(null),
    buildBboxCsvRows: vi.fn().mockReturnValue([]),
  });
});

import app from "../../app.js";
import { buildTerrainGrid, NoDataError } from "../../lib/terrain.js";

// ── Test lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(buildTerrainGrid).mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/datasets/:id/terrain — NoDataError → 503", () => {
  it("returns 503 with error:no_data when buildTerrainGrid throws NoDataError", async () => {
    vi.mocked(buildTerrainGrid).mockRejectedValue(
      new NoDataError("thorne-bay"),
    );

    const res = await request(app).get("/api/datasets/thorne-bay/terrain");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "no_data" });
    expect(typeof res.body.details).toBe("string");
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("still returns 404 when buildTerrainGrid returns null (dataset not found)", async () => {
    vi.mocked(buildTerrainGrid).mockResolvedValue(null);

    const res = await request(app).get("/api/datasets/thorne-bay/terrain");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("re-throws non-NoDataError errors as 500", async () => {
    vi.mocked(buildTerrainGrid).mockRejectedValue(new Error("Unexpected DB failure"));

    const res = await request(app).get("/api/datasets/thorne-bay/terrain");

    expect(res.status).toBe(500);
  });
});

describe("GET /api/datasets/:id/overview — NoDataError → 503", () => {
  it("returns 503 with error:no_data when buildTerrainGrid throws NoDataError for overview", async () => {
    vi.mocked(buildTerrainGrid).mockRejectedValue(
      new NoDataError("thorne-bay"),
    );

    const res = await request(app).get("/api/datasets/thorne-bay/overview");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "no_data" });
    expect(typeof res.body.details).toBe("string");
  });

  it("still returns 404 for overview when buildTerrainGrid returns null", async () => {
    vi.mocked(buildTerrainGrid).mockResolvedValue(null);

    const res = await request(app).get("/api/datasets/thorne-bay/overview");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });
});
