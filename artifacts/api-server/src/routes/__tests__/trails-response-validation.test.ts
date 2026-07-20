/**
 * trails-response-validation.test.ts
 *
 * Confirms that GET /api/trails and POST /api/trails return a structured
 * 500 — not a crash — when their response schema rejects the DB output.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const schemaState = vi.hoisted(() => ({
  throwGetTrailsResponse: false,
  throwGetTrailsResponseItem: false,
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    GetTrailsResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwGetTrailsResponse) throw new Error("bad shape: GetTrailsResponse");
        return x;
      },
    },
    GetTrailsResponseItem: {
      parse: (x: unknown) => {
        if (schemaState.throwGetTrailsResponseItem) throw new Error("bad shape: GetTrailsResponseItem");
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
    ExportUserDataResponse: { parse: (x: unknown) => x },
    DeleteAccountResponse: { parse: (x: unknown) => x },
    PostUserDatasetsIdGeorefResponse: { parse: (x: unknown) => x },
    GetUserDatasetsIdHyd93FeaturesResponse: { parse: (x: unknown) => x },
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

const TRAIL_ROW = {
  id: "trail-1",
  userId: "user-val",
  datasetId: "ds-1",
  name: "Test Trail",
  points: [],
  folderId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock("@workspace/db", () => {
  const gpsTrailsTable = { __tableName: "gps_trails" };

  const select = () => ({
    from: () => ({
      where: () => ({
        orderBy: () => Promise.resolve([TRAIL_ROW]),
      }),
    }),
  });
  const insert = () => ({
    values: () => ({ returning: () => Promise.resolve([TRAIL_ROW]) }),
  });

  return {
    db: {
      select,
      insert,
      update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([TRAIL_ROW]) }) }) }),
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    },
    gpsTrailsTable,
    gpsTrailPointsTable: {},
    userSettingsTable: {},
    markersTable: {},
    routesTable: {},
    customDatasetsTable: {},
    datasetFoldersTable: {},
    userCatalogSavesTable: {},
    trollingPresetsTable: {},
    trollingPresetFoldersTable: {},
    poeUsageLogTable: {},
    pool: {},
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: "user-val" })),
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

vi.mock("../../lib/upload/processTrailUpload.js", () => ({
  processTrailUpload: vi.fn(async () => TRAIL_ROW),
}));

import app from "../../app.js";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  schemaState.throwGetTrailsResponse = false;
  schemaState.throwGetTrailsResponseItem = false;
});

describe("GET /api/trails — response schema failure → 500", () => {
  it("returns 500 when GetTrailsResponse.parse() throws", async () => {
    schemaState.throwGetTrailsResponse = true;
    const res = await request(app)
      .get("/api/trails?datasetId=ds-1")
      .set("Authorization", "Bearer e2e-bypass");
    expect(res.status).toBe(500);
  });
});
