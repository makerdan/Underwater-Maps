/**
 * health.test.ts — unit/integration tests for the health-check routes.
 *
 * Covers:
 *   GET /healthz       — shallow liveness probe
 *   GET /healthz/deep  — deep subsystem probe (DB, Poe, AOOS)
 *
 * Regression suite (task 3552):
 *   (a) Poe probe 401 → subsystem degraded
 *   (b) Poe probe 403 → subsystem degraded
 *   (c) Poe probe 404 → subsystem degraded
 *   (d) AOOS probe 401/403/404 → subsystem degraded
 *   (e) DB query timeout → overall degraded, client.release() always called
 *   (f) shallow /healthz Zod parse failure → Express error handler (500),
 *       not uncaught exception
 *
 * Security regression (task 3698):
 *   (g) raw env-var values must never appear in any health response body
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// @workspace/db mock — supports both pool.query (legacy) and pool.connect()
// ---------------------------------------------------------------------------
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: {
    query: (...args: unknown[]) => poolQueryMock(...args),
    connect: (...args: unknown[]) => mockConnect(...args),
    totalCount: 2,
    idleCount: 1,
    waitingCount: 0,
  },
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

import healthRouter from "../health.js";

function makeApp() {
  const app = express();
  app.use(healthRouter);
  // Simple error handler so asyncHandler errors become 500 JSON responses
  // rather than unhandled rejections.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

/** Resets the DB client mock to simulate a healthy, fast query. */
function setupHealthyDb() {
  // All queries (BEGIN, SET LOCAL, SELECT 1, COMMIT) succeed by default.
  mockClientQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });
  mockClientRelease.mockReset();
  mockConnect.mockResolvedValue({
    query: mockClientQuery,
    release: mockClientRelease,
  });
}

// ---------------------------------------------------------------------------
// Shallow probe
// ---------------------------------------------------------------------------
describe("GET /healthz — shallow liveness probe", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(makeApp()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("(f) Zod parse failure in /healthz becomes a 500 Express error response, not an uncaught exception", async () => {
    // Import as namespace so we get the same object reference that health.ts
    // already holds (ESM live bindings share the same object).
    const apiZod = await import("@workspace/api-zod");
    const schema = apiZod.HealthCheckResponse;
    const realParse = schema.parse.bind(schema);
    schema.parse = () => { throw new Error("Zod parse failed: simulated"); };

    try {
      const res = await request(makeApp()).get("/healthz");
      // asyncHandler must forward the throw to Express error middleware → 500
      expect(res.status).toBe(500);
    } finally {
      schema.parse = realParse;
    }
  });
});

// ---------------------------------------------------------------------------
// Deep probe
// ---------------------------------------------------------------------------
describe("GET /healthz/deep — deep health check", () => {
  const fetchMock = vi.fn();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = fetchMock as typeof fetch;
    poolQueryMock.mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    mockConnect.mockReset();
    setupHealthyDb();
    vi.stubEnv("POE_API_KEY", "test-key");
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it("returns 200 when all subsystems are healthy", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await request(makeApp()).get("/healthz/deep");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.subsystems).toMatchObject({
      db: { status: "ok" },
      poe: { status: "ok" },
      aoos: { status: "ok" },
    });
    expect(res.body.subsystems.db.pool).toMatchObject({
      total: expect.any(Number),
      idle: expect.any(Number),
      waiting: expect.any(Number),
    });
  });

  it("returns 503 when the DB is degraded", async () => {
    mockConnect.mockRejectedValue(new Error("connection refused"));
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await request(makeApp()).get("/healthz/deep");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.subsystems.db.status).toBe("degraded");
  });

  it("returns 503 when POE_API_KEY is missing", async () => {
    vi.stubEnv("POE_API_KEY", "");
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await request(makeApp()).get("/healthz/deep");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.subsystems.poe.status).toBe("degraded");
  });

  it("includes latencyMs in db subsystem when healthy", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await request(makeApp()).get("/healthz/deep");
    if (res.body.subsystems.db.status === "ok") {
      expect(typeof res.body.subsystems.db.latencyMs).toBe("number");
    }
  });

  // -------------------------------------------------------------------------
  // (a-c) Poe probe: 4xx must be treated as degraded, not healthy
  // -------------------------------------------------------------------------
  it.each([401, 403, 404])(
    "(a-c) Poe probe HTTP %i → poe subsystem degraded",
    async (statusCode) => {
      // AOOS healthy; only Poe returns a non-2xx
      fetchMock.mockImplementation((url: string) => {
        if (String(url).includes("poe.com")) {
          return Promise.resolve({ ok: false, status: statusCode });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const res = await request(makeApp()).get("/healthz/deep");
      expect(res.status).toBe(503);
      expect(res.body.subsystems.poe.status).toBe("degraded");
      expect(res.body.subsystems.poe.statusCode).toBe(statusCode);
      // AOOS and DB should still be ok
      expect(res.body.subsystems.db.status).toBe("ok");
      expect(res.body.subsystems.aoos.status).toBe("ok");
    },
  );

  // -------------------------------------------------------------------------
  // (d) AOOS probe: 4xx must be treated as degraded, not healthy
  // -------------------------------------------------------------------------
  it.each([401, 403, 404])(
    "(d) AOOS probe HTTP %i → aoos subsystem degraded",
    async (statusCode) => {
      fetchMock.mockImplementation((url: string) => {
        if (String(url).includes("aoos.org")) {
          return Promise.resolve({ ok: false, status: statusCode });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const res = await request(makeApp()).get("/healthz/deep");
      expect(res.status).toBe(503);
      expect(res.body.subsystems.aoos.status).toBe("degraded");
      expect(res.body.subsystems.aoos.statusCode).toBe(statusCode);
      // Poe and DB should still be ok
      expect(res.body.subsystems.db.status).toBe("ok");
      expect(res.body.subsystems.poe.status).toBe("ok");
    },
  );

  // -------------------------------------------------------------------------
  // (e) DB query timeout → degraded AND client.release() always called
  // -------------------------------------------------------------------------
  it("(e) DB query timeout → db subsystem degraded and client is always released", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    // Query call order inside the transaction:
    //   0: BEGIN        → ok
    //   1: SET LOCAL    → ok
    //   2: SELECT 1     → fails (statement_timeout)
    //   3: ROLLBACK     → ok (best-effort cleanup)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SET LOCAL statement_timeout
      .mockRejectedValueOnce(new Error("canceling statement due to statement timeout"))
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const res = await request(makeApp()).get("/healthz/deep");
    expect(res.status).toBe(503);
    expect(res.body.subsystems.db.status).toBe("degraded");
    expect(res.body.subsystems.db.error).toMatch(/timeout/i);

    // Critical: the client must be released even when the query fails
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("(e) DB connect timeout → db subsystem degraded and no release attempted", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    // pool.connect() itself times out (pool exhausted)
    mockConnect.mockRejectedValue(new Error("timeout exceeded when trying to connect"));

    const res = await request(makeApp()).get("/healthz/deep");
    expect(res.status).toBe(503);
    expect(res.body.subsystems.db.status).toBe("degraded");
    // No client was obtained so release should never have been called
    expect(mockClientRelease).not.toHaveBeenCalled();
  });

  it("(e) ROLLBACK failure → client is discarded (release called with error), not returned to pool", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    // Query call order:
    //   0: BEGIN       → ok
    //   1: SET LOCAL   → ok
    //   2: SELECT 1    → fails (statement_timeout)
    //   3: ROLLBACK    → also fails (connection dropped)
    const rollbackError = new Error("server closed the connection unexpectedly");
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
      .mockRejectedValueOnce(new Error("canceling statement due to statement timeout"))
      .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

    const res = await request(makeApp()).get("/healthz/deep");
    expect(res.status).toBe(503);
    expect(res.body.subsystems.db.status).toBe("degraded");

    // client.release(err) must be called with a truthy Error so node-postgres
    // destroys the broken client instead of returning it to the pool.
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    const firstCall = mockClientRelease.mock.calls[0];
    expect(firstCall).toBeDefined();
    const releaseArg = firstCall?.[0];
    expect(releaseArg).toBeInstanceOf(Error);
  });

  // -------------------------------------------------------------------------
  // Session-state isolation: SET LOCAL must be scoped to the transaction so
  // that statement_timeout does not leak into subsequent queries on the same
  // pooled connection.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // (g) Raw env-var values must never appear in any health response body
  // -------------------------------------------------------------------------
  it("(g) raw POE_API_KEY value is never embedded in the /healthz/deep response body", async () => {
    const sensitiveKey = "sk-poe-super-secret-sentinel-value-12345";
    vi.stubEnv("POE_API_KEY", sensitiveKey);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await request(makeApp()).get("/healthz/deep");
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain(sensitiveKey);
  });

  it("(g) when POE_API_KEY is absent the degraded response body contains no raw env values", async () => {
    vi.stubEnv("POE_API_KEY", "");
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await request(makeApp()).get("/healthz/deep");
    expect(res.status).toBe(503);
    // The error field must only mention that the key is not configured —
    // not expose any portion of process.env itself.
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/process\.env/);
    expect(res.body.subsystems.poe.error).toBe("POE_API_KEY not configured");
  });

  it("uses SET LOCAL inside a transaction so statement_timeout does not escape to reused connections", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const queryCalls: string[] = [];
    mockClientQuery.mockImplementation((sql: string) => {
      queryCalls.push(sql.trim());
      return Promise.resolve({ rows: [] });
    });

    const res = await request(makeApp()).get("/healthz/deep");
    expect(res.status).toBe(200);

    // Verify the transaction envelope: BEGIN ... SET LOCAL ... COMMIT (no ROLLBACK)
    expect(queryCalls[0]).toBe("BEGIN");
    const setLocalCall = queryCalls.find((q) => /^SET LOCAL\b/i.test(q));
    expect(setLocalCall).toBeTruthy();
    expect(setLocalCall).toMatch(/statement_timeout/i);
    const lastCall = queryCalls[queryCalls.length - 1];
    expect(lastCall).toBe("COMMIT");
    expect(queryCalls.every((q) => !/^ROLLBACK$/i.test(q))).toBe(true);

    // The client is released after the transaction closes — at this point the
    // session has exited the transaction and statement_timeout is back to its
    // original value automatically (SET LOCAL is transaction-scoped in Postgres).
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});
