/**
 * markers-response-validation.test.ts
 *
 * Confirms that GET /api/markers, GET /api/markers/:id/catches, PATCH /api/markers/:id,
 * and DELETE /api/markers/mine return a structured 500 (not a crash) when their
 * response schema rejects the data produced by the DB.
 *
 * Strategy: mock the response schemas in @workspace/api-zod to throw on demand
 * via a per-test mutable flag. The rest of the mock is passthrough so the app
 * can boot normally. DB mock returns minimal valid-looking rows; schema mock
 * then rejects them to simulate a shape mismatch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const schemaState = vi.hoisted(() => ({
  throwGetMarkersResponse: false,
  throwGetMarkersMarkerIdCatchesResponse: false,
  throwPatchMarkersIdResponse: false,
  throwDeleteMarkersMineResponse: false,
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    GetMarkersResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwGetMarkersResponse) throw new Error("bad shape: GetMarkersResponse");
        return x;
      },
    },
    GetMarkersResponseItem: { parse: (x: unknown) => x },
    GetMarkersMarkerIdCatchesResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwGetMarkersMarkerIdCatchesResponse) throw new Error("bad shape: GetMarkersMarkerIdCatchesResponse");
        return x;
      },
    },
    GetMarkersMarkerIdCatchesResponseItem: { parse: (x: unknown) => x },
    PatchMarkersIdResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwPatchMarkersIdResponse) throw new Error("bad shape: PatchMarkersIdResponse");
        return x;
      },
    },
    DeleteMarkersMineResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwDeleteMarkersMineResponse) throw new Error("bad shape: DeleteMarkersMineResponse");
        return x;
      },
    },
    GetCatchesResponse: { parse: (x: unknown) => x },
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

const MARKER_ROW = {
  id: "marker-1",
  datasetId: "ds-1",
  userId: "user-val",
  lat: 40.0,
  lon: -73.0,
  depth: 10,
  symbol: "fish",
  label: null,
  notes: null,
  photos: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const CATCH_ROW = {
  id: "catch-1",
  markerId: "marker-1",
  userId: "user-val",
  createdAt: new Date().toISOString(),
  symbol: "bass",
  label: null,
  notes: null,
  photos: [],
  weight: null,
  length: null,
};

vi.mock("@workspace/db", () => {
  const markersTable = { __tableName: "markers", id: "id", userId: "userId", datasetId: "datasetId" };
  const catchEntriesTable = { __tableName: "catch_entries", id: "id", markerId: "markerId", userId: "userId" };

  const select = () => ({
    from: (tbl: { __tableName: string }) => ({
      where: () => Object.assign(
        Promise.resolve(tbl.__tableName === "markers" ? [MARKER_ROW] : [CATCH_ROW]),
        { orderBy: () => Promise.resolve(tbl.__tableName === "markers" ? [MARKER_ROW] : [CATCH_ROW]) },
      ),
    }),
  });
  const update = () => ({
    set: () => ({
      where: () => ({ returning: () => Promise.resolve([MARKER_ROW]) }),
    }),
  });
  const del = () => ({
    where: () => ({ returning: () => Promise.resolve([{ id: "marker-1" }]) }),
  });

  return {
    db: { select, update, delete: del },
    markersTable,
    catchEntriesTable,
    userSettingsTable: {},
    routesTable: {},
    gpsTrailsTable: {},
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

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

beforeEach(() => {
  __resetRateLimitMemory();
});

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  schemaState.throwGetMarkersResponse = false;
  schemaState.throwGetMarkersMarkerIdCatchesResponse = false;
  schemaState.throwPatchMarkersIdResponse = false;
  schemaState.throwDeleteMarkersMineResponse = false;
});

describe("GET /api/markers — response schema failure → 500", () => {
  it("returns 500 when GetMarkersResponse.parse() throws", async () => {
    schemaState.throwGetMarkersResponse = true;
    const res = await request(app)
      .get("/api/markers?datasetId=ds-1")
      .set("Authorization", "Bearer e2e-bypass");
    expect(res.status).toBe(500);
  });
});

describe("GET /api/markers/:id/catches — response schema failure → 500", () => {
  it("returns 500 when GetMarkersMarkerIdCatchesResponse.parse() throws", async () => {
    schemaState.throwGetMarkersMarkerIdCatchesResponse = true;
    const res = await request(app)
      .get("/api/markers/marker-1/catches")
      .set("Authorization", "Bearer e2e-bypass");
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/markers/:id — response schema failure → 500", () => {
  it("returns 500 when PatchMarkersIdResponse.parse() throws", async () => {
    schemaState.throwPatchMarkersIdResponse = true;
    const res = await request(app)
      .patch("/api/markers/marker-1")
      .set("Authorization", "Bearer e2e-bypass")
      .send({ label: "updated" });
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/markers/mine — response schema failure → 500", () => {
  it("returns 500 when DeleteMarkersMineResponse.parse() throws", async () => {
    schemaState.throwDeleteMarkersMineResponse = true;
    const res = await request(app)
      .delete("/api/markers/mine")
      .set("Authorization", "Bearer e2e-bypass")
      .send({ datasetId: "ds-1" });
    expect(res.status).toBe(500);
  });
});
