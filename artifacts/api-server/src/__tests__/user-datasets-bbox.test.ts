/**
 * user-datasets-bbox.test.ts
 *
 * Regression tests for the `bbox` field on GET /api/user/datasets.
 *
 *   - A dataset whose stored terrainJson carries valid geographic bounds
 *     (minLon / maxLon / minLat / maxLat) must expose a `bbox` object in the
 *     list response so the proximity hook can compute Haversine distances.
 *
 *   - A dataset with no terrain data (terrainJson = null) must return the item
 *     without a `bbox` field (absent / undefined) — not an error.
 *
 * The GET /user/datasets route chains:
 *   db.select(...).from(table).where(...).orderBy(...)
 * The mock must honour all four chain methods.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const dbState = vi.hoisted(() => ({
  // Each test push the rows to return from .orderBy().
  listResult: [] as unknown[],
}));

// ---------------------------------------------------------------------------
// Mocks (before module imports so Vitest hoisting applies)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");

  // Chain: select().from().where().orderBy()
  const orderByMock = vi.fn(() => Promise.resolve(dbState.listResult));
  const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });

  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({ from: fromMock }),
    },
  });
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
  getAuth: vi.fn((req: { headers: Record<string, string> }) => ({
    userId: req.headers["x-mock-clerk-user-id"] ?? null,
  })),
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
// Helpers
// ---------------------------------------------------------------------------

const AUTHED = { "x-mock-clerk-user-id": "user_bbox_test" };

/**
 * Minimal valid `terrainJson` blob that carries geographic bounds.
 * `extractBbox()` only needs the four numeric bound fields to be finite.
 */
function terrainBlobWithBbox(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    datasetId: "test-ds",
    name: "Test Dataset",
    waterType: "saltwater",
    resolution: 16,
    width: 16,
    height: 16,
    depths: Array<number>(16 * 16).fill(5),
    minDepth: 5,
    maxDepth: 5,
    minLon: -122.5,
    maxLon: -122.0,
    minLat: 37.5,
    maxLat: 38.0,
    centerLon: -122.25,
    centerLat: 37.75,
    ...overrides,
  };
}

/** Minimal DB row shape expected by metaJson(). */
function dbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    name: "Test Dataset",
    minDepth: 5,
    maxDepth: 5,
    folderId: null,
    createdAt: new Date("2024-06-01T00:00:00Z"),
    needsGeoreferencing: null,
    pendingRasterGzBase64: null,
    tideStationJson: null,
    terrainJson: null,
    overviewJson: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetRateLimitMemory();
  dbState.listResult = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/user/datasets — bbox field", () => {
  it("includes a bbox object when the stored terrainJson carries geographic bounds", async () => {
    dbState.listResult = [
      dbRow({
        id: "ds-with-terrain",
        name: "Survey With Bbox",
        terrainJson: terrainBlobWithBbox(),
      }),
    ];

    const res = await request(app)
      .get("/api/user/datasets")
      .set(AUTHED);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const item = res.body[0] as Record<string, unknown>;
    expect(item).toHaveProperty("bbox");
    const bbox = item["bbox"] as Record<string, number>;
    expect(bbox).toMatchObject({
      minLon: -122.5,
      maxLon: -122.0,
      minLat: 37.5,
      maxLat: 38.0,
    });
  });

  it("omits the bbox field when terrainJson is null", async () => {
    dbState.listResult = [
      dbRow({
        id: "ds-no-terrain",
        name: "Survey Without Terrain",
        terrainJson: null,
        overviewJson: null,
      }),
    ];

    const res = await request(app)
      .get("/api/user/datasets")
      .set(AUTHED);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const item = res.body[0] as Record<string, unknown>;
    // bbox must be absent (extractBbox returns null → metaJson omits the key).
    expect(item).not.toHaveProperty("bbox");
  });

  it("returns both bbox and null-bbox items correctly in the same response", async () => {
    dbState.listResult = [
      dbRow({
        id: "ds-has-bbox",
        name: "Survey With Bbox",
        terrainJson: terrainBlobWithBbox({ minLon: -130, maxLon: -125, minLat: 55, maxLat: 57 }),
      }),
      dbRow({
        id: "ds-no-bbox",
        name: "Survey Without Bbox",
        terrainJson: null,
        overviewJson: null,
      }),
    ];

    const res = await request(app)
      .get("/api/user/datasets")
      .set(AUTHED);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const withBbox = (res.body as Record<string, unknown>[]).find((r) => r["id"] === "ds-has-bbox");
    const withoutBbox = (res.body as Record<string, unknown>[]).find((r) => r["id"] === "ds-no-bbox");

    expect(withBbox).toHaveProperty("bbox");
    expect((withBbox!["bbox"] as Record<string, number>).minLon).toBe(-130);
    expect(withoutBbox).not.toHaveProperty("bbox");
  });

  it("falls back to overviewJson for bbox when terrainJson is null but overviewJson has bounds", async () => {
    const overviewBlob = terrainBlobWithBbox({ minLon: -140, maxLon: -138, minLat: 60, maxLat: 61 });
    dbState.listResult = [
      dbRow({
        id: "ds-overview-only",
        name: "Overview-Only Survey",
        terrainJson: null,
        overviewJson: overviewBlob,
      }),
    ];

    const res = await request(app)
      .get("/api/user/datasets")
      .set(AUTHED);

    expect(res.status).toBe(200);
    const item = res.body[0] as Record<string, unknown>;
    expect(item).toHaveProperty("bbox");
    const bbox = item["bbox"] as Record<string, number>;
    expect(bbox.minLon).toBe(-140);
    expect(bbox.maxLon).toBe(-138);
  });

  it("returns 401 when the request is not authenticated", async () => {
    const res = await request(app).get("/api/user/datasets");
    expect(res.status).toBe(401);
  });

  it("returns an empty array when the user has no datasets", async () => {
    dbState.listResult = [];

    const res = await request(app)
      .get("/api/user/datasets")
      .set(AUTHED);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
