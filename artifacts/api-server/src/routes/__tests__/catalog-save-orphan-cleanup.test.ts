/**
 * catalog-save-orphan-cleanup.test.ts — orphaned custom_datasets prevention
 *
 * Covers the two data-integrity bugs in the catalog-save materialization
 * pipeline:
 *
 *  Bug A — delete-while-processing: DELETE /datasets/my-saves/:id used to
 *  delete the save row while its materializeSave() job was still running;
 *  the job then inserted a custom_datasets row nothing pointed to.
 *  Fix under test: the DELETE route returns 409 for processing rows, and
 *  materializeSave aborts (or rolls back its insert) when the save row is
 *  gone by the time it wants to persist.
 *
 *  Bug B — retry without cleanup: POST /datasets/my-saves/:id/retry used to
 *  re-run materializeSave without removing the partial custom_datasets row
 *  a prior failed attempt may have left behind (materializeSave stamps
 *  dataset_id right after its INSERT, so the stale row is discoverable via
 *  save.datasetId). Fix under test: retry deletes the stale row and clears
 *  datasetId before restarting.
 *
 * Uses an in-memory DB mock with real predicate matching (same pattern as
 * catalog-saves-integration.test.ts) so materializeSave's guards, inserts,
 * updates, and deletes hit realistic WHERE semantics.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// In-memory DB mock + fixtures (hoisted so vi.mock factories can use them).
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

  const colRef = (table: string, col: string): ColRef => ({ __col: true, table, col });

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
    "displayLabel",
    "folderId",
    "datasetId",
    "requestBboxJson",
    "areaRequestId",
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

  // Test hooks:
  //  - buildBehavior.fn overrides the mocked buildTerrainGrid per-test
  //    (e.g. deferred resolution, or throwing to fail a materialization).
  //  - onDatasetInsert fires synchronously right after a row is inserted
  //    into the datasets table — used to deterministically simulate the
  //    save row vanishing between materializeSave's INSERT and its
  //    dataset_id link UPDATE.
  const hooks: {
    buildFn: ((id: string, resolution: number) => Promise<unknown>) | null;
    onDatasetInsert: (() => void) | null;
  } = { buildFn: null, onDatasetInsert: null };

  function tableArr(t: TableMarker): Record<string, unknown>[] {
    if (t.__name === "saves") return dbState.saves;
    if (t.__name === "datasets") return dbState.datasets;
    return [];
  }

  function matchWhere(row: Record<string, unknown>, cond: Cond | null): boolean {
    if (!cond) return true;
    if (cond.kind === "eq") return row[cond.col!.col] === cond.val;
    if (cond.kind === "and") return (cond.parts ?? []).every((p) => matchWhere(row, p));
    if (cond.kind === "lt") {
      const v = row[cond.col!.col];
      return v instanceof Date && cond.val instanceof Date
        ? v.getTime() < cond.val.getTime()
        : (v as number) < (cond.val as number);
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
    for (const [k, v] of Object.entries(projection)) out[k] = row[v.col];
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
              row["status"] = row["status"] ?? "queued";
              row["requestedAt"] = row["requestedAt"] ?? new Date();
              row["readyAt"] = row["readyAt"] ?? null;
              row["cacheKey"] = row["cacheKey"] ?? null;
              row["errorMessage"] = row["errorMessage"] ?? null;
              row["datasetId"] = row["datasetId"] ?? null;
              row["folderId"] = row["folderId"] ?? null;
              row["displayLabel"] = row["displayLabel"] ?? null;
            }
            if (table.__name === "datasets") {
              row["createdAt"] = row["createdAt"] ?? new Date();
              row["folderId"] = row["folderId"] ?? null;
            }
            tableArr(table).push(row);
            inserted.push(row);
          }
          if (table.__name === "datasets" && hooks.onDatasetInsert) {
            hooks.onDatasetInsert();
          }
          const chain = {
            onConflictDoNothing() {
              return chain;
            },
            returning(projection?: Record<string, ColRef>) {
              return Promise.resolve(inserted.map((r) => projectRow(r, projection)));
            },
            then(resolve: (v: unknown) => void) {
              resolve(undefined);
            },
          };
          return chain;
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

  function makeGrid(id: string, resolution: number) {
    return {
      datasetId: id,
      name: FAKE_PRESET.name,
      waterType: FAKE_PRESET.waterType,
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
    db,
    dbState,
    hooks,
    makeGrid,
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
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  and: (...parts: unknown[]) => ({ kind: "and", parts }),
  lt: (col: unknown, val: unknown) => ({ kind: "lt", col, val }),
  desc: (col: unknown) => ({ kind: "desc", col }),
  asc: (col: unknown) => ({ kind: "asc", col }),
  isNull: (col: unknown) => ({ kind: "isNull", col }),
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

vi.mock("../../lib/terrain.js", async () => {
  const { createTerrainMock } = await import("../../__tests__/helpers/terrainMock.js");
  return createTerrainMock({
    ALL_PRESET_DATASETS: [H.FAKE_PRESET],
    PRESET_DATASETS: [H.FAKE_PRESET],
    FRESHWATER_PRESET_DATASETS: [],
    NCEI_DATASET_COVERAGES: [],
    buildTerrainGrid: async (id: string, resolution: number) =>
      H.hooks.buildFn ? H.hooks.buildFn(id, resolution) : H.makeGrid(id, resolution),
  });
});

vi.mock("../../lib/catalogSeeder.js", () => ({
  seedDatasetCatalog: async () => {},
  getCatalogEntries: async () => [H.CATALOG_ENTRY],
  searchCatalog: async () => [],
  scoreEntry: () => 1,
  invalidateCatalogCache: () => {},
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  const pass = { parse: (x: unknown) => x };
  return {
    ...actual,
    GetDatasetsMySavesResponseItem: pass,
    GetDatasetsMySavesResponse: pass,
    GetDatasetsMySavesIdStatusResponse: pass,
    PostDatasetsMySavesIdRetryResponse: pass,
    PatchDatasetsMySavesIdRenameResponse: pass,
    PatchDatasetsMySavesIdMoveResponse: pass,
    GetDatasetsCatalogResponse: pass,
    GetDatasetsCatalogSearchResponse: pass,
    PostDatasetsBboxQueryResponse: pass,
    PostDatasetsPointRadiusQueryResponse: pass,
  };
});

vi.mock("../../lib/efhFetcher.js", () => ({
  fetchNoaaAlaskaEfh: async () => null,
  buildCollectionFromLiveFeatures: () => ({ type: "FeatureCollection", features: [] }),
}));

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

import app from "../../app.js";
import { materializeSave } from "../catalog-saves.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

const USER = "user_orphan_cleanup";
const SAVE_ID = "11111111-1111-4111-8111-111111111111";
const STALE_DATASET_ID = "22222222-2222-4222-8222-222222222222";

function makeSaveRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SAVE_ID,
    userId: USER,
    catalogId: H.CATALOG_ENTRY.id,
    status: "processing",
    requestedAt: new Date("2026-08-01T00:00:00Z"),
    readyAt: null,
    cacheKey: null,
    errorMessage: null,
    displayLabel: null,
    folderId: null,
    datasetId: null,
    requestBboxJson: null,
    areaRequestId: null,
    ...overrides,
  };
}

const authed = (r: request.Test) =>
  r.set("x-e2e-bypass-secret", "vitest-test-secret").set("x-e2e-user-id", USER);

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  H.dbState.saves.length = 0;
  H.dbState.datasets.length = 0;
  H.hooks.buildFn = null;
  H.hooks.onDatasetInsert = null;
});

afterAll(() => {
  H.dbState.saves.length = 0;
  H.dbState.datasets.length = 0;
  H.hooks.buildFn = null;
  H.hooks.onDatasetInsert = null;
});

// ---------------------------------------------------------------------------
// Bug A — delete-while-processing
// ---------------------------------------------------------------------------

describe("DELETE /api/datasets/my-saves/:id while processing", () => {
  it("returns 409 and deletes nothing when the save is still processing", async () => {
    H.dbState.saves.push(makeSaveRow({ status: "processing" }));

    const res = await authed(request(app).delete(`/api/datasets/my-saves/${SAVE_ID}`));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("conflict");
    expect(res.body.details).toMatch(/still processing/i);
    expect(H.dbState.saves).toHaveLength(1);
  });

  it("still deletes a failed save (and its stale dataset row) normally", async () => {
    H.dbState.saves.push(
      makeSaveRow({ status: "failed", datasetId: STALE_DATASET_ID }),
    );
    H.dbState.datasets.push({ id: STALE_DATASET_ID, userId: USER });

    const res = await authed(request(app).delete(`/api/datasets/my-saves/${SAVE_ID}`));

    expect(res.status).toBe(204);
    expect(H.dbState.saves).toHaveLength(0);
    expect(H.dbState.datasets).toHaveLength(0);
  });
});

describe("materializeSave cancellation guards", () => {
  it("aborts before the grid build when the save row no longer exists", async () => {
    // No save row seeded — simulates a save deleted before the job ran.
    await materializeSave(SAVE_ID, USER, H.CATALOG_ENTRY as never);

    expect(H.dbState.datasets).toHaveLength(0);
    expect(H.dbState.saves).toHaveLength(0);
  });

  it("aborts before the grid build when the save row belongs to a different user", async () => {
    H.dbState.saves.push(makeSaveRow({ userId: "someone-else" }));

    await materializeSave(SAVE_ID, USER, H.CATALOG_ENTRY as never);

    expect(H.dbState.datasets).toHaveLength(0);
  });

  it("aborts after the grid build (before INSERT) when the save row was deleted mid-build", async () => {
    H.dbState.saves.push(makeSaveRow());

    // Gate the grid build so we can delete the save row while the job is
    // "downloading". A single shared gate keeps every buildTerrainGrid call
    // (terrain + overview grids) suspended until we release it.
    let releaseBuild!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseBuild = resolve;
    });
    let buildStarted = false;
    H.hooks.buildFn = async (id, resolution) => {
      buildStarted = true;
      await gate;
      return H.makeGrid(id, resolution);
    };

    const job = materializeSave(SAVE_ID, USER, H.CATALOG_ENTRY as never);

    // Wait until the job is suspended inside the grid build.
    await vi.waitFor(() => {
      expect(buildStarted).toBe(true);
    });

    // User deletes the save while the job is in flight.
    H.dbState.saves.length = 0;

    releaseBuild();
    await job;

    // The job must NOT have inserted an orphaned dataset row.
    expect(H.dbState.datasets).toHaveLength(0);
  });

  it("rolls back the inserted dataset row when the save vanishes between INSERT and link", async () => {
    H.dbState.saves.push(makeSaveRow());

    // Remove the save row synchronously at the exact moment the dataset row
    // is inserted — the narrowest possible race window. The dataset_id link
    // UPDATE then matches zero rows and the job must delete its own insert.
    H.hooks.onDatasetInsert = () => {
      H.dbState.saves.length = 0;
    };

    await materializeSave(SAVE_ID, USER, H.CATALOG_ENTRY as never);

    expect(H.dbState.datasets).toHaveLength(0);
  });

  it("completes normally (ready + linked datasetId) when nothing interferes", async () => {
    H.dbState.saves.push(makeSaveRow());

    await materializeSave(SAVE_ID, USER, H.CATALOG_ENTRY as never);

    expect(H.dbState.saves).toHaveLength(1);
    const save = H.dbState.saves[0]!;
    expect(save["status"]).toBe("ready");
    expect(save["datasetId"]).toBeTruthy();
    expect(H.dbState.datasets).toHaveLength(1);
    expect(H.dbState.datasets[0]!["id"]).toBe(save["datasetId"]);
  });
});

// ---------------------------------------------------------------------------
// Bug B — retry without prior-row cleanup
// ---------------------------------------------------------------------------

describe("POST /api/datasets/my-saves/:id/retry stale-row cleanup", () => {
  it("deletes the stale custom_datasets row and clears datasetId before retrying", async () => {
    // Prior attempt failed after its INSERT: the save carries datasetId
    // pointing at a partial dataset row.
    H.dbState.saves.push(
      makeSaveRow({
        status: "failed",
        errorMessage: "boom",
        datasetId: STALE_DATASET_ID,
      }),
    );
    H.dbState.datasets.push({ id: STALE_DATASET_ID, userId: USER });

    // Make the re-run fail fast so the background job settles deterministically.
    H.hooks.buildFn = async () => {
      throw new Error("retry build failed");
    };

    const res = await authed(request(app).post(`/api/datasets/my-saves/${SAVE_ID}/retry`));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("processing");
    // The stale link is cleared in the response…
    expect(res.body.datasetId).toBeNull();
    // …and the stale dataset row is gone.
    expect(H.dbState.datasets.filter((d) => d["id"] === STALE_DATASET_ID)).toHaveLength(0);

    // Drain the background job (it fails via the stubbed build) so it can't
    // leak writes into the next test.
    await vi.waitFor(() => {
      expect(H.dbState.saves[0]!["status"]).toBe("failed");
    });
    // Even after the failed re-run, no orphaned dataset rows exist.
    expect(H.dbState.datasets).toHaveLength(0);
  });

  it("does not delete another user's dataset row via a forged datasetId", async () => {
    H.dbState.saves.push(
      makeSaveRow({ status: "failed", datasetId: STALE_DATASET_ID }),
    );
    // Dataset row exists but belongs to someone else.
    H.dbState.datasets.push({ id: STALE_DATASET_ID, userId: "victim-user" });

    H.hooks.buildFn = async () => {
      throw new Error("retry build failed");
    };

    const res = await authed(request(app).post(`/api/datasets/my-saves/${SAVE_ID}/retry`));

    expect(res.status).toBe(200);
    // The other user's dataset row must be untouched.
    expect(H.dbState.datasets).toHaveLength(1);
    expect(H.dbState.datasets[0]!["userId"]).toBe("victim-user");

    await vi.waitFor(() => {
      expect(H.dbState.saves[0]!["status"]).toBe("failed");
    });
  });

  it("retries cleanly when the save has no stale datasetId", async () => {
    H.dbState.saves.push(makeSaveRow({ status: "failed", errorMessage: "boom" }));

    const res = await authed(request(app).post(`/api/datasets/my-saves/${SAVE_ID}/retry`));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("processing");

    // Full happy-path re-run: the job completes and links a fresh dataset.
    await vi.waitFor(() => {
      expect(H.dbState.saves[0]!["status"]).toBe("ready");
    });
    expect(H.dbState.saves[0]!["datasetId"]).toBeTruthy();
    expect(H.dbState.datasets).toHaveLength(1);
  });
});
