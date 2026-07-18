/**
 * POST /api/markers — quickCatch one-tap drop behaviour.
 *
 * Verifies:
 *  - quickCatch:true atomically allocates the next per-user sequence number
 *    (INSERT ... ON CONFLICT DO UPDATE) and overrides the label to "Catch N".
 *  - Conditions snapshot is persisted alongside the marker.
 *  - Normal (non-quickCatch) creates never touch the counter table.
 *  - PATCH edits preserve the frozen snapshot (route never writes conditions).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const qdMocks = vi.hoisted(() => {
  const state = { lastSeq: 0 };

  // catch_counters insert chain: values().onConflictDoUpdate().returning()
  const counterReturningMock = vi.fn().mockImplementation(() => {
    state.lastSeq += 1;
    return Promise.resolve([{ lastSeq: state.lastSeq }]);
  });
  const counterConflictMock = vi.fn().mockReturnValue({ returning: counterReturningMock });
  const counterValuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: counterConflictMock });

  // markers insert chain: values().returning() — echoes back what was inserted
  const markerReturningMock = vi.fn();
  const markerValuesMock = vi.fn().mockImplementation((vals: Record<string, unknown>) => {
    markerReturningMock.mockResolvedValue([
      { id: "33333333-3333-3333-3333-333333333333", createdAt: new Date().toISOString(), ...vals },
    ]);
    return { returning: markerReturningMock };
  });

  const insertMock = vi.fn().mockImplementation((table: { lastSeq?: string }) => {
    if (table && "lastSeq" in table) return { values: counterValuesMock };
    return { values: markerValuesMock };
  });

  return { state, insertMock, counterValuesMock, counterConflictMock, markerValuesMock };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({ db: { insert: qdMocks.insertMock } });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
  sql: vi.fn(() => "sql-fragment"),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => ({
    userId: req.headers["x-mock-clerk-user-id"] || null,
  })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";

const AUTHED_HEADER = { "x-mock-clerk-user-id": "user_qd_test" };

const BASE_BODY = {
  datasetId: "thorne-bay",
  lon: -132.53,
  lat: 55.69,
  depth: 42,
  label: "Catch",
};

const CONDITIONS = {
  capturedAt: "2026-07-18T05:00:00.000Z",
  gpsAccuracyM: 8,
  speedMps: 1.2,
  headingDeg: 271,
  depthM: 42.5,
  depthSource: "terrain",
  tideHeightM: 1.8,
  currentSpeedKt: 0.6,
  currentDirDeg: 130,
  tideSource: "pack",
  windSpeedKnots: null,
  windDirDeg: null,
  tempC: null,
  weatherObservedAt: null,
  weatherSource: "unavailable",
};

beforeEach(() => {
  qdMocks.state.lastSeq = 0;
  qdMocks.insertMock.mockClear();
  qdMocks.markerValuesMock.mockClear();
  qdMocks.counterValuesMock.mockClear();
});

describe("POST /api/markers — quickCatch", () => {
  it("assigns 'Catch 1' and catchSeq via the counter upsert", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ ...BASE_BODY, quickCatch: true, conditions: CONDITIONS });

    expect(res.status).toBe(201);
    expect(res.body.label).toBe("Catch 1");
    expect(res.body.catchSeq).toBe(1);
    expect(qdMocks.counterValuesMock).toHaveBeenCalledWith({ userId: "user_qd_test", lastSeq: 1 });
    // Conditions snapshot persisted with the marker row.
    expect(res.body.conditions).toMatchObject({
      depthSource: "terrain",
      tideSource: "pack",
      gpsAccuracyM: 8,
    });
  });

  it("increments monotonically across drops (Catch 2 after Catch 1)", async () => {
    await request(app).post("/api/markers").set(AUTHED_HEADER).send({ ...BASE_BODY, quickCatch: true });
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ ...BASE_BODY, quickCatch: true });

    expect(res.status).toBe(201);
    expect(res.body.label).toBe("Catch 2");
    expect(res.body.catchSeq).toBe(2);
  });

  it("overrides the client-provided label when quickCatch is set", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ ...BASE_BODY, label: "My own name", quickCatch: true });

    expect(res.status).toBe(201);
    expect(res.body.label).toBe("Catch 1");
  });

  it("does not touch the counter for normal creates and leaves catchSeq null", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ ...BASE_BODY, label: "Manual marker" });

    expect(res.status).toBe(201);
    expect(res.body.label).toBe("Manual marker");
    expect(res.body.catchSeq).toBeNull();
    expect(res.body.conditions).toBeNull();
    expect(qdMocks.counterValuesMock).not.toHaveBeenCalled();
  });

  it("accepts a quickCatch body without conditions (snapshot optional)", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ ...BASE_BODY, quickCatch: true });

    expect(res.status).toBe(201);
    expect(res.body.conditions).toBeNull();
  });

  it("rejects a malformed conditions snapshot with 400", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({
        ...BASE_BODY,
        quickCatch: true,
        conditions: { ...CONDITIONS, depthSource: "sonar" },
      });

    expect(res.status).toBe(400);
  });

  it("requires auth like any other marker create", async () => {
    const res = await request(app)
      .post("/api/markers")
      .send({ ...BASE_BODY, quickCatch: true });
    expect(res.status).toBe(401);
  });
});
