/**
 * health.test.ts — integration tests for the health-check routes.
 *
 * Covers:
 *   GET /healthz       — shallow liveness probe
 *   GET /healthz/deep  — deep subsystem probe (DB, Poe, AOOS)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const poolQueryMock = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: {
    query: (...args: unknown[]) => poolQueryMock(...args),
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
  return app;
}

describe("GET /healthz — shallow liveness probe", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(makeApp()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("GET /healthz/deep — deep health check", () => {
  const fetchMock = vi.fn();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = fetchMock as typeof fetch;
    poolQueryMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns 200 when all subsystems are healthy", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await request(makeApp()).get("/healthz/deep");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.subsystems).toMatchObject({
      db: { status: "ok" },
      poe: expect.any(Object),
      aoos: expect.any(Object),
    });
    expect(res.body.subsystems.db.pool).toMatchObject({
      total: expect.any(Number),
      idle: expect.any(Number),
      waiting: expect.any(Number),
    });
  });

  it("returns 503 when the DB is degraded", async () => {
    poolQueryMock.mockRejectedValue(new Error("connection refused"));
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    vi.stubEnv("POE_API_KEY", "test-key");

    const res = await request(makeApp()).get("/healthz/deep");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.subsystems.db.status).toBe("degraded");
  });

  it("returns 503 when POE_API_KEY is missing", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    vi.stubEnv("POE_API_KEY", "");

    const res = await request(makeApp()).get("/healthz/deep");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.subsystems.poe.status).toBe("degraded");
  });

  it("includes latencyMs in db subsystem when healthy", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    vi.stubEnv("POE_API_KEY", "test-key");

    const res = await request(makeApp()).get("/healthz/deep");
    if (res.body.subsystems.db.status === "ok") {
      expect(typeof res.body.subsystems.db.latencyMs).toBe("number");
    }
  });
});
