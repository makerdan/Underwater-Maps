/**
 * markers-delete-cross-tenant.test.ts
 *
 * Security regression: DELETE /api/markers/:id prefetches catch-entry photo
 * paths for best-effort cleanup.  Before the fix the WHERE clause was scoped
 * only by markerId — an attacker could supply another user's marker UUID and
 * the handler would SELECT that user's photo storage paths even though the
 * subsequent DELETE is correctly owner-scoped and returns 404.
 *
 * After the fix the prefetch also filters by userId, so a cross-tenant request
 * cannot observe (or log) another user's catch-entry photo paths.
 *
 * Test strategy
 * ─────────────
 * The @workspace/db mock records the argument passed to the final .where()
 * call on the catchEntriesTable SELECT chain.  Because the route uses the real
 * drizzle-orm `and()` / `eq()` helpers, the resulting SQL expression tree
 * contains the literal userId value.  We JSON-serialize the captured arg and
 * assert the requesting user's ID appears in it — proving that userId was
 * included in the predicate, not just markerId.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

const VALID_MARKER_UUID = "00000000-0000-0000-0000-000000000099";

// Capture the WHERE argument supplied to the catch-entry SELECT.
let capturedCatchEntriesWhereArg: unknown = undefined;

const state = {
  deletedMarkerRows: [] as Array<{ id: string }>,
};

vi.mock("@workspace/db", () => {
  const markersTable = { __tableName: "markers" as const, id: "id", userId: "userId" };
  const catchEntriesTable = {
    __tableName: "catch_entries" as const,
    markerId: "markerId",
    // userId MUST be a distinct field name so we can verify it appears in the
    // captured where expression.
    userId: "userId",
    photos: "photos",
  };
  const catchCountersTable = { __tableName: "catch_counters" as const, userId: "userId", lastSeq: "lastSeq" };

  const select = () => ({
    from: (table: { __tableName: string }) => ({
      where: (arg: unknown) => {
        if (table.__tableName === "catch_entries") {
          capturedCatchEntriesWhereArg = arg;
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
    }),
  });

  const del = () => ({
    where: () => ({
      returning: () => Promise.resolve(state.deletedMarkerRows),
    }),
  });

  return {
    db: { select, delete: del },
    markersTable,
    catchEntriesTable,
    catchCountersTable,
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
  const uuidParse = (key: string) => ({
    safeParse: (p: Record<string, unknown>) => {
      const v = p[key];
      return typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)
        ? { success: true, data: { [key]: v } }
        : { success: false, error: noErr };
    },
  });

  return {
    GetMarkersQueryParams: { safeParse: () => ({ success: false, error: noErr }) },
    PostMarkersBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchMarkersIdParams: uuidParse("id"),
    PatchMarkersIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    DeleteMarkersIdParams: uuidParse("id"),
    GetCatchesQueryParams: { safeParse: () => ({ success: false, error: noErr }) },
    GetMarkersMarkerIdCatchesParams: { safeParse: () => ({ success: false, error: noErr }) },
    PostMarkersMarkerIdCatchesParams: { safeParse: () => ({ success: false, error: noErr }) },
    PostMarkersMarkerIdCatchesBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchCatchesIdParams: { safeParse: () => ({ success: false, error: noErr }) },
    PatchCatchesIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    DeleteCatchesIdParams: { safeParse: () => ({ success: false, error: noErr }) },
    GetUserDatasetsResponse: { parse: (x: unknown) => x },
    GetUserDatasetsIdTerrainResponse: { parse: (x: unknown) => x },
    GetUserDatasetsIdOverviewResponse: { parse: (x: unknown) => x },
    PatchUserDatasetsIdMoveBody: { safeParse: () => ({ success: false, error: noErr }) },
    PatchUserDatasetsIdMoveResponse: { parse: (x: unknown) => x },
    PatchUserDatasetsIdRenameBody: { safeParse: () => ({ success: false, error: noErr }) },
    PatchUserDatasetsIdRenameResponse: { parse: (x: unknown) => x },
    PostRouteBodySchema: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchRouteBodySchema: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetRoutesQuerySchema: { safeParse: () => ({ success: false, error: noErr }) },
    RouteIdParamSchema: { safeParse: () => ({ success: false, error: noErr }) },
    PostTrollingPresetsBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchTrollingPresetsIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    DeleteTrollingPresetsIdParams: { safeParse: () => ({ success: false, error: noErr }) },
    PostTrollingPresetFoldersBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchTrollingPresetFoldersIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetUserCollectionsResponse: { parse: (x: unknown) => x },
    PostUserCollectionsBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchUserCollectionsIdRenameBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchUserCollectionsIdRenameResponse: { parse: (x: unknown) => x },
    PostUserCollectionsIdMembersBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetUserFoldersResponse: { parse: (x: unknown) => x },
    PostUserFoldersBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
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
    PutSettingsBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetSettingsResponse: { parse: (x: unknown) => x },
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

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async deleteObjectEntity(_path: string): Promise<void> {}
  },
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return { ...actual, getPoeClient: vi.fn(() => ({})) };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  capturedCatchEntriesWhereArg = undefined;
  state.deletedMarkerRows = [];
});

// ---------------------------------------------------------------------------
// Cross-tenant prefetch security tests
// ---------------------------------------------------------------------------

describe("DELETE /api/markers/:id — catch-entry prefetch is owner-scoped", () => {
  it("includes the requesting userId in the catch-entry WHERE clause (happy path)", async () => {
    const requestingUserId = "user-requesting-delete";
    state.deletedMarkerRows = [{ id: VALID_MARKER_UUID }];

    await request(app)
      .delete(`/api/markers/${VALID_MARKER_UUID}`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", requestingUserId);

    // The captured WHERE arg must contain both the marker ID and the user ID.
    // drizzle and() / eq() build an expression tree that embeds the literal
    // values — serializing it lets us assert they're present without importing
    // drizzle internals.
    const serialized = JSON.stringify(capturedCatchEntriesWhereArg);
    expect(serialized).toContain(requestingUserId);
    expect(serialized).toContain(VALID_MARKER_UUID);
  });

  it("includes the requesting userId in the catch-entry WHERE clause even when the marker returns 404", async () => {
    // Attacker scenario: a different user's marker UUID is supplied.
    // The DELETE returns 404 (correct), but crucially the prefetch must ALSO
    // be scoped by the attacker's own userId — not the victim's.
    const attackerUserId = "user-attacker-cross-tenant";
    state.deletedMarkerRows = []; // Marker belongs to someone else → 404

    const res = await request(app)
      .delete(`/api/markers/${VALID_MARKER_UUID}`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", attackerUserId);

    expect(res.status).toBe(404);

    // The prefetch WHERE clause still ran — verify it contained the
    // ATTACKER's userId, not an unscoped query.
    const serialized = JSON.stringify(capturedCatchEntriesWhereArg);
    expect(serialized).toContain(attackerUserId);
    expect(serialized).toContain(VALID_MARKER_UUID);
  });

  it("uses different userId values in separate requests (no cross-contamination)", async () => {
    const userA = "user-alpha-UNIQUE";
    const userB = "user-beta-UNIQUE";

    state.deletedMarkerRows = [{ id: VALID_MARKER_UUID }];
    await request(app)
      .delete(`/api/markers/${VALID_MARKER_UUID}`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", userA);

    const serializedA = JSON.stringify(capturedCatchEntriesWhereArg);
    expect(serializedA).toContain(userA);
    expect(serializedA).not.toContain(userB);

    // Reset for the second request.
    capturedCatchEntriesWhereArg = undefined;

    state.deletedMarkerRows = [];
    await request(app)
      .delete(`/api/markers/${VALID_MARKER_UUID}`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", userB);

    const serializedB = JSON.stringify(capturedCatchEntriesWhereArg);
    expect(serializedB).toContain(userB);
    expect(serializedB).not.toContain(userA);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
