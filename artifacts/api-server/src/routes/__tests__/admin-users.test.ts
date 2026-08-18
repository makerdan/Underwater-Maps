/**
 * admin-users.test.ts — integration tests for /admin/users approval routes.
 *
 * Covers:
 *   GET    /admin/users                       — paginated list, ?status filter, empty shape
 *   POST   /admin/users/:clerkUserId/approve  — flips status, 404 unknown
 *   POST   /admin/users/:clerkUserId/ban      — sets status + optional note, 404 unknown
 *   POST   /admin/users/:clerkUserId/restore  — sets approved, 404 unknown
 *   DELETE /admin/users/:clerkUserId          — removes row, 404 unknown
 *   plus: non-admin 403, unauthenticated 401, blank param 400.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// DB mock — hand-rolled chains exposing per-test state and call spies.
// ---------------------------------------------------------------------------

const {
  dbState,
  limitMock,
  whereSelectMock,
  selectMock,
  updateWhereMock,
  setMock,
  updateMock,
  deleteWhereMock,
  deleteMock,
} = vi.hoisted(() => {
  const state = {
    listRows: [] as Array<Record<string, unknown>>,
    updateRows: [] as Array<Record<string, unknown>>,
    deleteRows: [] as Array<Record<string, unknown>>,
  };

  const limit = vi.fn(async () => state.listRows);
  const orderBy = vi.fn(() => ({ limit }));
  const whereSelect = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn(() => ({ from }));

  const updateReturning = vi.fn(async () => state.updateRows);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  const deleteReturning = vi.fn(async () => state.deleteRows);
  const deleteWhere = vi.fn(() => ({ returning: deleteReturning }));
  const del = vi.fn(() => ({ where: deleteWhere }));

  return {
    dbState: state,
    limitMock: limit,
    whereSelectMock: whereSelect,
    selectMock: select,
    updateReturningMock: updateReturning,
    updateWhereMock: updateWhere,
    setMock: set,
    updateMock: update,
    deleteReturningMock: deleteReturning,
    deleteWhereMock: deleteWhere,
    deleteMock: del,
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: selectMock,
    update: updateMock,
    delete: deleteMock,
  },
  userAccessTable: {
    clerkUserId: "clerkUserId",
    status: "status",
    email: "email",
    displayName: "displayName",
    adminNote: "adminNote",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

// Structured condition objects so where()/limit() arguments are assertable.
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ op: "eq", column, value })),
  gt: vi.fn((column: unknown, value: unknown) => ({ op: "gt", column, value })),
  and: vi.fn((...conds: unknown[]) => ({ op: "and", conds })),
  asc: vi.fn((column: unknown) => ({ op: "asc", column })),
}));

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => ({ userId: null })),
}));

import adminUsersRouter from "../admin-users.js";

const ADMIN_USER = "user_e2e_admin";
const NON_ADMIN_USER = "user_e2e_pleb";
const TARGET = "user_2target";

const NOW = new Date("2026-08-18T10:00:00.000Z");

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    clerkUserId: TARGET,
    status: "pending",
    email: "angler@example.com",
    displayName: "Test Angler",
    adminNote: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(adminUsersRouter);
  return app;
}

function asAdmin(r: request.Test) {
  return r.set("x-e2e-bypass-secret", "vitest-test-secret").set("x-e2e-user-id", ADMIN_USER);
}

function asNonAdmin(r: request.Test) {
  return r.set("x-e2e-bypass-secret", "vitest-test-secret").set("x-e2e-user-id", NON_ADMIN_USER);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("ADMIN_USER_IDS", ADMIN_USER);
  dbState.listRows = [];
  dbState.updateRows = [];
  dbState.deleteRows = [];
});

describe("GET /admin/users", () => {
  it("returns paginated rows with serialised timestamps", async () => {
    dbState.listRows = [makeRow(), makeRow({ clerkUserId: "user_2zz", status: "approved" })];
    const res = await asAdmin(request(makeApp()).get("/admin/users"));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    expect(res.body.users[0]).toEqual({
      clerkUserId: TARGET,
      status: "pending",
      email: "angler@example.com",
      displayName: "Test Angler",
      adminNote: null,
      createdAt: "2026-08-18T10:00:00.000Z",
      updatedAt: "2026-08-18T10:00:00.000Z",
    });
    // Full page not exceeded → no next page.
    expect(res.body.nextCursor).toBeNull();
    // Default page size 50 → fetches 51 to detect a next page.
    expect(limitMock).toHaveBeenCalledWith(51);
    // No filters → where(undefined).
    expect(whereSelectMock).toHaveBeenCalledWith(undefined);
  });

  it("returns an empty list with the correct pagination shape", async () => {
    dbState.listRows = [];
    const res = await asAdmin(request(makeApp()).get("/admin/users"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ users: [], nextCursor: null });
  });

  it("sets nextCursor when more rows exist than the page size", async () => {
    dbState.listRows = [
      makeRow({ clerkUserId: "user_2a" }),
      makeRow({ clerkUserId: "user_2b" }),
      makeRow({ clerkUserId: "user_2c" }), // the +1 probe row
    ];
    const res = await asAdmin(request(makeApp()).get("/admin/users?limit=2"));
    expect(res.status).toBe(200);
    expect(limitMock).toHaveBeenCalledWith(3);
    expect(res.body.users.map((u: { clerkUserId: string }) => u.clerkUserId)).toEqual([
      "user_2a",
      "user_2b",
    ]);
    expect(res.body.nextCursor).toBe("user_2b");
  });

  it("applies the ?status filter as an eq condition", async () => {
    dbState.listRows = [makeRow({ status: "banned" })];
    const res = await asAdmin(request(makeApp()).get("/admin/users?status=banned"));
    expect(res.status).toBe(200);
    expect(whereSelectMock).toHaveBeenCalledWith({
      op: "and",
      conds: [{ op: "eq", column: "status", value: "banned" }],
    });
  });

  it("applies the ?cursor as a gt condition for keyset pagination", async () => {
    dbState.listRows = [];
    const res = await asAdmin(request(makeApp()).get("/admin/users?cursor=user_2a"));
    expect(res.status).toBe(200);
    expect(whereSelectMock).toHaveBeenCalledWith({
      op: "and",
      conds: [{ op: "gt", column: "clerkUserId", value: "user_2a" }],
    });
  });

  it("rejects an invalid ?status with 400 invalid_param", async () => {
    const res = await asAdmin(request(makeApp()).get("/admin/users?status=nuked"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range ?limit with 400", async () => {
    const res = await asAdmin(request(makeApp()).get("/admin/users?limit=9999"));
    expect(res.status).toBe(400);
  });
});

describe("POST /admin/users/:clerkUserId/approve", () => {
  it("flips status to approved", async () => {
    dbState.updateRows = [makeRow({ status: "approved" })];
    const res = await asAdmin(request(makeApp()).post(`/admin/users/${TARGET}/approve`));
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe("approved");
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved", updatedAt: expect.any(Date) }),
    );
    expect(updateWhereMock).toHaveBeenCalledWith({
      op: "eq",
      column: "clerkUserId",
      value: TARGET,
    });
  });

  it("returns 404 for an unknown clerkUserId", async () => {
    dbState.updateRows = [];
    const res = await asAdmin(request(makeApp()).post("/admin/users/user_unknown/approve"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 400 for a blank clerkUserId param", async () => {
    const res = await asAdmin(request(makeApp()).post("/admin/users/%20/approve"));
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("POST /admin/users/:clerkUserId/ban", () => {
  it("sets status to banned and stores the optional note", async () => {
    dbState.updateRows = [makeRow({ status: "banned", adminNote: "abusive uploads" })];
    const res = await asAdmin(
      request(makeApp()).post(`/admin/users/${TARGET}/ban`).send({ note: "abusive uploads" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe("banned");
    expect(res.body.user.adminNote).toBe("abusive uploads");
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "banned", adminNote: "abusive uploads" }),
    );
  });

  it("bans without a note, leaving adminNote untouched", async () => {
    dbState.updateRows = [makeRow({ status: "banned" })];
    const res = await asAdmin(request(makeApp()).post(`/admin/users/${TARGET}/ban`));
    expect(res.status).toBe(200);
    const setArg = (setMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(setArg["status"]).toBe("banned");
    expect("adminNote" in setArg).toBe(false);
  });

  it("rejects an unexpected body key with 400", async () => {
    const res = await asAdmin(
      request(makeApp()).post(`/admin/users/${TARGET}/ban`).send({ reason: "nope" }),
    );
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown clerkUserId", async () => {
    dbState.updateRows = [];
    const res = await asAdmin(request(makeApp()).post("/admin/users/user_unknown/ban").send({}));
    expect(res.status).toBe(404);
  });
});

describe("POST /admin/users/:clerkUserId/restore", () => {
  it("sets a banned user back to approved", async () => {
    dbState.updateRows = [makeRow({ status: "approved", adminNote: "was banned" })];
    const res = await asAdmin(request(makeApp()).post(`/admin/users/${TARGET}/restore`));
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe("approved");
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved" }),
    );
  });

  it("returns 404 for an unknown clerkUserId", async () => {
    dbState.updateRows = [];
    const res = await asAdmin(request(makeApp()).post("/admin/users/user_unknown/restore"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /admin/users/:clerkUserId", () => {
  it("hard-deletes the row", async () => {
    dbState.deleteRows = [makeRow()];
    const res = await asAdmin(request(makeApp()).delete(`/admin/users/${TARGET}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, clerkUserId: TARGET });
    expect(deleteWhereMock).toHaveBeenCalledWith({
      op: "eq",
      column: "clerkUserId",
      value: TARGET,
    });
  });

  it("returns 404 when there is no row to delete", async () => {
    dbState.deleteRows = [];
    const res = await asAdmin(request(makeApp()).delete("/admin/users/user_unknown"));
    expect(res.status).toBe(404);
  });
});

describe("access control", () => {
  const CALLS: Array<[string, (app: express.Express) => request.Test]> = [
    ["GET /admin/users", (app) => request(app).get("/admin/users")],
    ["POST approve", (app) => request(app).post(`/admin/users/${TARGET}/approve`)],
    ["POST ban", (app) => request(app).post(`/admin/users/${TARGET}/ban`)],
    ["POST restore", (app) => request(app).post(`/admin/users/${TARGET}/restore`)],
    ["DELETE", (app) => request(app).delete(`/admin/users/${TARGET}`)],
  ];

  it.each(CALLS)("%s → 403 forbidden for a non-admin caller", async (_label, call) => {
    const res = await asNonAdmin(call(makeApp()));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect(selectMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it.each(CALLS)("%s → 401 for an unauthenticated caller", async (_label, call) => {
    vi.stubEnv("E2E_AUTH_BYPASS", "0");
    const res = await call(makeApp());
    expect(res.status).toBe(401);
  });
});
