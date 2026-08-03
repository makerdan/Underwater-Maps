/**
 * datasets-terrain-schema-validation.test.ts
 *
 * Verifies that the four terrain DB-write paths in datasets.ts reject a
 * malformed worker / gridder result with a clear terrain_schema_mismatch error
 * rather than silently storing corrupt JSON.
 *
 * Code paths covered:
 *   • Path 3 — POST /api/datasets/upload  (gridPoints → direct DB insert)
 *   • Path 4 — POST /api/datasets/raster-commit  (gridPoints → direct DB insert)
 *   • Unit test for validateTerrainForDb helper (exercises the same guard used
 *     by job paths 1 & 2 which run inside the async processUploadJob worker)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mock @workspace/db — pull Zod / Drizzle schema objects from the schema
// subpath (no DB connection needed there) and override the live db + pool.
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", async () => {
  // vi.importActual on the /schema subpath loads table definitions and
  // StoredTerrainJsonSchema without touching pg.Pool or DATABASE_URL.
  const schemaModule = await vi.importActual("@workspace/db/schema") as Record<string, unknown>;
  return {
    ...schemaModule,
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
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

// ---------------------------------------------------------------------------
// Mock gridPoints to return a terrain object missing all required bbox fields.
// parseXyzCsv and other terrain helpers are kept real via importOriginal so
// the CSV parse step in POST /api/datasets/upload still works.
// ---------------------------------------------------------------------------
vi.mock("../../lib/terrain.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/terrain.js")>();
  return {
    ...actual,
    gridPoints: vi.fn(() => ({
      datasetId: "test-grid-id",
      name: "test dataset",
      waterType: "saltwater" as const,
      resolution: 64,
      width: 64,
      height: 64,
      depths: new Array(64 * 64).fill(5),
      minDepth: 0,
      maxDepth: 10,
      // intentionally absent: minLon, maxLon, minLat, maxLat, centerLon, centerLat
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock commitCachedExtraction so the raster-commit route has valid points to
// grid without needing a real extraction cache token.
// ---------------------------------------------------------------------------
vi.mock("../../lib/pdfContourRaster.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/pdfContourRaster.js")>();
  return {
    ...actual,
    commitCachedExtraction: vi.fn(() =>
      Array.from({ length: 15 }, (_, i) => ({
        lon: -122 + i * 0.01,
        lat: 37 + i * 0.01,
        depth: 10 + i,
      })),
    ),
  };
});

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
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";
import { validateTerrainForDb } from "../datasets.js";

const E2E_USER = "user_schema_mismatch_test";

// A CSV with ≥10 points so the parse step succeeds and gridPoints is reached.
const ENOUGH_POINTS_CSV = [
  "lon,lat,depth",
  ...Array.from({ length: 12 }, (_, i) =>
    `-122.0${i},37.0${i},${10 + i}`),
].join("\n") + "\n";

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
});

// ---------------------------------------------------------------------------
// Path 3 — POST /api/datasets/upload
// gridPoints returns a bbox-less object → schema check fires → 500
// ---------------------------------------------------------------------------
describe("POST /api/datasets/upload — terrain schema mismatch", () => {
  it("returns 500 terrain_schema_mismatch when gridPoints output is missing required bbox fields", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .attach("file", Buffer.from(ENOUGH_POINTS_CSV), "survey.csv");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "terrain_schema_mismatch" });
    expect(typeof res.body.details).toBe("string");
    // The details string should name at least one of the missing fields.
    expect(res.body.details).toMatch(/minLon|maxLon|minLat|maxLat|centerLon|centerLat/);
  });

  it("does not return 201 or reach the DB insert when terrain is malformed", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .attach("file", Buffer.from(ENOUGH_POINTS_CSV), "survey.csv");

    // Must not succeed — if it did, corrupt terrain would have reached the DB.
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
    expect(res.body.error).toBe("terrain_schema_mismatch");
  });
});

// ---------------------------------------------------------------------------
// Path 4 — POST /api/datasets/raster-commit
// commitCachedExtraction returns valid points; gridPoints still returns the
// bbox-less stub → schema check fires → 500
// ---------------------------------------------------------------------------
describe("POST /api/datasets/raster-commit — terrain schema mismatch", () => {
  const VALID_BBOX = JSON.stringify({
    minLon: -122.5,
    maxLon: -121.5,
    minLat: 37.0,
    maxLat: 38.0,
  });

  const VALID_LABELS = [
    { x: 100, y: 200, value: 10, text: "10" },
    { x: 150, y: 250, value: 20, text: "20" },
  ];

  it("returns 500 terrain_schema_mismatch when gridPoints output is missing required bbox fields", async () => {
    const res = await request(app)
      .post("/api/datasets/raster-commit")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER)
      .send({
        token: "test-cache-token",
        correctedLabels: VALID_LABELS,
        pdfBbox: VALID_BBOX,
        pdfDepthUnit: "feet",
        resolution: 64,
        fileName: "test-chart.pdf",
      });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "terrain_schema_mismatch" });
    expect(typeof res.body.details).toBe("string");
    expect(res.body.details).toMatch(/minLon|maxLon|minLat|maxLat|centerLon|centerLat/);
  });

  it("does not return 200 when terrain is malformed", async () => {
    const res = await request(app)
      .post("/api/datasets/raster-commit")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER)
      .send({
        token: "test-cache-token",
        correctedLabels: VALID_LABELS,
        pdfBbox: VALID_BBOX,
        pdfDepthUnit: "feet",
        resolution: 64,
        fileName: "test-chart.pdf",
      });

    expect(res.status).not.toBe(200);
    expect(res.body.error).toBe("terrain_schema_mismatch");
  });
});

// ---------------------------------------------------------------------------
// Unit tests for validateTerrainForDb — this helper is also called from the
// two job-processing code paths (TAR/BAG archive and single-file chunk upload)
// which run inside processUploadJob.  Validating the helper directly covers
// those paths without requiring a full chunked-upload flow.
// ---------------------------------------------------------------------------
describe("validateTerrainForDb helper", () => {
  const VALID_TERRAIN = {
    datasetId: "abc123",
    name: "Test Lake",
    waterType: "freshwater" as const,
    resolution: 128,
    width: 128,
    height: 128,
    depths: new Array(128 * 128).fill(3),
    minDepth: 0,
    maxDepth: 10,
    minLon: -93.5,
    maxLon: -93.0,
    minLat: 44.5,
    maxLat: 45.0,
    centerLon: -93.25,
    centerLat: 44.75,
  };

  it("returns the terrain object unchanged when all required fields are present", () => {
    const result = validateTerrainForDb(VALID_TERRAIN, "test");
    expect(result).toBe(VALID_TERRAIN);
  });

  it("throws with code terrain_schema_mismatch when minLon is missing", () => {
    const { minLon: _dropped, ...noMinLon } = VALID_TERRAIN;
    expect(() => validateTerrainForDb(noMinLon, "test")).toThrow();
    try {
      validateTerrainForDb(noMinLon, "test");
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe("terrain_schema_mismatch");
      expect((err as Error).message).toMatch(/terrain_schema_mismatch/);
    }
  });

  it("throws when both centerLon and centerLat are absent", () => {
    const { centerLon: _clon, centerLat: _clat, ...noCentre } = VALID_TERRAIN;
    expect(() => validateTerrainForDb(noCentre, "test")).toThrow();
    try {
      validateTerrainForDb(noCentre, "test");
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe("terrain_schema_mismatch");
      expect((err as Error).message).toMatch(/centerLon|centerLat/);
    }
  });

  it("throws when depths is not an array", () => {
    const badDepths = { ...VALID_TERRAIN, depths: "not-an-array" };
    expect(() => validateTerrainForDb(badDepths, "test")).toThrow();
    try {
      validateTerrainForDb(badDepths, "test");
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe("terrain_schema_mismatch");
    }
  });

  it("throws when waterType is an unrecognised value", () => {
    const badWaterType = { ...VALID_TERRAIN, waterType: "brackish" };
    expect(() => validateTerrainForDb(badWaterType, "test")).toThrow();
    try {
      validateTerrainForDb(badWaterType, "test");
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe("terrain_schema_mismatch");
    }
  });

  it("includes the missing field names in the error message details", () => {
    const { maxLon: _maxLon, maxLat: _maxLat, ...missingTwo } = VALID_TERRAIN;
    try {
      validateTerrainForDb(missingTwo, "test");
      throw new Error("expected to throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/maxLon|maxLat/);
    }
  });

  it("passes through optional fields (topography, dataSource, etc.)", () => {
    const withOptional = {
      ...VALID_TERRAIN,
      topography: [0, 1, 2],
      hasTopography: true,
      dataSource: "ncei" as const,
    };
    expect(() => validateTerrainForDb(withOptional, "test")).not.toThrow();
  });
});
