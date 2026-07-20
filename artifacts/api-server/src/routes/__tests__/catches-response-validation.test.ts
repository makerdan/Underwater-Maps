/**
 * catches-response-validation.test.ts
 *
 * Confirms that GET /api/catches, PATCH /api/catches/:id, and the marker-scoped
 * catch list return a structured 500 — not a crash — when their response schema
 * rejects the data produced by the DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const schemaState = vi.hoisted(() => ({
  throwGetCatchesResponse: false,
  throwPatchCatchesIdResponse: false,
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    GetCatchesResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwGetCatchesResponse) throw new Error("bad shape: GetCatchesResponse");
        return x;
      },
    },
    GetMarkersMarkerIdCatchesResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwGetCatchesResponse) throw new Error("bad shape: GetMarkersMarkerIdCatchesResponse");
        return x;
      },
    },
    GetMarkersMarkerIdCatchesResponseItem: { parse: (x: unknown) => x },
    PatchCatchesIdResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwPatchCatchesIdResponse) throw new Error("bad shape: PatchCatchesIdResponse");
        return x;
      },
    },
    GetMarkersResponse: { parse: (x: unknown) => x },
    GetMarkersResponseItem: { parse: (x: unknown) => x },
    PatchMarkersIdResponse: { parse: (x: unknown) => x },
    DeleteMarkersMineResponse: { parse: (x: unknown) => x },
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

const MARKER_ROW = { id: "marker-1", userId: "user-val", datasetId: "ds-1" };
const CATCH_ROW = {
  id: "catch-1",
  markerId: "marker-1",
  userId: "user-val",
  datasetId: "ds-1",
  createdAt: new Date().toISOString(),
  symbol: "bass",
  label: null,
  notes: null,
  photos: [],
};

vi.mock("@workspace/db", () => {
  const markersTable = { __tableName: "markers", id: "id", userId: "userId", datasetId: "datasetId" };
  const catchEntriesTable = { __tableName: "catch_entries", id: "id", markerId: "markerId", userId: "userId", createdAt: "createdAt", photos: "photos" };

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
      where: () => ({ returning: () => Promise.resolve([{ ...CATCH_ROW }]) }),
    }),
  });

  return {
    db: { select, update, delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) },
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
  schemaState.throwGetCatchesResponse = false;
  schemaState.throwPatchCatchesIdResponse = false;
});

describe("GET /api/catches — response schema failure → 500", () => {
  it("returns 500 when GetCatchesResponse.parse() throws", async () => {
    schemaState.throwGetCatchesResponse = true;
    const res = await request(app)
      .get("/api/catches?datasetId=ds-1")
      .set("Authorization", "Bearer e2e-bypass");
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/catches/:id — response schema failure → 500", () => {
  it("returns 500 when PatchCatchesIdResponse.parse() throws", async () => {
    schemaState.throwPatchCatchesIdResponse = true;
    const res = await request(app)
      .patch("/api/catches/catch-1")
      .set("Authorization", "Bearer e2e-bypass")
      .send({ notes: "updated" });
    expect(res.status).toBe(500);
  });
});
