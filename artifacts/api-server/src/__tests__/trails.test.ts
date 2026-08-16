import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock state — must be defined before vi.mock factories run.
// ---------------------------------------------------------------------------

const trailsMocks = vi.hoisted(() => {
  const trailRow = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    userId: "user_test123",
    datasetId: "thorne-bay",
    name: "Morning run",
    colour: "#ff6600",
    startedAt: new Date("2024-01-01T08:00:00Z"),
    endedAt: new Date("2024-01-01T09:00:00Z"),
    pointCount: 3,
  };

  // Default: db.delete returns [{id}] (row was found and deleted).
  const deleteReturningMock = vi.fn().mockResolvedValue([{ id: trailRow.id }]);
  const deleteWhereMock = vi.fn().mockReturnValue({ returning: deleteReturningMock });

  // Default: db.select returns the settings row (for GET /trails retention lookup).
  const selectOrderByMock = vi.fn().mockResolvedValue([trailRow]);
  const selectLimitMock = vi.fn().mockResolvedValue([]);
  const selectWhereMock = vi.fn().mockReturnValue({
    orderBy: selectOrderByMock,
    limit: selectLimitMock,
  });
  const selectFromMock = vi.fn().mockReturnValue({ where: selectWhereMock });

  return {
    trailRow,
    deleteReturningMock,
    deleteWhereMock,
    selectOrderByMock,
    selectLimitMock,
    selectWhereMock,
    selectFromMock,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({ from: trailsMocks.selectFromMock }),
      delete: vi.fn().mockReturnValue({ where: trailsMocks.deleteWhereMock }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  gte: vi.fn(() => "gte-condition"),
  lt: vi.fn(() => "lt-condition"),
  sql: vi.fn(() => "sql-fragment"),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => {
    const header = req.headers["x-mock-clerk-user-id"];
    return { userId: header || null };
  }),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

// ---------------------------------------------------------------------------
// App + rate-limit reset
// ---------------------------------------------------------------------------

import app from "../app.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";

beforeEach(() => {
  __resetRateLimitMemory();
  // Reset to default: delete finds and removes the row.
  trailsMocks.deleteReturningMock.mockResolvedValue([{ id: trailsMocks.trailRow.id }]);
});

const AUTHED_HEADER = { "x-mock-clerk-user-id": "user_test123" };
const TRAIL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// ---------------------------------------------------------------------------
// POST /api/trails/:id/soft-delete — auth
// ---------------------------------------------------------------------------

describe("POST /api/trails/:id/soft-delete — auth required", () => {
  it("returns 401 when no auth session is present", async () => {
    const res = await request(app).post(`/api/trails/${TRAIL_ID}/soft-delete`);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });

  it("returns 400 when the trail id is not a valid UUID", async () => {
    const res = await request(app)
      .post("/api/trails/not-a-uuid/soft-delete")
      .set(AUTHED_HEADER);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid_request");
  });
});

// ---------------------------------------------------------------------------
// POST /api/trails/:id/soft-delete — happy path
// ---------------------------------------------------------------------------

describe("POST /api/trails/:id/soft-delete — deletes the trail", () => {
  it("returns 204 when the trail exists and belongs to the user", async () => {
    const res = await request(app)
      .post(`/api/trails/${TRAIL_ID}/soft-delete`)
      .set(AUTHED_HEADER);
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// POST /api/trails/:id/soft-delete — idempotency (core correctness)
//
// When the row is already gone (deleted by a prior normal DELETE or a prior
// beacon), the endpoint MUST still return 204, not 404 or 500. This ensures
// that two beacons racing against a normal DELETE can never cause a 5xx, and
// that a future "mark-as-deleted" implementation stays safe to call twice.
// ---------------------------------------------------------------------------

describe("POST /api/trails/:id/soft-delete — idempotency", () => {
  it("returns 204 on the first call (row present)", async () => {
    // First call: db.delete found the row.
    trailsMocks.deleteReturningMock.mockResolvedValueOnce([{ id: TRAIL_ID }]);

    const res = await request(app)
      .post(`/api/trails/${TRAIL_ID}/soft-delete`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(204);
  });

  it("returns 204 on the second call even when the row is already gone", async () => {
    // Simulate: row was already deleted (beacon arrived after normal DELETE).
    trailsMocks.deleteReturningMock.mockResolvedValueOnce([]);

    const res = await request(app)
      .post(`/api/trails/${TRAIL_ID}/soft-delete`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(204);
  });

  it("returns 204 both times when called twice in sequence for the same ID", async () => {
    const { db } = await import("@workspace/db");

    // First call: row is found and deleted.
    (db.delete as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: TRAIL_ID }]),
      }),
    });

    const first = await request(app)
      .post(`/api/trails/${TRAIL_ID}/soft-delete`)
      .set(AUTHED_HEADER);

    expect(first.status).toBe(204);

    // Second call: row is already gone (zero affected rows).
    (db.delete as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });

    const second = await request(app)
      .post(`/api/trails/${TRAIL_ID}/soft-delete`)
      .set(AUTHED_HEADER);

    expect(second.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// POST /api/trails/:id/soft-delete — ownership check (cross-user beacon)
//
// The WHERE clause filters by BOTH id AND userId, so a beacon sent by an
// attacker targeting another user's trail will find zero rows and return 204
// with no deletion occurring.  This is intentionally indistinguishable from
// the "already gone" 204 — returning 404 would leak the existence of the trail
// to the attacker.  The two silent-204 scenarios are:
//   • "already gone"  — row was previously deleted by the real owner
//   • "wrong owner"   — row exists but belongs to a different userId
// ---------------------------------------------------------------------------

describe("POST /api/trails/:id/soft-delete — cross-user ownership", () => {
  it("returns 204 without deleting when the trail belongs to a different user", async () => {
    // db.delete returns [] because the WHERE(id AND userId) matched zero rows —
    // the trail exists but its userId does not match the authenticated user.
    // This is the "wrong owner" 204: identical response to "already gone" so
    // the caller cannot distinguish ownership from non-existence (no info leak).
    trailsMocks.deleteReturningMock.mockResolvedValueOnce([]);

    const res = await request(app)
      .post(`/api/trails/${TRAIL_ID}/soft-delete`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/trails/:id — basic smoke tests (ensure route still works)
// ---------------------------------------------------------------------------

describe("DELETE /api/trails/:id — auth required", () => {
  it("returns 401 when no auth session is present", async () => {
    const res = await request(app).delete(`/api/trails/${TRAIL_ID}`);
    expect(res.status).toBe(401);
  });

  it("returns 204 when authenticated and trail exists", async () => {
    const res = await request(app)
      .delete(`/api/trails/${TRAIL_ID}`)
      .set(AUTHED_HEADER);
    expect(res.status).toBe(204);
  });

  it("returns 404 when authenticated but trail is not found", async () => {
    const { db } = await import("@workspace/db");
    (db.delete as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await request(app)
      .delete(`/api/trails/${TRAIL_ID}`)
      .set(AUTHED_HEADER);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });
});
