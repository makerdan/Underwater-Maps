/**
 * settings-put-response-validation.test.ts
 *
 * Confirms that PUT /api/settings returns a structured 500 — not a crash —
 * when GetSettingsResponse.parse() rejects the settings object after a
 * successful DB write. This validates the response validation path added
 * to the PUT handler in settings.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const schemaState = vi.hoisted(() => ({
  throwOnParse: false,
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    GetSettingsResponse: {
      parse: (x: unknown) => {
        if (schemaState.throwOnParse) throw new Error("bad shape: GetSettingsResponse");
        return (actual.GetSettingsResponse as { parse: (x: unknown) => unknown }).parse(x);
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
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve([]),
        returning: () => Promise.resolve([]),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  userSettingsTable: { userId: "__col__" },
  markersTable: {},
  routesTable: {},
  gpsTrailsTable: {},
  gpsTrailPointsTable: {},
  customDatasetsTable: {},
  datasetFoldersTable: {},
  userCatalogSavesTable: {
    id: "id", userId: "userId", catalogId: "catalogId", status: "status",
    requestedAt: "requestedAt", readyAt: "readyAt", cacheKey: "cacheKey",
    errorMessage: "errorMessage", folderId: "folderId", datasetId: "datasetId",
  },
  datasetCatalogTable: {},
  trollingPresetsTable: {},
  trollingPresetFoldersTable: {},
  poeUsageLogTable: {},
  pool: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: "user-settings-put" })),
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
  schemaState.throwOnParse = false;
});

describe("PUT /api/settings — response schema failure → 500", () => {
  it("returns 200 with valid body when schema passes", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set("Authorization", "Bearer e2e-bypass")
      .send({});
    expect(res.status).toBe(200);
  });

  it("returns 500 when GetSettingsResponse.parse() throws after DB write", async () => {
    schemaState.throwOnParse = true;
    const res = await request(app)
      .put("/api/settings")
      .set("Authorization", "Bearer e2e-bypass")
      .send({});
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "internal_error" });
  });
});
