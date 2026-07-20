/**
 * markers.test.ts — unit tests for /api/markers
 *
 * Covers:
 *  - 400 for missing datasetId on GET /markers
 *  - 401 for unauthenticated callers
 *  - DB failure on GET /markers returns 500 (not a hanging request), confirming
 *    asyncHandler correctly forwards the rejected promise to Express error
 *    middleware instead of leaving the request open.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

const state: { throwOnSelect: boolean } = { throwOnSelect: false };

vi.mock("@workspace/db", () => {
  const markersTable = { __tableName: "markers" as const };

  const select = () => ({
    from: () => ({
      where: () => ({
        orderBy: () => {
          if (state.throwOnSelect) {
            return Promise.reject(new Error("DB connection lost"));
          }
          return Promise.resolve([]);
        },
      }),
    }),
  });

  return {
    db: { select },
    markersTable,
    catchEntriesTable: { __tableName: "catch_entries" as const, id: "id", markerId: "markerId", userId: "userId", createdAt: "createdAt", photos: "photos" },
    catchCountersTable: { __tableName: "catch_counters" as const, userId: "userId", lastSeq: "lastSeq" },
    pool: { query: () => Promise.resolve({ rows: [] }), connect: async () => ({ release: () => {}, query: async () => ({ rows: [] }) }) },
    userCatalogSavesTable: { __tableName: "user_catalog_saves" as const },
    datasetCatalogTable: { __tableName: "dataset_catalog" as const },
    customDatasetsTable: { __tableName: "custom_datasets" as const },
    userSettingsTable: { __tableName: "user_settings" as const },
    uploadJobsTable: { __tableName: "upload_jobs" as const },
    disabledPresetsTable: { __tableName: "disabled_presets" as const },
    uploadCalibrationTable: { __tableName: "upload_calibration" as const },
    datasetFoldersTable: { __tableName: "dataset_folders" as const },
    routesTable: { __tableName: "routes" as const },
    trollingPresetFoldersTable: { __tableName: "trolling_preset_folders" as const },
    trollingPresetsTable: { __tableName: "trolling_presets" as const },
    gpsTrailsTable: { __tableName: "gps_trails" as const },
    gpsTrailPointsTable: { __tableName: "gps_trail_points" as const },
  };
});

vi.mock("@workspace/api-zod", () => {
  const noErr = { issues: [] } as const;
  return {
    GetMarkersQueryParams: {
      safeParse: (q: Record<string, unknown>) =>
        q["datasetId"]
          ? { success: true, data: { datasetId: q["datasetId"] } }
          : { success: false, error: noErr },
    },
    PostMarkersBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    DeleteMarkersIdParams: { safeParse: () => ({ success: false, error: noErr }) },
    PatchMarkersIdParams: { safeParse: () => ({ success: false, error: noErr }) },
    PatchMarkersIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    // Schemas from other routes mounted by app.ts — referenced via validateBody at module-load time.
    // Stubs must have safeParse so the closure created by validateBody() doesn't throw if the
    // middleware is ever called. Tests in this file never hit these routes.
    PostMarkersMarkerIdCatchesBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchCatchesIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PostRouteBodySchema: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchRouteBodySchema: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PostTrollingPresetsBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchTrollingPresetsIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    DeleteTrollingPresetsIdParams: { safeParse: () => ({ success: false, error: noErr }) },
    PostTrollingPresetFoldersBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchTrollingPresetFoldersIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetCatchesQueryParams: { safeParse: () => ({ success: false, error: noErr }) },
    GetMarkersMarkerIdCatchesParams: { safeParse: () => ({ success: false, error: noErr }) },
    PostMarkersMarkerIdCatchesParams: { safeParse: () => ({ success: false, error: noErr }) },
    PatchCatchesIdParams: { safeParse: () => ({ success: false, error: noErr }) },
    DeleteCatchesIdParams: { safeParse: () => ({ success: false, error: noErr }) },
    GetUserDatasetsResponse: { parse: (x: unknown) => x },
    GetUserDatasetsIdTerrainResponse: { parse: (x: unknown) => x },
    GetUserDatasetsIdOverviewResponse: { parse: (x: unknown) => x },
    PatchUserDatasetsIdMoveBody: { safeParse: () => ({ success: false, error: noErr }) },
    PatchUserDatasetsIdMoveResponse: { parse: (x: unknown) => x },
    PatchUserDatasetsIdRenameBody: { safeParse: () => ({ success: false, error: noErr }) },
    PatchUserDatasetsIdRenameResponse: { parse: (x: unknown) => x },
    GetUserFoldersResponse: { parse: (x: unknown) => x },
    PostUserFoldersBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetRoutesQuerySchema: { safeParse: () => ({ success: false, error: noErr }) },
    RouteIdParamSchema: { safeParse: () => ({ success: false, error: noErr }) },
    PatchUserFoldersIdRenameBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchUserFoldersIdRenameResponse: { parse: (x: unknown) => x },
    PatchUserFoldersIdMoveBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchUserFoldersIdMoveResponse: { parse: (x: unknown) => x },
    DeleteUserFoldersIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetDatasetsResponse: { parse: (x: unknown) => x },
    GetDatasetsIdTerrainResponse: { parse: (x: unknown) => x },
    GetDatasetsIdOverviewResponse: { parse: (x: unknown) => x },
    PostDatasetsUploadResponse: { parse: (x: unknown) => x },
    DeepHealthCheckResponse: { parse: (x: unknown) => x },
    HealthCheckResponse: { parse: (x: unknown) => x },
    NceiSearchQuerySchema: { safeParse: () => ({ success: false, error: noErr }) },
    GetSettingsResponse: { parse: (x: unknown) => x },
    PutSettingsBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
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

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return { ...actual, getPoeClient: vi.fn(() => ({})) };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import app from "../../app.js";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  state.throwOnSelect = false;
});

describe("GET /api/markers", () => {
  it("returns 401 when unauthenticated (no E2E bypass header)", async () => {
    vi.unstubAllEnvs();
    const res = await request(app).get("/api/markers?datasetId=abc");
    expect(res.status).toBe(401);
  });

  it("returns 400 when datasetId query param is missing", async () => {
    const res = await request(app)
      .get("/api/markers")
      .set("x-e2e-user-id", "user-markers-400");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 500 (not a timeout) when the database throws", async () => {
    state.throwOnSelect = true;
    const res = await request(app)
      .get("/api/markers?datasetId=test-dataset")
      .set("x-e2e-user-id", "user-markers-db-fail");
    expect(res.status).toBe(500);
  });

  it("returns 200 with an array when the DB succeeds", async () => {
    const res = await request(app)
      .get("/api/markers?datasetId=test-dataset")
      .set("x-e2e-user-id", "user-markers-ok");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/markers — safeParse rejection (400) negative tests
//
// The PostMarkersBody mock always returns { success: false } so the route
// must reply 400 with { error: "invalid_request" } for any body. These tests
// document the expected 400 contract for each class of invalid input:
//   • missing required field (no body at all)
//   • wrong type (lon supplied as a string)
//   • extra-invalid: empty object (all required fields absent)
// ---------------------------------------------------------------------------

describe("POST /api/markers — safeParse rejection (400)", () => {
  it("returns 400 with error: invalid_request when the body is completely absent", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set("x-e2e-user-id", "user-markers-post-400")
      .set("content-type", "application/json")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when required field 'label' is missing from the body", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set("x-e2e-user-id", "user-markers-post-400")
      .send({ datasetId: "ds-1", lon: -136.0, lat: 58.5, depth: 50 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when 'lon' is supplied as a string (wrong type)", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set("x-e2e-user-id", "user-markers-post-400")
      .send({ datasetId: "ds-1", lon: "not-a-number", lat: 58.5, depth: 50, label: "Test" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 401 when POSTing without auth (no bypass header)", async () => {
    vi.unstubAllEnvs();
    const res = await request(app)
      .post("/api/markers")
      .send({ datasetId: "ds-1", lon: -136.0, lat: 58.5, depth: 50, label: "Test" });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/markers/:id — safeParse rejection (400) negative tests
//
// PatchMarkersIdParams mock always returns { success: false }, so the route
// replies 400 for any :id before even inspecting the body.
// ---------------------------------------------------------------------------

describe("PATCH /api/markers/:id — safeParse rejection (400)", () => {
  it("returns 400 with error: invalid_request for any marker id (params validation)", async () => {
    const res = await request(app)
      .patch("/api/markers/not-a-uuid")
      .set("x-e2e-user-id", "user-markers-patch-400")
      .send({ label: "Updated" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 with error: invalid_request for a well-formed UUID id (params mock rejects all)", async () => {
    const res = await request(app)
      .patch("/api/markers/00000000-0000-0000-0000-000000000001")
      .set("x-e2e-user-id", "user-markers-patch-400")
      .send({ label: "Updated" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });
});

// ---------------------------------------------------------------------------
// Explicit teardown — release mock closures so the V8 heap can reclaim
// the vi.importActual(@workspace/poe) module registry promptly.  In the
// singleFork queue this file runs at position 2 (right after portFailFast),
// but the explicit restoreAllMocks call below guarantees the mock references
// are cleared even if the sequencer order changes in the future.
// ---------------------------------------------------------------------------
afterAll(() => {
  vi.restoreAllMocks();
});
