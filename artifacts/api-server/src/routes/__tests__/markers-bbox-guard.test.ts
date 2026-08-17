/**
 * markers-bbox-guard.test.ts
 *
 * Unit tests for the dataset bbox validation guard added to
 * POST /api/markers and PATCH /api/markers/:id.
 *
 * Covers (for both POST and PATCH):
 *  - in-bounds catalog dataset       → 201 / 200
 *  - out-of-bounds catalog dataset   → 422
 *  - in-bounds user-dataset          → 201 / 200
 *  - out-of-bounds user-dataset      → 422
 *  - unknown datasetId               → 404
 *  - null datasetId (un-assignment)  → guard skipped, accepted
 *  - PATCH with no datasetId field   → guard skipped, accepted
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Controlled mocks — defined via vi.hoisted so they are available inside the
// vi.mock() factory closures (which are hoisted above all imports).
// ---------------------------------------------------------------------------

const dbState = vi.hoisted(() => {
  /** Build a single select chain that resolves to `rows`. */
  const selectChain = (rows: unknown[]) => ({
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(rows),
    })),
  });

  const markerRow = {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    datasetId: "catalog-ds-1",
    lon: -135.0,
    lat: 55.5,
    depth: 50,
    type: "custom",
    label: "Test Marker",
    notes: null,
    userId: "user-bbox-test",
    catchSeq: null,
    conditions: null,
    createdAt: new Date().toISOString(),
  };

  // Catalogue bbox (coordinates of markerRow are inside)
  const catalogBbox = { minLon: -140, minLat: 50, maxLon: -130, maxLat: 60 };
  // Bbox that is far from the marker's coordinates
  const farBbox = { minLon: 0, minLat: 0, maxLon: 10, maxLat: 10 };

  /** Mock for db.select — configure per-test with mockReturnValueOnce. */
  const selectSpy = vi.fn(() => selectChain([]));

  /** Mock for db.insert — returns a resolved marker row by default. */
  const insertValuesMock = vi.fn(() => ({
    returning: vi.fn().mockResolvedValue([markerRow]),
    onConflictDoUpdate: vi.fn().mockResolvedValue([{ lastSeq: 1 }]),
  }));
  const insertSpy = vi.fn(() => ({ values: insertValuesMock }));

  /** Mock for db.update — returns a resolved marker row by default. */
  const updateSetMock = vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([markerRow]),
    })),
  }));
  const updateSpy = vi.fn(() => ({ set: updateSetMock }));

  /** Mock for db.delete — not relevant for bbox tests but must exist. */
  const deleteWhereMock = vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) }));
  const deleteSpy = vi.fn(() => ({ where: deleteWhereMock }));

  return {
    selectSpy,
    insertSpy,
    insertValuesMock,
    updateSpy,
    updateSetMock,
    deleteSpy,
    selectChain,
    markerRow,
    catalogBbox,
    farBbox,
  };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("../../__tests__/helpers/db-mock.js");
  return createDbMock({
    db: {
      select: dbState.selectSpy,
      insert: dbState.insertSpy,
      update: dbState.updateSpy,
      delete: dbState.deleteSpy,
    },
  });
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return { ...actual, getPoeClient: vi.fn(() => ({})) };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

// Authed request helper — uses the E2E bypass injected by requireAuth.
const AUTH_HEADERS = {
  "x-e2e-bypass-secret": "vitest-test-secret",
  "x-e2e-user-id": "user-bbox-test",
};

const MARKER_ID = "aaaaaaaa-0000-0000-0000-000000000001";

// Valid POST body — coordinates fall inside catalogBbox.
const VALID_POST_BODY = {
  datasetId: "catalog-ds-1",
  lon: -135.0,
  lat: 55.5,
  depth: 50,
  label: "Test Marker",
};

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");

  // Reset all spies so each test starts with a clean call count.
  dbState.selectSpy.mockReset();
  dbState.insertSpy.mockReset();
  dbState.insertValuesMock.mockReset();
  dbState.updateSpy.mockReset();
  dbState.updateSetMock.mockReset();

  // Defaults (overridden per-test with mockReturnValueOnce).
  dbState.selectSpy.mockReturnValue(dbState.selectChain([]));
  dbState.insertValuesMock.mockReturnValue({
    returning: vi.fn().mockResolvedValue([dbState.markerRow]),
    onConflictDoUpdate: vi.fn().mockResolvedValue([{ lastSeq: 1 }]),
  });
  dbState.insertSpy.mockReturnValue({ values: dbState.insertValuesMock });
  dbState.updateSetMock.mockReturnValue({
    where: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([dbState.markerRow]),
    })),
  });
  dbState.updateSpy.mockReturnValue({ set: dbState.updateSetMock });
});

// ---------------------------------------------------------------------------
// POST /api/markers — bbox guard
// ---------------------------------------------------------------------------

describe("POST /api/markers — bbox guard", () => {
  it("201: in-bounds marker for a catalog dataset", async () => {
    // Call 1: catalog lookup returns bbox row
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{ coverageBbox: dbState.catalogBbox }]),
    );

    const res = await request(app)
      .post("/api/markers")
      .set(AUTH_HEADERS)
      .send(VALID_POST_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
  });

  it("422: out-of-bounds marker for a catalog dataset", async () => {
    // Catalog returns a bbox that doesn't contain the marker coords.
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{ coverageBbox: dbState.farBbox }]),
    );

    const res = await request(app)
      .post("/api/markers")
      .set(AUTH_HEADERS)
      .send(VALID_POST_BODY);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "validation_error" });
    expect(res.body.message).toMatch(/outside/i);
  });

  it("201: in-bounds marker for a user-uploaded dataset", async () => {
    // Call 1: catalog returns nothing → fall through to custom datasets.
    dbState.selectSpy.mockReturnValueOnce(dbState.selectChain([]));
    // Call 2: custom datasets returns a terrain json with an in-bounds bbox.
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{
        terrainJson: {
          minLon: -140, minLat: 50, maxLon: -130, maxLat: 60,
          minDepth: 0, maxDepth: 200,
        },
      }]),
    );

    const res = await request(app)
      .post("/api/markers")
      .set(AUTH_HEADERS)
      .send({ ...VALID_POST_BODY, datasetId: "bbbbbbbb-1111-2222-3333-444444444444" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
  });

  it("422: out-of-bounds marker for a user-uploaded dataset", async () => {
    dbState.selectSpy.mockReturnValueOnce(dbState.selectChain([]));
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{
        terrainJson: {
          minLon: 0, minLat: 0, maxLon: 10, maxLat: 10,
          minDepth: 0, maxDepth: 200,
        },
      }]),
    );

    const res = await request(app)
      .post("/api/markers")
      .set(AUTH_HEADERS)
      .send({ ...VALID_POST_BODY, datasetId: "bbbbbbbb-1111-2222-3333-444444444444" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "validation_error" });
    expect(res.body.message).toMatch(/outside/i);
  });

  it("404: unknown datasetId not found in catalog or user datasets", async () => {
    // Both catalog and custom-dataset selects return empty.
    dbState.selectSpy.mockReturnValueOnce(dbState.selectChain([]));
    dbState.selectSpy.mockReturnValueOnce(dbState.selectChain([]));

    const res = await request(app)
      .post("/api/markers")
      .set(AUTH_HEADERS)
      .send({ ...VALID_POST_BODY, datasetId: "nonexistent-dataset" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("404 for a non-UUID unknown id issues only the catalog select — custom_datasets (uuid PK) is never queried", async () => {
    // Catalog select returns empty; the custom_datasets select must be
    // skipped entirely because "nonexistent-dataset" is not UUID-shaped and
    // would make Postgres throw `invalid input syntax for type uuid`.
    dbState.selectSpy.mockReturnValueOnce(dbState.selectChain([]));

    const res = await request(app)
      .post("/api/markers")
      .set(AUTH_HEADERS)
      .send({ ...VALID_POST_BODY, datasetId: "nonexistent-dataset" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
    expect(dbState.selectSpy).toHaveBeenCalledTimes(1);
  });

  it("201: bundled preset slug without in-code bbox (thorne-bay) bypasses the bbox check and never touches the DB resolver", async () => {
    // thorne-bay is code-defined (DATASET_SOURCE_PRIORITY) but has no
    // DatasetMeta bbox — the guard must allow the create unbounded, with no
    // catalog / custom_datasets selects at all.
    const res = await request(app)
      .post("/api/markers")
      .set(AUTH_HEADERS)
      .send({ ...VALID_POST_BODY, datasetId: "thorne-bay", lon: 142.5, lat: 11.35 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(dbState.selectSpy).not.toHaveBeenCalled();
  });

  it("201/422: bundled preset with an in-code DatasetMeta bbox (lake-ray-roberts) is enforced against that bbox without DB lookups", async () => {
    // In-bounds (inside the lake-ray-roberts bbox: lon -97.15..-96.92, lat 33.3..33.52).
    const inRes = await request(app)
      .post("/api/markers")
      .set(AUTH_HEADERS)
      .send({ ...VALID_POST_BODY, datasetId: "lake-ray-roberts", lon: -97.0, lat: 33.4 });
    expect(inRes.status).toBe(201);

    // Out-of-bounds → 422 from the in-code bbox, still no resolver selects.
    const outRes = await request(app)
      .post("/api/markers")
      .set(AUTH_HEADERS)
      .send({ ...VALID_POST_BODY, datasetId: "lake-ray-roberts", lon: 142.5, lat: 11.35 });
    expect(outRes.status).toBe(422);
    expect(outRes.body).toMatchObject({ error: "validation_error" });
    expect(dbState.selectSpy).not.toHaveBeenCalled();
  });

  it("404: '__proto__' as datasetId is not treated as a known bundled dataset", async () => {
    dbState.selectSpy.mockReturnValueOnce(dbState.selectChain([]));

    const res = await request(app)
      .post("/api/markers")
      .set(AUTH_HEADERS)
      .send({ ...VALID_POST_BODY, datasetId: "__proto__" });

    expect(res.status).toBe(404);
  });

  it("201: null datasetId skips the bbox guard entirely", async () => {
    // No select calls should be made for the bbox resolver.
    const res = await request(app)
      .post("/api/markers")
      .set(AUTH_HEADERS)
      .send({ ...VALID_POST_BODY, datasetId: null });

    expect(res.status).toBe(201);
    // Confirm the guard wasn't called (selectSpy only ever called for GET /markers
    // which we didn't hit here).
    expect(dbState.selectSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/markers/:id — bbox guard
// ---------------------------------------------------------------------------

describe("PATCH /api/markers/:id — bbox guard", () => {
  it("200: reassigning to an in-bounds catalog dataset", async () => {
    // Call 1: catalog bbox lookup.
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{ coverageBbox: dbState.catalogBbox }]),
    );
    // Call 2: existing marker fetch (lon/lat within catalog bbox).
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{ lon: -135.0, lat: 55.5 }]),
    );

    const res = await request(app)
      .patch(`/api/markers/${MARKER_ID}`)
      .set(AUTH_HEADERS)
      .send({ datasetId: "catalog-ds-1" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id");
  });

  it("422: reassigning to an out-of-bounds catalog dataset", async () => {
    // Call 1: catalog returns a bbox far from the marker.
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{ coverageBbox: dbState.farBbox }]),
    );
    // Call 2: existing marker fetch.
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{ lon: -135.0, lat: 55.5 }]),
    );

    const res = await request(app)
      .patch(`/api/markers/${MARKER_ID}`)
      .set(AUTH_HEADERS)
      .send({ datasetId: "catalog-ds-1" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "validation_error" });
    expect(res.body.message).toMatch(/outside/i);
  });

  it("200: reassigning to an in-bounds user-uploaded dataset", async () => {
    // Call 1: catalog returns nothing.
    dbState.selectSpy.mockReturnValueOnce(dbState.selectChain([]));
    // Call 2: custom datasets returns in-bounds terrain json.
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{
        terrainJson: {
          minLon: -140, minLat: 50, maxLon: -130, maxLat: 60,
          minDepth: 0, maxDepth: 200,
        },
      }]),
    );
    // Call 3: existing marker lon/lat.
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{ lon: -135.0, lat: 55.5 }]),
    );

    const res = await request(app)
      .patch(`/api/markers/${MARKER_ID}`)
      .set(AUTH_HEADERS)
      .send({ datasetId: "bbbbbbbb-1111-2222-3333-444444444444" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id");
  });

  it("422: reassigning to an out-of-bounds user-uploaded dataset", async () => {
    dbState.selectSpy.mockReturnValueOnce(dbState.selectChain([]));
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{
        terrainJson: {
          minLon: 0, minLat: 0, maxLon: 10, maxLat: 10,
          minDepth: 0, maxDepth: 200,
        },
      }]),
    );
    dbState.selectSpy.mockReturnValueOnce(
      dbState.selectChain([{ lon: -135.0, lat: 55.5 }]),
    );

    const res = await request(app)
      .patch(`/api/markers/${MARKER_ID}`)
      .set(AUTH_HEADERS)
      .send({ datasetId: "bbbbbbbb-1111-2222-3333-444444444444" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "validation_error" });
    expect(res.body.message).toMatch(/outside/i);
  });

  it("404: unknown datasetId in PATCH body", async () => {
    dbState.selectSpy.mockReturnValueOnce(dbState.selectChain([]));
    dbState.selectSpy.mockReturnValueOnce(dbState.selectChain([]));

    const res = await request(app)
      .patch(`/api/markers/${MARKER_ID}`)
      .set(AUTH_HEADERS)
      .send({ datasetId: "nonexistent-dataset" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("200: null datasetId (un-assignment) skips the bbox guard", async () => {
    const res = await request(app)
      .patch(`/api/markers/${MARKER_ID}`)
      .set(AUTH_HEADERS)
      .send({ datasetId: null });

    expect(res.status).toBe(200);
    // No bbox resolver calls were made.
    expect(dbState.selectSpy).not.toHaveBeenCalled();
  });

  it("200: patch with no datasetId field skips the bbox guard", async () => {
    const res = await request(app)
      .patch(`/api/markers/${MARKER_ID}`)
      .set(AUTH_HEADERS)
      .send({ label: "Renamed Marker" });

    expect(res.status).toBe(200);
    // No bbox resolver select calls.
    expect(dbState.selectSpy).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
