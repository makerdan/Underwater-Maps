/**
 * user-datasets-legacy-compat.test.ts
 *
 * Regression tests for the read-path sanitization of pre-freshwater
 * custom_datasets rows.  Two legacy conditions can cause the strict Zod
 * `.parse()` to throw a 500:
 *
 *   1. Rows stored before 2026-07-19 lack `waterType` in their terrainJson /
 *      overviewJson blobs.  The routes must inject `waterType: "saltwater"` so
 *      the parse succeeds.
 *
 *   2. Rows materialized from old catalog saves may carry
 *      `dataSource: "synthetic"`.  That value was removed from the enum; the
 *      routes must strip it before parsing.
 *
 * The terrain route uses two sequential db.select calls (first a size pre-check
 * via pg_column_size, then the actual terrainJson fetch).  The mock returns
 * them in order via mockReturnValueOnce.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Shared mock state — mutated per test before each request
// ---------------------------------------------------------------------------

const dbState = vi.hoisted(() => ({
  // Terrain route issues two selects: [sizeRow, terrainRow].
  // Push them in order; the mock shifts them off.
  terrainSelectQueue: [] as unknown[][],
  // Overview route issues one select: [overviewRow].
  overviewSelectResult: [] as unknown[],
}));

// Catalog entries returned by the mocked catalogSeeder — used by the legacy
// waterType override tests (linked catalog save → canonical waterType).
const catalogState = vi.hoisted(() => ({
  entries: [] as Array<{ id: string; waterType: string }>,
}));

// ---------------------------------------------------------------------------
// Mocks (declared before module imports so Vitest hoisting applies)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");

  // Each call to db.select() returns a fresh fluent chain.
  // The from() → where() terminal resolves from the queue.
  let callCount = 0;
  const selectMock = vi.fn(() => {
    const callIndex = callCount++;
    const whereFn = vi.fn(() => {
      // Terrain tests push two entries (size row then terrain row).
      // Overview tests push one entry.
      const result =
        dbState.terrainSelectQueue.length > 0
          ? Promise.resolve(dbState.terrainSelectQueue.shift()!)
          : Promise.resolve(dbState.overviewSelectResult);
      // GET /user/datasets chains .orderBy() after .where() — support both
      // awaiting the where() result directly and chaining orderBy first.
      return Object.assign(result, { orderBy: vi.fn(() => result) });
    });
    void callIndex; // suppress unused-variable lint
    return { from: vi.fn().mockReturnValue({ where: whereFn }) };
  });

  return createDbMock({ db: { select: selectMock } });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  desc: vi.fn(() => "desc-condition"),
  sql: vi.fn(() => "sql-condition"),
  lt: vi.fn(() => "lt-condition"),
  inArray: vi.fn(() => "in-condition"),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => {
    const header = req.headers["x-mock-clerk-user-id"];
    return { userId: header ?? null };
  }),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

// Catalog seeder — the legacy waterType read-path fix looks up the linked
// catalog entry's waterType via getCatalogEntries(), and EXTRA_CATALOG_ENTRIES
// is used as a static fallback for fw-* ids when the catalog DB row is absent.
vi.mock("../lib/catalogSeeder.js", () => ({
  seedDatasetCatalog: vi.fn(async () => {}),
  getCatalogEntries: vi.fn(async () => catalogState.entries),
  searchCatalog: vi.fn(async () => []),
  EXTRA_CATALOG_ENTRIES: [
    { id: "fw-lake-tahoe-ca-nv", waterType: "freshwater" },
    { id: "fw-lake-of-the-woods-mn", waterType: "freshwater" },
  ],
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import app from "../app.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";
import { sanitizeLegacyStoredJson } from "../routes/user-datasets.js";
import { getCatalogEntries } from "../lib/catalogSeeder.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const AUTHED_HEADER = { "x-mock-clerk-user-id": "user_legacy_test" };
const DATASET_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Size below MAX_TERRAIN_JSON_BYTES so the size pre-check passes. */
const SAFE_SIZE = 1_000;

/** Minimal valid terrain blob — every required field present, waterType omitted. */
function minimalTerrainBlob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    datasetId: DATASET_ID,
    name: "Test Dataset",
    // waterType intentionally absent in the "legacy missing" variant
    resolution: 64,
    width: 64,
    height: 64,
    depths: Array(64 * 64).fill(10),
    minDepth: 10,
    maxDepth: 10,
    minLon: -70,
    maxLon: -69,
    minLat: 41,
    maxLat: 42,
    centerLon: -69.5,
    centerLat: 41.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetRateLimitMemory();
  dbState.terrainSelectQueue = [];
  dbState.overviewSelectResult = [];
  catalogState.entries = [];
});

// ===========================================================================
// GET /api/user/datasets/:id/terrain — legacy blob sanitization
// ===========================================================================

describe("GET /api/user/datasets/:id/terrain — legacy blob sanitization", () => {
  it("returns 200 with waterType=saltwater when the stored blob lacks waterType", async () => {
    const blob = minimalTerrainBlob(); // no waterType field
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],  // pg_column_size pre-check
      [{ terrainJson: blob }], // actual fetch
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "saltwater");
  });

  it("returns 200 with waterType=saltwater when the stored blob has waterType=null", async () => {
    const blob = minimalTerrainBlob({ waterType: null });
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],
      [{ terrainJson: blob }],
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "saltwater");
  });

  it("returns 200 with dataSource absent when the stored blob has dataSource=synthetic", async () => {
    const blob = minimalTerrainBlob({ waterType: "saltwater", dataSource: "synthetic" });
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],
      [{ terrainJson: blob }],
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("dataSource");
  });

  it("returns 200 when both waterType is absent AND dataSource=synthetic", async () => {
    const blob = minimalTerrainBlob({ dataSource: "synthetic" });
    // no waterType either
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],
      [{ terrainJson: blob }],
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "saltwater");
    expect(res.body).not.toHaveProperty("dataSource");
  });

  it("does not alter a valid modern blob (waterType=freshwater, dataSource=mn-dnr)", async () => {
    const blob = minimalTerrainBlob({ waterType: "freshwater", dataSource: "mn-dnr" });
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],
      [{ terrainJson: blob }],
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "freshwater");
    expect(res.body).toHaveProperty("dataSource", "mn-dnr");
  });
});

// ===========================================================================
// GET /api/user/datasets/:id/overview — legacy blob sanitization
// ===========================================================================

describe("GET /api/user/datasets/:id/overview — legacy blob sanitization", () => {
  it("returns 200 with waterType=saltwater when the stored blob lacks waterType", async () => {
    const blob = minimalTerrainBlob(); // no waterType field
    dbState.overviewSelectResult = [{ overviewJson: blob }];

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/overview`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "saltwater");
  });

  it("returns 200 with dataSource absent when the stored blob has dataSource=synthetic", async () => {
    const blob = minimalTerrainBlob({ waterType: "saltwater", dataSource: "synthetic" });
    dbState.overviewSelectResult = [{ overviewJson: blob }];

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/overview`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("dataSource");
  });

  it("returns 200 when both waterType is absent AND dataSource=synthetic", async () => {
    const blob = minimalTerrainBlob({ dataSource: "synthetic" });
    dbState.overviewSelectResult = [{ overviewJson: blob }];

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/overview`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "saltwater");
    expect(res.body).not.toHaveProperty("dataSource");
  });

  it("does not alter a valid modern blob (waterType=saltwater, dataSource=ncei)", async () => {
    const blob = minimalTerrainBlob({ waterType: "saltwater", dataSource: "ncei" });
    dbState.overviewSelectResult = [{ overviewJson: blob }];

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/overview`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "saltwater");
    expect(res.body).toHaveProperty("dataSource", "ncei");
  });
});

// ===========================================================================
// Legacy waterType override — linked catalog save resolves the real type
// ===========================================================================

describe("legacy waterType override from linked catalog save", () => {
  const FRESH_ENTRY = { id: "preset-lake-ray-roberts", waterType: "freshwater" };

  it("terrain: legacy blob linked to a freshwater catalog save returns waterType=freshwater", async () => {
    catalogState.entries = [FRESH_ENTRY];
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],                          // pg_column_size pre-check
      [{ terrainJson: minimalTerrainBlob() }],        // legacy blob, no waterType
      [{ catalogId: "preset-lake-ray-roberts" }],     // linked user_catalog_saves row
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "freshwater");
  });

  it("terrain: Ray Roberts-linked legacy blob returns freshwater even when the catalog DB entry is absent", async () => {
    // The seeder reconcile purges & re-creates preset-* rows on boot, so the
    // catalog DB row can be momentarily missing. The in-code preset registry
    // (ALL_PRESET_DATASETS) must win — Lake Ray Roberts is always freshwater.
    catalogState.entries = []; // catalog table empty
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],
      [{ terrainJson: minimalTerrainBlob() }],
      [{ catalogId: "preset-lake-ray-roberts" }],
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "freshwater");
  });

  it("terrain: Ray Roberts-linked legacy blob returns freshwater when the catalog lookup throws", async () => {
    vi.mocked(getCatalogEntries).mockRejectedValueOnce(new Error("catalog lookup failed"));
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],
      [{ terrainJson: minimalTerrainBlob() }],
      [{ catalogId: "preset-lake-ray-roberts" }],
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "freshwater");
  });

  it("terrain: legacy blob whose linked save points at a deleted catalog entry falls back to saltwater", async () => {
    catalogState.entries = [FRESH_ENTRY];
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],
      [{ terrainJson: minimalTerrainBlob() }],
      [{ catalogId: "gone-entry" }],
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "saltwater");
  });

  it("terrain: modern blob with stored waterType is NOT overridden by the catalog lookup", async () => {
    catalogState.entries = [FRESH_ENTRY];
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],
      [{ terrainJson: minimalTerrainBlob({ waterType: "saltwater" }) }],
      // No third select expected — stored value wins without a lookup.
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "saltwater");
  });

  it("overview: legacy blob linked to a freshwater catalog save returns waterType=freshwater", async () => {
    catalogState.entries = [FRESH_ENTRY];
    dbState.terrainSelectQueue.push(
      [{ overviewJson: minimalTerrainBlob() }],       // overview fetch
      [{ catalogId: "preset-lake-ray-roberts" }],     // linked save lookup
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/overview`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "freshwater");
  });

  it("overview: Ray Roberts-linked legacy blob returns freshwater even when the catalog DB entry is absent", async () => {
    catalogState.entries = []; // catalog table empty — preset registry must win
    dbState.terrainSelectQueue.push(
      [{ overviewJson: minimalTerrainBlob() }],       // overview fetch
      [{ catalogId: "preset-lake-ray-roberts" }],     // linked save lookup
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/overview`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "freshwater");
  });
});

// ===========================================================================
// Legacy waterType override — fw-* ids fall back to freshwater even when the
// catalog DB entry is absent (seeder reconcile window / transient failure)
// ===========================================================================

describe("legacy waterType override — fw-* catalog ids resolve freshwater without DB row", () => {
  const FW_CATALOG_ID = "fw-lake-tahoe-ca-nv";

  it("terrain: fw-*-linked legacy blob returns freshwater when the catalog DB entry is absent", async () => {
    catalogState.entries = []; // catalog table empty during seeder reconcile window
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],
      [{ terrainJson: minimalTerrainBlob() }],
      [{ catalogId: FW_CATALOG_ID }],
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "freshwater");
  });

  it("terrain: fw-*-linked legacy blob returns freshwater when the catalog lookup throws", async () => {
    vi.mocked(getCatalogEntries).mockRejectedValueOnce(new Error("catalog lookup failed"));
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],
      [{ terrainJson: minimalTerrainBlob() }],
      [{ catalogId: FW_CATALOG_ID }],
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "freshwater");
  });

  it("terrain: fw-*-linked legacy blob returns freshwater when catalog DB has the row too", async () => {
    catalogState.entries = [{ id: FW_CATALOG_ID, waterType: "freshwater" }];
    dbState.terrainSelectQueue.push(
      [{ size: SAFE_SIZE }],
      [{ terrainJson: minimalTerrainBlob() }],
      [{ catalogId: FW_CATALOG_ID }],
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/terrain`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "freshwater");
  });

  it("overview: fw-*-linked legacy blob returns freshwater when the catalog DB entry is absent", async () => {
    catalogState.entries = []; // catalog table empty
    dbState.terrainSelectQueue.push(
      [{ overviewJson: minimalTerrainBlob() }],
      [{ catalogId: FW_CATALOG_ID }],
    );

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/overview`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("waterType", "freshwater");
  });
});

// ===========================================================================
// sanitizeLegacyStoredJson — fallback override unit tests
// ===========================================================================

describe("sanitizeLegacyStoredJson fallback override", () => {
  it("uses the provided fallback when waterType is missing", () => {
    expect(sanitizeLegacyStoredJson({}, "freshwater")["waterType"]).toBe("freshwater");
  });

  it("defaults to saltwater when no fallback is provided", () => {
    expect(sanitizeLegacyStoredJson({})["waterType"]).toBe("saltwater");
  });

  it("keeps a valid stored waterType even when a different fallback is provided", () => {
    expect(
      sanitizeLegacyStoredJson({ waterType: "saltwater" }, "freshwater")["waterType"],
    ).toBe("saltwater");
  });

  it("replaces an invalid stored waterType with the fallback", () => {
    expect(
      sanitizeLegacyStoredJson({ waterType: "brackish" }, "freshwater")["waterType"],
    ).toBe("freshwater");
  });
});

// ===========================================================================
// GET /api/user/datasets — metaJson waterType exposure
// ===========================================================================

describe("GET /api/user/datasets — metaJson waterType", () => {
  function makeListRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: DATASET_ID,
      name: "Upload",
      minDepth: 5,
      maxDepth: 50,
      folderId: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      needsGeoreferencing: null,
      pendingRasterGzBase64: null,
      tideStationJson: null,
      terrainJson: null,
      overviewJson: null,
      ...overrides,
    };
  }

  it("exposes waterType=freshwater from the stored terrain JSON", async () => {
    dbState.terrainSelectQueue.push([
      makeListRow({ terrainJson: minimalTerrainBlob({ waterType: "freshwater" }) }),
    ]);

    const res = await request(app).get("/api/user/datasets").set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toHaveProperty("waterType", "freshwater");
  });

  it("defaults a legacy grid (no stored waterType) to saltwater", async () => {
    dbState.terrainSelectQueue.push([
      makeListRow({ terrainJson: minimalTerrainBlob() }),
    ]);

    const res = await request(app).get("/api/user/datasets").set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty("waterType", "saltwater");
  });

  it("omits waterType entirely when the row has no stored grids", async () => {
    dbState.terrainSelectQueue.push([makeListRow()]);

    const res = await request(app).get("/api/user/datasets").set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty("waterType");
  });
});
