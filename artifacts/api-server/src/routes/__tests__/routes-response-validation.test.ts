/**
 * routes-response-validation.test.ts
 *
 * Confirms that GET /api/routes and PATCH /api/routes/:id return a structured
 * 500 — not a crash — when their response schema rejects the DB output.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const schemaState = vi.hoisted(() => ({
  throwGetRoutesResponse: false,
  throwPatchRouteResponse: false,
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    GetRoutesResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwGetRoutesResponse) throw new Error("bad shape: GetRoutesResponse");
        return x;
      },
    },
    GetRoutesResponseItem: { parse: (x: unknown) => x },
    PatchRouteResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwPatchRouteResponse) throw new Error("bad shape: PatchRouteResponse");
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

const ROUTE_UUID = "00000000-0000-0000-0000-000000000001";

const ROUTE_ROW = {
  id: ROUTE_UUID,
  userId: "user-val",
  datasetId: "ds-1",
  name: "Test Route",
  waypoints: [],
  folderId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock("@workspace/db", () => {
  const routesTable = { __tableName: "routes" };

  const select = () => ({
    from: () => ({
      where: () => ({
        orderBy: () => Promise.resolve([ROUTE_ROW]),
      }),
    }),
  });
  const update = () => ({
    set: () => ({
      where: () => ({ returning: () => Promise.resolve([ROUTE_ROW]) }),
    }),
  });

  return {
    db: { select, update, delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) },
    routesTable,
    userSettingsTable: {},
    markersTable: {},
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

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => null,
  eq: (..._args: unknown[]) => null,
  asc: (..._args: unknown[]) => null,
  or: (..._args: unknown[]) => null,
  inArray: (..._args: unknown[]) => null,
  lt: (..._args: unknown[]) => null,
}));

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

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  schemaState.throwGetRoutesResponse = false;
  schemaState.throwPatchRouteResponse = false;
});

describe("GET /api/routes — response schema failure → 500", () => {
  it("returns 500 when GetRoutesResponse.parse() throws", async () => {
    schemaState.throwGetRoutesResponse = true;
    const res = await request(app)
      .get("/api/routes?datasetId=ds-1")
      .set("Authorization", "Bearer e2e-bypass");
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/routes/:id — response schema failure → 500", () => {
  it("returns 500 when PatchRouteResponse.parse() throws", async () => {
    schemaState.throwPatchRouteResponse = true;
    const res = await request(app)
      .patch(`/api/routes/${ROUTE_UUID}`)
      .set("Authorization", "Bearer e2e-bypass")
      .send({ name: "Renamed" });
    expect(res.status).toBe(500);
  });
});
