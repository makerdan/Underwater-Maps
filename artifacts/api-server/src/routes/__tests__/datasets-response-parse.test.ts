/**
 * datasets-response-parse.test.ts
 *
 * Confirms that GET /api/datasets returns a structured 500 — not a crash —
 * when the mapped dataset list fails GetDatasetsResponse.parse(). Without
 * the try/catch guard in datasets.ts this would produce an unhandled Zod
 * exception that leaks a stack trace or closes the connection.
 *
 * Strategy: vi.mock "../../lib/terrain.js" (path relative to this __tests__
 * dir, resolving to src/lib/terrain.js — the same module datasets.ts imports
 * from its own "../lib/terrain.js").  The mock exposes ALL_PRESET_DATASETS
 * via a vi.hoisted mutable state object so each test can swap the fixture.
 *
 * Note: GET /api/datasets is a public route — no requireAuth middleware.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

type BboxShape = { minLon: number; minLat: number; maxLon: number; maxLat: number };

interface PresetDataset {
  id: string;
  name: string;
  description: string | null;
  waterType: string;
  minDepth: number;
  maxDepth: number;
  centerLon: number;
  centerLat: number;
  bbox: BboxShape | string;
  hasTopography?: boolean;
  hasEfh?: boolean;
}

// vi.hoisted runs before vi.mock factories so state is initialised in time.
const terrainState = vi.hoisted<{ presets: PresetDataset[] }>(() => ({ presets: [] }));

// Mock path is "../../lib/terrain.js" — two levels up from __tests__, reaching
// src/lib/terrain.js which is the same resolved path that datasets.ts imports.
vi.mock("../../lib/terrain.js", () => ({
  BUNDLED_TERRAIN: [],
  NYSDEC_BATHY_FEATURE_SERVICE: "https://mock.invalid/nysdec",
  MN_DNR_BATHY_FEATURE_SERVICE: "https://mock.invalid/mndnr",
  get ALL_PRESET_DATASETS() { return terrainState.presets; },
  buildTerrainGrid: vi.fn(async () => null),
  parseXyzCsv: vi.fn(() => ({ points: [], errors: [] })),
  gridPoints: vi.fn(() => []),
  previewDataset: vi.fn(async () => null),
  previewBboxForDownload: vi.fn(() => null),
  buildBboxCsvRows: vi.fn(() => []),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve([]), returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: {},
  userSettingsTable: { userId: "__col__", settings: "__col__" },
  userCatalogSavesTable: {},
  uploadJobsTable: { objectKey: "__col__" },
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: "user-datasets-parse-test" })),
  requireAuth: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("../../lib/bucketMonitor.js", () => ({
  signDatasetUploadUrl: vi.fn(async () => ({ signedUrl: "https://example.com/upload" })),
  getJobByObjectKey: vi.fn(async () => null),
  recoverGcsJobStatus: vi.fn(async () => {}),
}));

vi.mock("../../lib/uploadParsers.js", () => ({
  parseUploadedFile: vi.fn(async () => ({ points: [], errors: [] })),
}));

vi.mock("../../lib/gunzipBounded.js", () => ({
  gunzipBounded: vi.fn(async (buf: Buffer) => buf),
}));

vi.mock("../../lib/copernicusDem.js", () => ({
  fetchCopernicusDem: vi.fn(async () => null),
}));

vi.mock("../../lib/cacheRegistry.js", () => ({
  registerCache: vi.fn(),
}));

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

const VALID_PRESET: PresetDataset = {
  id: "test-dataset-01",
  name: "Test Region",
  description: "A test region for unit testing",
  waterType: "saltwater",
  minDepth: 0,
  maxDepth: 200,
  centerLon: -136.0,
  centerLat: 58.0,
  bbox: { minLon: -137, minLat: 57, maxLon: -135, maxLat: 59 },
};

const CORRUPT_PRESET: PresetDataset = {
  ...VALID_PRESET,
  bbox: "not-a-valid-bbox-object" as unknown as BboxShape,
};

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  terrainState.presets = [];
});

describe("GET /api/datasets — response-parse failure → structured 500", () => {
  it("returns 200 with an empty array when ALL_PRESET_DATASETS is empty", async () => {
    terrainState.presets = [];
    const res = await request(app).get("/api/datasets");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it("returns 200 with one item for a single valid preset dataset", async () => {
    terrainState.presets = [VALID_PRESET];
    const res = await request(app).get("/api/datasets");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("test-dataset-01");
    expect(res.body[0].bbox).toMatchObject({ minLon: -137, minLat: 57, maxLon: -135, maxLat: 59 });
  });

  it("returns 500 with error: internal when bbox is a string (violates response schema)", async () => {
    terrainState.presets = [CORRUPT_PRESET];
    const res = await request(app).get("/api/datasets");
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "internal" });
    expect(typeof res.body.details).toBe("string");
  });

  it("returns 200 with two items when two valid presets are present", async () => {
    terrainState.presets = [VALID_PRESET, { ...VALID_PRESET, id: "test-dataset-02" }];
    const res = await request(app).get("/api/datasets");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});
