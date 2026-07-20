/**
 * ncei-save.integration.test.ts — end-to-end round-trip test for the
 * full NCEI portal save pipeline:
 *
 *   POST /api/ncei/save                         (body: NceiPortalSaveBody)
 *     → dataset_catalog upsert with ncei-portal-* id
 *     → user_catalog_saves insert (status "processing")
 *     → invalidateCatalogCache()
 *     → void materializeSave()                  (fire-and-forget)
 *         → buildCatalogGrids(entry)            (routed through NCEI WCS stub)
 *         → custom_datasets insert
 *         → user_catalog_saves update (status "ready", datasetId)
 *
 * The terrain pipeline is stubbed to return a deterministic synthetic grid
 * so the test doesn't hit NCEI WCS. Everything else — including the real
 * materializeSave function — executes against the in-memory DB mock.
 *
 * DB mock pattern mirrors catalog-saves-integration.test.ts exactly:
 * table marker objects with ColRef columns, a condition evaluator for
 * eq/and, and mutable state arrays for saves and custom_datasets. The
 * datasetCatalogTable is also represented so the /ncei/save upsert path
 * is exercised statelessly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// In-memory DB, table markers, and shared fixtures — all inside vi.hoisted()
// so they are available to the hoisted vi.mock factories below.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  interface ColRef {
    __col: true;
    table: string;
    col: string;
  }
  interface Cond {
    kind: "eq" | "and" | "lt";
    col?: ColRef;
    val?: unknown;
    parts?: Cond[];
  }
  interface TableMarker {
    __name: string;
    [k: string]: unknown;
  }

  const colRef = (table: string, col: string): ColRef => ({
    __col: true,
    table,
    col,
  });

  function makeTable(name: string, cols: string[]): TableMarker {
    const t: TableMarker = { __name: name };
    for (const c of cols) t[c] = colRef(name, c);
    return t;
  }

  // Table markers — must list every column accessed by route code so ColRef
  // lookups resolve correctly in the condition evaluator.
  const userCatalogSavesTable = makeTable("saves", [
    "id",
    "userId",
    "catalogId",
    "status",
    "requestedAt",
    "readyAt",
    "cacheKey",
    "errorMessage",
    "folderId",
    "datasetId",
  ]);
  const customDatasetsTable = makeTable("datasets", [
    "id",
    "userId",
    "name",
    "minDepth",
    "maxDepth",
    "terrainJson",
    "overviewJson",
    "folderId",
    "createdAt",
  ]);
  const datasetCatalogTable = makeTable("catalog", [
    "id",
    "name",
    "sourceAgency",
    "dataType",
    "coverageBbox",
    "description",
  ]);
  // Other tables referenced during module load by routes mounted in the app.
  const datasetFoldersTable = makeTable("folders", ["id", "userId"]);
  const userSettingsTable = makeTable("settings", ["userId"]);
  const markersTable = makeTable("markers", ["id"]);
  const gpsTrailsTable = makeTable("trails", ["id"]);
  const gpsTrailPointsTable = makeTable("trail_points", ["id"]);
  const trollingPresetsTable = makeTable("trolling_presets", ["id"]);

  // Mutable in-memory state reset in beforeEach.
  const dbState: {
    catalog: Record<string, unknown>[];
    saves: Record<string, unknown>[];
    datasets: Record<string, unknown>[];
  } = { catalog: [], saves: [], datasets: [] };

  function tableArr(t: TableMarker): Record<string, unknown>[] {
    if (t.__name === "catalog") return dbState.catalog;
    if (t.__name === "saves") return dbState.saves;
    if (t.__name === "datasets") return dbState.datasets;
    return [];
  }

  function matchWhere(row: Record<string, unknown>, cond: Cond | null): boolean {
    if (!cond) return true;
    if (cond.kind === "eq") {
      return row[(cond.col as ColRef).col] === cond.val;
    }
    if (cond.kind === "and") {
      return (cond.parts ?? []).every((p) => matchWhere(row, p));
    }
    if (cond.kind === "lt") {
      const v = row[(cond.col as ColRef).col];
      return (v as Date) < (cond.val as Date);
    }
    return true;
  }

  function projectRow(
    row: Record<string, unknown>,
    projection: Record<string, ColRef> | undefined,
  ): Record<string, unknown> {
    if (!projection) return { ...row };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(projection)) {
      out[k] = row[v.col];
    }
    return out;
  }

  let uuidCounter = 0;
  const uid = (): string =>
    `00000000-0000-0000-0000-${String(++uuidCounter).padStart(12, "0")}`;

  // Spy tracked separately so tests can clear it in beforeEach.
  const invalidateCatalogCacheSpy = vi.fn();

  const db = {
    select(projection?: Record<string, ColRef>) {
      return {
        from(table: TableMarker) {
          const ctx: { where: Cond | null; limit: number | null } = {
            where: null,
            limit: null,
          };
          const builder = {
            where(c: Cond) {
              ctx.where = c;
              return builder;
            },
            orderBy() {
              return builder;
            },
            limit(n: number) {
              ctx.limit = n;
              return builder;
            },
            then(
              resolve: (rows: Record<string, unknown>[]) => void,
              reject: (err: unknown) => void,
            ) {
              try {
                let rows = tableArr(table).filter((r) => matchWhere(r, ctx.where));
                if (ctx.limit != null) rows = rows.slice(0, ctx.limit);
                resolve(rows.map((r) => projectRow(r, projection)));
              } catch (err) {
                reject(err);
              }
            },
          };
          return builder;
        },
      };
    },

    insert(table: TableMarker) {
      return {
        values(vals: Record<string, unknown> | Record<string, unknown>[]) {
          const list = Array.isArray(vals) ? vals : [vals];
          const inserted: Record<string, unknown>[] = [];

          for (const v of list) {
            const row: Record<string, unknown> = { ...v };
            if (!row["id"]) row["id"] = uid();

            if (table.__name === "saves") {
              row["status"] = row["status"] ?? "processing";
              row["requestedAt"] = row["requestedAt"] ?? new Date();
              row["readyAt"] = row["readyAt"] ?? null;
              row["cacheKey"] = row["cacheKey"] ?? null;
              row["errorMessage"] = row["errorMessage"] ?? null;
              row["datasetId"] = row["datasetId"] ?? null;
              row["folderId"] = row["folderId"] ?? null;
            }
            if (table.__name === "datasets") {
              row["createdAt"] = row["createdAt"] ?? new Date();
              row["folderId"] = row["folderId"] ?? null;
            }
            if (table.__name === "catalog") {
              // No extra defaults needed for catalog rows.
            }

            tableArr(table).push(row);
            inserted.push(row);
          }

          return {
            // Used by datasetCatalogTable upsert in /ncei/save
            onConflictDoUpdate(opts: {
              target: unknown;
              set: Record<string, unknown>;
            }) {
              // Upsert: if a row with the same id already exists, apply set
              // fields; otherwise the row was already inserted above.
              const newRow = inserted[0];
              if (!newRow) return Promise.resolve();
              const arr = tableArr(table);
              const existing = arr.find((r) => r["id"] === newRow["id"]);
              if (existing && existing !== newRow) {
                // Row existed before this insert — update it and remove the
                // duplicate that was pushed above.
                const setVals = opts.set as Record<string, unknown>;
                // Merge set values (use inserted row values as the "excluded" proxy)
                for (const [k] of Object.entries(setVals)) {
                  existing[k] = newRow[k];
                }
                // Remove the duplicate row that was just pushed
                const dupIdx = arr.lastIndexOf(newRow);
                if (dupIdx >= 0) arr.splice(dupIdx, 1);
              }
              return Promise.resolve();
            },
            returning(projection?: Record<string, ColRef>) {
              return Promise.resolve(inserted.map((r) => projectRow(r, projection)));
            },
            then(resolve: (v: unknown) => void) {
              resolve(undefined);
            },
          };
        },
      };
    },

    update(table: TableMarker) {
      return {
        set(vals: Record<string, unknown>) {
          return {
            where(cond: Cond) {
              let cache: Record<string, unknown>[] | null = null;
              const exec = (): Record<string, unknown>[] => {
                if (cache) return cache;
                const matched = tableArr(table).filter((r) => matchWhere(r, cond));
                for (const row of matched) Object.assign(row, vals);
                cache = matched;
                return matched;
              };
              return {
                then(
                  resolve: (rows: Record<string, unknown>[]) => void,
                  reject: (err: unknown) => void,
                ) {
                  try {
                    resolve(exec());
                  } catch (err) {
                    reject(err);
                  }
                },
                catch(cb: (err: unknown) => unknown) {
                  try {
                    exec();
                    return Promise.resolve();
                  } catch (err) {
                    return Promise.resolve(cb(err));
                  }
                },
                returning(projection?: Record<string, ColRef>) {
                  const rows = exec();
                  return Promise.resolve(rows.map((r) => projectRow(r, projection)));
                },
              };
            },
          };
        },
      };
    },

    delete(table: TableMarker) {
      return {
        where(cond: Cond) {
          const arr = tableArr(table);
          const matched = arr.filter((r) => matchWhere(r, cond));
          for (const m of matched) {
            const i = arr.indexOf(m);
            if (i >= 0) arr.splice(i, 1);
          }
          return {
            returning(projection?: Record<string, ColRef>) {
              return Promise.resolve(matched.map((r) => projectRow(r, projection)));
            },
            then(resolve: (rows: Record<string, unknown>[]) => void) {
              resolve(matched);
            },
          };
        },
      };
    },

    execute() {
      return Promise.resolve({ rows: [{ count: "0" }], rowCount: 0 });
    },
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb({}),
  };

  return {
    db,
    dbState,
    invalidateCatalogCacheSpy,
    userCatalogSavesTable,
    customDatasetsTable,
    datasetCatalogTable,
    datasetFoldersTable,
    userSettingsTable,
    markersTable,
    gpsTrailsTable,
    gpsTrailPointsTable,
    trollingPresetsTable,
  };
});

// ---------------------------------------------------------------------------
// Module mocks — must precede the app import
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  and: (...parts: unknown[]) => ({ kind: "and", parts }),
  lt: (col: unknown, val: unknown) => ({ kind: "lt", col, val }),
  desc: (col: unknown) => ({ kind: "desc", col }),
  asc: (col: unknown) => ({ kind: "asc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: strings.join("?"),
    values,
  }),
  inArray: (col: unknown, vals: unknown[]) => ({ kind: "inArray", col, vals }),
  notInArray: (col: unknown, vals: unknown[]) => ({
    kind: "notInArray",
    col,
    vals,
  }),
}));

vi.mock("@workspace/db", () => ({
  db: H.db,
  userCatalogSavesTable: H.userCatalogSavesTable,
  customDatasetsTable: H.customDatasetsTable,
  datasetCatalogTable: H.datasetCatalogTable,
  datasetFoldersTable: H.datasetFoldersTable,
  userSettingsTable: H.userSettingsTable,
  markersTable: H.markersTable,
  gpsTrailsTable: H.gpsTrailsTable,
  gpsTrailPointsTable: H.gpsTrailPointsTable,
  trollingPresetsTable: H.trollingPresetsTable,
  pool: { query: async () => ({ rows: [] }) },
}));

// Stub the terrain pipeline so tests don't hit NCEI or GEBCO WCS.
// buildNceiTerrainForBbox is the function called by buildCatalogGrids for
// ncei-portal-* entries (routed via nceiCoverageForEntry).
vi.mock("../../lib/terrain.js", () => {
  function makeGrid(id: string, resolution: number) {
    return {
      datasetId: id,
      name: "NCEI Test Survey",
      waterType: "saltwater",
      resolution,
      width: resolution,
      height: resolution,
      depths: new Array(resolution * resolution).fill(-50),
      minDepth: 50,
      maxDepth: 50,
      minLon: -125.5,
      maxLon: -122.0,
      minLat: 37.0,
      maxLat: 40.0,
      centerLon: -123.75,
      centerLat: 38.5,
      dataSource: "ncei",
      bathymetrySource: "ncei",
      bathymetrySourceLabel: "NCEI BAG Mosaic",
    };
  }
  return {
    ALL_PRESET_DATASETS: [],
    PRESET_DATASETS: [],
    FRESHWATER_PRESET_DATASETS: [],
    NCEI_DATASET_COVERAGES: [],
    buildTerrainGrid: async (id: string, resolution: number) => makeGrid(id, resolution),
    buildGebcoTerrainForBbox: async (meta: { datasetId: string }, resolution: number) =>
      makeGrid(meta.datasetId, resolution),
    buildNceiTerrainForBbox: async (meta: { datasetId: string }, resolution: number) =>
      makeGrid(meta.datasetId, resolution),
    TERRAIN_CACHE_VERSION: 1,
  };
});

// Stub the catalog seeder — /ncei/save calls invalidateCatalogCache() directly,
// so we spy on it. seedDatasetCatalog and getCatalogEntries are no-ops here
// because the test doesn't exercise the catalog listing routes.
vi.mock("../../lib/catalogSeeder.js", () => ({
  seedDatasetCatalog: async () => {},
  getCatalogEntries: async () => [],
  searchCatalog: async () => [],
  scoreEntry: () => 1,
  invalidateCatalogCache: H.invalidateCatalogCacheSpy,
}));

// Clerk / proxy plumbing — same stubs as the sibling catalog-saves integration test.
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => ({ userId: null }),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: () => "pk_test_mock",
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    GetDatasetsMySavesResponseItem: { parse: (x: unknown) => x },
    GetDatasetsMySavesResponse: { parse: (x: unknown) => x },
    GetDatasetsMySavesIdStatusResponse: { parse: (x: unknown) => x },
    PostDatasetsMySavesIdRetryResponse: { parse: (x: unknown) => x },
    PatchDatasetsMySavesIdRenameResponse: { parse: (x: unknown) => x },
    PatchDatasetsMySavesIdMoveResponse: { parse: (x: unknown) => x },
    GetDatasetsCatalogResponse: { parse: (x: unknown) => x },
    GetDatasetsCatalogSearchResponse: { parse: (x: unknown) => x },
    PostDatasetsBboxQueryResponse: { parse: (x: unknown) => x },
    PostDatasetsPointRadiusQueryResponse: { parse: (x: unknown) => x },
  };
});

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const E2E_USER = "user_ncei_save_integration";

/**
 * Poll GET /api/datasets/my-saves until the given save id reaches a terminal
 * status (anything other than "processing" or "queued").
 */
async function pollUntilReady(
  saveId: string,
  timeoutMs = 8_000,
): Promise<{ id: string; status: string; datasetId: string | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app)
      .get("/api/datasets/my-saves")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      id: string;
      status: string;
      datasetId: string | null;
    }>;
    const row = rows.find((r) => r.id === saveId);
    if (row && row.status !== "processing" && row.status !== "queued") {
      return row;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Save ${saveId} did not reach a terminal status within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A well-formed NceiPortalSaveBody whose bbox intersects the US West Coast
 * BAG Mosaic region so `serverWcsAvailable` is true and the save proceeds.
 * resolutionMMin = 50 → nceiCoverageForEntry routes to "bagMosaic".
 */
const VALID_SAVE_BODY = {
  result: {
    id: "gov.noaa.ncei:test-survey-west-coast-001",
    name: "NCEI Multibeam Survey — US West Coast Integration Test",
    description: "Integration test fixture",
    sourceAgency: "NOAA/NCEI",
    resolutionMMin: 50,
    resolutionMMax: 50,
    coverageBbox: { minLon: -125.5, minLat: 37.0, maxLon: -122.0, maxLat: 40.0 },
    metadataUrl:
      "https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/test-001/html",
    wcsAvailable: true,
  },
};

/**
 * Expected catalog id after sanitizeNceiId:
 *   "gov.noaa.ncei:test-survey-west-coast-001" (colons kept by [^a-z0-9:.-])
 *   → "ncei-portal-gov.noaa.ncei:test-survey-west-coast-001"
 */
const EXPECTED_CATALOG_ID = "ncei-portal-gov.noaa.ncei:test-survey-west-coast-001";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  H.dbState.catalog.length = 0;
  H.dbState.saves.length = 0;
  H.dbState.datasets.length = 0;
  H.invalidateCatalogCacheSpy.mockClear();
});

describe("POST /api/ncei/save — NCEI portal save end-to-end flow", () => {
  // --- auth guard -----------------------------------------------------------

  it("returns 401 when no auth session is present", async () => {
    vi.unstubAllEnvs();
    const res = await request(app).post("/api/ncei/save").send(VALID_SAVE_BODY);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });

  // --- schema validation ----------------------------------------------------

  it("returns 400 when the request body is missing the result field", async () => {
    const res = await request(app)
      .post("/api/ncei/save")
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid_request");
  });

  it("returns 400 when coverageBbox is missing a required coordinate", async () => {
    const res = await request(app)
      .post("/api/ncei/save")
      .set("x-e2e-user-id", E2E_USER)
      .send({
        result: {
          ...VALID_SAVE_BODY.result,
          coverageBbox: { minLon: -125.5, minLat: 37.0, maxLon: -122.0 },
        },
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid_request");
  });

  // --- WCS bbox guard -------------------------------------------------------

  it("returns 400 when the bbox does not intersect any NCEI WCS mosaic coverage", async () => {
    const res = await request(app)
      .post("/api/ncei/save")
      .set("x-e2e-user-id", E2E_USER)
      .send({
        result: {
          ...VALID_SAVE_BODY.result,
          // Central Asia — well outside BAG + DEM Global Mosaic regions
          coverageBbox: { minLon: 60, minLat: 40, maxLon: 80, maxLat: 55 },
          wcsAvailable: false,
        },
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "not_available");
  });

  // --- happy path: DB rows + cache -----------------------------------------

  it(
    "upserts a dataset_catalog row with ncei-portal-* id and creates a user_catalog_saves row with status 'processing'",
    async () => {
      const res = await request(app)
        .post("/api/ncei/save")
        .set("x-e2e-user-id", E2E_USER)
        .send(VALID_SAVE_BODY);

      // HTTP response is captured before materializeSave (fire-and-forget) updates
      // the row, so the body reflects the initial "processing" status.
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        catalogId: EXPECTED_CATALOG_ID,
        status: "processing",
      });
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("requestedAt");

      // dataset_catalog row must be present immediately (synchronous upsert)
      expect(H.dbState.catalog).toHaveLength(1);
      expect(H.dbState.catalog[0]).toMatchObject({
        id: EXPECTED_CATALOG_ID,
        name: "NCEI Multibeam Survey — US West Coast Integration Test",
        sourceAgency: "NOAA/NCEI",
        dataType: "bathymetry",
      });

      // user_catalog_saves row must be present immediately — check key fields
      // that don't change post-materialization.
      expect(H.dbState.saves).toHaveLength(1);
      expect(H.dbState.saves[0]).toMatchObject({
        userId: E2E_USER,
        catalogId: EXPECTED_CATALOG_ID,
      });

      // Cache must be invalidated after the catalog upsert.
      expect(H.invalidateCatalogCacheSpy).toHaveBeenCalledOnce();
    },
  );

  // --- full materialization round trip -------------------------------------

  it(
    "materializes the NCEI portal save to 'ready' and links a custom dataset row",
    async () => {
      // 1. Kick off the save.
      const saveRes = await request(app)
        .post("/api/ncei/save")
        .set("x-e2e-user-id", E2E_USER)
        .send(VALID_SAVE_BODY);

      expect(saveRes.status).toBe(201);
      const saveId = saveRes.body.id as string;

      // 2. Poll until the fire-and-forget materializeSave completes.
      const ready = await pollUntilReady(saveId);
      expect(ready.status).toBe("ready");
      expect(ready.datasetId).toBeTruthy();
      const datasetId = ready.datasetId!;

      // 3. The custom_datasets row must exist in the in-memory store.
      const datasetRow = H.dbState.datasets.find((d) => d["id"] === datasetId);
      expect(datasetRow).toBeDefined();

      // 4. The user_catalog_saves row must carry the new datasetId.
      const saveRow = H.dbState.saves.find((s) => s["id"] === saveId);
      expect(saveRow).toBeDefined();
      expect(saveRow!["datasetId"]).toBe(datasetId);
      expect(saveRow!["status"]).toBe("ready");
    },
    15_000,
  );

  // --- idempotency ----------------------------------------------------------

  it("returns HTTP 200 and skips a second insert when the same dataset is saved again", async () => {
    const first = await request(app)
      .post("/api/ncei/save")
      .set("x-e2e-user-id", E2E_USER)
      .send(VALID_SAVE_BODY);
    expect(first.status).toBe(201);
    const firstId = first.body.id as string;

    // Wait for the first save to reach terminal state so the second POST
    // exercises the idempotent-return branch (existing.length > 0).
    await pollUntilReady(firstId);

    const second = await request(app)
      .post("/api/ncei/save")
      .set("x-e2e-user-id", E2E_USER)
      .send(VALID_SAVE_BODY);

    expect(second.status).toBe(200);
    expect(second.body.id).toBe(firstId);
    // Only one saves row must exist — no duplicate created.
    expect(H.dbState.saves).toHaveLength(1);
  }, 15_000);

  // --- DEM Global Mosaic coverage (Indian Ocean) ---------------------------

  it(
    "accepts a bbox in the Indian Ocean (DEM Global Mosaic) and reaches 'ready' status",
    async () => {
      const saveRes = await request(app)
        .post("/api/ncei/save")
        .set("x-e2e-user-id", E2E_USER)
        .send({
          result: {
            id: "gov.noaa.ncei:indian-ocean-survey",
            name: "Indian Ocean Bathymetric Survey",
            description: null,
            sourceAgency: "NOAA/NCEI",
            resolutionMMin: null,
            resolutionMMax: null,
            coverageBbox: { minLon: 55, minLat: -15, maxLon: 75, maxLat: 5 },
            metadataUrl: null,
            wcsAvailable: true,
          },
        });

      expect(saveRes.status).toBe(201);
      expect(H.dbState.catalog[0]).toMatchObject({
        id: "ncei-portal-gov.noaa.ncei:indian-ocean-survey",
        waterType: "saltwater",
      });

      const saveId = saveRes.body.id as string;
      const ready = await pollUntilReady(saveId);
      expect(ready.status).toBe("ready");
      expect(ready.datasetId).toBeTruthy();
    },
    15_000,
  );
});
