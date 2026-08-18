/**
 * requireApproved.test.ts — unit tests for the user-approval gate.
 *
 * Covers every case from the task spec:
 *   - pending user  → 403 awaiting_approval
 *   - banned user   → 403 account_banned
 *   - approved user → next()
 *   - admin user    → next() with NO DB hit
 *   - first-time user → auto-inserts pending row (ON CONFLICT DO NOTHING) + 403
 *   - DB error → forwarded to next(err) (500 via error middleware)
 *   - concurrent first logins → no duplicate-key crash
 *   - enforcement wiring through requireAuth (real-Clerk path enforced,
 *     E2E bypass path skipped)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mocks — requireApproved imports @workspace/db and drizzle-orm dynamically
// at call time; vi.mock intercepts dynamic imports too.
// ---------------------------------------------------------------------------

const {
  dbState,
  selectMock,
  insertMock,
  insertValuesMock,
  onConflictDoNothingMock,
  updateWhereMock,
  updateSetMock,
  updateMock,
  clerkGetUserMock,
} = vi.hoisted(() => {
  const state = {
    selectRows: [] as Array<Record<string, unknown>>,
    selectError: null as Error | null,
    insertError: null as Error | null,
    clerkProfile: null as Record<string, unknown> | null,
    clerkError: null as Error | null,
  };

  const selectWhere = vi.fn(async () => {
    if (state.selectError) throw state.selectError;
    return state.selectRows;
  });
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const onConflictDoNothing = vi.fn(async () => {
    if (state.insertError) throw state.insertError;
    return [];
  });
  const insertValues = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateWhere = vi.fn(async () => []);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const clerkGetUser = vi.fn(async () => {
    if (state.clerkError) throw state.clerkError;
    return state.clerkProfile ?? {
      emailAddresses: [],
      firstName: null,
      lastName: null,
      username: null,
    };
  });

  return {
    dbState: state,
    selectMock: select,
    insertMock: insert,
    insertValuesMock: insertValues,
    onConflictDoNothingMock: onConflictDoNothing,
    updateWhereMock: updateWhere,
    updateSetMock: updateSet,
    updateMock: update,
    clerkGetUserMock: clerkGetUser,
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
  },
  userAccessTable: {
    clerkUserId: "clerkUserId",
    status: "status",
    email: "email",
    displayName: "displayName",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ op: "eq", column, value })),
}));

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => ({ userId: null })),
  // Match the real @clerk/express shape: clerkClient is a client OBJECT,
  // not a factory function.
  clerkClient: { users: { getUser: clerkGetUserMock } },
}));

import { getAuth } from "@clerk/express";
import { requireApproved, shouldEnforceApproval } from "../requireApproved.js";
import { requireAuth } from "../requireAuth.js";

const USER = "user_2pending";
const ADMIN = "user_2admin";

function makeReqRes(clerkUserId?: string) {
  const req = { clerkUserId } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json, locals: {} } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  dbState.selectRows = [];
  dbState.selectError = null;
  dbState.insertError = null;
  dbState.clerkProfile = null;
  dbState.clerkError = null;
});

describe("requireApproved — verdicts", () => {
  it("pending user → 403 awaiting_approval", async () => {
    dbState.selectRows = [{ clerkUserId: USER, status: "pending" }];
    const { req, res, next, status, json } = makeReqRes(USER);
    await requireApproved(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "awaiting_approval", details: expect.any(String) }),
    );
    expect(next).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("banned user → 403 account_banned", async () => {
    dbState.selectRows = [{ clerkUserId: USER, status: "banned" }];
    const { req, res, next, status, json } = makeReqRes(USER);
    await requireApproved(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "account_banned", details: expect.any(String) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("approved user → next() after a single PK lookup", async () => {
    dbState.selectRows = [{ clerkUserId: USER, status: "approved" }];
    const { req, res, next, status } = makeReqRes(USER);
    await requireApproved(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("approved verdict is cached in-request (second invocation does not re-query)", async () => {
    dbState.selectRows = [{ clerkUserId: USER, status: "approved" }];
    const { req, res, next } = makeReqRes(USER);
    await requireApproved(req, res, next);
    await requireApproved(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("admin user → next() without any DB access", async () => {
    vi.stubEnv("ADMIN_USER_IDS", ADMIN);
    const { req, res, next, status } = makeReqRes(ADMIN);
    await requireApproved(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("first-time user → auto-inserts a pending row (ON CONFLICT DO NOTHING) and 403s", async () => {
    dbState.selectRows = [];
    const { req, res, next, status, json } = makeReqRes(USER);
    await requireApproved(req, res, next);
    expect(insertValuesMock).toHaveBeenCalledWith({ clerkUserId: USER, status: "pending" });
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "awaiting_approval" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("first-time user → enriches the pending row with Clerk email + displayName", async () => {
    dbState.selectRows = [];
    dbState.clerkProfile = {
      emailAddresses: [{ emailAddress: "angler@example.com" }],
      firstName: "Test",
      lastName: "Angler",
      username: null,
    };
    const { req, res, next } = makeReqRes(USER);
    await requireApproved(req, res, next);

    expect(clerkGetUserMock).toHaveBeenCalledWith(USER);
    expect(updateSetMock).toHaveBeenCalledWith({
      email: "angler@example.com",
      displayName: "Test Angler",
    });
    expect(updateWhereMock).toHaveBeenCalledWith({ op: "eq", column: "clerkUserId", value: USER });
  });

  it("first-time user → falls back to username when name parts are absent", async () => {
    dbState.selectRows = [];
    dbState.clerkProfile = {
      emailAddresses: [],
      firstName: null,
      lastName: null,
      username: "bigfish42",
    };
    const { req, res, next } = makeReqRes(USER);
    await requireApproved(req, res, next);

    expect(updateSetMock).toHaveBeenCalledWith({
      email: null,
      displayName: "bigfish42",
    });
  });

  it("first-time user → Clerk API failure does not prevent the 403 or crash", async () => {
    dbState.selectRows = [];
    dbState.clerkError = new Error("Clerk API unavailable");
    const { req, res, next, status, json } = makeReqRes(USER);
    await requireApproved(req, res, next);

    // The row is still created and the 403 is still returned.
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "awaiting_approval" }));
    // No DB update attempted after a Clerk failure.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("first-time user → skips DB update when Clerk returns no email and no name", async () => {
    dbState.selectRows = [];
    dbState.clerkProfile = {
      emailAddresses: [],
      firstName: null,
      lastName: null,
      username: null,
    };
    const { req, res, next } = makeReqRes(USER);
    await requireApproved(req, res, next);

    expect(clerkGetUserMock).toHaveBeenCalledWith(USER);
    // Nothing useful to store — update must NOT be called.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("missing clerkUserId (mis-wired chain) → 401, fail closed", async () => {
    const { req, res, next, status } = makeReqRes(undefined);
    await requireApproved(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("DB error on lookup → forwarded to next(err)", async () => {
    dbState.selectError = new Error("connection refused");
    const { req, res, next, status } = makeReqRes(USER);
    await requireApproved(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(status).not.toHaveBeenCalled();
  });

  it("DB error surfaces as 500 through express error handling", async () => {
    dbState.selectError = new Error("connection refused");
    const app = express();
    app.get(
      "/probe",
      (req, _res, next) => {
        (req as Request & { clerkUserId: string }).clerkUserId = USER;
        next();
      },
      (req: Request, res: Response, next: NextFunction) => void requireApproved(req, res, next),
      (_req: Request, res: Response) => res.json({ ok: true }),
    );
    const res = await request(app).get("/probe");
    expect(res.status).toBe(500);
  });

  it("concurrent first logins race without a duplicate-key crash", async () => {
    dbState.selectRows = []; // both requests see "no row"
    const a = makeReqRes(USER);
    const b = makeReqRes(USER);
    await Promise.all([
      requireApproved(a.req, a.res, a.next),
      requireApproved(b.req, b.res, b.next),
    ]);
    // Both go through the ON CONFLICT DO NOTHING path; both 403 cleanly.
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(2);
    expect(a.status).toHaveBeenCalledWith(403);
    expect(b.status).toHaveBeenCalledWith(403);
    expect(a.next).not.toHaveBeenCalled();
    expect(b.next).not.toHaveBeenCalled();
  });
});

describe("shouldEnforceApproval — environment gating", () => {
  it("is disabled by default under vitest", () => {
    expect(shouldEnforceApproval()).toBe(false);
  });

  it("is enabled when REQUIRE_APPROVED_IN_TEST=1", () => {
    vi.stubEnv("REQUIRE_APPROVED_IN_TEST", "1");
    expect(shouldEnforceApproval()).toBe(true);
  });
});

describe("requireAuth → requireApproved wiring", () => {
  function makeApp() {
    const app = express();
    app.get("/protected", requireAuth, (_req, res) => res.json({ ok: true }));
    return app;
  }

  it("real-Clerk pending user is blocked at any requireAuth route when enforcement is on", async () => {
    vi.stubEnv("REQUIRE_APPROVED_IN_TEST", "1");
    vi.mocked(getAuth).mockReturnValue({ userId: USER } as ReturnType<typeof getAuth>);
    dbState.selectRows = [{ clerkUserId: USER, status: "pending" }];
    const res = await request(makeApp()).get("/protected");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("awaiting_approval");
  });

  it("real-Clerk approved user passes through", async () => {
    vi.stubEnv("REQUIRE_APPROVED_IN_TEST", "1");
    vi.mocked(getAuth).mockReturnValue({ userId: USER } as ReturnType<typeof getAuth>);
    dbState.selectRows = [{ clerkUserId: USER, status: "approved" }];
    const res = await request(makeApp()).get("/protected");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("E2E bypass path skips the approval gate entirely even with enforcement on", async () => {
    vi.stubEnv("REQUIRE_APPROVED_IN_TEST", "1");
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    const res = await request(makeApp())
      .get("/protected")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", "user_no_access_row");
    expect(res.status).toBe(200);
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("approval gate is skipped in default test environment (legacy suites unaffected)", async () => {
    vi.mocked(getAuth).mockReturnValue({ userId: USER } as ReturnType<typeof getAuth>);
    dbState.selectRows = []; // would 403 if the gate ran
    const res = await request(makeApp()).get("/protected");
    expect(res.status).toBe(200);
    expect(selectMock).not.toHaveBeenCalled();
  });
});
