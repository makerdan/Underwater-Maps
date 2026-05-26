/**
 * catalog-saves-integration.test.ts — end-to-end round-trip test for the
 * full catalog save pipeline:
 *
 *   POST /api/datasets/catalog/:id/save        (create + kick off materialize)
 *     → poll GET /api/datasets/my-saves        (wait for status=ready + datasetId)
 *       → GET  /api/user/datasets/:id/terrain  (assert grid is stamped)
 *       → GET  /api/user/datasets/:id/overview (assert grid is stamped)
 *
 * The existing `catalog-saves.test.ts` only covers `buildCatalogGrids` in
 * isolation — it never touches the routes, the materializer's persistence
 * branch, or the `/user/datasets/:id/{terrain,overview}` read path. This
 * integration test exercises the contract that the catalog "Save" UI
 * depends on: a regression in the cross-route handoff (e.g. forgetting to
 * stamp `datasetId` on the persisted grid, or to set `dataset_id` on the
 * save row) would be invisible to unit tests but caught here.
 *
 * The DB is mocked with an in-memory store keyed on the same table objects
 * the routes import from `@workspace/db`. Drizzle's `eq`/`and`/`desc`
 * helpers are stubbed to return predicate descriptors the mock can match
 * against. The terrain pipeline is stubbed to return a deterministic
 * synthetic grid so the test doesn't hit NCEI/GEBCO.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// In-memory DB mock + shared fixtures.
//
// All state, table objects, and helpers live inside vi.hoisted() so they are
// available to the hoisted vi.mock factories below (which run before any
// top-level statement in this module).
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  interface ColRef {
    __col: true;
    table: string;
    col: string;
  }
  interface Cond {
    kind: "eq" | "and";
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
  const datasetFoldersTable = makeTable("folders", ["id", "userId"]);
  const userSettingsTable = makeTable("settings", ["userId"]);
  const datasetCatalogTable = makeTable("catalog", ["id"]);
  const markersTable = makeTable("markers", ["id"]);
  const gpsTrailsTable = makeTable("trails", ["id"]);
  const gpsTrailPointsTable = makeTable("trail_points", ["id"]);
  const trollingPresetsTable = makeTable("trolling_presets", ["id"]);

  const dbState: {
    saves: Record<string, unknown>[];
    datasets: Record<string, unknown>[];
  } = { saves: [], datasets: [] };

  function tableArr(t: TableMarker): Record<string, unknown>[] {
    if (t.__name === "saves") return dbState.saves;
    if (t.__name === "datasets") return dbState.datasets;
    // Other tables are not used by the routes under test; empty array is
    // safe because we only mount routes that don't depend on them.
    return [];
  }

  function matchWhere(row: Record<string, unknown>, cond: Cond | null): boolean {
    if (!cond) return true;
    if (cond.kind === "eq") {
      return row[cond.col!.col] === cond.val;
    }
    if (cond.kind === "and") {
      return (cond.parts ?? []).every((p) => matchWhere(row, p));
    }
    return true;
  }

  let uuidCounter = 0;
  const uid = (): string =>
    `00000000-0000-0000-0000-${String(++uuidCounter).padStart(12, "0")}`;

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
                let rows = tableArr(table).filter((r) =>
                  matchWhere(r, ctx.where),
                );
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
              row["status"] = row["status"] ?? "queued";
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
            tableArr(table).push(row);
            inserted.push(row);
          }
          return {
            returning(projection?: Record<string, ColRef>) {
              return Promise.resolve(
                inserted.map((r) => projectRow(r, projection)),
              );
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
                const matched = tableArr(table).filter((r) =>
                  matchWhere(r, cond),
                );
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
                  return Promise.resolve(
                    rows.map((r) => projectRow(r, projection)),
                  );
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
              return Promise.resolve(
                matched.map((r) => projectRow(r, projection)),
              );
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
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb({}),
  };

  // Shared test fixtures (the synthetic preset + catalog entry the routes
  // resolve against).
  const FAKE_PRESET = {
    id: "test-preset",
    name: "Test Preset",
    description: "Synthetic test preset",
    waterType: "saltwater" as const,
    minDepth: 0,
    maxDepth: 100,
    centerLon: 0,
    centerLat: 0,
    bbox: { minLon: -1, minLat: -1, maxLon: 1, maxLat: 1 },
  };
  const CATALOG_ENTRY = {
    id: "preset-test-preset",
    name: "Test Preset",
    sourceAgency: "test",
    dataType: "bathymetry" as const,
    resolutionMMin: 1,
    resolutionMMax: 100,
    coverageBbox: { minLon: -1, minLat: -1, maxLon: 1, maxLat: 1 },
    endpointUrl: null,
    accessNotes: null,
    description: null,
    keywords: null,
    lastUpdated: null,
    waterType: "saltwater" as const,
  };
  // Non-preset NOAA EFH habitat catalog entry used to exercise the EFH
  // habitat-polygon materializer end-to-end. The bundled SE Alaska EFH
  // feature collections live inside the real `efhData` module — the test
  // hits them through `buildCatalogGrids`, so we deliberately do NOT mock
  // that module here.
  const EFH_CATALOG_ENTRY = {
    id: "noaa-efh-alaska-rockfish",
    name: "NOAA EFH — Rockfish Complex (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat" as const,
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl:
      "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: null,
    description: null,
    keywords: null,
    lastUpdated: "2024",
    waterType: "saltwater" as const,
  };
  // Non-preset GEBCO catalog entry used to exercise the GEBCO WCS branch of
  // `buildCatalogGrids` end-to-end (catalog → materialize → user dataset).
  const GEBCO_CATALOG_ENTRY = {
    id: "gebco-2024-global",
    name: "GEBCO 2024 Global Bathymetric Grid",
    sourceAgency: "GEBCO / BODC",
    dataType: "bathymetry" as const,
    resolutionMMin: 400,
    resolutionMMax: 400,
    coverageBbox: { minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 },
    endpointUrl: null,
    accessNotes: null,
    description: null,
    keywords: null,
    lastUpdated: null,
    waterType: "saltwater" as const,
  };
  // NCEI BAG mosaic catalog entry used to exercise the NCEI WCS branch of
  // `buildCatalogGrids` end-to-end (catalog → materialize → user dataset).
  const NCEI_BAG_CATALOG_ENTRY = {
    id: "ncei-bag-mosaic-alaska",
    name: "NCEI Multibeam Bag Mosaic — SE Alaska",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry" as const,
    resolutionMMin: 1,
    resolutionMMax: 50,
    coverageBbox: { minLon: -170, minLat: 54, maxLon: -130, maxLat: 72 },
    endpointUrl: null,
    accessNotes: null,
    description: null,
    keywords: null,
    lastUpdated: null,
    waterType: "saltwater" as const,
  };
  // NCEI Community DEM catalog entry routed through the DEM Global Mosaic WCS.
  const NCEI_COMMUNITY_DEM_CATALOG_ENTRY = {
    id: "ncei-community-dem-juneau",
    name: "NCEI Community DEM — Juneau, AK",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry" as const,
    resolutionMMin: 10,
    resolutionMMax: 10,
    coverageBbox: { minLon: -135.2, minLat: 57.9, maxLon: -133.8, maxLat: 58.7 },
    endpointUrl: null,
    accessNotes: null,
    description: null,
    keywords: null,
    lastUpdated: null,
    waterType: "saltwater" as const,
  };

  return {
    db,
    dbState,
    userCatalogSavesTable,
    customDatasetsTable,
    datasetFoldersTable,
    userSettingsTable,
    datasetCatalogTable,
    markersTable,
    gpsTrailsTable,
    gpsTrailPointsTable,
    trollingPresetsTable,
    FAKE_PRESET,
    CATALOG_ENTRY,
    GEBCO_CATALOG_ENTRY,
    NCEI_BAG_CATALOG_ENTRY,
    NCEI_COMMUNITY_DEM_CATALOG_ENTRY,
    EFH_CATALOG_ENTRY,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  and: (...parts: unknown[]) => ({ kind: "and", parts }),
  desc: (col: unknown) => ({ kind: "desc", col }),
  asc: (col: unknown) => ({ kind: "asc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: strings.join("?"),
    values,
  }),
}));

vi.mock("@workspace/db", () => ({
  db: H.db,
  userCatalogSavesTable: H.userCatalogSavesTable,
  customDatasetsTable: H.customDatasetsTable,
  datasetFoldersTable: H.datasetFoldersTable,
  userSettingsTable: H.userSettingsTable,
  datasetCatalogTable: H.datasetCatalogTable,
  markersTable: H.markersTable,
  gpsTrailsTable: H.gpsTrailsTable,
  gpsTrailPointsTable: H.gpsTrailPointsTable,
  trollingPresetsTable: H.trollingPresetsTable,
  pool: { query: async () => ({ rows: [] }) },
}));

// Stub the terrain pipeline (avoids upstream NCEI/GEBCO calls) and seed a
// fake preset so `buildCatalogGrids` has something to materialize. The
// in-tree `ALL_PRESET_DATASETS` registry is currently empty, so without
// this seed `preset-*` materialization would always throw.
vi.mock("../../lib/terrain.js", () => {
  const preset = H.FAKE_PRESET;
  function makeGrid(id: string, resolution: number) {
    return {
      datasetId: id,
      name: preset.name,
      waterType: preset.waterType,
      resolution,
      width: resolution,
      height: resolution,
      depths: new Array(resolution * resolution).fill(50),
      minDepth: 0,
      maxDepth: 100,
      minLon: -1,
      maxLon: 1,
      minLat: -1,
      maxLat: 1,
      centerLon: 0,
      centerLat: 0,
    };
  }
  return {
    ALL_PRESET_DATASETS: [preset],
    PRESET_DATASETS: [preset],
    FRESHWATER_PRESET_DATASETS: [],
    NCEI_DATASET_COVERAGES: [],
    buildTerrainGrid: async (id: string, resolution: number) =>
      makeGrid(id, resolution),
    // GEBCO direct-bbox fetcher used by the non-preset catalog branch.
    // Returns the same deterministic synthetic grid shape so the
    // /user/datasets read path validates identically.
    buildGebcoTerrainForBbox: async (
      meta: { datasetId: string },
      resolution: number,
    ) => makeGrid(meta.datasetId, resolution),
    // NCEI direct-bbox fetcher used by the NCEI catalog branch (BAG
    // mosaic + DEM Global Mosaic). Mirrored stub so the integration test
    // doesn't hit the live WCS.
    buildNceiTerrainForBbox: async (
      meta: { datasetId: string },
      resolution: number,
    ) => makeGrid(meta.datasetId, resolution),
    TERRAIN_CACHE_VERSION: 1,
  };
});

// Stub the catalog seeder so /datasets/catalog/:id/save can find our test
// preset entry without touching the real catalog DB rows or NCEI bbox
// derivation. The route only needs `getCatalogEntries` for lookup.
vi.mock("../../lib/catalogSeeder.js", () => ({
  seedDatasetCatalog: async () => {},
  getCatalogEntries: async () => [
    H.CATALOG_ENTRY,
    H.GEBCO_CATALOG_ENTRY,
    H.NCEI_BAG_CATALOG_ENTRY,
    H.NCEI_COMMUNITY_DEM_CATALOG_ENTRY,
    H.EFH_CATALOG_ENTRY,
  ],
  searchCatalog: async () => [],
  scoreEntry: () => 1,
}));

// Clerk / proxy plumbing — same stubs as the sibling datasets.test.ts so the
// app boots without contacting Clerk.
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  getAuth: () => ({ userId: null }),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: () =>
    (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: () => "pk_test_mock",
}));

import app from "../../app.js";

const E2E_USER = "user_catalog_saves_integration";
const CATALOG_ID = H.CATALOG_ENTRY.id;

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  H.dbState.saves.length = 0;
  H.dbState.datasets.length = 0;
});

async function pollUntilReady(
  saveId: string,
  timeoutMs = 5_000,
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
  throw new Error(
    `Save ${saveId} did not reach a terminal status within ${timeoutMs}ms`,
  );
}

describe("catalog save → materialize → fetch round trip", () => {
  it(
    "saves a preset catalog entry, materializes it, and serves the resulting grids back through /user/datasets",
    async () => {
      // 1. Kick off the save.
      const saveRes = await request(app)
        .post(`/api/datasets/catalog/${CATALOG_ID}/save`)
        .set("x-e2e-user-id", E2E_USER)
        .send({});

      expect(saveRes.status).toBe(201);
      expect(saveRes.body).toMatchObject({
        catalogId: CATALOG_ID,
        status: "processing",
      });
      const saveId = saveRes.body.id as string;
      expect(typeof saveId).toBe("string");

      // 2. Poll /my-saves until the materializer finishes.
      const ready = await pollUntilReady(saveId);
      expect(ready.status).toBe("ready");
      expect(ready.datasetId).toBeTruthy();
      const datasetId = ready.datasetId!;

      // 3. Read the materialized terrain grid back through the per-user
      //    dataset endpoint and confirm it carries the new dataset id
      //    (not the bare preset id).
      const terrainRes = await request(app)
        .get(`/api/user/datasets/${datasetId}/terrain`)
        .set("x-e2e-user-id", E2E_USER);
      expect(terrainRes.status).toBe(200);
      expect(terrainRes.body.datasetId).toBe(datasetId);
      expect(terrainRes.body.resolution).toBe(256);
      expect(terrainRes.body.depths).toHaveLength(256 * 256);
      expect(terrainRes.body.waterType).toBe("saltwater");

      // 4. Same for the lower-resolution overview grid.
      const overviewRes = await request(app)
        .get(`/api/user/datasets/${datasetId}/overview`)
        .set("x-e2e-user-id", E2E_USER);
      expect(overviewRes.status).toBe(200);
      expect(overviewRes.body.datasetId).toBe(datasetId);
      expect(overviewRes.body.resolution).toBe(64);
      expect(overviewRes.body.depths).toHaveLength(64 * 64);
    },
    15_000,
  );

  it("is idempotent — POSTing the same catalog id twice returns the existing save row", async () => {
    const first = await request(app)
      .post(`/api/datasets/catalog/${CATALOG_ID}/save`)
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(first.status).toBe(201);
    const firstId = first.body.id as string;

    // Wait for the first save to finish so the second POST sees the row in
    // its terminal state (and we exercise the idempotent-return branch).
    await pollUntilReady(firstId);

    const second = await request(app)
      .post(`/api/datasets/catalog/${CATALOG_ID}/save`)
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(firstId);
  });

  it("returns 401 when the request is unauthenticated", async () => {
    const res = await request(app)
      .post(`/api/datasets/catalog/${CATALOG_ID}/save`)
      .send({});
    expect(res.status).toBe(401);
  });

  it(
    "saves a non-preset GEBCO catalog entry through the GEBCO bbox fetcher and serves it back",
    async () => {
      const gebcoId = H.GEBCO_CATALOG_ENTRY.id;

      const saveRes = await request(app)
        .post(`/api/datasets/catalog/${gebcoId}/save`)
        .set("x-e2e-user-id", E2E_USER)
        .send({});
      expect(saveRes.status).toBe(201);
      expect(saveRes.body).toMatchObject({
        catalogId: gebcoId,
        status: "processing",
      });
      const saveId = saveRes.body.id as string;

      const ready = await pollUntilReady(saveId);
      expect(ready.status).toBe("ready");
      expect(ready.datasetId).toBeTruthy();
      const datasetId = ready.datasetId!;

      const terrainRes = await request(app)
        .get(`/api/user/datasets/${datasetId}/terrain`)
        .set("x-e2e-user-id", E2E_USER);
      expect(terrainRes.status).toBe(200);
      expect(terrainRes.body.datasetId).toBe(datasetId);
      expect(terrainRes.body.resolution).toBe(256);
      expect(terrainRes.body.depths).toHaveLength(256 * 256);

      const overviewRes = await request(app)
        .get(`/api/user/datasets/${datasetId}/overview`)
        .set("x-e2e-user-id", E2E_USER);
      expect(overviewRes.status).toBe(200);
      expect(overviewRes.body.datasetId).toBe(datasetId);
      expect(overviewRes.body.resolution).toBe(64);
      expect(overviewRes.body.depths).toHaveLength(64 * 64);
    },
    15_000,
  );

  it(
    "saves a non-preset NCEI BAG mosaic catalog entry through the NCEI WCS fetcher",
    async () => {
      const nceiId = H.NCEI_BAG_CATALOG_ENTRY.id;

      const saveRes = await request(app)
        .post(`/api/datasets/catalog/${nceiId}/save`)
        .set("x-e2e-user-id", E2E_USER)
        .send({});
      expect(saveRes.status).toBe(201);
      const saveId = saveRes.body.id as string;

      const ready = await pollUntilReady(saveId);
      expect(ready.status).toBe("ready");
      expect(ready.datasetId).toBeTruthy();
      const datasetId = ready.datasetId!;

      const terrainRes = await request(app)
        .get(`/api/user/datasets/${datasetId}/terrain`)
        .set("x-e2e-user-id", E2E_USER);
      expect(terrainRes.status).toBe(200);
      expect(terrainRes.body.datasetId).toBe(datasetId);
      expect(terrainRes.body.resolution).toBe(256);
    },
    15_000,
  );

  it(
    "saves an NCEI Community DEM catalog entry through the NCEI WCS fetcher",
    async () => {
      const demId = H.NCEI_COMMUNITY_DEM_CATALOG_ENTRY.id;

      const saveRes = await request(app)
        .post(`/api/datasets/catalog/${demId}/save`)
        .set("x-e2e-user-id", E2E_USER)
        .send({});
      expect(saveRes.status).toBe(201);
      const saveId = saveRes.body.id as string;

      const ready = await pollUntilReady(saveId);
      expect(ready.status).toBe("ready");
      expect(ready.datasetId).toBeTruthy();
    },
    15_000,
  );

  it(
    "saves a NOAA EFH habitat catalog entry as a polygon overlay dataset",
    async () => {
      const efhId = H.EFH_CATALOG_ENTRY.id;

      const saveRes = await request(app)
        .post(`/api/datasets/catalog/${efhId}/save`)
        .set("x-e2e-user-id", E2E_USER)
        .send({});
      expect(saveRes.status).toBe(201);
      expect(saveRes.body).toMatchObject({
        catalogId: efhId,
        status: "processing",
      });
      const saveId = saveRes.body.id as string;

      const ready = await pollUntilReady(saveId);
      expect(ready.status).toBe("ready");
      expect(ready.datasetId).toBeTruthy();
      const datasetId = ready.datasetId!;

      // The materialized dataset row exists and serves a valid terrain grid
      // (flat depth surface bounded by the EFH coverage bbox).
      const terrainRes = await request(app)
        .get(`/api/user/datasets/${datasetId}/terrain`)
        .set("x-e2e-user-id", E2E_USER);
      expect(terrainRes.status).toBe(200);
      expect(terrainRes.body.datasetId).toBe(datasetId);
      expect(terrainRes.body.resolution).toBe(256);
      expect(terrainRes.body.depths).toHaveLength(256 * 256);
      expect(terrainRes.body.waterType).toBe("saltwater");

      const overviewRes = await request(app)
        .get(`/api/user/datasets/${datasetId}/overview`)
        .set("x-e2e-user-id", E2E_USER);
      expect(overviewRes.status).toBe(200);
      expect(overviewRes.body.resolution).toBe(64);
      expect(overviewRes.body.depths).toHaveLength(64 * 64);

      // The persisted jsonb retains the habitat polygon overlay even though
      // the GET endpoint's zod schema strips unknown fields. Inspect the
      // mock DB row directly to confirm the overlay was stored.
      const datasetRow = H.dbState.datasets.find((d) => d["id"] === datasetId);
      expect(datasetRow).toBeDefined();
      const terrainJson = datasetRow!["terrainJson"] as {
        habitatPolygons?: { type: string; features: Array<{ properties: { species: string } }> };
      };
      expect(terrainJson.habitatPolygons).toBeDefined();
      expect(terrainJson.habitatPolygons!.type).toBe("FeatureCollection");
      expect(terrainJson.habitatPolygons!.features.length).toBeGreaterThan(0);
      for (const f of terrainJson.habitatPolygons!.features) {
        expect(f.properties.species.startsWith("sebastes_")).toBe(true);
      }
    },
    15_000,
  );

  it("returns 404 for an unknown catalog id", async () => {
    const res = await request(app)
      .post(`/api/datasets/catalog/does-not-exist/save`)
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });
});
