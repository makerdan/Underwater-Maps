/**
 * datasets-route-guards.test.ts
 *
 * Structural + regression guards against datasets.ts mis-merge corruption
 * (duplicate route registrations, stale schema fragments pasted into catch
 * blocks, handlers merged into each other). See Task "Guard datasets.ts
 * against future mis-merge corruption".
 *
 * Coverage:
 *  1. Duplicate-route guard — every (method, path) pair on the datasets
 *     router must be unique. A mis-merge that pastes a route twice fails
 *     here with a message naming the duplicated path.
 *  2. Query-validation regressions — zones (h/w), terrain/land (bbox+size),
 *     terrain/download/info, terrain/download: invalid queries return a
 *     structured 400 JSON error (never an unhandled throw), and each has a
 *     happy-path 200 with upstreams mocked.
 *  3. Catch-block sanity — upstream throws surface as 502 upstream_error
 *     JSON bodies for terrain/land and terrain/download/info, proving the
 *     catch blocks contain only the error response (no stale fragments).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock("../lib/terrain.js", async () => {
  const { createTerrainMock } = await import("./helpers/terrainMock.js");
  return createTerrainMock({
    ALL_PRESET_DATASETS: [{ id: "guard-preset", name: "Guard Preset" }],
    previewBboxForDownload: vi.fn(),
    buildBboxCsvRows: vi.fn(),
  });
});

vi.mock("../lib/copernicusDem.js", () => ({
  fetchCopernicusDem: vi.fn(),
}));

vi.mock("../lib/substrateGrid.js", () => ({
  substrateFingerprintForDataset: vi.fn(() => "00000000"),
}));

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const selectWhere = () => Promise.resolve([]);
  const selectFrom = () => ({ where: selectWhere });
  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({ from: selectFrom }),
    },
  });
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  // Return userId from the test-only x-mock-clerk-user-id header.
  getAuth: vi.fn((req: { headers: Record<string, string> }) => ({
    userId: req.headers["x-mock-clerk-user-id"] ?? null,
  })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import app from "../app.js";
import datasetDiscoveryRouter from "../routes/datasets-discovery.js";
import datasetTerrainRouter from "../routes/datasets-terrain.js";
import datasetIngestionRouter from "../routes/datasets-ingestion.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";
import { datasetZonesCache, zoneCacheKey } from "../routes/poe.js";
import { previewBboxForDownload, buildBboxCsvRows } from "../lib/terrain.js";
import { findDuplicateRoutes, findDuplicateRoutesAcross, countRoutes } from "./helpers/routeGuard.js";
import { fetchCopernicusDem } from "../lib/copernicusDem.js";

const mockPreview = vi.mocked(previewBboxForDownload);
const mockCsvRows = vi.mocked(buildBboxCsvRows);
const mockDem = vi.mocked(fetchCopernicusDem);

function authHeader(userId = "guard-user") {
  return { "x-mock-clerk-user-id": userId };
}

beforeEach(() => {
  __resetRateLimitMemory();
  datasetZonesCache.clear();
  mockPreview.mockReset();
  mockCsvRows.mockReset();
  mockDem.mockReset();
});

// ---------------------------------------------------------------------------
// 1. Duplicate-route guard
// ---------------------------------------------------------------------------

describe("dataset capability routers structural guard", () => {
  it.each([
    ["discovery", datasetDiscoveryRouter],
    ["terrain", datasetTerrainRouter],
    ["ingestion", datasetIngestionRouter],
  ])("registers every %s (method, path) pair at most once", (_name, router) => {
    expect(
      countRoutes(router),
      "dataset capability router registered no routes — Express internals changed?",
    ).toBeGreaterThan(0);

    expect(findDuplicateRoutes(router)).toEqual([]);
  });

  it("keeps all dataset capability routes disjoint", () => {
    expect(findDuplicateRoutesAcross([
      [datasetDiscoveryRouter, ""],
      [datasetTerrainRouter, ""],
      [datasetIngestionRouter, ""],
    ])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. GET /api/datasets/:id/zones — query validation + happy path
// ---------------------------------------------------------------------------

describe("GET /api/datasets/:id/zones query validation", () => {
  it("400 invalid_param when h is missing", async () => {
    const res = await request(app).get("/api/datasets/guard-preset/zones?w=saltwater");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
    expect(typeof res.body.details).toBe("string");
  });

  it("400 invalid_param on array-injected h (?h[]=...)", async () => {
    const res = await request(app).get(
      "/api/datasets/guard-preset/zones?h[]=aaaaaaaa&h[]=bbbbbbbb&w=saltwater",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });

  it("400 invalid_param on malformed h and unknown w", async () => {
    const res = await request(app).get("/api/datasets/guard-preset/zones?h=XYZ&w=brackish");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });

  it("200 happy path served from the in-memory zone cache", async () => {
    const gridHash = "a".repeat(64);
    const key = zoneCacheKey("", gridHash, "saltwater", "00000000");
    datasetZonesCache.set(key, {
      zones: new Array(1024).fill("sand"),
      waterType: "saltwater",
      classifiedAt: Date.now(),
      fromCache: true,
      source: "ai",
      coarseWidth: 32,
      coarseHeight: 32,
    } as never);

    const res = await request(app).get(
      `/api/datasets/guard-preset/zones?h=${gridHash}&w=saltwater`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.zones).toHaveLength(1024);
    expect(res.body.source).toBe("ai");
  });
});

// ---------------------------------------------------------------------------
// 3. GET /api/terrain/land — bbox+size validation, happy path, catch block
// ---------------------------------------------------------------------------

describe("GET /api/terrain/land validation and catch block", () => {
  it("400 invalid_param when bbox is missing", async () => {
    const res = await request(app).get("/api/terrain/land");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });

  it("400 invalid_param on array-injected bbox (?bbox[]=...)", async () => {
    const res = await request(app).get("/api/terrain/land?bbox[]=1,2,3,4&bbox[]=5,6,7,8");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });

  it("400 invalid_param on non-finite bbox values", async () => {
    const res = await request(app).get("/api/terrain/land?bbox=1,2,3,NaN");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });

  it("400 invalid_bbox when min >= max or out of range", async () => {
    const flipped = await request(app).get("/api/terrain/land?bbox=10,10,5,20");
    expect(flipped.status).toBe(400);
    expect(flipped.body.error).toBe("invalid_bbox");

    const outOfRange = await request(app).get("/api/terrain/land?bbox=-200,10,5,20");
    expect(outOfRange.status).toBe(400);
    expect(outOfRange.body.error).toBe("invalid_bbox");
  });

  it("200 happy path returns the mocked DEM grid", async () => {
    const grid = {
      depths: [0, 1, 2, 3],
      width: 2,
      height: 2,
      minDepth: 0,
      maxDepth: 3,
      bounds: { minLon: 1, minLat: 2, maxLon: 3, maxLat: 4 },
    };
    mockDem.mockResolvedValue(grid as never);
    const res = await request(app).get("/api/terrain/land?bbox=1,2,3,4&size=64");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.width).toBe(2);
    expect(mockDem).toHaveBeenCalledWith({ minLon: 1, minLat: 2, maxLon: 3, maxLat: 4 }, 64);
  });

  it("502 upstream_error JSON when the DEM fetch throws (catch-block sanity)", async () => {
    mockDem.mockRejectedValue(new Error("Copernicus is down"));
    const res = await request(app).get("/api/terrain/land?bbox=1,2,3,4");
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "upstream_error", details: "Copernicus is down" });
  });
});

// ---------------------------------------------------------------------------
// 4. GET /api/terrain/download/info — validation, happy path, catch block
// ---------------------------------------------------------------------------

describe("GET /api/terrain/download/info validation and catch block", () => {
  it("401 without auth", async () => {
    const res = await request(app).get(
      "/api/terrain/download/info?north=45&south=44&east=-70&west=-71",
    );
    expect(res.status).toBe(401);
  });

  it("400 invalid_bbox on missing params", async () => {
    const res = await request(app)
      .get("/api/terrain/download/info?north=45")
      .set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_bbox");
  });

  it("400 invalid_bbox on array-injected cardinal param", async () => {
    const res = await request(app)
      .get("/api/terrain/download/info?north[]=45&north[]=50&south=44&east=-70&west=-71")
      .set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_bbox");
  });

  it("400 invalid_bbox when bbox span exceeds 10°", async () => {
    const res = await request(app)
      .get("/api/terrain/download/info?north=45&south=20&east=-70&west=-71")
      .set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_bbox");
  });

  it("200 happy path returns the mocked preflight info", async () => {
    mockPreview.mockResolvedValue({
      sourceName: "GEBCO 2024",
      dataSource: "gebco",
      nominalResolutionM: 450,
      waterFraction: 0.75,
    } as never);
    const res = await request(app)
      .get("/api/terrain/download/info?north=45&south=44&east=-70&west=-71")
      .set(authHeader());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.dataSource).toBe("gebco");
    expect(res.body.waterFraction).toBe(0.75);
  });

  it("502 upstream_error JSON when preflight throws (catch-block sanity)", async () => {
    mockPreview.mockRejectedValue(new Error("probe failed"));
    const res = await request(app)
      .get("/api/terrain/download/info?north=45&south=44&east=-70&west=-71")
      .set(authHeader());
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "upstream_error", details: "probe failed" });
  });
});

// ---------------------------------------------------------------------------
// 5. GET /api/terrain/download — validation, happy path, catch block
// ---------------------------------------------------------------------------

describe("GET /api/terrain/download validation and catch block", () => {
  it("400 invalid_bbox on bad resolution", async () => {
    const res = await request(app)
      .get("/api/terrain/download?north=45&south=44&east=-70&west=-71&resolution=100")
      .set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_bbox");
    expect(res.body.details).toContain("resolution");
  });

  it("400 invalid_bbox when north <= south", async () => {
    const res = await request(app)
      .get("/api/terrain/download?north=44&south=45&east=-70&west=-71")
      .set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_bbox");
  });

  it("200 happy path streams CSV with the mocked rows", async () => {
    mockCsvRows.mockResolvedValue([
      { lon: -70.5, lat: 44.5, depth: 12.345 },
    ] as never);
    const res = await request(app)
      .get("/api/terrain/download?north=45&south=44&east=-70&west=-71&resolution=64")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.text).toContain("lon,lat,depth\n");
    expect(res.text).toContain("-70.5000000,44.5000000,12.345");
  });

  it("502 upstream_error JSON when the grid build throws before streaming", async () => {
    mockCsvRows.mockRejectedValue(new Error("grid build failed"));
    const res = await request(app)
      .get("/api/terrain/download?north=45&south=44&east=-70&west=-71")
      .set(authHeader());
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "upstream_error", details: "grid build failed" });
  });
});
