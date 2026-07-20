/**
 * catalog-saves-response-validation.test.ts
 *
 * Confirms that GET /api/datasets/catalog, GET /api/datasets/catalog/search,
 * POST /api/datasets/bbox-query, POST /api/datasets/point-radius-query, and
 * GET /api/datasets/my-saves return a structured 500 when their response
 * schemas reject the handler's output.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const schemaState = vi.hoisted(() => ({
  throwGetDatasetsCatalogResponse: false,
  throwGetDatasetsCatalogSearchResponse: false,
  throwPostDatasetsBboxQueryResponse: false,
  throwPostDatasetsPointRadiusQueryResponse: false,
  throwGetDatasetsMySavesResponse: false,
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    GetDatasetsCatalogResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwGetDatasetsCatalogResponse) throw new Error("bad shape: GetDatasetsCatalogResponse");
        return x;
      },
    },
    GetDatasetsCatalogSearchResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwGetDatasetsCatalogSearchResponse) throw new Error("bad shape: GetDatasetsCatalogSearchResponse");
        return x;
      },
    },
    PostDatasetsBboxQueryResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwPostDatasetsBboxQueryResponse) throw new Error("bad shape: PostDatasetsBboxQueryResponse");
        return x;
      },
    },
    PostDatasetsPointRadiusQueryResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwPostDatasetsPointRadiusQueryResponse) throw new Error("bad shape: PostDatasetsPointRadiusQueryResponse");
        return x;
      },
    },
    GetDatasetsMySavesResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwGetDatasetsMySavesResponse) throw new Error("bad shape: GetDatasetsMySavesResponse");
        return x;
      },
    },
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

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Object.assign(Promise.resolve([]), {
          orderBy: () => Promise.resolve([]),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve([]), returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  userSettingsTable: { userId: "__col__" },
  userCatalogSavesTable: {
    id: "id", userId: "userId", catalogId: "catalogId", status: "status",
    requestedAt: "requestedAt", readyAt: "readyAt", cacheKey: "cacheKey",
    errorMessage: "errorMessage", folderId: "folderId", datasetId: "datasetId",
  },
  customDatasetsTable: {},
  datasetFoldersTable: {},
  datasetCatalogTable: {},
  markersTable: {},
  routesTable: {},
  gpsTrailsTable: {},
  trollingPresetsTable: {},
  trollingPresetFoldersTable: {},
  poeUsageLogTable: {},
  pool: {},
}));

vi.mock("../../lib/logger.js");

vi.mock("../catalog.js", () => ({
  getCatalogEntries: vi.fn(async () => []),
  searchCatalog: vi.fn(async () => []),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: "user-cat" })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return { ...actual, getPoeClient: vi.fn(() => ({})) };
});

import app from "../../app.js";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  schemaState.throwGetDatasetsCatalogResponse = false;
  schemaState.throwGetDatasetsCatalogSearchResponse = false;
  schemaState.throwPostDatasetsBboxQueryResponse = false;
  schemaState.throwPostDatasetsPointRadiusQueryResponse = false;
  schemaState.throwGetDatasetsMySavesResponse = false;
});

describe("GET /api/datasets/catalog — response schema failure → 500", () => {
  it("returns 500 when GetDatasetsCatalogResponse.parse() throws", async () => {
    schemaState.throwGetDatasetsCatalogResponse = true;
    const res = await request(app).get("/api/datasets/catalog");
    expect(res.status).toBe(500);
  });
});

describe("GET /api/datasets/catalog/search — response schema failure → 500", () => {
  it("returns 500 when GetDatasetsCatalogSearchResponse.parse() throws", async () => {
    schemaState.throwGetDatasetsCatalogSearchResponse = true;
    const res = await request(app)
      .get("/api/datasets/catalog/search?q=salmon");
    expect(res.status).toBe(500);
  });
});

describe("POST /api/datasets/bbox-query — response schema failure → 500", () => {
  it("returns 500 when PostDatasetsBboxQueryResponse.parse() throws", async () => {
    schemaState.throwPostDatasetsBboxQueryResponse = true;
    const res = await request(app)
      .post("/api/datasets/bbox-query")
      .send({ north: 48, south: 47, east: -122, west: -123 });
    expect(res.status).toBe(500);
  });
});

describe("POST /api/datasets/point-radius-query — response schema failure → 500", () => {
  it("returns 500 when PostDatasetsPointRadiusQueryResponse.parse() throws", async () => {
    schemaState.throwPostDatasetsPointRadiusQueryResponse = true;
    const res = await request(app)
      .post("/api/datasets/point-radius-query")
      .send({ lat: 47.5, lon: -122.5, radius: 50 });
    expect(res.status).toBe(500);
  });
});

describe("GET /api/datasets/my-saves — response schema failure → 500", () => {
  it("returns 500 when GetDatasetsMySavesResponse.parse() throws", async () => {
    schemaState.throwGetDatasetsMySavesResponse = true;
    const res = await request(app)
      .get("/api/datasets/my-saves")
      .set("Authorization", "Bearer e2e-bypass");
    expect(res.status).toBe(500);
  });
});
