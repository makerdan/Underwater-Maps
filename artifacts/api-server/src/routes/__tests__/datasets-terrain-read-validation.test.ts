/**
 * datasets-terrain-read-validation.test.ts
 *
 * Verifies that the two GET terrain read paths validate the stored JSON from
 * the database against StoredTerrainJsonSchema before serving it to the client.
 *
 * Code paths covered:
 *   • GET /api/datasets/:id/terrain   — reads terrainJson from DB for custom
 *     datasets, validates it, and returns 500 terrain_schema_mismatch when the
 *     stored row is corrupt rather than forwarding bad data to the 3D renderer.
 *   • GET /api/datasets/:id/overview  — same guard on overviewJson.
 *   • Both endpoints return 200 when the stored JSON is well-formed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mutable DB row store shared by all tests.  Each test seeds it with the row
// that represents the custom dataset the authenticated user owns.  The DB mock
// returns it from every select().from().where() call (the ownership + payload
// query in the terrain/overview handlers).
// ---------------------------------------------------------------------------
let _mockDbRows: unknown[] = [];

vi.mock("@workspace/db", async () => {
  const schemaModule = await vi.importActual("@workspace/db/schema") as Record<string, unknown>;
  return {
    ...schemaModule,
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(_mockDbRows),
        }),
      }),
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([]),
          onConflictDoUpdate: () => Promise.resolve([]),
          onConflictDoNothing: () => Promise.resolve([]),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
      transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
    },
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: "test-owner" })),
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
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

// Custom UUID not in the preset catalog — triggers the DB read path.
const TEST_UUID = "deadbeef-1234-5678-abcd-000000000000";

// A minimal valid StoredTerrainJson that satisfies the schema.
const VALID_TERRAIN_JSON = {
  datasetId: TEST_UUID,
  name: "Test Lake",
  waterType: "freshwater" as const,
  resolution: 64,
  width: 64,
  height: 64,
  depths: new Array(64 * 64).fill(5),
  minDepth: 0,
  maxDepth: 10,
  minLon: -93.5,
  maxLon: -93.0,
  minLat: 44.5,
  maxLat: 45.0,
  centerLon: -93.25,
  centerLat: 44.75,
};

// A malformed StoredTerrainJson — bbox and center fields are absent.
const CORRUPT_TERRAIN_JSON = {
  datasetId: TEST_UUID,
  name: "Corrupt Lake",
  waterType: "freshwater" as const,
  resolution: 64,
  width: 64,
  height: 64,
  depths: new Array(64 * 64).fill(5),
  minDepth: 0,
  maxDepth: 10,
  // intentionally absent: minLon, maxLon, minLat, maxLat, centerLon, centerLat
};

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  _mockDbRows = [];
});

// ---------------------------------------------------------------------------
// GET /api/datasets/:id/terrain — corrupt stored row
// ---------------------------------------------------------------------------
describe("GET /api/datasets/:id/terrain — terrain schema mismatch on corrupt DB row", () => {
  it("returns 500 terrain_schema_mismatch when the stored terrainJson is missing required bbox fields", async () => {
    _mockDbRows = [{ userId: "test-owner", terrainJson: CORRUPT_TERRAIN_JSON }];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/terrain`);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "terrain_schema_mismatch" });
    expect(typeof res.body.details).toBe("string");
    // The details string must name at least one of the missing fields.
    expect(res.body.details).toMatch(/minLon|maxLon|minLat|maxLat|centerLon|centerLat/);
  });

  it("does not return 200 when the stored terrainJson is malformed", async () => {
    _mockDbRows = [{ userId: "test-owner", terrainJson: CORRUPT_TERRAIN_JSON }];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/terrain`);

    expect(res.status).not.toBe(200);
    expect(res.body.error).toBe("terrain_schema_mismatch");
  });

  it("includes field-level details in the error when waterType is invalid", async () => {
    const badWaterType = { ...VALID_TERRAIN_JSON, waterType: "brackish" };
    _mockDbRows = [{ userId: "test-owner", terrainJson: badWaterType }];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/terrain`);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "terrain_schema_mismatch" });
    expect(res.body.details).toMatch(/waterType/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/datasets/:id/terrain — valid stored row
// ---------------------------------------------------------------------------
describe("GET /api/datasets/:id/terrain — valid stored terrainJson", () => {
  it("returns 200 and the terrain grid when the stored terrainJson is well-formed", async () => {
    _mockDbRows = [{ userId: "test-owner", terrainJson: VALID_TERRAIN_JSON }];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/terrain`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      datasetId: TEST_UUID,
      name: "Test Lake",
      waterType: "freshwater",
      resolution: 64,
      minLon: -93.5,
      maxLon: -93.0,
      minLat: 44.5,
      maxLat: 45.0,
      centerLon: -93.25,
      centerLat: 44.75,
    });
    expect(Array.isArray(res.body.depths)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/datasets/:id/overview — corrupt stored row
// ---------------------------------------------------------------------------
describe("GET /api/datasets/:id/overview — terrain schema mismatch on corrupt DB row", () => {
  it("returns 500 terrain_schema_mismatch when the stored overviewJson is missing required bbox fields", async () => {
    _mockDbRows = [{ userId: "test-owner", overviewJson: CORRUPT_TERRAIN_JSON }];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/overview`);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "terrain_schema_mismatch" });
    expect(typeof res.body.details).toBe("string");
    expect(res.body.details).toMatch(/minLon|maxLon|minLat|maxLat|centerLon|centerLat/);
  });

  it("does not return 200 when the stored overviewJson is malformed", async () => {
    _mockDbRows = [{ userId: "test-owner", overviewJson: CORRUPT_TERRAIN_JSON }];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/overview`);

    expect(res.status).not.toBe(200);
    expect(res.body.error).toBe("terrain_schema_mismatch");
  });

  it("includes field-level details in the error when depths is not an array", async () => {
    const badDepths = { ...VALID_TERRAIN_JSON, depths: "not-an-array" };
    _mockDbRows = [{ userId: "test-owner", overviewJson: badDepths }];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/overview`);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "terrain_schema_mismatch" });
    expect(res.body.details).toMatch(/depths/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/datasets/:id/overview — valid stored row
// ---------------------------------------------------------------------------
describe("GET /api/datasets/:id/overview — valid stored overviewJson", () => {
  it("returns 200 and the overview grid when the stored overviewJson is well-formed", async () => {
    _mockDbRows = [{ userId: "test-owner", overviewJson: VALID_TERRAIN_JSON }];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/overview`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      datasetId: TEST_UUID,
      name: "Test Lake",
      waterType: "freshwater",
      resolution: 64,
      minLon: -93.5,
      maxLon: -93.0,
      minLat: 44.5,
      maxLat: 45.0,
      centerLon: -93.25,
      centerLat: 44.75,
    });
    expect(Array.isArray(res.body.depths)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/datasets/:id/preview — corrupt stored row (line 1745 guard)
// ---------------------------------------------------------------------------
describe("GET /api/datasets/:id/preview — terrain schema mismatch on corrupt DB row", () => {
  it("returns 500 terrain_schema_mismatch when the stored terrainJson is missing required bbox fields", async () => {
    _mockDbRows = [{ userId: "test-owner", name: "Corrupt Lake", terrainJson: CORRUPT_TERRAIN_JSON }];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/preview`);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "terrain_schema_mismatch" });
    expect(typeof res.body.details).toBe("string");
    expect(res.body.details).toMatch(/minLon|maxLon|minLat|maxLat|centerLon|centerLat/);
  });

  it("does not return 200 when the stored terrainJson is malformed", async () => {
    _mockDbRows = [{ userId: "test-owner", name: "Corrupt Lake", terrainJson: CORRUPT_TERRAIN_JSON }];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/preview`);

    expect(res.status).not.toBe(200);
    expect(res.body.error).toBe("terrain_schema_mismatch");
  });
});

// ---------------------------------------------------------------------------
// GET /api/datasets/:id/preview — valid stored row
// ---------------------------------------------------------------------------
describe("GET /api/datasets/:id/preview — valid stored terrainJson", () => {
  it("returns 200 with datasetId and bbox when the stored terrainJson is well-formed", async () => {
    _mockDbRows = [{ userId: "test-owner", name: "Test Lake", terrainJson: VALID_TERRAIN_JSON }];

    const res = await request(app).get(`/api/datasets/${TEST_UUID}/preview`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      datasetId: TEST_UUID,
      name: "Test Lake",
      bbox: { minLon: -93.5, maxLon: -93.0, minLat: 44.5, maxLat: 45.0 },
      dataSource: "ncei",
    });
  });
});
