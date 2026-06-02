/**
 * datasets.test.ts (routes) — integration tests for the dataset upload route.
 *
 * Test suites:
 *  1. numeric-param validation — malformed `resolution` / `gridResolution` params
 *  2. binary survey file uploads — GeoTIFF, NetCDF, LAS 1.2, LAS 1.4 uploaded via
 *     POST /api/datasets/upload and validated end-to-end through the parser stack
 *  3. hash format compatibility for GET /api/datasets/:id/zones
 *  4. upload job poll — DB fallback and clear error messages after server restart
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Mutable DB row store so individual tests can control what the job-poll
// DB fallback returns without re-mocking the entire module.
let _mockJobRows: unknown[] = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(_mockJobRows),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoUpdate: () => Promise.resolve([]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: {},
  userSettingsTable: {},
  uploadJobsTable: {},
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
import { getAuth } from "@clerk/express";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  // Reset the DB mock row store before each test.
  _mockJobRows = [];
});

// ---------------------------------------------------------------------------
// Custom dataset (UUID) auth guards — GET /api/datasets/:id/terrain and
// GET /api/datasets/:id/overview
//
// UUID-format IDs that are not in the preset catalog require:
//   • authentication (401 if missing)
//   • ownership (404 if the dataset exists but belongs to another user)
// Preset IDs remain publicly accessible regardless of auth state.
// ---------------------------------------------------------------------------

const TEST_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("GET /api/datasets/:id/terrain — custom dataset auth guard", () => {
  it("returns 401 for a UUID-format dataset id when the caller is not authenticated", async () => {
    // Ensure getAuth returns no userId (default mock, but make explicit)
    vi.mocked(getAuth).mockReturnValueOnce({ userId: null } as ReturnType<typeof getAuth>);
    // Unset bypass so requireAuth doesn't short-circuit (this test exercises
    // the inline getAuth check, not requireAuth)
    vi.unstubAllEnvs();

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/terrain`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "unauthenticated" });
  });

  it("returns 404 when an authenticated user requests a UUID dataset they do not own", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-a" } as ReturnType<typeof getAuth>);
    vi.unstubAllEnvs();
    // DB mock returns no matching row for the ownership check
    _mockJobRows = [];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/terrain`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });
});

describe("GET /api/datasets/:id/overview — custom dataset auth guard", () => {
  it("returns 401 for a UUID-format dataset id when the caller is not authenticated", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: null } as ReturnType<typeof getAuth>);
    vi.unstubAllEnvs();

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/overview`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "unauthenticated" });
  });

  it("returns 404 when an authenticated user requests a UUID dataset they do not own", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-a" } as ReturnType<typeof getAuth>);
    vi.unstubAllEnvs();
    _mockJobRows = [];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/overview`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });
});

// /datasets/upload is auth-gated (task #433). All requests below carry the
// e2e bypass header so requireAuth admits the request and the underlying
// numeric-param validation actually runs.
const E2E_USER = "user_e2e_datasets_test";

// A CSV with enough points (≥10) that the parse step succeeds and the handler
// reaches the resolution-param validation check.  The handler was reordered to
// parse before validating resolution (so file-format errors surface first), so
// a 2-point file would trigger insufficient_data before the resolution check.
const ENOUGH_POINTS_CSV = [
  "lon,lat,depth",
  "-122.00,37.00,10",
  "-122.01,37.01,11",
  "-122.02,37.02,12",
  "-122.03,37.03,13",
  "-122.04,37.04,14",
  "-122.05,37.05,15",
  "-122.06,37.06,16",
  "-122.07,37.07,17",
  "-122.08,37.08,18",
  "-122.09,37.09,19",
  "-122.10,37.10,20",
].join("\n") + "\n";

describe("POST /api/datasets/upload — numeric-param validation", () => {
  it("returns 400 with invalid_param when resolution is malformed", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(ENOUGH_POINTS_CSV), "survey.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 when resolution is out of range (too small)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "8")
      .attach("file", Buffer.from(ENOUGH_POINTS_CSV), "survey.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 when resolution is out of range (too large)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "9999")
      .attach("file", Buffer.from(ENOUGH_POINTS_CSV), "survey.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 when gridResolution alias is malformed", async () => {
    // Older clients send `gridResolution` instead of `resolution`. Both must
    // surface a clean 400 (not a 5xx) when the value isn't a valid int.
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("gridResolution", "NaN")
      .attach("file", Buffer.from(ENOUGH_POINTS_CSV), "survey.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 401 when neither Clerk session nor e2e bypass header is present", async () => {
    const csv = "lon,lat,depth\n-122.0,37.0,10\n-122.1,37.1,15\n";
    const res = await request(app)
      .post("/api/datasets/upload")
      .attach("file", Buffer.from(csv), "small.csv");

    expect(res.status).toBe(401);
  });
});

// ── Binary survey file upload tests ──────────────────────────────────────────
//
// These tests exercise the full POST /api/datasets/upload route using real
// binary fixtures (GeoTIFF, NetCDF, LAS 1.2, LAS 1.4).  The DB mock returns
// an empty array from `returning()`, so `savedDatasetId` is absent and
// `saveError` is set — but the route still returns 200 with populated `terrain`
// and `overview` fields generated from the parsed point cloud.

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../__tests__/fixtures",
);

describe("POST /api/datasets/upload — binary survey formats (end-to-end)", () => {
  it("accepts and parses a GeoTIFF (.tif) survey file", async () => {
    const buf = readFileSync(join(FIXTURE_DIR, "survey.tif"));
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .attach("file", buf, { filename: "survey.tif", contentType: "image/tiff" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("terrain");
    expect(res.body).toHaveProperty("overview");
    expect(Array.isArray(res.body.terrain.depths)).toBe(true);
    expect(res.body.terrain.depths.length).toBeGreaterThan(0);
  });

  it("accepts and parses a NetCDF (.nc) survey file", async () => {
    const buf = readFileSync(join(FIXTURE_DIR, "survey.nc"));
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .attach("file", buf, { filename: "survey.nc", contentType: "application/octet-stream" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("terrain");
    expect(res.body).toHaveProperty("overview");
    expect(Array.isArray(res.body.terrain.depths)).toBe(true);
    expect(res.body.terrain.depths.length).toBeGreaterThan(0);
  });

  it("accepts and parses a LAS 1.2 (.las) survey file", async () => {
    const buf = readFileSync(join(FIXTURE_DIR, "survey_1_2.las"));
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .attach("file", buf, { filename: "survey_1_2.las", contentType: "application/octet-stream" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("terrain");
    expect(res.body).toHaveProperty("overview");
    expect(Array.isArray(res.body.terrain.depths)).toBe(true);
    expect(res.body.terrain.depths.length).toBeGreaterThan(0);
  });

  it("accepts and parses a LAS 1.4 (.las) survey file", async () => {
    const buf = readFileSync(join(FIXTURE_DIR, "survey_1_4.las"));
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .attach("file", buf, { filename: "survey_1_4.las", contentType: "application/octet-stream" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("terrain");
    expect(res.body).toHaveProperty("overview");
    expect(Array.isArray(res.body.terrain.depths)).toBe(true);
    expect(res.body.terrain.depths.length).toBeGreaterThan(0);
  });

  it("returns 415 for an unsupported binary extension (.shp)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .attach("file", Buffer.from("fake shapefile"), { filename: "survey.shp", contentType: "application/octet-stream" });

    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ error: "unsupported_file_type" });
  });
});

describe("GET /api/datasets/:id/zones — hash format compatibility", () => {
  it("rejects a hash that is neither 8-char nor 64-char hex", async () => {
    const res = await request(app)
      .get("/api/datasets/glba_main/zones")
      .query({ h: "not-hex", w: "saltwater" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("accepts a 64-char sha256 hex hash (new client format)", async () => {
    const sha = "a".repeat(64);
    const res = await request(app)
      .get("/api/datasets/glba_main/zones")
      .query({ h: sha, w: "saltwater" });
    // 404 (no cache entry) is the expected outcome here — what matters is
    // that the 64-char hash format passed the validator (no 400).
    expect(res.status).not.toBe(400);
  });

  it("rejects a request missing the waterType query param", async () => {
    const res = await request(app)
      .get("/api/datasets/glba_main/zones")
      .query({ h: "deadbeef" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });
});

describe("GET /api/datasets/upload/jobs/:jobId — DB fallback after server restart", () => {
  const JOB_ID = "00000000-0000-0000-0000-000000000001";
  const OTHER_USER_JOB_ID = "00000000-0000-0000-0000-000000000002";

  it("returns 404 with a clear re-upload message when job is not found anywhere", async () => {
    // _mockJobRows is [] (reset in beforeEach) — neither memory nor DB has the job
    const res = await request(app)
      .get(`/api/datasets/upload/jobs/${JOB_ID}`)
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
    expect(res.body.details).toMatch(/re-upload/i);
  });

  it("falls back to DB and returns error state for a stale job recovered after restart", async () => {
    // Simulate recoverStaleUploadJobs having already marked this job as error
    _mockJobRows = [
      {
        id: JOB_ID,
        userId: E2E_USER,
        status: "error",
        progress: 5,
        error: "Server restarted while this job was in progress — please re-upload your file.",
        datasetId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const res = await request(app)
      .get(`/api/datasets/upload/jobs/${JOB_ID}`)
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("error");
    expect(res.body.error).toMatch(/re-upload/i);
  });

  it("returns 403 when a DB-resident job belongs to a different user", async () => {
    _mockJobRows = [
      {
        id: OTHER_USER_JOB_ID,
        userId: "user_different",
        status: "done",
        progress: 100,
        error: null,
        datasetId: "some-dataset-id",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const res = await request(app)
      .get(`/api/datasets/upload/jobs/${OTHER_USER_JOB_ID}`)
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "forbidden" });
  });

  it("returns done state from DB with datasetId for a completed job", async () => {
    const DATASET_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    _mockJobRows = [
      {
        id: JOB_ID,
        userId: E2E_USER,
        status: "done",
        progress: 100,
        error: null,
        datasetId: DATASET_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const res = await request(app)
      .get(`/api/datasets/upload/jobs/${JOB_ID}`)
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("done");
    expect(res.body.datasetId).toBe(DATASET_ID);
    expect(res.body).not.toHaveProperty("error");
  });
});
