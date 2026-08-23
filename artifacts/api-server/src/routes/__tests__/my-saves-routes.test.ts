/**
 * my-saves-routes.test.ts
 *
 * Route-level regression tests for the My Saves endpoints. These routes had
 * undefined-variable bugs (saveId, updated.catalogId, folderId) that were
 * invisible to the prior test suite. The assertions below would have caught
 * each bug before production.
 *
 * Covers:
 *  - GET  /api/datasets/my-saves              — list user's saves
 *  - GET  /api/datasets/my-saves/:id/status   — poll save status
 *  - PATCH /api/datasets/my-saves/:id/rename  — displayLabel is persisted
 *  - POST  /api/datasets/my-saves/:id/retry   — status resets to 'processing'
 *  - POST  /api/datasets/catalog/:id/save     — entry lookup uses route catalogId
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Shared test state — mutated by mocks and reset in beforeEach.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const state: {
  saves: Row[];
  lastUpdateValues: Row | null;
  insertedRows: Row[];
  customDatasets: Row[];
} = {
  saves: [],
  lastUpdateValues: null,
  insertedRows: [],
  customDatasets: [],
};

let currentUserId: string | null = "user-a";

// ---------------------------------------------------------------------------
// vi.mock declarations — must appear before any dynamic import of app.js so
// Vitest's hoisting can intercept module resolution.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => {
  type TableName = "userCatalogSaves" | "customDatasets" | "datasetFolders";
  const tag = (n: TableName) => ({ __tableName: n });
  const userCatalogSavesTable = tag("userCatalogSaves");
  const customDatasetsTable = tag("customDatasets");
  const datasetFoldersTable = tag("datasetFolders");

  /** Returns all saves belonging to the current user. */
  function userSaves() {
    return state.saves.filter((r) => r["userId"] === currentUserId);
  }

  // select(): simple filter by userId, ignoring the WHERE condition detail.
  // Every route under test enforces ownership via userId in its WHERE clause,
  // so this faithfully reproduces ownership semantics. The customDatasets
  // table is served from its own state bucket (the my-saves list route
  // bulk-fetches terrainJson to build the terrainBbox fallback).
  const select = () => ({
    from: (table: unknown) => ({
      where: () => {
        const name = (table as { __tableName?: string }).__tableName;
        if (name === "customDatasets") return Promise.resolve(state.customDatasets);
        return Promise.resolve(userSaves());
      },
    }),
  });

  // update(): finds the first row belonging to currentUserId and patches it.
  const update = (_table: unknown) => ({
    set: (values: Row) => ({
      where: () => ({
        returning: () => {
          const idx = state.saves.findIndex(
            (r) => r["userId"] === currentUserId,
          );
          if (idx === -1) return Promise.resolve([]);
          state.saves[idx] = { ...state.saves[idx]!, ...values };
          state.lastUpdateValues = values;
          return Promise.resolve([state.saves[idx]!]);
        },
      }),
    }),
  });

  let insertCounter = 0;
  const insert = (_table: unknown) => ({
    values: (vals: Row) => ({
      returning: () => {
        const row: Row = {
          id: `test-save-${++insertCounter}`,
          status: "processing",
          requestedAt: new Date("2024-06-01T00:00:00Z"),
          readyAt: null,
          cacheKey: null,
          errorMessage: null,
          displayLabel: null,
          folderId: null,
          datasetId: null,
          areaRequestId: null,
          requestBboxJson: null,
          ...vals,
        };
        state.saves.push(row);
        state.insertedRows.push(row);
        return Promise.resolve([row]);
      },
    }),
  });

  return {
    db: {
      select,
      update,
      insert,
      delete: () => ({ where: () => Promise.resolve([]) }),
      transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
    },
    userCatalogSavesTable,
    customDatasetsTable,
    datasetFoldersTable,
    userSettingsTable: {},
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: currentUserId })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

// Bypass Zod response validation so tests aren't coupled to the exact schema.
vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  const pass = { parse: (x: unknown) => x };
  return {
    ...actual,
    GetDatasetsMySavesResponse: pass,
    GetDatasetsMySavesResponseItem: pass,
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

// Catalog seeder: returns a deterministic entry when the id is "preset-ocean".
vi.mock("../../lib/catalogSeeder.js", () => ({
  seedDatasetCatalog: vi.fn(async () => {}),
  getCatalogEntries: vi.fn(async () => [CATALOG_ENTRY, CATALOG_ENTRY_FRESH]),
  searchCatalog: vi.fn(async () => []),
  invalidateCatalogCache: vi.fn(),
}));

// Area-request grouping: always a no-op (returns null → no auto-folder).
vi.mock("../../lib/areaRequestFolders.js", () => ({
  AreaRequestContextSchema: { optional: () => ({ safeParse: () => ({ success: true, data: undefined }) }) },
  applyAreaRequestGrouping: vi.fn(async () => null),
  applyCatalogSaveGrouping: vi.fn(async () => null),
}));

// Terrain builders: use the shared factory so all module-init-consumed
// constants (NYSDEC_BATHY_FEATURE_SERVICE etc.) are always present.
vi.mock("../../lib/terrain.js", async () => {
  const { createTerrainMock } = await import(
    "../../__tests__/helpers/terrainMock.js"
  );
  return createTerrainMock();
});

// EFH stubs (imported at module load by catalog-saves.ts).
vi.mock("../../lib/efhData.js", () => ({
  SALTWATER_EFH_BY_DATASET: {},
}));
vi.mock("../../lib/efhFetcher.js", () => ({
  fetchNoaaAlaskaEfh: vi.fn(async () => []),
  buildCollectionFromLiveFeatures: vi.fn(() => ({ type: "FeatureCollection", features: [] })),
}));

// ---------------------------------------------------------------------------
// Constants reused across tests
// ---------------------------------------------------------------------------

const CATALOG_ENTRY = {
  id: "preset-ocean",
  name: "Test Ocean Survey",
  sourceAgency: "GEBCO",
  dataType: "bathymetry",
  resolutionMMin: 100,
  resolutionMMax: 500,
  coverageBbox: [-180, -90, 180, 90] as [number, number, number, number],
  endpointUrl: null,
  accessNotes: null,
  description: null,
  keywords: null,
  lastUpdated: null,
  waterType: "saltwater" as const,
};

/** Freshwater catalog entry — exercises the ?waterType= filter. */
const CATALOG_ENTRY_FRESH = {
  ...CATALOG_ENTRY,
  id: "preset-lake-ray-roberts",
  name: "Lake Ray Roberts",
  sourceAgency: "TWDB",
  waterType: "freshwater" as const,
};

const SAVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Build a seed row for state.saves with sensible defaults. */
function makeSaveRow(overrides: Partial<Row> = {}): Row {
  return {
    id: SAVE_ID,
    userId: "user-a",
    catalogId: "preset-ocean",
    status: "ready",
    requestedAt: new Date("2024-06-01T00:00:00Z"),
    readyAt: new Date("2024-06-01T00:05:00Z"),
    cacheKey: "cache-key-abc",
    errorMessage: null,
    displayLabel: null,
    folderId: null,
    datasetId: "ds-1",
    areaRequestId: null,
    requestBboxJson: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Import app after all mocks are registered.
// ---------------------------------------------------------------------------

const { default: app } = await import("../../app.js");

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  state.saves = [];
  state.lastUpdateValues = null;
  state.insertedRows = [];
  state.customDatasets = [];
  currentUserId = "user-a";
});

afterAll(() => {
  state.saves = [];
  state.insertedRows = [];
});

// ===========================================================================
// GET /api/datasets/my-saves
// ===========================================================================

describe("GET /api/datasets/my-saves", () => {
  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await request(app).get("/api/datasets/my-saves");
    expect(res.status).toBe(401);
  });

  it("returns 200 with an empty array when the user has no saves", async () => {
    const res = await request(app).get("/api/datasets/my-saves");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with the user's saves", async () => {
    state.saves = [makeSaveRow()];

    const res = await request(app).get("/api/datasets/my-saves");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    const item = res.body[0];
    expect(item.id).toBe(SAVE_ID);
    expect(item.catalogId).toBe("preset-ocean");
    expect(item.status).toBe("ready");
  });

  it("does not return saves belonging to other users", async () => {
    // Another user's save — should be invisible to user-a.
    state.saves = [makeSaveRow({ userId: "user-b", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })];

    const res = await request(app).get("/api/datasets/my-saves");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("includes catalog metadata in each item when the entry exists", async () => {
    state.saves = [makeSaveRow()];

    const res = await request(app).get("/api/datasets/my-saves");

    expect(res.status).toBe(200);
    const item = res.body[0];
    expect(item.catalog).not.toBeNull();
    expect(item.catalog.id).toBe("preset-ocean");
    expect(item.catalog.name).toBe("Test Ocean Survey");
  });

  it("sets catalog to null when the catalog entry has been removed", async () => {
    // Seed a save whose catalogId doesn't exist in the mock catalog.
    state.saves = [makeSaveRow({ catalogId: "deleted-entry" })];

    const res = await request(app).get("/api/datasets/my-saves");

    expect(res.status).toBe(200);
    const item = res.body[0];
    expect(item.catalog).toBeNull();
  });
});

// ===========================================================================
// GET /api/datasets/my-saves — terrainBbox fallback for custom datasets
// ===========================================================================

describe("GET /api/datasets/my-saves — terrainBbox", () => {
  const TERRAIN_BBOX = { minLon: -122, minLat: 37, maxLon: -121, maxLat: 38 };

  it("populates terrainBbox from the custom dataset's terrainJson for orphan saves", async () => {
    // Orphan: catalog entry gone, but the materialized dataset still exists.
    state.saves = [makeSaveRow({ catalogId: "deleted-entry", datasetId: "ds-1" })];
    state.customDatasets = [
      { id: "ds-1", terrainJson: { ...TERRAIN_BBOX, depths: [] } },
    ];

    const res = await request(app).get("/api/datasets/my-saves");

    expect(res.status).toBe(200);
    expect(res.body[0].catalog).toBeNull();
    expect(res.body[0].terrainBbox).toEqual(TERRAIN_BBOX);
  });

  it("sets terrainBbox to null when the stored terrainJson bbox is malformed", async () => {
    state.saves = [makeSaveRow({ catalogId: "deleted-entry", datasetId: "ds-1" })];
    state.customDatasets = [
      // maxLat missing → invalid, must be skipped rather than served.
      { id: "ds-1", terrainJson: { minLon: -122, minLat: 37, maxLon: -121 } },
    ];

    const res = await request(app).get("/api/datasets/my-saves");

    expect(res.status).toBe(200);
    expect(res.body[0].terrainBbox).toBeNull();
  });

  it("sets terrainBbox to null when the save has no materialized dataset", async () => {
    state.saves = [makeSaveRow({ datasetId: null, status: "processing" })];

    const res = await request(app).get("/api/datasets/my-saves");

    expect(res.status).toBe(200);
    expect(res.body[0].terrainBbox).toBeNull();
  });
});

// ===========================================================================
// GET /api/datasets/my-saves — waterType filter
// ===========================================================================

describe("GET /api/datasets/my-saves — waterType filter", () => {
  const FRESH_SAVE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const ORPHAN_SAVE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  /** One saltwater save, one freshwater save, one orphan (catalog entry gone). */
  function seedMixedSaves() {
    state.saves = [
      makeSaveRow(), // saltwater (preset-ocean)
      makeSaveRow({ id: FRESH_SAVE_ID, catalogId: "preset-lake-ray-roberts", datasetId: "ds-2" }),
      makeSaveRow({ id: ORPHAN_SAVE_ID, catalogId: "deleted-entry", datasetId: "ds-3" }),
    ];
  }

  it("?waterType=freshwater returns only freshwater saves plus orphans", async () => {
    seedMixedSaves();

    const res = await request(app).get("/api/datasets/my-saves?waterType=freshwater");

    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((s) => s.id).sort();
    expect(ids).toEqual([FRESH_SAVE_ID, ORPHAN_SAVE_ID].sort());
  });

  it("?waterType=saltwater returns only saltwater saves plus orphans", async () => {
    seedMixedSaves();

    const res = await request(app).get("/api/datasets/my-saves?waterType=saltwater");

    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((s) => s.id).sort();
    expect(ids).toEqual([SAVE_ID, ORPHAN_SAVE_ID].sort());
  });

  it("no waterType param returns all saves (unfiltered)", async () => {
    seedMixedSaves();

    const res = await request(app).get("/api/datasets/my-saves");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it("returns 400 invalid_param for an unknown waterType value", async () => {
    seedMixedSaves();

    const res = await request(app).get("/api/datasets/my-saves?waterType=brackish");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });
});

// ===========================================================================
// GET /api/datasets/my-saves/:id/status
// ===========================================================================

describe("GET /api/datasets/my-saves/:id/status", () => {
  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await request(app).get(`/api/datasets/my-saves/${SAVE_ID}/status`);
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-UUID save id", async () => {
    const res = await request(app).get("/api/datasets/my-saves/not-a-uuid/status");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });

  it("returns 404 when the save doesn't exist", async () => {
    const res = await request(app).get(`/api/datasets/my-saves/${SAVE_ID}/status`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the save belongs to another user", async () => {
    state.saves = [makeSaveRow({ userId: "user-b" })];
    // currentUserId is "user-a" — user-b's save is invisible.
    const res = await request(app).get(`/api/datasets/my-saves/${SAVE_ID}/status`);
    expect(res.status).toBe(404);
  });

  it("returns 200 with the save status fields", async () => {
    state.saves = [makeSaveRow({ status: "processing" })];

    const res = await request(app).get(`/api/datasets/my-saves/${SAVE_ID}/status`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(SAVE_ID);
    expect(res.body.status).toBe("processing");
    expect(res.body.catalogId).toBe("preset-ocean");
  });

  it("includes requestedAt as an ISO string in the response", async () => {
    state.saves = [makeSaveRow()];

    const res = await request(app).get(`/api/datasets/my-saves/${SAVE_ID}/status`);

    expect(res.status).toBe(200);
    expect(typeof res.body.requestedAt).toBe("string");
    expect(() => new Date(res.body.requestedAt)).not.toThrow();
  });
});

// ===========================================================================
// PATCH /api/datasets/my-saves/:id/rename
// ===========================================================================

describe("PATCH /api/datasets/my-saves/:id/rename", () => {
  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/rename`)
      .send({ displayLabel: "My Custom Name" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-UUID save id", async () => {
    const res = await request(app)
      .patch("/api/datasets/my-saves/not-a-uuid/rename")
      .send({ displayLabel: "name" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });

  it("returns 400 when displayLabel exceeds 200 characters", async () => {
    state.saves = [makeSaveRow()];
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/rename`)
      .send({ displayLabel: "a".repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_name");
  });

  it("returns 400 when body is missing displayLabel key", async () => {
    state.saves = [makeSaveRow()];
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/rename`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 when the save doesn't exist or belongs to another user", async () => {
    // state.saves is empty → update returns []
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/rename`)
      .send({ displayLabel: "New Name" });
    expect(res.status).toBe(404);
  });

  it("persists the displayLabel and returns 200", async () => {
    state.saves = [makeSaveRow()];

    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/rename`)
      .send({ displayLabel: "My Custom Name" });

    expect(res.status).toBe(200);
    // The update mock patches the row, so lastUpdateValues captures what was set.
    expect(state.lastUpdateValues).toMatchObject({ displayLabel: "My Custom Name" });
    expect(res.body.displayLabel).toBe("My Custom Name");
  });

  it("trims whitespace from displayLabel before persisting", async () => {
    state.saves = [makeSaveRow()];

    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/rename`)
      .send({ displayLabel: "  Padded Name  " });

    expect(res.status).toBe(200);
    expect(state.lastUpdateValues).toMatchObject({ displayLabel: "Padded Name" });
  });

  it("converts empty string displayLabel to null (clear override)", async () => {
    state.saves = [makeSaveRow({ displayLabel: "Old Name" })];

    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/rename`)
      .send({ displayLabel: "" });

    expect(res.status).toBe(200);
    expect(state.lastUpdateValues).toMatchObject({ displayLabel: null });
  });

  it("accepts null displayLabel to clear the override", async () => {
    state.saves = [makeSaveRow({ displayLabel: "Old Name" })];

    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/rename`)
      .send({ displayLabel: null });

    expect(res.status).toBe(200);
    expect(state.lastUpdateValues).toMatchObject({ displayLabel: null });
  });

  it("includes catalog metadata in the response", async () => {
    state.saves = [makeSaveRow()];

    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/rename`)
      .send({ displayLabel: "Renamed" });

    expect(res.status).toBe(200);
    expect(res.body.catalog).not.toBeNull();
    expect(res.body.catalog.id).toBe("preset-ocean");
  });
});

// ===========================================================================
// POST /api/datasets/my-saves/:id/retry
// ===========================================================================

describe("POST /api/datasets/my-saves/:id/retry", () => {
  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await request(app).post(`/api/datasets/my-saves/${SAVE_ID}/retry`);
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-UUID save id", async () => {
    const res = await request(app).post("/api/datasets/my-saves/not-a-uuid/retry");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });

  it("returns 404 when the save doesn't exist", async () => {
    const res = await request(app).post(`/api/datasets/my-saves/${SAVE_ID}/retry`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the save belongs to another user", async () => {
    state.saves = [makeSaveRow({ userId: "user-b" })];
    const res = await request(app).post(`/api/datasets/my-saves/${SAVE_ID}/retry`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the catalog entry no longer exists", async () => {
    // Save references a catalog entry that has been removed from the catalog.
    state.saves = [makeSaveRow({ status: "failed", catalogId: "deleted-entry" })];

    const res = await request(app).post(`/api/datasets/my-saves/${SAVE_ID}/retry`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 200 without updating when the save is already 'ready' (no-op)", async () => {
    state.saves = [makeSaveRow({ status: "ready" })];

    const res = await request(app).post(`/api/datasets/my-saves/${SAVE_ID}/retry`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    // The DB should not have been updated.
    expect(state.lastUpdateValues).toBeNull();
  });

  it("returns 200 without updating when the save is already 'processing' (no-op)", async () => {
    state.saves = [makeSaveRow({ status: "processing" })];

    const res = await request(app).post(`/api/datasets/my-saves/${SAVE_ID}/retry`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("processing");
    expect(state.lastUpdateValues).toBeNull();
  });

  it("resets a failed save to 'processing' and clears the error message", async () => {
    state.saves = [
      makeSaveRow({
        status: "failed",
        errorMessage: "Materialization timed out.",
      }),
    ];

    const res = await request(app).post(`/api/datasets/my-saves/${SAVE_ID}/retry`);

    expect(res.status).toBe(200);
    // The update must set status → processing and clear errorMessage.
    expect(state.lastUpdateValues).toMatchObject({
      status: "processing",
      errorMessage: null,
    });
    expect(res.body.status).toBe("processing");
    expect(res.body.errorMessage).toBeNull();
  });

  it("returns the catalogId from the save row (not an undefined variable)", async () => {
    // Regression guard: the original bug used `updated.catalogId` where
    // `updated` was undefined. The correct variable is `row.catalogId` (from
    // the initial select) and, after the update, the returned row's catalogId.
    state.saves = [makeSaveRow({ status: "failed" })];

    const res = await request(app).post(`/api/datasets/my-saves/${SAVE_ID}/retry`);

    expect(res.status).toBe(200);
    expect(res.body.catalogId).toBe("preset-ocean");
  });
});

// ===========================================================================
// POST /api/datasets/catalog/:id/save
// ===========================================================================

describe("POST /api/datasets/catalog/:id/save", () => {
  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await request(app).post("/api/datasets/catalog/preset-ocean/save");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the catalog entry does not exist", async () => {
    const res = await request(app).post("/api/datasets/catalog/no-such-entry/save");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 201 and creates a save row for a known catalog entry", async () => {
    const res = await request(app).post("/api/datasets/catalog/preset-ocean/save");

    expect(res.status).toBe(201);
    // A row must have been inserted.
    expect(state.insertedRows).toHaveLength(1);
    const created = state.insertedRows[0]!;
    // The save row must reference the catalogId from the route param.
    expect(created["catalogId"]).toBe("preset-ocean");
    expect(created["userId"]).toBe("user-a");
    expect(created["status"]).toBe("processing");
  });

  it("response body uses the route-param catalogId (regression: was using undefined variable)", async () => {
    // Before the fix, `formatSaveRow(created, entry)` was called with `entry`
    // looked up from `updated.catalogId` — but `updated` was never defined in
    // that scope. The fix uses `catalogId` (from the validated route param).
    const res = await request(app).post("/api/datasets/catalog/preset-ocean/save");

    expect(res.status).toBe(201);
    expect(res.body.catalogId).toBe("preset-ocean");
    // The catalog sub-object must be populated (requires a successful lookup).
    expect(res.body.catalog).not.toBeNull();
    expect(res.body.catalog.id).toBe("preset-ocean");
  });

  it("returns 200 (idempotent) when the user already has a save for this entry", async () => {
    // Pre-seed an existing save for user-a + preset-ocean with no requestBbox.
    state.saves = [
      makeSaveRow({ status: "ready", requestBboxJson: null }),
    ];

    const res = await request(app).post("/api/datasets/catalog/preset-ocean/save");

    // Idempotent: must return 200 (not 201) and not insert a duplicate.
    expect(res.status).toBe(200);
    expect(state.insertedRows).toHaveLength(0);
  });

  it("returns 201 with status 'processing' for a freshly created save", async () => {
    const res = await request(app).post("/api/datasets/catalog/preset-ocean/save");

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("processing");
  });
});
