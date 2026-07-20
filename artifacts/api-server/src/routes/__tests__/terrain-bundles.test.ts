/**
 * terrain-bundles.test.ts
 *
 * Unit tests for the terrain-bundle routes. Network calls are intercepted with
 * vi.mock so the suite runs offline in CI.
 *
 * NETWORK_TESTS=1 (set in environment) enables the optional probe-sanity
 * section that actually hits live endpoints. Those tests are skipped by default.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Mock heavy dependencies before import
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@workspace/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...mod,
    db: {
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    },
    terrainBundleJobsTable: {
      id: "id",
      userId: "userId",
      presetId: "presetId",
      status: "status",
      progressNote: "progressNote",
      errorMessage: "errorMessage",
      createdAt: "createdAt",
      completedAt: "completedAt",
    },
  };
});

const mockFileSave = vi.fn().mockResolvedValue(undefined);
const mockFileDownload = vi.fn().mockResolvedValue([Buffer.from("{}")]);
const mockFileExists = vi.fn().mockResolvedValue([false]);

vi.mock("../../lib/objectStorage.js", () => ({
  objectStorageClient: {
    bucket: vi.fn().mockReturnValue({
      file: vi.fn().mockReturnValue({
        exists: mockFileExists,
        save: mockFileSave,
        download: mockFileDownload,
      }),
    }),
  },
}));

vi.mock("../../lib/terrain.js", () => ({
  BUNDLED_TERRAIN: {},
  NYSDEC_BATHY_FEATURE_SERVICE: "https://example.com/nysdec",
  MN_DNR_BATHY_FEATURE_SERVICE: "https://example.com/mn-dnr",
  ALL_PRESET_DATASETS: [
    {
      id: "lake-ray-roberts",
      name: "Demo: Lake Ray Roberts (TX)",
      waterType: "freshwater",
      bbox: { minLon: -97.15, minLat: 33.3, maxLon: -96.92, maxLat: 33.52 },
      fetchStrategy: { kind: "bundled" },
    },
    {
      id: "no-strategy-preset",
      name: "Preset without fetchStrategy",
      waterType: "saltwater",
      bbox: { minLon: -90, minLat: 25, maxLon: -80, maxLat: 30 },
    },
  ],
}));

const mockFetch = vi.fn().mockResolvedValue({
  depths: new Array(256 * 256).fill(5),
  topography: new Array(256 * 256).fill(0),
  hasTopography: false,
  minDepth: 1,
  maxDepth: 10,
  width: 256,
  height: 256,
  bbox: { minLon: -97.15, minLat: 33.3, maxLon: -96.92, maxLat: 33.52 },
  dataSource: "bundled",
  label: "Test bundle",
  creditUrl: "https://example.com",
});

vi.mock("../../lib/fetchers/index.js", () => ({
  getFetcher: vi.fn().mockReturnValue({
    probe: vi.fn().mockResolvedValue({ available: true, title: "Test" }),
    fetch: mockFetch,
  }),
}));

// ---------------------------------------------------------------------------
// Bypass auth for all tests
// ---------------------------------------------------------------------------

const _prevBypass = process.env["E2E_AUTH_BYPASS"];
const _prevObjDir = process.env["PRIVATE_OBJECT_DIR"];
process.env["E2E_AUTH_BYPASS"] = "1";
process.env["PRIVATE_OBJECT_DIR"] = "/test-bucket/test-prefix/";

// Restore env so later files in the singleFork suite (e.g. the
// auth-bypass-production-guard test) do not inherit the bypass flag.
afterAll(() => {
  if (_prevBypass === undefined) delete process.env["E2E_AUTH_BYPASS"];
  else process.env["E2E_AUTH_BYPASS"] = _prevBypass;
  if (_prevObjDir === undefined) delete process.env["PRIVATE_OBJECT_DIR"];
  else process.env["PRIVATE_OBJECT_DIR"] = _prevObjDir;
});

// Import after mocks are set up
const { default: terrainBundlesRouter } = await import("../terrain-bundles.js");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
// requireAuth's E2E bypass authenticates via the x-e2e-user-id header; without
// it getAuth() throws (no clerkMiddleware in this test app) and every request
// 500s before reaching the route handler.
app.use((req, _res, next) => {
  req.headers["x-e2e-user-id"] = "test-user";
  next();
});
app.use(terrainBundlesRouter);

// ---------------------------------------------------------------------------
// DB chain builder helper
// ---------------------------------------------------------------------------

function makeChain(resolveWith: unknown) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(resolveWith),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(resolveWith),
  } as unknown;
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /terrain/bundles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue([false]);
    const updateChain = makeChain([]);
    mockUpdate.mockReturnValue(updateChain);
  });

  it("404 for unknown presetId", async () => {
    const res = await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", "bypass-user")
      .send({ presetId: "does-not-exist" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Unknown preset" });
  });

  it("422 for preset without fetchStrategy", async () => {
    const res = await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", "bypass-user")
      .send({ presetId: "no-strategy-preset" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "Preset has no fetchStrategy" });
  });

  it("400 for missing presetId", async () => {
    const res = await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", "bypass-user")
      .send({});

    expect(res.status).toBe(400);
  });

  it("202 with new job when no existing job", async () => {
    mockSelect.mockReturnValue(makeChain([]));
    mockInsert.mockReturnValue(makeChain([{ id: "job-1", status: "pending" }]));

    const res = await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", "bypass-user")
      .send({ presetId: "lake-ray-roberts" });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "pending" });
  });

  it("200 when bundle already complete and GCS file exists", async () => {
    mockFileExists.mockResolvedValue([true]);
    mockSelect.mockReturnValue(makeChain([{
      id: "job-1",
      status: "complete",
      presetId: "lake-ray-roberts",
      userId: "bypass-user",
    }]));

    const res = await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", "bypass-user")
      .send({ presetId: "lake-ray-roberts" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "complete", message: "Bundle already available" });
  });

  it("202 when job already running", async () => {
    mockSelect.mockReturnValue(makeChain([{
      id: "job-1",
      status: "running",
      presetId: "lake-ray-roberts",
      userId: "bypass-user",
    }]));

    const res = await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", "bypass-user")
      .send({ presetId: "lake-ray-roberts" });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "running" });
  });
});

describe("GET /terrain/bundles/:presetId/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("404 when no job found", async () => {
    mockSelect.mockReturnValue(makeChain([]));
    const res = await request(app).get("/terrain/bundles/lake-ray-roberts/status").set("x-e2e-user-id", "bypass-user");
    expect(res.status).toBe(404);
  });

  it("returns job status when found", async () => {
    mockSelect.mockReturnValue(makeChain([{
      id: "job-1",
      status: "running",
      progressNote: "Fetching…",
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    }]));

    const res = await request(app).get("/terrain/bundles/lake-ray-roberts/status").set("x-e2e-user-id", "bypass-user");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ jobId: "job-1", status: "running" });
  });
});

describe("GET /terrain/bundles/:presetId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue([false]);
  });

  it("404 when no job", async () => {
    mockSelect.mockReturnValue(makeChain([]));
    const res = await request(app).get("/terrain/bundles/lake-ray-roberts").set("x-e2e-user-id", "bypass-user");
    expect(res.status).toBe(404);
  });

  it("202 when job is pending", async () => {
    mockSelect.mockReturnValue(makeChain([{
      id: "job-1",
      status: "pending",
      progressNote: "Queued",
      errorMessage: null,
    }]));

    const res = await request(app).get("/terrain/bundles/lake-ray-roberts").set("x-e2e-user-id", "bypass-user");
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "pending" });
  });

  it("200 with bundle when complete and GCS has it", async () => {
    mockSelect.mockReturnValue(makeChain([{
      id: "job-1",
      status: "complete",
      progressNote: "Done",
      errorMessage: null,
    }]));
    mockFileExists.mockResolvedValue([true]);
    const bundleJson = JSON.stringify({ depths: [], label: "Test" });
    mockFileDownload.mockResolvedValue([Buffer.from(bundleJson)]);

    const res = await request(app).get("/terrain/bundles/lake-ray-roberts").set("x-e2e-user-id", "bypass-user");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ label: "Test" });
  });
});

// ---------------------------------------------------------------------------
// Optional: live network probe tests (NETWORK_TESTS=1 only)
// ---------------------------------------------------------------------------

const NETWORK_TESTS = process.env["NETWORK_TESTS"] === "1";

describe.skipIf(!NETWORK_TESTS)("fetcher probe sanity (NETWORK_TESTS=1)", () => {
  it("USGS 3DEP probe succeeds for Lake Ray Roberts bbox", async () => {
    const { usgs3depFetcher } = await import("../../lib/fetchers/usgs3dep.js");
    const bbox = { minLon: -97.15, minLat: 33.3, maxLon: -96.92, maxLat: 33.52 };
    const result = await usgs3depFetcher.probe({ kind: "usgs-3dep" }, bbox);
    expect(result.available).toBe(true);
  }, 45_000);

  it("GEBCO probe succeeds for open ocean", async () => {
    const { gebcoFetcher } = await import("../../lib/fetchers/gebco.js");
    const bbox = { minLon: -70, minLat: 35, maxLon: -65, maxLat: 40 };
    const result = await gebcoFetcher.probe({ kind: "gebco-wcs" }, bbox);
    expect(result.available).toBe(true);
  }, 45_000);

  it("Great Lakes probe succeeds for Lake Michigan", async () => {
    const { greatLakesFetcher } = await import("../../lib/fetchers/greatLakes.js");
    const bbox = { minLon: -87.5, minLat: 43.5, maxLon: -87.0, maxLat: 44.0 };
    const result = await greatLakesFetcher.probe({ kind: "great-lakes-wcs" }, bbox);
    expect(result.available).toBe(true);
  }, 45_000);
});
