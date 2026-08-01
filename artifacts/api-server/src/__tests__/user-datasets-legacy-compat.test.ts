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
      if (dbState.terrainSelectQueue.length > 0) {
        return Promise.resolve(dbState.terrainSelectQueue.shift()!);
      }
      return Promise.resolve(dbState.overviewSelectResult);
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import app from "../app.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";

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
