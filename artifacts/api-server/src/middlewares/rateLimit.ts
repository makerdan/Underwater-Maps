/**
 * Shared sliding-window rate limiter for costly API routes (AI proxies, the
 * NL `/query` endpoint, etc.).
 *
 * Backends
 * --------
 * - **Postgres** (default in dev/prod) — inserts one row per request into
 *   `rate_limit_events` and counts the rows whose `created_at` is inside the
 *   active window. Shared across processes and survives restarts.
 * - **Memory** (tests + emergency fallback) — same semantics, in-process Map.
 *   Selected when `RATE_LIMIT_BACKEND === "memory"`.
 *
 * Key shape
 * ---------
 * - mode `user`: `u:<route>:<userId>` — requires upstream `requireAuth` to
 *   have populated `clerkUserId`. Without it the middleware short-circuits
 *   with 401 (unless `skipIfNoUser` is set, in which case the request is
 *   passed through — useful for stacking IP+user limiters).
 * - mode `ip`: `i:<route>:<ip>` — derived from `X-Forwarded-For` (first hop)
 *   or `req.ip` / socket address as a fallback.
 *
 * The middleware always sets `X-RateLimit-{Limit,Remaining,Reset}` headers on
 * its response and adds `Retry-After` on 429s.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { pool } from "@workspace/db";
import type { AuthenticatedRequest } from "./requireAuth.js";
import { logger } from "../lib/logger.js";

export type RateLimitKeyMode = "user" | "ip";

export interface RateLimitOptions {
  /** Logical route name; included in the bucket key so different routes don't share quota. */
  route: string;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed per key per window. */
  max: number;
  /** Whether the key is per-authenticated-user or per-client-IP. */
  mode: RateLimitKeyMode;
  /**
   * In `user` mode, skip the limiter (call `next()`) when no userId is present
   * instead of replying 401. Useful when chaining a user limiter behind an
   * earlier auth middleware that has already 401'd unauthenticated requests
   * — or when stacking with an IP limiter for unauthenticated endpoints.
   */
  skipIfNoUser?: boolean;
}

// ---------------------------------------------------------------------------
// Route registry — populated by createRateLimit so the admin usage endpoint
// can resolve max / windowMs for each observed bucket_key.
// ---------------------------------------------------------------------------

interface RouteRegistryEntry {
  route: string;
  mode: RateLimitKeyMode;
  max: number;
  windowMs: number;
}

const routeRegistry: RouteRegistryEntry[] = [];

/** Returns a snapshot of every route/mode pair that has been registered. */
export function getRouteRegistry(): Readonly<RouteRegistryEntry[]> {
  return routeRegistry;
}

// ---------------------------------------------------------------------------
// Admin usage query — reads the rate_limit_events table and returns the
// top-N bucket_keys by event count within the given window.
// ---------------------------------------------------------------------------

export interface RateLimitUsageRow {
  bucket_key: string;
  route: string;
  mode: RateLimitKeyMode;
  count: number;
  max: number | null;
  remaining: number | null;
}

const USAGE_SQL = `
  SELECT bucket_key, COUNT(*)::int AS count
  FROM rate_limit_events
  WHERE created_at > NOW() - ($1::bigint || ' milliseconds')::interval
  GROUP BY bucket_key
  ORDER BY count DESC
  LIMIT $2
`;

/**
 * Queries the live rate_limit_events table for aggregated window usage.
 *
 * @param windowMs  - The sliding window size in ms. Defaults to 60 000 (1 min).
 * @param topN      - Maximum number of bucket_keys to return. Defaults to 25.
 */
export async function queryRateLimitUsage(
  windowMs = 60_000,
  topN = 25,
): Promise<RateLimitUsageRow[]> {
  const result = await pool.query<{ bucket_key: string; count: number }>(USAGE_SQL, [
    windowMs,
    topN,
  ]);

  return result.rows.map((row) => {
    const parts = row.bucket_key.split(":");
    const modeChar = parts[0] ?? "";
    const route = parts[1] ?? row.bucket_key;
    const mode: RateLimitKeyMode = modeChar === "i" ? "ip" : "user";

    const entry = routeRegistry.find((e) => e.route === route && e.mode === mode);
    const max = entry?.max ?? null;
    const remaining = max !== null ? Math.max(0, max - row.count) : null;

    return { bucket_key: row.bucket_key, route, mode, count: row.count, max, remaining };
  });
}

interface ConsumeResult {
  allowed: boolean;
  /** Requests still permitted in the current window (>= 0). */
  remaining: number;
  /** Milliseconds until the window resets for this key. */
  retryAfterMs: number;
}

interface RateLimitBackend {
  consume(key: string, windowMs: number, max: number): Promise<ConsumeResult>;
}

// ---------------------------------------------------------------------------
// In-memory backend — used by unit tests and as an emergency fallback if the
// Postgres backend errors. Sliding window: stores per-key timestamp lists,
// purges old entries on every consume.
// ---------------------------------------------------------------------------

const memoryBuckets = new Map<string, number[]>();

const memoryBackend: RateLimitBackend = {
  async consume(key, windowMs, max) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const prev = memoryBuckets.get(key) ?? [];
    const live: number[] = [];
    for (const t of prev) if (t > cutoff) live.push(t);
    if (live.length >= max) {
      const oldest = live[0] as number;
      memoryBuckets.set(key, live);
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, oldest + windowMs - now) };
    }
    live.push(now);
    memoryBuckets.set(key, live);
    return { allowed: true, remaining: max - live.length, retryAfterMs: windowMs };
  },
};

/** Test-only hook: wipe the in-memory bucket state between tests. */
export function __resetRateLimitMemory(): void {
  memoryBuckets.clear();
}

/**
 * Test-only hook: sweep timestamps older than maxAgeMs from all in-memory
 * buckets, mirroring what the Postgres prune job does for the durable store.
 * Returns the number of timestamps removed.
 */
export function __pruneMemoryBackend(maxAgeMs: number): number {
  const cutoff = Date.now() - maxAgeMs;
  let swept = 0;
  for (const [key, timestamps] of memoryBuckets.entries()) {
    const before = timestamps.length;
    const live = timestamps.filter((t) => t > cutoff);
    swept += before - live.length;
    if (live.length > 0) {
      memoryBuckets.set(key, live);
    } else {
      memoryBuckets.delete(key);
    }
  }
  return swept;
}

/**
 * Test-only hook: pre-fill an in-memory rate-limit bucket with `count`
 * synthetic timestamps spread evenly within the given window.
 *
 * This lets tests assert "Nth request is blocked" or "last allowed request
 * passes" without sending N-1 actual HTTP requests to exhaust the quota.
 * Dramatically reduces run time for high-limit routes (e.g. terrain-fetch
 * at 90 req/min would otherwise require 90 supertest round-trips).
 *
 * @param key      - Raw bucket key: `i:<route>:<ip>` or `u:<route>:<userId>`.
 * @param count    - Number of timestamps to inject (typically max or max-1).
 * @param windowMs - Window length in ms; all timestamps are placed inside it.
 */
export function __prefillRateLimitMemory(key: string, count: number, windowMs: number): void {
  const now = Date.now();
  const timestamps: number[] = [];
  for (let i = 0; i < count; i++) {
    // Spread timestamps evenly across the window, all guaranteed to be live
    // (newer than the cutoff = now - windowMs) when the next consume() runs.
    timestamps.push(now - windowMs + Math.floor((windowMs * (i + 1)) / (count + 1)));
  }
  memoryBuckets.set(key, timestamps);
}

// ---------------------------------------------------------------------------
// Postgres backend — single-query INSERT + windowed count using the shared
// Drizzle pg pool. Atomic enough for our needs: any concurrent inserter sees
// the row it just inserted in its own count.
// ---------------------------------------------------------------------------

const PG_CONSUME_SQL = `
  WITH prune AS (
    DELETE FROM rate_limit_events
    WHERE created_at < now() - ($2::bigint || ' milliseconds')::interval
  ),
  ins AS (
    INSERT INTO rate_limit_events (bucket_key) VALUES ($1) RETURNING created_at
  ),
  window_rows AS (
    SELECT created_at FROM rate_limit_events
    WHERE bucket_key = $1
      AND created_at > now() - ($2::bigint || ' milliseconds')::interval
  )
  SELECT
    (SELECT count(*)::int FROM window_rows) AS count,
    (SELECT EXTRACT(EPOCH FROM min(created_at))::float8 FROM window_rows) AS oldest_epoch;
`;

const pgBackend: RateLimitBackend = {
  async consume(key, windowMs, max) {
    const result = await pool.query<{ count: number; oldest_epoch: number | null }>(
      PG_CONSUME_SQL,
      [key, windowMs],
    );
    const row = result.rows[0];
    const count = row?.count ?? 1;
    const oldestEpoch = row?.oldest_epoch ?? Date.now() / 1000;
    if (count > max) {
      const retryAfterMs = Math.max(
        1000,
        Math.ceil(oldestEpoch * 1000 + windowMs - Date.now()),
      );
      return { allowed: false, remaining: 0, retryAfterMs };
    }
    return { allowed: true, remaining: max - count, retryAfterMs: windowMs };
  },
};

function selectBackend(): RateLimitBackend {
  return process.env["RATE_LIMIT_BACKEND"] === "memory" ? memoryBackend : pgBackend;
}

const FALLBACK_WARN_INTERVAL_MS = 60_000;
let lastFallbackWarnAt = 0;

/**
 * Wraps the Postgres backend with an in-memory fallback. Costly AI routes
 * must NOT silently bypass the limiter on a DB outage / missing table — that
 * re-exposes the paid API to abuse. Instead we degrade to per-process memory
 * limiting (still bounded, still per-user/IP) and emit a throttled WARN once
 * per minute so ops can see the degradation without flooding logs.
 */
const fallbackBackend: RateLimitBackend = {
  async consume(key, windowMs, max) {
    const primary = selectBackend();
    if (primary === memoryBackend) return primary.consume(key, windowMs, max);
    try {
      return await primary.consume(key, windowMs, max);
    } catch (err) {
      const now = Date.now();
      if (now - lastFallbackWarnAt >= FALLBACK_WARN_INTERVAL_MS) {
        lastFallbackWarnAt = now;
        logger.warn(
          {
            code: "rate_limit_fallback_active",
            err: (err as Error)?.message ?? "unknown",
          },
          "Rate limiter degraded to in-memory backend — durable Postgres store unavailable",
        );
      }
      return memoryBackend.consume(key, windowMs, max);
    }
  },
};

// ---------------------------------------------------------------------------
// Standalone prune — deletes all rows older than maxAgeMs from the durable
// store. The inline CTE prunes on each consume() call, but infrequently-used
// keys accumulate stale rows between requests. The scheduled prune job calls
// this on a fixed interval so the table stays bounded regardless of traffic.
// ---------------------------------------------------------------------------

const PRUNE_SQL = `
  DELETE FROM rate_limit_events
  WHERE created_at < now() - ($1::bigint || ' milliseconds')::interval
`;

/**
 * Delete all rate_limit_events rows older than `maxAgeMs` milliseconds.
 *
 * Uses the Postgres backend in production and the in-memory sweep helper in
 * test environments (RATE_LIMIT_BACKEND=memory). Returns the number of rows /
 * timestamps removed. Errors are caught and logged — callers never need to
 * handle them.
 */
export async function pruneRateLimitEvents(maxAgeMs: number): Promise<number> {
  if (process.env["RATE_LIMIT_BACKEND"] === "memory") {
    return __pruneMemoryBackend(maxAgeMs);
  }
  try {
    const result = await pool.query(PRUNE_SQL, [maxAgeMs]);
    return result.rowCount ?? 0;
  } catch (err) {
    logger.warn(
      { code: "rate_limit_prune_error", err: (err as Error)?.message ?? "unknown" },
      "Rate-limit prune failed — stale rows may accumulate until next run",
    );
    return 0;
  }
}

function clientIp(req: Request): string {
  // req.ip is authoritative when app.set("trust proxy", 1) is configured —
  // Express validates the proxy hop and strips untrustworthy XFF entries,
  // preventing clients from spoofing arbitrary IPs via the header.
  if (req.ip && req.ip.length > 0) return req.ip;
  return req.socket.remoteAddress ?? "unknown";
}

export function createRateLimit(opts: RateLimitOptions): RequestHandler {
  const alreadyRegistered = routeRegistry.some(
    (e) => e.route === opts.route && e.mode === opts.mode,
  );
  if (!alreadyRegistered) {
    routeRegistry.push({ route: opts.route, mode: opts.mode, max: opts.max, windowMs: opts.windowMs });
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = (req as AuthenticatedRequest).clerkUserId;
    let key: string;
    if (opts.mode === "user") {
      if (!userId) {
        if (opts.skipIfNoUser) {
          next();
          return;
        }
        res.status(401).json({ error: "unauthenticated", message: "Authentication required" });
        return;
      }
      key = `u:${opts.route}:${userId}`;
    } else {
      key = `i:${opts.route}:${clientIp(req)}`;
    }

    // Always use the fallback wrapper: if the durable Postgres store is
    // unavailable we still enforce a (per-process) in-memory limit rather
    // than bypass entirely. Bypassing on DB failure would re-open the very
    // abuse vector this middleware exists to close.
    const result = await fallbackBackend.consume(key, opts.windowMs, opts.max);

    res.setHeader("X-RateLimit-Limit", String(opts.max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, result.remaining)));
    res.setHeader(
      "X-RateLimit-Reset",
      String(Math.ceil((Date.now() + result.retryAfterMs) / 1000)),
    );

    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "rate_limit",
        message: "Too many requests — please wait a moment",
      });
      return;
    }

    next();
  };
}

/**
 * Pre-stamps baseline `X-RateLimit-*` headers before delegating to another
 * middleware (typically `requireAuth`). Lets 401 responses still carry rate
 * limit headers so clients can reason about quota even without a session.
 */
export function stampBaselineRateLimitHeaders(max: number, windowMs: number) {
  return function baselineHeaders(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(max));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil((Date.now() + windowMs) / 1000)));
    next();
  };
}
