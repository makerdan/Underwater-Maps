/**
 * user-datasets-response-validation.test.ts
 *
 * Confirms that POST /api/user-datasets/:id/georef and
 * GET /api/user-datasets/:id/hyd93-features return a structured 500 —
 * not a crash — when their response schemas reject the handler output.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const schemaState = vi.hoisted(() => ({
  throwPostUserDatasetsIdGeorefResponse: false,
  throwGetUserDatasetsIdHyd93FeaturesResponse: false,
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    PostUserDatasetsIdGeorefResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwPostUserDatasetsIdGeorefResponse) throw new Error("bad shape: PostUserDatasetsIdGeorefResponse");
        return x;
      },
    },
    GetUserDatasetsIdHyd93FeaturesResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwGetUserDatasetsIdHyd93FeaturesResponse) throw new Error("bad shape: GetUserDatasetsIdHyd93FeaturesResponse");
        return x;
      },
    },
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
    GetDatasetsCatalogResponse: { parse: (x: unknown) => x },
    GetDatasetsCatalogSearchResponse: { parse: (x: unknown) => x },
    PostDatasetsBboxQueryResponse: { parse: (x: unknown) => x },
    PostDatasetsPointRadiusQueryResponse: { parse: (x: unknown) => x },
    GetDatasetsMySavesResponse: { parse: (x: unknown) => x },
    GetDatasetsMySavesResponseItem: { parse: (x: unknown) => x },
    GetDatasetsMySavesIdStatusResponse: { parse: (x: unknown) => x },
    PostDatasetsMySavesIdRetryResponse: { parse: (x: unknown) => x },
    PatchDatasetsMySavesIdRenameResponse: { parse: (x: unknown) => x },
    PatchDatasetsMySavesIdMoveResponse: { parse: (x: unknown) => x },
    GetDatasetZonesResponse: { parse: (x: unknown) => x },
    GetTerrainLandResponse: { parse: (x: unknown) => x },
    GetDatasetsIdPreviewResponse: { parse: (x: unknown) => x },
    GetTerrainDownloadInfoResponse: { parse: (x: unknown) => x },
    GetUploadJobStatusResponse: { parse: (x: unknown) => x },
  };
});

const DATASET_ROW = {
  id: "ds-user-1",
  userId: "user-ud",
  name: "My Upload",
  status: "ready" as const,
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  sourceType: "bag" as const,
  folderId: null,
  geoTiffKey: null,
  bagKey: null,
  csvKey: null,
  jobId: null,
  errorMessage: null,
  georefAnchors: null,
  hyd93Enabled: false,
  hyd93Features: [],
  hyd93FeaturesJson: [],
  needsGeoreferencing: true,
  pendingRasterGzBase64: null,
  minDepth: 0,
  maxDepth: 100,
};

vi.mock("@workspace/db", () => {
  const customDatasetsTable = { __tableName: "custom_datasets" };

  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([DATASET_ROW]),
        }),
      }),
      update: () => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([DATASET_ROW]) }) }),
      }),
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    },
    customDatasetsTable,
    datasetFoldersTable: {},
    userSettingsTable: {},
    markersTable: {},
    routesTable: {},
    gpsTrailsTable: {},
    userCatalogSavesTable: {},
    trollingPresetsTable: {},
    trollingPresetFoldersTable: {},
    poeUsageLogTable: {},
    pool: {},
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: "user-ud" })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("../../lib/logger.js");

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return { ...actual, getPoeClient: vi.fn(() => ({})) };
});

import app from "../../app.js";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  schemaState.throwPostUserDatasetsIdGeorefResponse = false;
  schemaState.throwGetUserDatasetsIdHyd93FeaturesResponse = false;
});

describe("POST /api/user-datasets/:id/georef — response schema failure → 500", () => {
  it("returns 500 when PostUserDatasetsIdGeorefResponse.parse() throws", async () => {
    schemaState.throwPostUserDatasetsIdGeorefResponse = true;
    const res = await request(app)
      .post("/api/user/datasets/ds-user-1/georef")
      .set("Authorization", "Bearer e2e-bypass")
      .send({
        controlPoints: [
          { px: 0, py: 0, lon: -122.0, lat: 47.0 },
          { px: 100, py: 100, lon: -121.0, lat: 46.0 },
        ],
      });
    expect(res.status).toBe(500);
  });
});

describe("GET /api/user-datasets/:id/hyd93-features — response schema failure → 500", () => {
  it("returns 500 when GetUserDatasetsIdHyd93FeaturesResponse.parse() throws", async () => {
    schemaState.throwGetUserDatasetsIdHyd93FeaturesResponse = true;
    const res = await request(app)
      .get("/api/user/datasets/ds-user-1/hyd93-features")
      .set("Authorization", "Bearer e2e-bypass");
    expect(res.status).toBe(500);
  });
});
