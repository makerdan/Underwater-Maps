/**
 * catalog-point-radius.test.ts — tests for POST /api/datasets/point-radius-query.
 *
 * The handler runs *before* any DB access, so we only need to stub the
 * search layer. searchCatalog is a spy so tests can assert the derived
 * bbox that reaches the search layer (latitude correction, parity with
 * an equivalent bbox query).
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

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
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
    GetMarkersResponse: { parse: (x: unknown) => x },
    GetMarkersResponseItem: { parse: (x: unknown) => x },
    PatchMarkersIdResponse: { parse: (x: unknown) => x },
    DeleteMarkersMineResponse: { parse: (x: unknown) => x },
    GetCatchesResponse: { parse: (x: unknown) => x },
    GetMarkersMarkerIdCatchesResponse: { parse: (x: unknown) => x },
    GetMarkersMarkerIdCatchesResponseItem: { parse: (x: unknown) => x },
    PatchCatchesIdResponse: { parse: (x: unknown) => x },
    PostCatchPhotosUploadUrlResponse: { parse: (x: unknown) => x },
    GetRoutesResponse: { parse: (x: unknown) => x },
    GetRoutesResponseItem: { parse: (x: unknown) => x },
    PatchRouteResponse: { parse: (x: unknown) => x },
    GetTrailsResponse: { parse: (x: unknown) => x },
    GetTrailsResponseItem: { parse: (x: unknown) => x },
    ExportUserDataResponse: { parse: (x: unknown) => x },
    DeleteAccountResponse: { parse: (x: unknown) => x },
    PostUserDatasetsIdGeorefResponse: { parse: (x: unknown) => x },
    GetUserDatasetsIdHyd93FeaturesResponse: { parse: (x: unknown) => x },
    GetDatasetZonesResponse: { parse: (x: unknown) => x },
    GetTerrainLandResponse: { parse: (x: unknown) => x },
    GetDatasetsIdPreviewResponse: { parse: (x: unknown) => x },
    GetTerrainDownloadInfoResponse: { parse: (x: unknown) => x },
    GetUploadJobStatusResponse: { parse: (x: unknown) => x },
  };
});

const SAMPLE_RESULT = {
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
};

vi.mock("../../lib/catalogSeeder.js", () => ({
  seedDatasetCatalog: vi.fn(async () => {}),
  getCatalogEntries: vi.fn(async () => []),
  searchCatalog: vi.fn(async () => [SAMPLE_RESULT]),
}));

import app from "../../app.js";
import { searchCatalog } from "../../lib/catalogSeeder.js";

const searchCatalogMock = vi.mocked(searchCatalog);

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  searchCatalogMock.mockClear();
});

// Thorne Bay, Alaska — the app's home turf; high latitude exercises the
// longitude-widening correction.
const BASE = { lat: 55.7, lon: -132.45, radius: 10 };

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQUATOR = 111.32;

describe("POST /api/datasets/point-radius-query", () => {
  it("returns datasets for a valid point + radius", async () => {
    const res = await request(app).post("/api/datasets/point-radius-query").send(BASE);
    expect(res.status).toBe(200);
    expect(res.body.center).toEqual({ lat: 55.7, lon: -132.45 });
    expect(res.body.radiusKm).toBe(10);
    expect(res.body.datasets).toHaveLength(1);
    expect(res.body.datasets[0].id).toBe("preset-thorne-bay");
    expect(res.body.datasets[0].relevanceScore).toBe(0.9);
    // bbox is returned so the client can render the searched area
    expect(res.body.bbox.north).toBeGreaterThan(BASE.lat);
    expect(res.body.bbox.south).toBeLessThan(BASE.lat);
  });

  it("applies latitude-aware longitude widening (Alaska latitudes)", async () => {
    const res = await request(app).post("/api/datasets/point-radius-query").send(BASE);
    expect(res.status).toBe(200);
    const { north, south, east, west } = res.body.bbox;

    const latDelta = 10 / KM_PER_DEG_LAT;
    const lonDelta = 10 / (KM_PER_DEG_LON_EQUATOR * Math.cos((55.7 * Math.PI) / 180));
    expect(north).toBeCloseTo(55.7 + latDelta, 6);
    expect(south).toBeCloseTo(55.7 - latDelta, 6);
    expect(east).toBeCloseTo(-132.45 + lonDelta, 6);
    expect(west).toBeCloseTo(-132.45 - lonDelta, 6);

    // At 55.7°N the lon half-span must be wider than the lat half-span.
    expect(east - west).toBeGreaterThan(north - south);

    // The same bbox is what reaches the search layer.
    expect(searchCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        minLon: west,
        maxLon: east,
        minLat: south,
        maxLat: north,
      }),
    );
  });

  it("longitude span equals latitude span at the equator", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ lat: 0, lon: 0, radius: 10 });
    expect(res.status).toBe(200);
    const { north, south, east, west } = res.body.bbox;
    // 111.32 vs 110.574 km/deg — spans are nearly (not exactly) equal.
    expect(east - west).toBeCloseTo((north - south) * (KM_PER_DEG_LAT / KM_PER_DEG_LON_EQUATOR), 6);
  });

  it("matches results of an equivalent bbox query", async () => {
    const prRes = await request(app).post("/api/datasets/point-radius-query").send(BASE);
    expect(prRes.status).toBe(200);
    const bboxRes = await request(app).post("/api/datasets/bbox-query").send(prRes.body.bbox);
    expect(bboxRes.status).toBe(200);
    expect(bboxRes.body.datasets).toEqual(prRes.body.datasets);
  });

  it("converts nautical miles to kilometers", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ ...BASE, radius: 10, unit: "nmi" });
    expect(res.status).toBe(200);
    expect(res.body.radiusKm).toBeCloseTo(18.52, 6);
  });

  it("400 when fields are missing or non-numeric", async () => {
    const res = await request(app).post("/api/datasets/point-radius-query").send({ lat: 55.7 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("400 when lat/lon/radius are non-finite", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ lat: "NaN", lon: -132, radius: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("400 when lat is out of range", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ ...BASE, lat: 90.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_point");
  });

  it("normalizes out-of-range longitudes", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ ...BASE, lon: 227.55 }); // wraps to -132.45
    expect(res.status).toBe(200);
    expect(res.body.center.lon).toBeCloseTo(-132.45, 6);
  });

  it("400 when radius is below the minimum", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ ...BASE, radius: 0.001 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_radius");
    expect(res.body.details).toMatch(/too small/i);
  });

  it("400 when radius is zero or negative", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ ...BASE, radius: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_radius");
  });

  it("400 when radius exceeds the maximum cap", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ lat: 0, lon: 0, radius: 9500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_radius");
    expect(res.body.details).toMatch(/too large/i);
  });

  it("400 when the circle spans too much longitude near a pole", async () => {
    // At 89.9°N, cos(lat) ≈ 0.0017 — even a modest radius blows past 180° lon.
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ lat: 89.9, lon: 0, radius: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_radius");
    expect(res.body.details).toMatch(/pole/i);
  });

  it("400 when the circle crosses the antimeridian", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ lat: 52, lon: 179.9, radius: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_bbox");
    expect(res.body.details).toMatch(/antimeridian/i);
  });

  it("accepts optional dataType/waterType filters and forwards them", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ ...BASE, dataType: "bathymetry", waterType: "saltwater" });
    expect(res.status).toBe(200);
    expect(searchCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ dataType: "bathymetry", waterType: "saltwater" }),
    );
  });

  it("400 when dataType is invalid", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ ...BASE, dataType: "weather" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("400 when unit is invalid", async () => {
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ ...BASE, unit: "miles" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});
