/**
 * area-request-folders.test.ts — auto-folder grouping for multi-dataset
 * area requests (POST /api/datasets/catalog/:id/save + materializeSave).
 *
 * Verifies:
 *  - deriveAreaFolderName cleanup/cap/fallback behavior
 *  - ≤2 saves from one area request → NO folder (behaves as today)
 *  - 3rd save → folder auto-created, named after the search label, and all
 *    of the request's saves (including in-flight ones) are moved into it
 *  - datasets that finish materializing AFTER folder creation land inside
 *    the folder (folderId read post-build + post-link re-sync)
 *  - datasets already materialized before folder creation are moved into it
 *  - folder names de-duplicate against existing sibling folders ("Name 2")
 *  - a 4th save reuses the request's folder (no duplicate folder)
 *  - saves the user manually filed elsewhere are NOT re-stamped
 *  - saves without an areaRequest body never trigger grouping
 *  - malformed areaRequest bodies are rejected with 400
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// In-memory DB mock + fixtures (hoisted so the vi.mock factories can use it).
// Modeled on catalog-saves-integration.test.ts, extended with a folders
// table (with root unique-name enforcement) and isNull/isNotNull/inArray
// support in the where-matcher.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  interface ColRef {
    __col: true;
    table: string;
    col: string;
  }
  interface Cond {
    kind: "eq" | "and" | "lt" | "isNull" | "isNotNull" | "inArray";
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
    "areaRequestId",
    // Used in materializeSave's select({ requestBboxJson: ... }) projection
    "requestBboxJson",
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
  const datasetFoldersTable = makeTable("folders", [
    "id",
    "userId",
    "parentId",
    "name",
    "areaRequestId",
    "createdAt",
  ]);
  const userSettingsTable = makeTable("settings", ["userId"]);
  const datasetCatalogTable = makeTable("catalog", ["id"]);
  const markersTable = makeTable("markers", ["id"]);
  const gpsTrailsTable = makeTable("trails", ["id"]);
  const gpsTrailPointsTable = makeTable("trail_points", ["id"]);
  const trollingPresetsTable = makeTable("trolling_presets", ["id"]);

  const dbState: {
    saves: Record<string, unknown>[];
    datasets: Record<string, unknown>[];
    folders: Record<string, unknown>[];
  } = { saves: [], datasets: [], folders: [] };

  function tableArr(t: TableMarker): Record<string, unknown>[] {
    if (t.__name === "saves") return dbState.saves;
    if (t.__name === "datasets") return dbState.datasets;
    if (t.__name === "folders") return dbState.folders;
    return [];
  }

  function matchWhere(row: Record<string, unknown>, cond: Cond | null): boolean {
    if (!cond) return true;
    if (cond.kind === "eq") return row[cond.col!.col] === cond.val;
    if (cond.kind === "and") {
      return (cond.parts ?? []).every((p) => matchWhere(row, p));
    }
    if (cond.kind === "lt") {
      const v = row[cond.col!.col];
      return v instanceof Date && cond.val instanceof Date
        ? v.getTime() < cond.val.getTime()
        : (v as number) < (cond.val as number);
    }
    if (cond.kind === "isNull") return row[cond.col!.col] == null;
    if (cond.kind === "isNotNull") return row[cond.col!.col] != null;
    if (cond.kind === "inArray") {
      return (cond.val as unknown[]).includes(row[cond.col!.col]);
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
              row["areaRequestId"] = row["areaRequestId"] ?? null;
            }
            if (table.__name === "datasets") {
              row["createdAt"] = row["createdAt"] ?? new Date();
              row["folderId"] = row["folderId"] ?? null;
            }
            if (table.__name === "folders") {
              row["parentId"] = row["parentId"] ?? null;
              row["areaRequestId"] = row["areaRequestId"] ?? null;
              row["createdAt"] = row["createdAt"] ?? new Date();
              // Simulate the (user_id, parent_id, lower(name)) unique index
              // so name de-duplication is actually exercised.
              const clash = dbState.folders.some(
                (f) =>
                  f["userId"] === row["userId"] &&
                  (f["parentId"] ?? null) === (row["parentId"] ?? null) &&
                  String(f["name"]).toLowerCase() ===
                    String(row["name"]).toLowerCase(),
              );
              if (clash) {
                throw new Error(
                  "duplicate key value violates unique constraint",
                );
              }
            }
            tableArr(table).push(row);
            inserted.push(row);
          }
          const chain = {
            onConflictDoNothing() {
              return chain;
            },
            returning(projection?: Record<string, ColRef>) {
              return Promise.resolve(
                inserted.map((r) => projectRow(r, projection)),
              );
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

  // Five synthetic presets so one "area request" can span 3–5 saves of
  // distinct catalog entries.
  const PRESET_IDS = ["area-a", "area-b", "area-c", "area-d", "area-e"];
  const PRESETS = PRESET_IDS.map((id) => ({
    id,
    name: `Preset ${id}`,
    description: "Synthetic test preset",
    waterType: "saltwater" as const,
    minDepth: 0,
    maxDepth: 100,
    centerLon: 0,
    centerLat: 0,
    bbox: { minLon: -1, minLat: -1, maxLon: 1, maxLat: 1 },
  }));
  const CATALOG_ENTRIES = PRESETS.map((p) => ({
    id: `preset-${p.id}`,
    name: p.name,
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
  }));

  // Gate for the terrain build: when set, buildTerrainGrid awaits it, so
  // saves stay "processing" (in flight) until the test releases the gate.
  const buildGate: { current: Promise<void> | null } = { current: null };

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
    PRESETS,
    CATALOG_ENTRIES,
    buildGate,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", () => {
  const colCond =
    (kind: string) =>
    (col: unknown, val?: unknown): unknown => ({ kind, col, val });
  return {
    eq: colCond("eq"),
    lt: colCond("lt"),
    lte: colCond("lte"),
    gte: colCond("gte"),
    isNull: colCond("isNull"),
    isNotNull: colCond("isNotNull"),
    inArray: colCond("inArray"),
    notInArray: colCond("notInArray"),
    and: (...parts: unknown[]) => ({ kind: "and", parts }),
    or: (...parts: unknown[]) => ({ kind: "or", parts }),
    desc: (col: unknown) => ({ kind: "desc", col }),
    asc: (col: unknown) => ({ kind: "asc", col }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      __sql: strings.join("?"),
      values,
    }),
  };
});

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
  pool: { query: async () => ({ rows: [] }), connect: async () => ({ release: () => {} }) },
}));

vi.mock("../../lib/terrain.js", async () => {
  const { createTerrainMock } = await import(
    "../../__tests__/helpers/terrainMock.js"
  );
  function makeGrid(id: string, resolution: number) {
    return {
      datasetId: id,
      name: `Grid ${id}`,
      waterType: "saltwater",
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
  return createTerrainMock({
    ALL_PRESET_DATASETS: H.PRESETS,
    PRESET_DATASETS: H.PRESETS,
    FRESHWATER_PRESET_DATASETS: [],
    NCEI_DATASET_COVERAGES: [],
    buildTerrainGrid: async (id: string, resolution: number) => {
      if (H.buildGate.current) await H.buildGate.current;
      return makeGrid(id, resolution);
    },
  });
});

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

vi.mock("../../lib/catalogSeeder.js", () => ({
  seedDatasetCatalog: async () => {},
  getCatalogEntries: async () => H.CATALOG_ENTRIES,
  searchCatalog: async () => [],
  scoreEntry: () => 1,
  invalidateCatalogCache: () => {},
}));

// Controllable reverse-geocode mock: tests set G.result to the place name
// the "geocoder" returns (null = no place found); G.calls records lookups.
const G = vi.hoisted(() => ({
  result: null as string | null,
  calls: [] as Array<{ lat: number; lon: number }>,
  /** Extra artificial delay before resolving, in milliseconds (0 = none). */
  delay: 0,
}));

vi.mock("../../lib/reverseGeocode.js", () => ({
  placeNameForPoint: async (lat: number, lon: number) => {
    G.calls.push({ lat, lon });
    if (G.delay > 0) await new Promise<void>((r) => setTimeout(r, G.delay));
    return G.result;
  },
  __clearReverseGeocodeCache: () => {},
}));

vi.mock("../../lib/efhFetcher.js", () => ({
  fetchNoaaAlaskaEfh: async () => null,
  buildCollectionFromLiveFeatures: () => ({
    type: "FeatureCollection",
    features: [],
  }),
}));

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
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";
import { deriveAreaFolderName } from "../../lib/areaRequestFolders.js";

const E2E_USER = "user_area_request_folders";
const AR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AR = { id: AR_ID, label: "Sitka Sound" };

function saveCatalog(
  catalogId: string,
  body?: Record<string, unknown>,
): request.Test {
  return request(app)
    .post(`/api/datasets/catalog/${catalogId}/save`)
    .set("x-e2e-bypass-secret", "vitest-test-secret")
    .set("x-e2e-user-id", E2E_USER)
    .send(body ?? {});
}

async function pollUntilReady(saveId: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = H.dbState.saves.find((s) => s["id"] === saveId);
    if (row && row["status"] === "ready") return;
    if (row && row["status"] === "failed") {
      throw new Error(`Save ${saveId} failed: ${String(row["errorMessage"])}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Save ${saveId} not ready within ${timeoutMs}ms`);
}

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  H.dbState.saves.length = 0;
  H.dbState.datasets.length = 0;
  H.dbState.folders.length = 0;
  H.buildGate.current = null;
  G.result = null;
  G.calls.length = 0;
  G.delay = 0;
});

// ---------------------------------------------------------------------------
// deriveAreaFolderName
// ---------------------------------------------------------------------------

describe("deriveAreaFolderName", () => {
  it("collapses whitespace and trims", () => {
    expect(deriveAreaFolderName("  Sitka   Sound \n area ")).toBe(
      "Sitka Sound area",
    );
  });

  it("falls back to a generic name for empty labels", () => {
    expect(deriveAreaFolderName("   ")).toBe("Area search");
  });

  it("caps overlong labels at 120 chars with an ellipsis", () => {
    const name = deriveAreaFolderName("x".repeat(300));
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Auto-folder grouping through the catalog save route
// ---------------------------------------------------------------------------

describe("auto-folder for multi-dataset area requests", () => {
  it("two saves from one area request stay at root (no folder)", async () => {
    const r1 = await saveCatalog("preset-area-a", { areaRequest: AR });
    const r2 = await saveCatalog("preset-area-b", { areaRequest: AR });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.folderId ?? null).toBeNull();
    expect(r2.body.folderId ?? null).toBeNull();

    await pollUntilReady(r1.body.id);
    await pollUntilReady(r2.body.id);

    expect(H.dbState.folders).toHaveLength(0);
    expect(H.dbState.saves.every((s) => s["folderId"] === null)).toBe(true);
    expect(H.dbState.datasets.every((d) => d["folderId"] === null)).toBe(true);
    // areaRequestId is stamped even below the threshold (needed to count).
    expect(
      H.dbState.saves.every((s) => s["areaRequestId"] === AR_ID),
    ).toBe(true);
  });

  it("third save creates the folder and moves in-flight saves; late materializations land inside it", async () => {
    // Hold the terrain build open so all three saves stay processing.
    let release!: () => void;
    H.buildGate.current = new Promise<void>((r) => (release = r));

    const r1 = await saveCatalog("preset-area-a", { areaRequest: AR });
    const r2 = await saveCatalog("preset-area-b", { areaRequest: AR });
    expect(H.dbState.folders).toHaveLength(0);

    const r3 = await saveCatalog("preset-area-c", { areaRequest: AR });
    expect(r3.status).toBe(201);

    // Folder exists, is named after the search, and the response row is
    // already stamped with it.
    expect(H.dbState.folders).toHaveLength(1);
    const folder = H.dbState.folders[0]!;
    expect(folder["name"]).toBe("Sitka Sound");
    expect(folder["parentId"]).toBeNull();
    expect(r3.body.folderId).toBe(folder["id"]);

    // All three save rows — two of them still in flight — are in the folder.
    for (const res of [r1, r2, r3]) {
      const row = H.dbState.saves.find((s) => s["id"] === res.body.id)!;
      expect(row["folderId"]).toBe(folder["id"]);
      expect(row["status"]).toBe("processing");
    }

    // Release the builds: every dataset must materialize INTO the folder.
    release();
    H.buildGate.current = null;
    await Promise.all([r1, r2, r3].map((r) => pollUntilReady(r.body.id)));

    expect(H.dbState.datasets).toHaveLength(3);
    expect(
      H.dbState.datasets.every((d) => d["folderId"] === folder["id"]),
    ).toBe(true);
  });

  it("datasets already materialized before folder creation are moved into it", async () => {
    const r1 = await saveCatalog("preset-area-a", { areaRequest: AR });
    const r2 = await saveCatalog("preset-area-b", { areaRequest: AR });
    await pollUntilReady(r1.body.id);
    await pollUntilReady(r2.body.id);
    expect(H.dbState.datasets.every((d) => d["folderId"] === null)).toBe(true);

    const r3 = await saveCatalog("preset-area-c", { areaRequest: AR });
    await pollUntilReady(r3.body.id);

    expect(H.dbState.folders).toHaveLength(1);
    const folderId = H.dbState.folders[0]!["id"];
    expect(H.dbState.datasets).toHaveLength(3);
    expect(
      H.dbState.datasets.every((d) => d["folderId"] === folderId),
    ).toBe(true);
    expect(
      H.dbState.saves.every((s) => s["folderId"] === folderId),
    ).toBe(true);
  });

  it("de-duplicates the folder name against existing sibling folders", async () => {
    H.dbState.folders.push({
      id: "f-existing",
      userId: E2E_USER,
      parentId: null,
      name: "Sitka Sound",
      createdAt: new Date(),
    });

    await saveCatalog("preset-area-a", { areaRequest: AR });
    await saveCatalog("preset-area-b", { areaRequest: AR });
    const r3 = await saveCatalog("preset-area-c", { areaRequest: AR });

    expect(H.dbState.folders).toHaveLength(2);
    const created = H.dbState.folders.find((f) => f["id"] !== "f-existing")!;
    expect(created["name"]).toBe("Sitka Sound 2");
    expect(r3.body.folderId).toBe(created["id"]);
  });

  it("a fourth save reuses the request's folder instead of creating another", async () => {
    for (const id of ["preset-area-a", "preset-area-b", "preset-area-c"]) {
      await saveCatalog(id, { areaRequest: AR });
    }
    expect(H.dbState.folders).toHaveLength(1);
    const folderId = H.dbState.folders[0]!["id"];

    const r4 = await saveCatalog("preset-area-d", { areaRequest: AR });
    expect(r4.status).toBe(201);
    expect(H.dbState.folders).toHaveLength(1);
    expect(r4.body.folderId).toBe(folderId);
  });

  it("saves the user manually filed elsewhere are not re-stamped", async () => {
    const r1 = await saveCatalog("preset-area-a", { areaRequest: AR });
    await saveCatalog("preset-area-b", { areaRequest: AR });

    // User manually moves the first save into their own folder.
    H.dbState.folders.push({
      id: "f-manual",
      userId: E2E_USER,
      parentId: null,
      name: "My spots",
      createdAt: new Date(),
    });
    const row1 = H.dbState.saves.find((s) => s["id"] === r1.body.id)!;
    row1["folderId"] = "f-manual";

    await saveCatalog("preset-area-c", { areaRequest: AR });

    const autoFolder = H.dbState.folders.find((f) => f["id"] !== "f-manual")!;
    expect(autoFolder["name"]).toBe("Sitka Sound");
    // The manually filed save stays where the user put it…
    expect(row1["folderId"]).toBe("f-manual");
    // …while the other two land in the auto-folder.
    const others = H.dbState.saves.filter((s) => s["id"] !== r1.body.id);
    expect(others).toHaveLength(2);
    expect(
      others.every((s) => s["folderId"] === autoFolder["id"]),
    ).toBe(true);
  });

  it("saves without an areaRequest never trigger grouping", async () => {
    for (const id of ["preset-area-a", "preset-area-b", "preset-area-c"]) {
      const res = await saveCatalog(id); // empty body — legacy client shape
      expect(res.status).toBe(201);
    }
    expect(H.dbState.folders).toHaveLength(0);
    expect(H.dbState.saves.every((s) => s["areaRequestId"] === null)).toBe(
      true,
    );
    expect(H.dbState.saves.every((s) => s["folderId"] === null)).toBe(true);
  });

  it("rejects a malformed areaRequest with 400", async () => {
    const res = await saveCatalog("preset-area-a", {
      areaRequest: { id: "not-a-uuid", label: "x" },
    });
    expect(res.status).toBe(400);
    expect(H.dbState.saves).toHaveLength(0);
  });

  it("distinct area requests get distinct folders", async () => {
    const AR2 = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "Icy Strait" };
    for (const id of ["preset-area-a", "preset-area-b", "preset-area-c"]) {
      await saveCatalog(id, { areaRequest: AR });
    }
    // The second request re-saves nothing (distinct catalog ids) and crosses
    // its own threshold independently.
    for (const id of ["preset-area-d", "preset-area-e"]) {
      await saveCatalog(id, { areaRequest: AR2 });
    }
    // Only 2 saves for AR2 → still just the AR folder.
    expect(H.dbState.folders).toHaveLength(1);
    expect(H.dbState.folders[0]!["name"]).toBe("Sitka Sound");
  });
});

// ---------------------------------------------------------------------------
// Place-name resolution for coordinate/viewport searches (areaRequest.center)
// ---------------------------------------------------------------------------

describe("area folder naming via reverse geocoding", () => {
  const COORD_AR = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    label: "Area 57.10°N, 135.50°W (25 km)",
    center: { lat: 57.1, lon: -135.5 },
  };

  it("names the folder after the geocoded place when center is present", async () => {
    G.result = "Sitka, Alaska";
    for (const id of ["preset-area-a", "preset-area-b", "preset-area-c"]) {
      await saveCatalog(id, { areaRequest: COORD_AR });
    }
    expect(H.dbState.folders).toHaveLength(1);
    expect(H.dbState.folders[0]!["name"]).toBe("Sitka, Alaska");
    expect(G.calls.length).toBeGreaterThan(0);
    expect(G.calls[0]).toEqual({ lat: 57.1, lon: -135.5 });
  });

  it("falls back to the coordinate label when no place is found", async () => {
    G.result = null;
    for (const id of ["preset-area-a", "preset-area-b", "preset-area-c"]) {
      await saveCatalog(id, { areaRequest: COORD_AR });
    }
    expect(H.dbState.folders).toHaveLength(1);
    expect(H.dbState.folders[0]!["name"]).toBe(COORD_AR.label);
  });

  it("de-duplicates geocoded names against existing sibling folders", async () => {
    G.result = "Sitka, Alaska";
    H.dbState.folders.push({
      id: "f-existing",
      userId: E2E_USER,
      parentId: null,
      name: "Sitka, Alaska",
      createdAt: new Date(),
    });
    for (const id of ["preset-area-a", "preset-area-b", "preset-area-c"]) {
      await saveCatalog(id, { areaRequest: COORD_AR });
    }
    const created = H.dbState.folders.find((f) => f["id"] !== "f-existing")!;
    expect(created["name"]).toBe("Sitka, Alaska 2");
  });

  it("never calls the geocoder for text-query searches (no center)", async () => {
    G.result = "Should Not Appear";
    for (const id of ["preset-area-a", "preset-area-b", "preset-area-c"]) {
      await saveCatalog(id, { areaRequest: AR });
    }
    expect(G.calls).toHaveLength(0);
    expect(H.dbState.folders[0]!["name"]).toBe("Sitka Sound");
  });

  it("uses the coordinate label when the geocoder times out (returns null)", async () => {
    // G.result = null simulates what placeNameForPoint returns on timeout or
    // any upstream failure; the folder must fall back to the client label.
    G.result = null;
    for (const id of ["preset-area-a", "preset-area-b", "preset-area-c"]) {
      await saveCatalog(id, { areaRequest: COORD_AR });
    }
    expect(H.dbState.folders).toHaveLength(1);
    expect(H.dbState.folders[0]!["name"]).toBe(COORD_AR.label);
    // Geocoder was still called — it just returned null (timeout/error).
    expect(G.calls.length).toBeGreaterThan(0);
  });

  it("names the folder correctly even when geocoding resolves after the DB queries (parallel race)", async () => {
    // Simulate geocoding that takes longer than the DB work (the in-parallel
    // optimisation fires it early; we must await the result before creating
    // the folder so the name is never an empty/stale string).
    G.result = "Sitka, Alaska";
    G.delay = 50;
    for (const id of ["preset-area-a", "preset-area-b", "preset-area-c"]) {
      await saveCatalog(id, { areaRequest: COORD_AR });
    }
    expect(H.dbState.folders).toHaveLength(1);
    expect(H.dbState.folders[0]!["name"]).toBe("Sitka, Alaska");
  });

  it("rejects an out-of-range center with 400", async () => {
    const res = await saveCatalog("preset-area-a", {
      areaRequest: { ...AR, center: { lat: 200, lon: 0 } },
    });
    expect(res.status).toBe(400);
    expect(H.dbState.saves).toHaveLength(0);
  });
});
