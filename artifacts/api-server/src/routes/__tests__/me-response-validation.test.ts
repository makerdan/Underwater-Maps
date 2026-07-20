/**
 * me-response-validation.test.ts
 *
 * Confirms that GET /api/me/export and DELETE /api/me/account return a
 * structured 500 — not a crash — when their response schemas reject the
 * data produced by the handler.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const schemaState = vi.hoisted(() => ({
  throwExportUserDataResponse: false,
  throwDeleteAccountResponse: false,
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    ExportUserDataResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwExportUserDataResponse) throw new Error("bad shape: ExportUserDataResponse");
        return x;
      },
    },
    DeleteAccountResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwDeleteAccountResponse) throw new Error("bad shape: DeleteAccountResponse");
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

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  markersTable: { userId: "userId" },
  catchEntriesTable: { userId: "userId" },
  routesTable: { userId: "userId" },
  gpsTrailsTable: { userId: "userId" },
  gpsTrailPointsTable: { trailId: "trailId" },
  customDatasetsTable: { userId: "userId" },
  datasetFoldersTable: { userId: "userId" },
  userCatalogSavesTable: { userId: "userId" },
  userSettingsTable: { userId: "userId" },
  trollingPresetsTable: { userId: "userId" },
  trollingPresetFoldersTable: { userId: "userId" },
  poeUsageLogTable: {},
  pool: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: "user-me" })),
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

vi.mock("../../lib/clerkAdmin.js", () => ({
  deleteClerkUser: vi.fn(async () => undefined),
}));

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  schemaState.throwExportUserDataResponse = false;
  schemaState.throwDeleteAccountResponse = false;
});

describe("GET /api/me/export — response schema failure → 500", () => {
  it("returns 500 when ExportUserDataResponse.parse() throws", async () => {
    schemaState.throwExportUserDataResponse = true;
    const res = await request(app)
      .get("/api/me/export")
      .set("Authorization", "Bearer e2e-bypass");
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/me/account — response schema failure → 500", () => {
  it("returns 500 when DeleteAccountResponse.parse() throws", async () => {
    schemaState.throwDeleteAccountResponse = true;
    const res = await request(app)
      .delete("/api/me")
      .set("Authorization", "Bearer e2e-bypass");
    expect(res.status).toBe(500);
  });
});
