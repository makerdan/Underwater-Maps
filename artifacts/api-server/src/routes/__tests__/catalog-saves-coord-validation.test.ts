/**
 * catalog-saves-coord-validation.test.ts
 *
 * Covers the latitude range guards added to POST /api/datasets/bbox-query:
 *
 *  1. north > 90  → 422 (validation_error, field: "north")
 *  2. north < -90 → 422 (validation_error, field: "north")
 *  3. south < -90 → 422 (validation_error, field: "south")
 *  4. south > 90  → 422 (validation_error, field: "south")
 *  5. Valid bbox within bounds → 200 (searchCatalog called)
 *
 * These guards sit before the DB/searchCatalog call so the mocks for those
 * paths are kept minimal — they only need to return enough for the happy-path
 * assertion. Mock paths follow the integration-test convention: relative to
 * this test file (one level up from __tests__/).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mocks — hoisted before any import executes.
// NOTE: paths are relative to THIS FILE (src/routes/__tests__/), so modules
// that live in src/routes/../lib resolve to src/lib → ../../lib/...
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  and: (...parts: unknown[]) => ({ kind: "and", parts }),
  lt: (col: unknown, val: unknown) => ({ kind: "lt", col, val }),
  isNull: (col: unknown) => ({ kind: "isNull", col }),
  desc: (col: unknown) => ({ kind: "desc", col }),
  asc: (col: unknown) => ({ kind: "asc", col }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
  },
  userCatalogSavesTable: { __name: "user_catalog_saves" },
  customDatasetsTable: { __name: "custom_datasets" },
  datasetFoldersTable: { __name: "dataset_folders" },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

// Rate limit: bypass so tests aren't throttled or blocked.
vi.mock("../../middlewares/rateLimit.js", () => ({
  createRateLimit:
    () =>
    (_req: unknown, _res: unknown, next: () => void) =>
      next(),
  __resetRateLimitMemory: vi.fn(),
  __prefillRateLimitMemory: vi.fn(),
}));

// dataMutationRateLimit: used by other routes mounted in this router.
vi.mock("../../middlewares/dataMutationRateLimit.js", () => ({
  dataMutationRateLimit: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  bulkDeleteMarkersRateLimit: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

const mockSearchCatalog = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockInvalidateCatalogCache = vi.hoisted(() => vi.fn());

vi.mock("../../lib/catalogSeeder.js", () => ({
  searchCatalog: mockSearchCatalog,
  invalidateCatalogCache: mockInvalidateCatalogCache,
  getCatalogEntries: vi.fn().mockResolvedValue([]),
  seedDatasetCatalog: vi.fn().mockResolvedValue(undefined),
  scoreEntry: vi.fn().mockReturnValue(1),
}));

vi.mock("../../lib/terrain.js", async () => {
  const { createTerrainMock } = await import(
    "../../__tests__/helpers/terrainMock.js"
  );
  return createTerrainMock({
    buildTerrainGrid: vi.fn(),
    buildGebcoTerrainForBbox: vi.fn(),
    buildNceiTerrainForBbox: vi.fn(),
    buildUsgs3depTerrainForBbox: vi.fn(),
    buildGreatLakesTerrainForBbox: vi.fn(),
  });
});

vi.mock("../../lib/efhData.js", () => ({
  SALTWATER_EFH_BY_DATASET: {},
}));

vi.mock("../../lib/efhFetcher.js", () => ({
  fetchNoaaAlaskaEfh: vi.fn().mockResolvedValue(null),
  buildCollectionFromLiveFeatures: vi.fn().mockReturnValue({
    type: "FeatureCollection",
    features: [],
  }),
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    // Override response parsers to passthrough so the minimal mock data
    // (empty datasets array) doesn't fail strict schema validation.
    PostDatasetsBboxQueryResponse: { parse: (x: unknown) => x },
    PostDatasetsPointRadiusQueryResponse: { parse: (x: unknown) => x },
    GetDatasetsCatalogResponse: { parse: (x: unknown) => x },
    GetDatasetsCatalogSearchResponse: { parse: (x: unknown) => x },
    GetDatasetsMySavesResponse: { parse: (x: unknown) => x },
    GetDatasetsMySavesResponseItem: { parse: (x: unknown) => x },
    GetDatasetsMySavesIdStatusResponse: { parse: (x: unknown) => x },
    PostDatasetsMySavesIdRetryResponse: { parse: (x: unknown) => x },
    PatchDatasetsMySavesIdRenameResponse: { parse: (x: unknown) => x },
    PatchDatasetsMySavesIdMoveResponse: { parse: (x: unknown) => x },
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  // Return a non-null userId so requireAuth (used by the save route) passes.
  getAuth: () => ({ userId: "test-user" }),
}));

// ---------------------------------------------------------------------------
// App factory — mount both current owners of the routes covered here.
// ---------------------------------------------------------------------------
import catalogDiscoveryRouter from "../catalog-discovery.js";
import catalogSavesRouter from "../catalog-saves.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(catalogDiscoveryRouter);
  app.use(catalogSavesRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const VALID_BBOX = { north: 60, south: 50, east: -130, west: -140 };

beforeEach(() => {
  mockSearchCatalog.mockClear();
  mockSearchCatalog.mockResolvedValue([]);
  mockInvalidateCatalogCache.mockClear();
});

// ---------------------------------------------------------------------------
// north out of lat range
// ---------------------------------------------------------------------------
describe("POST /datasets/bbox-query — north latitude range", () => {
  it("returns 422 when north > 90", async () => {
    const res = await request(makeApp())
      .post("/datasets/bbox-query")
      .send({ ...VALID_BBOX, north: 91 });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "validation_error",
      field: "north",
    });
    expect(res.body.message).toMatch(/north must be a finite latitude between -90 and 90/);
  });

  it("returns 422 when north < -90", async () => {
    const res = await request(makeApp())
      .post("/datasets/bbox-query")
      .send({ ...VALID_BBOX, north: -91 });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "validation_error",
      field: "north",
    });
  });

  it("accepts north = 90 (boundary)", async () => {
    const res = await request(makeApp())
      .post("/datasets/bbox-query")
      .send({ ...VALID_BBOX, north: 90 });

    expect(res.status).toBe(200);
    expect(mockSearchCatalog).toHaveBeenCalledOnce();
  });

  it("accepts north = -90 (boundary, degenerate box but lat-range check passes)", async () => {
    // north=-90, south=-90 is a zero-area box; the existing span check may
    // fire a 400. We only assert that the new lat-range 422 guard does NOT
    // fire (i.e. status is not 422 with field "north").
    const res = await request(makeApp())
      .post("/datasets/bbox-query")
      .send({ ...VALID_BBOX, north: -90, south: -90 });

    expect(res.status).not.toBe(422);
  });
});

// ---------------------------------------------------------------------------
// south out of lat range
// ---------------------------------------------------------------------------
describe("POST /datasets/bbox-query — south latitude range", () => {
  it("returns 422 when south < -90", async () => {
    const res = await request(makeApp())
      .post("/datasets/bbox-query")
      .send({ ...VALID_BBOX, south: -91 });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "validation_error",
      field: "south",
    });
    expect(res.body.message).toMatch(/south must be a finite latitude between -90 and 90/);
  });

  it("returns 422 when south > 90", async () => {
    const res = await request(makeApp())
      .post("/datasets/bbox-query")
      .send({ ...VALID_BBOX, south: 91 });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "validation_error",
      field: "south",
    });
  });

  it("accepts south = -90 (boundary)", async () => {
    const res = await request(makeApp())
      .post("/datasets/bbox-query")
      .send({ ...VALID_BBOX, south: -90 });

    expect(res.status).toBe(200);
    expect(mockSearchCatalog).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Valid bbox reaches searchCatalog
// ---------------------------------------------------------------------------
describe("POST /datasets/bbox-query — valid coordinates pass through", () => {
  it("returns 200 and calls searchCatalog for a valid bbox", async () => {
    const res = await request(makeApp())
      .post("/datasets/bbox-query")
      .send(VALID_BBOX);

    expect(res.status).toBe(200);
    expect(mockSearchCatalog).toHaveBeenCalledOnce();
    expect(mockSearchCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        minLat: VALID_BBOX.south,
        maxLat: VALID_BBOX.north,
        minLon: VALID_BBOX.west,
        maxLon: VALID_BBOX.east,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// POST /datasets/catalog/:id/save — requestBbox coordinate range guards
//
// RequestBboxSchema enforces lat ∈ [-90, 90] and lon ∈ [-180, 180].
// The validateBody middleware fires before the route handler so invalid
// coordinates return 400 ("invalid_request") without touching the DB.
// ---------------------------------------------------------------------------
describe("POST /datasets/catalog/:id/save — requestBbox lat/lon range", () => {
  const VALID_REQUEST_BBOX = { minLat: 50, maxLat: 60, minLon: -140, maxLon: -130 };
  const SAVE_URL = "/datasets/catalog/test-id/save";

  // --- minLat ---
  it("returns 400 when requestBbox.minLat < -90", async () => {
    const res = await request(makeApp())
      .post(SAVE_URL)
      .send({ requestBbox: { ...VALID_REQUEST_BBOX, minLat: -91 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when requestBbox.minLat > 90", async () => {
    const res = await request(makeApp())
      .post(SAVE_URL)
      .send({ requestBbox: { ...VALID_REQUEST_BBOX, minLat: 91 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  // --- maxLat ---
  it("returns 400 when requestBbox.maxLat < -90", async () => {
    const res = await request(makeApp())
      .post(SAVE_URL)
      .send({ requestBbox: { ...VALID_REQUEST_BBOX, maxLat: -91 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when requestBbox.maxLat > 90", async () => {
    const res = await request(makeApp())
      .post(SAVE_URL)
      .send({ requestBbox: { ...VALID_REQUEST_BBOX, maxLat: 91 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  // --- minLon ---
  it("returns 400 when requestBbox.minLon < -180", async () => {
    const res = await request(makeApp())
      .post(SAVE_URL)
      .send({ requestBbox: { ...VALID_REQUEST_BBOX, minLon: -181 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when requestBbox.minLon > 180", async () => {
    const res = await request(makeApp())
      .post(SAVE_URL)
      .send({ requestBbox: { ...VALID_REQUEST_BBOX, minLon: 181 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  // --- maxLon ---
  it("returns 400 when requestBbox.maxLon < -180", async () => {
    const res = await request(makeApp())
      .post(SAVE_URL)
      .send({ requestBbox: { ...VALID_REQUEST_BBOX, maxLon: -181 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when requestBbox.maxLon > 180", async () => {
    const res = await request(makeApp())
      .post(SAVE_URL)
      .send({ requestBbox: { ...VALID_REQUEST_BBOX, maxLon: 181 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  // --- boundary values pass schema validation ---
  it("accepts requestBbox at lat/lon boundaries (-90/-180/90/180)", async () => {
    const res = await request(makeApp())
      .post(SAVE_URL)
      .send({ requestBbox: { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 } });

    // validateBody passes; downstream handler returns 404 (catalog id not
    // found in the seeded mock) — not a 400 from coord-range validation.
    expect(res.status).not.toBe(400);
  });
});
