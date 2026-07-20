/**
 * rate-limit-prune.test.ts
 *
 * Unit tests for the rate-limit prune functionality:
 *
 *  1. __pruneMemoryBackend — sweeps old timestamps from the in-memory store,
 *     leaving live entries intact.
 *  2. pruneRateLimitEvents (memory backend) — delegates to __pruneMemoryBackend
 *     when RATE_LIMIT_BACKEND=memory, removes old entries and returns the count.
 *  3. pruneRateLimitEvents (pg backend) — issues the correct DELETE SQL with
 *     maxAgeMs as the threshold parameter; returns rowCount.
 *  4. Prune resilience — pool.query errors are caught and 0 is returned without
 *     re-throwing so the scheduled job stays alive.
 *
 * All tests use vitest fake-module mocking so no real Postgres connection is
 * required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @workspace/db — stateful pool.query so individual tests can control it.
// ---------------------------------------------------------------------------

let _pgQueryImpl: (sql: string, params: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> =
  async () => ({ rows: [], rowCount: 0 });

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn().mockImplementation((sql: string, params: unknown[]) =>
      _pgQueryImpl(sql, params),
    ),
  },
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

import {
  pruneRateLimitEvents,
  __resetRateLimitMemory,
  __prefillRateLimitMemory,
  __pruneMemoryBackend,
} from "../middlewares/rateLimit.js";

beforeEach(() => {
  __resetRateLimitMemory();
  _pgQueryImpl = async () => ({ rows: [], rowCount: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// 1. __pruneMemoryBackend — pure in-process sweep
// ---------------------------------------------------------------------------

describe("__pruneMemoryBackend — sweeps old timestamps", () => {
  it("removes timestamps older than maxAgeMs and returns count swept", () => {
    const windowMs = 60_000;

    __prefillRateLimitMemory("u:test-route:user1", 3, windowMs);

    // Verify entries are present before prune.
    // (We know 3 were added — if prune reports swept=0, the bucket is fresh.)
    // Now prune with maxAgeMs=0 to force-sweep everything (all timestamps < now).
    const swept = __pruneMemoryBackend(0);
    expect(swept).toBe(3);
  });

  it("leaves live timestamps in place", () => {
    const windowMs = 60_000;
    __prefillRateLimitMemory("u:test-route:user2", 5, windowMs);

    // Prune with maxAgeMs = windowMs * 2 so all recent timestamps survive.
    const swept = __pruneMemoryBackend(windowMs * 2);
    expect(swept).toBe(0);
  });

  it("deletes the bucket entry entirely when all timestamps are pruned", () => {
    __prefillRateLimitMemory("u:test-route:user3", 2, 60_000);
    __pruneMemoryBackend(0); // force-prune everything

    // After pruning all entries, a second prune of the same bucket returns 0.
    const secondSweep = __pruneMemoryBackend(0);
    expect(secondSweep).toBe(0);
  });

  it("returns 0 when the memory store is empty", () => {
    const swept = __pruneMemoryBackend(60_000);
    expect(swept).toBe(0);
  });

  it("handles multiple buckets independently", () => {
    const windowMs = 60_000;
    __prefillRateLimitMemory("u:route-a:alice", 4, windowMs);
    __prefillRateLimitMemory("u:route-b:bob", 2, windowMs);

    // Prune everything.
    const swept = __pruneMemoryBackend(0);
    expect(swept).toBe(6); // 4 + 2

    // Both buckets gone — second pass returns 0.
    expect(__pruneMemoryBackend(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. pruneRateLimitEvents with RATE_LIMIT_BACKEND=memory
// ---------------------------------------------------------------------------

describe("pruneRateLimitEvents — memory backend delegates to __pruneMemoryBackend", () => {
  beforeEach(() => {
    vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  });

  it("removes old in-memory entries and returns the swept count", async () => {
    __prefillRateLimitMemory("u:test-route:user4", 3, 60_000);

    const deleted = await pruneRateLimitEvents(0); // force-prune
    expect(deleted).toBe(3);
  });

  it("returns 0 when no entries are older than maxAgeMs", async () => {
    __prefillRateLimitMemory("u:test-route:user5", 2, 60_000);

    const deleted = await pruneRateLimitEvents(60_000 * 2); // keep everything
    expect(deleted).toBe(0);
  });

  it("does not call pool.query when the memory backend is selected", async () => {
    const { pool } = await import("@workspace/db");
    (pool.query as ReturnType<typeof vi.fn>).mockClear();

    await pruneRateLimitEvents(60_000);

    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. pruneRateLimitEvents — pg backend issues the correct DELETE SQL
// ---------------------------------------------------------------------------

describe("pruneRateLimitEvents — pg backend issues correct SQL", () => {
  it("sends DELETE FROM rate_limit_events with maxAgeMs as threshold", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];

    _pgQueryImpl = async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [], rowCount: 7 };
    };

    const deleted = await pruneRateLimitEvents(300_000);

    expect(capturedSql).toMatch(/DELETE FROM rate_limit_events/i);
    expect(capturedSql).toMatch(/created_at < now\(\)/i);
    expect(capturedParams[0]).toBe(300_000);
    expect(deleted).toBe(7);
  });

  it("returns the rowCount reported by postgres", async () => {
    _pgQueryImpl = async () => ({ rows: [], rowCount: 42 });
    const deleted = await pruneRateLimitEvents(60_000);
    expect(deleted).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 4. Prune resilience — pool errors are caught and do not throw
// ---------------------------------------------------------------------------

describe("pruneRateLimitEvents — pg backend error resilience", () => {
  it("returns 0 and does not throw when pool.query rejects", async () => {
    _pgQueryImpl = async () => {
      throw new Error("FATAL: connection refused");
    };

    await expect(pruneRateLimitEvents(60_000)).resolves.toBe(0);
  });
});
