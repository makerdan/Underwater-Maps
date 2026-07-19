/**
 * rate-limit-fallback.test.ts
 *
 * Verifies that the rate-limiter in-memory fallback enforces per-key request
 * limits even when the Postgres backend is unavailable (pool.query throws).
 *
 * Design: rateLimit.ts wraps the Postgres backend in a `fallbackBackend` that
 * catches any DB errors and degrades to an in-memory sliding-window store.
 * This test confirms the degraded path is NOT a silent pass-through — it still
 * enforces the configured `max` and returns 429 once the budget is exhausted.
 *
 * We inject the DB failure by mocking pool.query to reject with an error, then
 * set RATE_LIMIT_BACKEND to "postgres" (the default) so the primary path is
 * attempted before falling back. __resetRateLimitMemory() clears the in-memory
 * bucket state between tests for deterministic results.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { loggerMockFactory } from "./helpers/mockLogger.js";

const mockPoolQuery = vi.hoisted(() =>
  vi.fn().mockRejectedValue(new Error("DB unavailable")),
);

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const mock = createDbMock();
  return { ...mock, pool: { query: mockPoolQuery } };
});

vi.mock("../lib/logger.js", () => loggerMockFactory());

import {
  createRateLimit,
  __resetRateLimitMemory,
} from "../middlewares/rateLimit.js";

function buildApp(max: number) {
  const app = express();
  app.set("trust proxy", 1);
  const limiter = createRateLimit({
    route: "test-fallback",
    windowMs: 60_000,
    max,
    mode: "ip",
  });
  app.get("/ping", limiter, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("RATE_LIMIT_BACKEND", "postgres");
  mockPoolQuery.mockRejectedValue(new Error("DB unavailable"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rate-limiter — in-memory fallback when DB is unavailable", () => {
  it("allows requests up to the configured max even while falling back to memory", async () => {
    const app = buildApp(3);

    const r1 = await request(app).get("/ping");
    const r2 = await request(app).get("/ping");
    const r3 = await request(app).get("/ping");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
  });

  it("returns 429 on the request that exceeds the limit (not a silent pass-through)", async () => {
    const app = buildApp(2);

    const r1 = await request(app).get("/ping");
    const r2 = await request(app).get("/ping");
    const r3 = await request(app).get("/ping");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.body).toMatchObject({ error: "rate_limit" });
  });

  it("includes Retry-After header on the 429 response", async () => {
    const app = buildApp(1);

    await request(app).get("/ping");
    const r2 = await request(app).get("/ping");

    expect(r2.status).toBe(429);
    expect(r2.headers["retry-after"]).toBeDefined();
    expect(Number(r2.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("includes X-RateLimit-Limit and X-RateLimit-Remaining headers on allowed responses", async () => {
    const app = buildApp(5);

    const r1 = await request(app).get("/ping");
    expect(r1.status).toBe(200);
    expect(r1.headers["x-ratelimit-limit"]).toBe("5");
    expect(Number(r1.headers["x-ratelimit-remaining"])).toBeGreaterThanOrEqual(0);
  });

  it("separate keys (IPs) have independent quotas in the fallback store", async () => {
    const app = buildApp(1);

    const r1 = await request(app).get("/ping").set("x-forwarded-for", "10.0.0.1");
    const r2 = await request(app).get("/ping").set("x-forwarded-for", "10.0.0.2");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });
});
