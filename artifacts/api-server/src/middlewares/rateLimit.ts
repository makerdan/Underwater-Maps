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

// ---------------------------------------------------------------------------
// Postgres backend — single-query INSERT + windowed count using the shared
// Drizzle pg pool. Atomic enough for our needs: any concurrent inserter sees
// the row it just inserted in its own count.
// ---------------------------------------------------------------------------

const PG_CONSUME_SQL = `
  WITH ins AS (
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

/**
 * Wraps the Postgres backend with an in-memory fallback. Costly AI routes
 * must NOT silently bypass the limiter on a DB outage / missing table — that
 * re-exposes the paid API to abuse. Instead we degrade to per-process memory
 * limiting (still bounded, still per-user/IP) and log loudly so ops can fix
 * the underlying durable store.
 */
const fallbackBackend: RateLimitBackend = {
  async consume(key, windowMs, max) {
    const primary = selectBackend();
    if (primary === memoryBackend) return primary.consume(key, windowMs, max);
    try {
      return await primary.consume(key, windowMs, max);
    } catch (err) {
      console.warn(
        `[rate-limit] durable backend unavailable (${
          (err as Error)?.message ?? "unknown"
        }) — degrading to in-memory limiter`,
      );
      return memoryBackend.consume(key, windowMs, max);
    }
  },
};

function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0];
    if (first && first.trim().length > 0) return first.trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function createRateLimit(opts: RateLimitOptions): RequestHandler {
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
