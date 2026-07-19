/**
 * catalog-bbox.test.ts — validation tests for POST /api/datasets/bbox-query.
 *
 * The handler runs *before* any DB access, so we only need to stub the
 * search layer enough to return an empty array for happy-path checks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: {},
  userSettingsTable: {},
  userCatalogSavesTable: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));
vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock("@clerk/shared/keys", () => ({ publishableKeyFromHost: vi.fn(() => "pk_test_mock") }));

vi.mock("../../lib/catalogSeeder.js", () => ({
  seedDatasetCatalog: vi.fn(async () => {}),
  getCatalogEntries: vi.fn(async () => []),
  searchCatalog: vi.fn(async () => [
    {
      id: "preset-thorne-bay",
      title: "Thorne Bay Bathymetry",
      description: "Sample",
      dataType: "bathymetry",
      sourceAgency: "NOAA",
      source: "NOAA",
      minLon: -132.6,
      maxLon: -132.3,
      minLat: 55.6,
      maxLat: 55.8,
      resolution: 256,
      relevanceScore: 0.9,
      createdAt: new Date("2024-01-01"),
      keywords: [],
      thumbnailUrl: null,
      downloadUrl: null,
      attribution: null,
      license: null,
      waterType: "saltwater",
      hasEfh: false,
    },
  ]),
}));

import app from "../../app.js";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
});

const BASE = { north: 55.8, south: 55.6, east: -132.3, west: -132.6 };

describe("POST /api/datasets/bbox-query", () => {
  it("returns datasets for a valid bbox", async () => {
    const res = await request(app).post("/api/datasets/bbox-query").send(BASE);
    expect(res.status).toBe(200);
    expect(res.body.bbox).toEqual(BASE);
    expect(res.body.datasets).toHaveLength(1);
    expect(res.body.datasets[0].id).toBe("preset-thorne-bay");
  });

  it("400 when bbox fields are missing or non-numeric", async () => {
    const res = await request(app).post("/api/datasets/bbox-query").send({ north: 1, south: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("400 when north <= south", async () => {
    const res = await request(app).post("/api/datasets/bbox-query").send({ ...BASE, north: 55.6, south: 55.8 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_bbox");
  });

  it("400 when east <= west (antimeridian crossing rejected)", async () => {
    const res = await request(app).post("/api/datasets/bbox-query").send({ north: 10, south: 5, east: -170, west: 170 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_bbox");
    expect(res.body.details).toMatch(/antimeridian/i);
  });

  it("400 when the bbox has zero area", async () => {
    const res = await request(app).post("/api/datasets/bbox-query").send({ north: 10.00001, south: 10, east: 20.00001, west: 20 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_bbox");
  });

  it("400 when the bbox is too large", async () => {
    // Lat range 170.1° exceeds MAX_BBOX_LAT_DEG (170°).
    const res = await request(app).post("/api/datasets/bbox-query").send({ north: 85.1, south: -85, east: 50, west: -100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_bbox");
    expect(res.body.details).toMatch(/too large/i);
  });

  it("accepts optional dataType/waterType filters", async () => {
    const res = await request(app)
      .post("/api/datasets/bbox-query")
      .send({ ...BASE, dataType: "bathymetry", waterType: "saltwater" });
    expect(res.status).toBe(200);
  });

  it("normalizes out-of-range longitudes and clamps latitudes", async () => {
    // west=190 wraps to -170, east=-170 stays -170 → east<west → antimeridian.
    // Instead exercise normalization happy-path: send east=190 (→-170),
    // west=170, north=95 (→clamp 90), south=80 → bbox becomes
    // {north:90,south:80,east:-170,west:170} → east<west → antimeridian.
    // Use east=200 (→-160), west=-170 → {east:-160,west:-170} valid 10° wide.
    const res = await request(app)
      .post("/api/datasets/bbox-query")
      .send({ north: 95, south: 80, east: 200, west: -170 });
    expect(res.status).toBe(200);
    expect(res.body.bbox).toEqual({ north: 90, south: 80, east: -160, west: -170 });
  });

  it("400 when dataType is invalid", async () => {
    const res = await request(app)
      .post("/api/datasets/bbox-query")
      .send({ ...BASE, dataType: "weather" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});
