/**
 * user-datasets-watertype-writeback.test.ts
 *
 * Verifies that the write-back behaviour added to the legacy waterType
 * read-path works correctly:
 *
 *  - When a legacy row (no waterType in stored JSON) is fetched, the handler
 *    performs the catalog lookup, writes the resolved waterType back into the
 *    DB, and returns the correct waterType to the caller.
 *
 *  - When a modern row (waterType already present) is fetched the handler
 *    skips the catalog lookup entirely and issues no UPDATE — mirroring what
 *    happens on the "second open" after the write-back has been persisted.
 *
 *  - Orphan legacy rows (no linked catalog save) still fall back to
 *    "saltwater" and do NOT issue an UPDATE (nothing useful to persist).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ─── Shared mutable state ─────────────────────────────────────────────────────

type DbState = {
  /** Incremented for every db.select().from(customDatasetsTable) call. */
  customDatasetSelectCount: number;
  /** Incremented for every db.select().from(userCatalogSavesTable) call. */
  catalogSavesSelectCount: number;
  /** Incremented for every db.update() call. */
  updateCount: number;
  /** The last args passed to db.update().set() */
  lastUpdateSet: Record<string, unknown> | null;

  /**
   * True when the terrain endpoint is being exercised: the first
   * customDatasetsTable select is the size pre-check (returns {size}).
   * False for overview: the first customDatasetsTable select is the full row.
   */
  hasTerrainSizePrecheck: boolean;

  /** pg_column_size returned by the size pre-check (terrain path only). */
  sizeBytes: number;

  /** terrainJson to return from the full row select; null → row not found. */
  terrainJson: Record<string, unknown> | null;

  /** overviewJson to return from the full row select; null → row not found. */
  overviewJson: Record<string, unknown> | null;

  /** catalogId returned by userCatalogSavesTable select; null → no linked save. */
  catalogId: string | null;
};

const dbState: DbState = {
  customDatasetSelectCount: 0,
  catalogSavesSelectCount:  0,
  updateCount:   0,
  lastUpdateSet: null,

  hasTerrainSizePrecheck: true,
  sizeBytes:    1_000,
  terrainJson:  null,
  overviewJson: null,
  catalogId:    null,
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { _tableName?: string; tableName?: string }) => {
        const name = String(tbl._tableName ?? tbl.tableName ?? "");
        const isCatalogSaves = name.toLowerCase().includes("catalog");

        return {
          where: (..._args: unknown[]) => {
            if (isCatalogSaves) {
              dbState.catalogSavesSelectCount++;
              const rows = dbState.catalogId != null
                ? [{ catalogId: dbState.catalogId }]
                : [];
              return Promise.resolve(rows);
            }

            // customDatasetsTable selects — use call count + context flag
            const call = ++dbState.customDatasetSelectCount;
            let result: unknown[];

            if (dbState.hasTerrainSizePrecheck && call === 1) {
              // Terrain size pre-check — always returns a size row
              result = [{ size: dbState.sizeBytes }];
            } else {
              // Full terrain or overview row
              if (dbState.terrainJson !== null) {
                result = [{ terrainJson: dbState.terrainJson }];
              } else if (dbState.overviewJson !== null) {
                result = [{ overviewJson: dbState.overviewJson }];
              } else {
                result = [];
              }
            }

            return {
              then: (
                resolve: (v: unknown[]) => unknown,
                reject: (e: unknown) => unknown,
              ) => Promise.resolve(result).then(resolve, reject),
            };
          },
        };
      },
    }),

    update: () => {
      dbState.updateCount++;
      return {
        set: (payload: Record<string, unknown>) => {
          dbState.lastUpdateSet = payload;
          return {
            where: () => Promise.resolve(),
          };
        },
      };
    },

    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    delete: () => ({
      where: () => ({ returning: () => Promise.resolve([]) }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: { _tableName: "customDatasets" },
  datasetFoldersTable: { _tableName: "datasetFolders" },
  userCatalogSavesTable: { _tableName: "userCatalogSaves" },
  userSettingsTable: {},
  uploadJobsTable: {},
  datasetCatalogTable: {},
  markersTable: {},
}));

vi.mock("../../lib/catalogSeeder.js", () => ({
  getCatalogEntries: vi.fn(() =>
    Promise.resolve([
      { id: "catalog-lake-freshwater", waterType: "freshwater" as const },
      { id: "catalog-ocean-salt",      waterType: "saltwater"  as const },
    ]),
  ),
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    GetUserDatasetsIdTerrainResponse:  { parse: (x: unknown) => x },
    GetUserDatasetsIdOverviewResponse: { parse: (x: unknown) => x },
    GetUserDatasetsResponse:           { parse: (x: unknown) => x },
    PatchUserDatasetsIdMoveBody:       { safeParse: () => ({ success: false, error: { issues: [] } }) },
    PatchUserDatasetsIdMoveResponse:   { parse: (x: unknown) => x },
    PatchUserDatasetsIdRenameBody:     { safeParse: () => ({ success: false, error: { issues: [] } }) },
    PatchUserDatasetsIdRenameResponse: { parse: (x: unknown) => x },
    PostUserDatasetsIdGeorefResponse:  { parse: (x: unknown) => x },
    GetUserDatasetsIdHyd93FeaturesResponse: { parse: (x: unknown) => x },
    GetMarkersQueryParams:    { safeParse: () => ({ success: false }) },
    PostMarkersBody:          { safeParse: () => ({ success: false, error: { message: "noop" } }) },
    DeleteMarkersIdParams:    { safeParse: () => ({ success: false }) },
    PatchMarkersIdParams:     { safeParse: () => ({ success: false }) },
    PatchMarkersIdBody:       { safeParse: () => ({ success: false, error: { message: "noop" } }) },
    GetCatchesQueryParams:    { safeParse: () => ({ success: false }) },
    GetMarkersMarkerIdCatchesParams: { safeParse: () => ({ success: false }) },
    PostMarkersMarkerIdCatchesBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchCatchesIdParams:     { safeParse: () => ({ success: false }) },
    PatchCatchesIdBody:       { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    DeleteCatchesIdParams:    { safeParse: () => ({ success: false }) },
    PostRouteBodySchema:      { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchRouteBodySchema:     { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetRoutesQuerySchema:     { safeParse: () => ({ success: false }) },
    RouteIdParamSchema:       { safeParse: () => ({ success: false }) },
    PostTrollingPresetsBody:  { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchTrollingPresetsIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    DeleteTrollingPresetsIdParams: { safeParse: () => ({ success: false }) },
    PostTrollingPresetFoldersBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchTrollingPresetFoldersIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetUserFoldersResponse:   { parse: (x: unknown) => x },
    PostUserFoldersBody:      { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    DeepHealthCheckResponse:  { parse: (x: unknown) => x },
    GetSettingsResponse:      { parse: (x: unknown) => x },
    HealthCheckResponse:      { parse: (x: unknown) => x },
    NceiSearchQuerySchema:    { safeParse: () => ({ success: false }) },
    PutSettingsBody:          { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetMarkersResponse:        { parse: (x: unknown) => x },
    GetMarkersResponseItem:    { parse: (x: unknown) => x },
    PatchMarkersIdResponse:    { parse: (x: unknown) => x },
    DeleteMarkersMineResponse: { parse: (x: unknown) => x },
    GetCatchesResponse:        { parse: (x: unknown) => x },
    GetMarkersMarkerIdCatchesResponse:     { parse: (x: unknown) => x },
    GetMarkersMarkerIdCatchesResponseItem: { parse: (x: unknown) => x },
    PatchCatchesIdResponse:    { parse: (x: unknown) => x },
    PostCatchPhotosUploadUrlResponse: { parse: (x: unknown) => x },
    GetRoutesResponse:         { parse: (x: unknown) => x },
    GetRoutesResponseItem:     { parse: (x: unknown) => x },
    PatchRouteResponse:        { parse: (x: unknown) => x },
    GetTrailsResponse:         { parse: (x: unknown) => x },
    GetTrailsResponseItem:     { parse: (x: unknown) => x },
    ExportUserDataResponse:    { parse: (x: unknown) => x },
    DeleteAccountResponse:     { parse: (x: unknown) => x },
    GetDatasetsCatalogResponse:       { parse: (x: unknown) => x },
    GetDatasetsCatalogSearchResponse: { parse: (x: unknown) => x },
    PostDatasetsBboxQueryResponse:    { parse: (x: unknown) => x },
    PostDatasetsPointRadiusQueryResponse: { parse: (x: unknown) => x },
    GetDatasetsMySavesResponse:        { parse: (x: unknown) => x },
    GetDatasetsMySavesResponseItem:    { parse: (x: unknown) => x },
    GetDatasetsMySavesIdStatusResponse: { parse: (x: unknown) => x },
    PostDatasetsMySavesIdRetryResponse: { parse: (x: unknown) => x },
    PatchDatasetsMySavesIdRenameResponse: { parse: (x: unknown) => x },
    PatchDatasetsMySavesIdMoveResponse:   { parse: (x: unknown) => x },
    GetDatasetZonesResponse:          { parse: (x: unknown) => x },
    GetTerrainLandResponse:           { parse: (x: unknown) => x },
    GetDatasetsIdPreviewResponse:     { parse: (x: unknown) => x },
    GetTerrainDownloadInfoResponse:   { parse: (x: unknown) => x },
    GetUploadJobStatusResponse:       { parse: (x: unknown) => x },
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: "user-wb-test" })),
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

const USER = "user-wb-test";
const DS_ID = "ds-legacy-lake";

/** A minimal legacy terrain blob — no waterType field. */
const LEGACY_TERRAIN = {
  datasetId: DS_ID,
  name: "Legacy Lake",
  resolution: 16,
  width: 16,
  height: 16,
  depths: new Array(256).fill(3),
  minDepth: 0,
  maxDepth: 10,
  minLon: -93.5, maxLon: -93.0,
  minLat: 44.5,  maxLat: 45.0,
  centerLon: -93.25, centerLat: 44.75,
  // waterType deliberately absent — simulates a pre-2026-07-19 row
};

/** A modern terrain blob — waterType already set (as if write-back already ran). */
const MODERN_TERRAIN = { ...LEGACY_TERRAIN, waterType: "freshwater" as const };

/** Flush pending microtasks so fire-and-forget write-back Promises settle. */
const flushMicrotasks = () => new Promise<void>(resolve => setImmediate(resolve));

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");

  dbState.customDatasetSelectCount = 0;
  dbState.catalogSavesSelectCount  = 0;
  dbState.updateCount   = 0;
  dbState.lastUpdateSet = null;

  dbState.hasTerrainSizePrecheck = true;
  dbState.sizeBytes    = 1_000;
  dbState.terrainJson  = null;
  dbState.overviewJson = null;
  dbState.catalogId    = null;
});

// ─── terrain write-back ───────────────────────────────────────────────────────

describe("GET /api/user/datasets/:id/terrain — waterType write-back", () => {
  it("performs catalog lookup and write-back when terrainJson has no waterType", async () => {
    dbState.terrainJson = LEGACY_TERRAIN;
    dbState.catalogId   = "catalog-lake-freshwater";

    const res = await request(app)
      .get(`/api/user/datasets/${DS_ID}/terrain`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER);

    await flushMicrotasks();

    expect(res.status).toBe(200);
    expect(res.body.waterType).toBe("freshwater");

    // Catalog lookup MUST have run
    expect(dbState.catalogSavesSelectCount).toBeGreaterThanOrEqual(1);

    // Write-back MUST have run
    expect(dbState.updateCount).toBe(1);
    const writtenTerrain = (dbState.lastUpdateSet?.terrainJson ?? {}) as Record<string, unknown>;
    expect(writtenTerrain["waterType"]).toBe("freshwater");
  });

  it("skips catalog lookup and write-back when terrainJson already has a valid waterType", async () => {
    // Simulates the row state after the first write-back has been persisted.
    dbState.terrainJson = MODERN_TERRAIN;
    dbState.catalogId   = "catalog-lake-freshwater"; // available but must NOT be queried

    const res = await request(app)
      .get(`/api/user/datasets/${DS_ID}/terrain`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER);

    await flushMicrotasks();

    expect(res.status).toBe(200);
    expect(res.body.waterType).toBe("freshwater");

    // No catalog lookup on the "second open"
    expect(dbState.catalogSavesSelectCount).toBe(0);
    // No write-back either
    expect(dbState.updateCount).toBe(0);
  });

  it("does NOT write back when catalog lookup returns null (orphan save)", async () => {
    dbState.terrainJson = LEGACY_TERRAIN;
    dbState.catalogId   = null; // no linked catalog save

    const res = await request(app)
      .get(`/api/user/datasets/${DS_ID}/terrain`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER);

    await flushMicrotasks();

    expect(res.status).toBe(200);
    // Falls back to the saltwater default
    expect(res.body.waterType).toBe("saltwater");

    // Catalog lookup ran (trying to find a waterType)
    expect(dbState.catalogSavesSelectCount).toBeGreaterThanOrEqual(1);
    // But no write-back — nothing resolved, nothing to persist
    expect(dbState.updateCount).toBe(0);
  });
});

// ─── overview write-back ──────────────────────────────────────────────────────

describe("GET /api/user/datasets/:id/overview — waterType write-back", () => {
  beforeEach(() => {
    // The overview handler has no size pre-check: the first
    // customDatasetsTable select is already the full row.
    dbState.hasTerrainSizePrecheck = false;
  });

  it("performs catalog lookup and write-back when overviewJson has no waterType", async () => {
    dbState.overviewJson = LEGACY_TERRAIN;
    dbState.catalogId    = "catalog-lake-freshwater";

    const res = await request(app)
      .get(`/api/user/datasets/${DS_ID}/overview`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER);

    await flushMicrotasks();

    expect(res.status).toBe(200);
    expect(res.body.waterType).toBe("freshwater");

    expect(dbState.catalogSavesSelectCount).toBeGreaterThanOrEqual(1);
    expect(dbState.updateCount).toBe(1);
    const writtenOverview = (dbState.lastUpdateSet?.overviewJson ?? {}) as Record<string, unknown>;
    expect(writtenOverview["waterType"]).toBe("freshwater");
  });

  it("skips catalog lookup and write-back when overviewJson already has a valid waterType", async () => {
    dbState.overviewJson = MODERN_TERRAIN;
    dbState.catalogId    = "catalog-lake-freshwater";

    const res = await request(app)
      .get(`/api/user/datasets/${DS_ID}/overview`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER);

    await flushMicrotasks();

    expect(res.status).toBe(200);
    expect(res.body.waterType).toBe("freshwater");

    // No catalog lookup or write-back on the "second open"
    expect(dbState.catalogSavesSelectCount).toBe(0);
    expect(dbState.updateCount).toBe(0);
  });

  it("does NOT write back when catalog lookup returns null (orphan overview save)", async () => {
    dbState.overviewJson = LEGACY_TERRAIN;
    dbState.catalogId    = null;

    const res = await request(app)
      .get(`/api/user/datasets/${DS_ID}/overview`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", USER);

    await flushMicrotasks();

    expect(res.status).toBe(200);
    expect(res.body.waterType).toBe("saltwater");

    expect(dbState.catalogSavesSelectCount).toBeGreaterThanOrEqual(1);
    expect(dbState.updateCount).toBe(0);
  });
});
