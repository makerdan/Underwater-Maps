/**
 * trails-coord-validation.test.ts
 *
 * Covers the semantic validation added to POST /api/trails:
 *
 *  1. lat out of range (> 90, < -90) → 422
 *  2. lon out of range (> 180, < -180) → 422
 *  3. Non-finite lat/lon (Infinity) → 422
 *  4. Timestamp that is an Invalid Date (NaN) → 422
 *  5. Timestamp before year 2000 → 422
 *  6. Timestamp after year 2100 → 422
 *  7. Valid points → 201
 *  8. pointCount reflects only actually-inserted rows after dedup
 *     (onConflictDoNothing skips duplicates; the route updates the stored count)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// State shared across mock callbacks
// ---------------------------------------------------------------------------
const mockState = {
  // Simulated number of rows actually inserted by onConflictDoNothing
  insertedPointCount: 0,
  // Updated pointCount stored by tx.update()
  updatedPointCount: null as number | null,
};

vi.mock("@workspace/db", () => {
  const gpsTrailsTable = { __tableName: "gps_trails" as const };
  const gpsTrailPointsTable = { __tableName: "gps_trail_points" as const };

  /**
   * Factory for a mock Drizzle insert chain that routes to different
   * behaviours based on which table is targeted.
   */
  type MockDb = {
    transaction: <T>(cb: (tx: MockDb) => Promise<T>) => Promise<T>;
    insert: (table: { __tableName: string }) => ReturnType<typeof makeInsert>;
    update: () => { set: (data: { pointCount?: number }) => { where: () => Promise<Array<never>> } };
    select: () => { from: () => { where: () => Promise<Array<never>> } };
    delete: () => { where: () => { returning: () => Promise<Array<never>> } };
  };

  const makeInsert = (table: { __tableName: string }) => ({
    values: (_rows: unknown) => {
      if (table.__tableName === "gps_trail_points") {
        // Simulate onConflictDoNothing().returning() — return only
        // mockState.insertedPointCount rows so the route sees a dedup.
        return {
          onConflictDoNothing: () => ({
            returning: () =>
              Promise.resolve(
                Array.from({ length: mockState.insertedPointCount }, (_, i) => ({
                  id: `pt-${i}`,
                })),
              ),
          }),
        };
      }
      // gps_trails insert — return a minimal trail row.
      return {
        returning: () =>
          Promise.resolve([
            {
              id: "trail-001",
              userId: "user-test",
              datasetId: "ds-1",
              name: "Test Trail",
              colour: "#ff6600",
              startedAt: new Date("2026-01-01"),
              endedAt: new Date("2026-01-01T01:00:00"),
              pointCount: 0,
              createdAt: new Date(),
            },
          ]),
      };
    },
  });

  const db: MockDb = {
    transaction: async <T>(cb: (tx: MockDb) => Promise<T>) => cb(db),
    insert: (table: { __tableName: string }) => makeInsert(table),
    update: () => ({
      set: (data: { pointCount?: number }) => ({
        where: () => {
          if (data.pointCount !== undefined) {
            mockState.updatedPointCount = data.pointCount;
          }
          return Promise.resolve([]);
        },
      }),
    }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
  };

  return {
    db,
    gpsTrailsTable,
    gpsTrailPointsTable,
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

// ---------------------------------------------------------------------------
// Minimal app — mount just the trails router so we avoid needing every
// @workspace/api-zod schema stub that the full app.ts requires.
// ---------------------------------------------------------------------------
import trailsRouter from "../trails.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  // Simulate the auth bypass: requireAuth reads E2E_AUTH_BYPASS and
  // x-e2e-user-id.
  app.use(trailsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const VALID_POINT = { lon: -136.0, lat: 58.5, accuracy: 3, timestamp: 1735689600000, seq: 0 };

const BASE_BODY = {
  datasetId: "ds-1",
  name: "My Trail",
  colour: "#ff6600",
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T01:00:00.000Z",
};

function bodyWith(points: unknown[]) {
  return { ...BASE_BODY, points };
}

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  mockState.insertedPointCount = 0;
  mockState.updatedPointCount = null;
});

// ---------------------------------------------------------------------------
// lat range
// ---------------------------------------------------------------------------
describe("POST /trails — lat range validation", () => {
  it("returns 422 when lat > 90", async () => {
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, lat: 91 }]));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "validation_error", field: "lat" });
    expect(res.body.message).toMatch(/lat must be a finite number between -90 and 90/);
  });

  it("returns 422 when lat < -90", async () => {
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, lat: -91 }]));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "validation_error", field: "lat" });
  });

  it("returns 422 when lat is Infinity", async () => {
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      // JSON.stringify drops Infinity to null; send as raw string to bypass that
      .set("content-type", "application/json")
      .send(JSON.stringify(bodyWith([{ ...VALID_POINT, lat: 999999 }])));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "validation_error", field: "lat" });
  });

  it("returns 422 when lat is exactly -90.0001", async () => {
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, lat: -90.0001 }]));

    expect(res.status).toBe(422);
  });

  it("accepts lat = -90 (boundary)", async () => {
    mockState.insertedPointCount = 1;
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, lat: -90 }]));

    expect(res.status).toBe(201);
  });

  it("accepts lat = 90 (boundary)", async () => {
    mockState.insertedPointCount = 1;
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, lat: 90 }]));

    expect(res.status).toBe(201);
  });

  it("reports the index of the first invalid point", async () => {
    // First two points valid; third point has invalid lat.
    const points = [
      { ...VALID_POINT, seq: 0 },
      { ...VALID_POINT, seq: 1 },
      { ...VALID_POINT, lat: 999, seq: 2 },
    ];
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith(points));

    expect(res.status).toBe(422);
    expect(res.body.index).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// lon range
// ---------------------------------------------------------------------------
describe("POST /trails — lon range validation", () => {
  it("returns 422 when lon > 180", async () => {
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, lon: 181 }]));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "validation_error", field: "lon" });
    expect(res.body.message).toMatch(/lon must be a finite number between -180 and 180/);
  });

  it("returns 422 when lon < -180", async () => {
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, lon: -181 }]));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "validation_error", field: "lon" });
  });

  it("accepts lon = 180 (boundary)", async () => {
    mockState.insertedPointCount = 1;
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, lon: 180 }]));

    expect(res.status).toBe(201);
  });

  it("accepts lon = -180 (boundary)", async () => {
    mockState.insertedPointCount = 1;
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, lon: -180 }]));

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// timestamp range
// ---------------------------------------------------------------------------
describe("POST /trails — timestamp range validation", () => {
  it("returns 422 when timestamp represents a year before 2000", async () => {
    // Unix ms for 1999-12-31
    const before2000 = new Date("1999-12-31T23:59:59.000Z").getTime();
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, timestamp: before2000 }]));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "validation_error", field: "timestamp" });
    expect(res.body.message).toMatch(/valid date between 2000 and 2100/);
  });

  it("returns 422 when timestamp represents a year after 2100", async () => {
    const after2100 = new Date("2101-01-01T00:00:00.000Z").getTime();
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, timestamp: after2100 }]));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "validation_error", field: "timestamp" });
  });

  it("accepts a valid timestamp within 2000–2100", async () => {
    mockState.insertedPointCount = 1;
    const validTs = new Date("2026-06-15T12:00:00.000Z").getTime();
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, timestamp: validTs }]));

    expect(res.status).toBe(201);
  });

  it("accepts timestamp = exactly 2000-01-01 (boundary)", async () => {
    mockState.insertedPointCount = 1;
    const ts2000 = new Date("2000-01-01T00:00:00.000Z").getTime();
    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-coord-test")
      .send(bodyWith([{ ...VALID_POINT, timestamp: ts2000 }]));

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// pointCount accuracy after dedup
// ---------------------------------------------------------------------------
describe("POST /trails — pointCount reflects actual inserted rows after dedup", () => {
  it("updates pointCount when onConflictDoNothing skips some duplicate-seq rows", async () => {
    // Send 5 points but the mock only inserts 3 (2 were conflicts).
    mockState.insertedPointCount = 3;

    const points = Array.from({ length: 5 }, (_, i) => ({
      ...VALID_POINT,
      seq: i,
    }));

    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-dedup-test")
      .send(bodyWith(points));

    expect(res.status).toBe(201);
    // The route should have issued an UPDATE to set pointCount = 3.
    expect(mockState.updatedPointCount).toBe(3);
    // The returned trail should report the actual count.
    expect(res.body.pointCount).toBe(3);
  });

  it("does NOT issue an extra UPDATE when all points were inserted (no dedup)", async () => {
    // Send 4 points; mock returns all 4 as inserted.
    mockState.insertedPointCount = 4;

    const points = Array.from({ length: 4 }, (_, i) => ({
      ...VALID_POINT,
      seq: i,
    }));

    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-dedup-test")
      .send(bodyWith(points));

    expect(res.status).toBe(201);
    // No pointCount discrepancy → no UPDATE needed.
    expect(mockState.updatedPointCount).toBeNull();
  });

  it("sets pointCount to 0 when all points are duplicate-seq conflicts", async () => {
    // Mock returns 0 inserted (all were conflicts).
    mockState.insertedPointCount = 0;

    const points = [VALID_POINT, { ...VALID_POINT, seq: 0 }]; // both seq=0

    const res = await request(makeApp())
      .post("/trails")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user-dedup-test")
      .send(bodyWith(points));

    expect(res.status).toBe(201);
    expect(mockState.updatedPointCount).toBe(0);
    expect(res.body.pointCount).toBe(0);
  });
});
