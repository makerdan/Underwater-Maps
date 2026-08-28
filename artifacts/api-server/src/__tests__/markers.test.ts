import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// vi.mock is hoisted above all imports/variable declarations.
// All data used inside factories must be defined inline.

const markersMocks = vi.hoisted(() => {
  const row = {
    id: "11111111-1111-1111-1111-111111111111",
    datasetId: "thorne-bay",
    lon: -132.53,
    lat: 55.69,
    depth: 100,
    type: "custom",
    label: "Test Marker",
    notes: null,
    userId: "user_test123",
    createdAt: new Date().toISOString(),
  };
  const orderByMock = vi.fn().mockResolvedValue([row]);
  // The DELETE handler awaits .where() directly (no .orderBy()), so the where
  // result must be a Promise.  Attach .orderBy so the GET handler still works.
  const selectWhereResult = Object.assign(Promise.resolve([]), { orderBy: orderByMock });
  const selectWhereMock = vi.fn().mockReturnValue(selectWhereResult);
  // For POST /api/markers resolveDatasetBbox checks: return a valid catalog
  // bbox row when querying datasetCatalogTable (identified by coverageBbox key)
  // so the handler doesn't 404 on a missing dataset.
  const fromMock = vi.fn().mockImplementation((table: Record<string, unknown>) => {
    if (table && "coverageBbox" in table) {
      return {
        where: vi.fn().mockResolvedValue([
          { coverageBbox: { minLon: -133, minLat: 55, maxLon: -132, maxLat: 56 } },
        ]),
      };
    }
    return { where: selectWhereMock };
  });
  const insertReturningMock = vi.fn().mockResolvedValue([row]);
  const valuesMock = vi.fn().mockReturnValue({ returning: insertReturningMock });
  const deleteReturningMock = vi.fn().mockResolvedValue([{ id: row.id }]);
  const deleteWhereMock = vi.fn().mockReturnValue({ returning: deleteReturningMock });
  return { row, orderByMock, selectWhereMock, fromMock, insertReturningMock, valuesMock, deleteReturningMock, deleteWhereMock };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({ from: markersMocks.fromMock }),
      insert: vi.fn().mockReturnValue({ values: markersMocks.valuesMock }),
      delete: vi.fn().mockReturnValue({ where: markersMocks.deleteWhereMock }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => ({ type: "or", args })),
  lt: vi.fn(() => "lt-condition"),
  isNull: vi.fn(() => "is-null-condition"),
  gte: vi.fn(() => "gte-condition"),
  lte: vi.fn(() => "lte-condition"),
  gt: vi.fn(() => "gt-condition"),
  sql: vi.fn(() => "sql-fragment"),
}));

// Mock @clerk/express so tests control auth without a real Clerk tenant.
// getAuth returns { userId } when the mock session header is present.
vi.mock("@clerk/express", () => {
  return {
    clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
    getAuth: vi.fn((req: { headers: Record<string, string> }) => {
      const header = req.headers["x-mock-clerk-user-id"];
      return { userId: header || null };
    }),
  };
});

// Mock http-proxy-middleware (used by clerkProxyMiddleware) so it doesn't
// try to reach out to the network in the test environment.
vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

// Mock @clerk/shared/keys so publishableKeyFromHost doesn't crash without a key.
vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";

beforeEach(() => {
  __resetRateLimitMemory();
});

const AUTHED_HEADER = { "x-mock-clerk-user-id": "user_test123" };

describe("GET /api/markers — auth required", () => {
  it("returns 401 when no auth session is present", async () => {
    const res = await request(app).get("/api/markers?datasetId=thorne-bay");
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });

  it("returns 200 with user-scoped markers when authenticated and datasetId is provided", async () => {
    const res = await request(app)
      .get("/api/markers?datasetId=thorne-bay")
      .set(AUTHED_HEADER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns 400 when authenticated but no datasetId and no bounds (neither filter provided)", async () => {
    const res = await request(app)
      .get("/api/markers")
      .set(AUTHED_HEADER);
    expect(res.status).toBe(400);
  });

  it("uses both longitude intervals for an antimeridian-crossing bounds query", async () => {
    const { or } = await import("drizzle-orm");
    const orMock = or as unknown as ReturnType<typeof vi.fn>;

    const res = await request(app)
      .get("/api/markers?minLat=-10&minLon=170&maxLat=10&maxLon=-170")
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(orMock).toHaveBeenCalledWith("gte-condition", "lte-condition");
  });
});

describe("POST /api/markers — auth required", () => {
  it("returns 401 when no auth session is present", async () => {
    const res = await request(app)
      .post("/api/markers")
      .send({ datasetId: "thorne-bay", lon: -132.53, lat: 55.69, depth: 100, label: "Test" });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });

  it("returns 201 with userId set when authenticated with valid body", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ datasetId: "thorne-bay", lon: -132.53, lat: 55.69, depth: 100, label: "Test" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("datasetId", "thorne-bay");
    expect(res.body).toHaveProperty("userId", "user_test123");
  });

  it("returns 400 when required body fields are missing (authenticated)", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ lon: 142.2 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("DELETE /api/markers/:id — auth required", () => {
  it("returns 401 when no auth session is present", async () => {
    const res = await request(app).delete("/api/markers/11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });

  it("returns 204 when authenticated and marker exists", async () => {
    const res = await request(app)
      .delete("/api/markers/11111111-1111-1111-1111-111111111111")
      .set(AUTHED_HEADER);
    expect(res.status).toBe(204);
  });

  it("returns 404 when authenticated but marker not found", async () => {
    const { db } = await import("@workspace/db");
    (db.delete as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    const res = await request(app)
      .delete("/api/markers/22222222-2222-2222-2222-222222222222")
      .set(AUTHED_HEADER);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/markers — label and notes length boundary tests
//
// The PostMarkersBody Zod schema (from @workspace/api-zod) enforces the
// canonical label max (200) and notes max (2000).  The server route also has
// a secondary semantic guard at 422 for anything that slips through. These
// tests use the real (un-mocked) @workspace/api-zod schemas so that any
// future change to the schema constants is caught immediately at test-standard
// tier rather than surfacing only after users hit a 400 on a valid edit.
// ---------------------------------------------------------------------------
describe("POST /api/markers — label length boundary (canonical LABEL_MAX = 200)", () => {
  it("returns 201 when label is exactly 200 characters", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ datasetId: "thorne-bay", lon: -132.53, lat: 55.69, depth: 100, label: "a".repeat(200) });
    expect(res.status).toBe(201);
  });

  it("returns 400 when label is 201 characters (one over the limit)", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ datasetId: "thorne-bay", lon: -132.53, lat: 55.69, depth: 100, label: "a".repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /api/markers — notes length boundary (canonical NOTES_MAX = 2000)", () => {
  it("returns 201 when notes is exactly 2000 characters", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ datasetId: "thorne-bay", lon: -132.53, lat: 55.69, depth: 100, label: "Test", notes: "n".repeat(2000) });
    expect(res.status).toBe(201);
  });

  it("returns 400 when notes is 2001 characters (one over the limit)", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ datasetId: "thorne-bay", lon: -132.53, lat: 55.69, depth: 100, label: "Test", notes: "n".repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// Cross-user delete ownership enforcement
//
// The DELETE /api/markers/:id WHERE clause includes BOTH id AND userId, so
// a marker belonging to a different user produces an empty RETURNING set and
// the route returns 404 (not 403) to avoid leaking existence to the caller.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Regression guard — malformed dataset bbox must be rejected with 404.
//
// A catalog coverageBbox JSONB blob with a valid minLon but a missing / null /
// non-finite / inverted sibling was previously accepted by resolveDatasetBbox
// and passed to isInsideBbox, where NaN comparisons always evaluate to false —
// silently accepting or mis-rejecting marker coordinates. resolveDatasetBbox
// must now treat a partial bbox exactly like a missing one: 404, never 201/422.
// ---------------------------------------------------------------------------
describe("POST /api/markers — malformed dataset bbox is rejected (404)", () => {
  function postMarker() {
    return request(app)
      .post("/api/markers")
      .set(AUTHED_HEADER)
      .send({ datasetId: "test-catalog-ds", lon: -132.53, lat: 55.69, depth: 100, label: "Test" });
  }

  function mockCatalogBboxOnce(coverageBbox: Record<string, unknown>) {
    markersMocks.fromMock.mockImplementationOnce(() => ({
      where: vi.fn().mockResolvedValue([{ coverageBbox }]),
    }));
  }

  it("returns 404 (not 201 or 422) when coverageBbox.maxLat is null", async () => {
    mockCatalogBboxOnce({ minLon: -133, minLat: 55, maxLon: -132, maxLat: null });
    const res = await postMarker();
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 404 when coverageBbox.maxLat is missing entirely", async () => {
    mockCatalogBboxOnce({ minLon: -133, minLat: 55, maxLon: -132 });
    const res = await postMarker();
    expect(res.status).toBe(404);
  });

  it("returns 404 when a coverageBbox field is NaN", async () => {
    mockCatalogBboxOnce({ minLon: -133, minLat: Number.NaN, maxLon: -132, maxLat: 56 });
    const res = await postMarker();
    expect(res.status).toBe(404);
  });

  it("returns 404 when a coverageBbox field is Infinity", async () => {
    mockCatalogBboxOnce({ minLon: -133, minLat: 55, maxLon: Infinity, maxLat: 56 });
    const res = await postMarker();
    expect(res.status).toBe(404);
  });

  it("returns 404 when longitude bounds are inverted (minLon > maxLon)", async () => {
    mockCatalogBboxOnce({ minLon: -132, minLat: 55, maxLon: -133, maxLat: 56 });
    const res = await postMarker();
    expect(res.status).toBe(404);
  });

  it("still returns 201 for a valid bbox (control)", async () => {
    // Default fromMock already returns a fully-valid coverageBbox.
    const res = await postMarker();
    expect(res.status).toBe(201);
  });
});

describe("DELETE /api/markers/:id — cross-user ownership", () => {
  it("returns 404 (not 403) when an authenticated user tries to delete another user's marker", async () => {
    const { db } = await import("@workspace/db");
    // Simulate the DB returning no rows: the WHERE(id = ? AND userId = ?)
    // condition matched nothing because the marker belongs to a different user.
    (db.delete as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });

    const res = await request(app)
      .delete("/api/markers/99999999-9999-9999-9999-999999999999")
      .set({ "x-mock-clerk-user-id": "user_attacker" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("leaves the marker intact after a failed cross-user delete attempt", async () => {
    const { db } = await import("@workspace/db");
    // The cross-user delete returns no rows …
    (db.delete as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    await request(app)
      .delete("/api/markers/11111111-1111-1111-1111-111111111111")
      .set({ "x-mock-clerk-user-id": "user_attacker" });

    // … and the real owner can still delete it afterwards (db returns the row).
    const res = await request(app)
      .delete("/api/markers/11111111-1111-1111-1111-111111111111")
      .set(AUTHED_HEADER);
    expect(res.status).toBe(204);
  });
});
