/**
 * Scheduled background job that prunes stale rows from rate_limit_events.
 *
 * The sliding-window consume() CTE already deletes rows outside the active
 * window on every request, but keys with infrequent traffic accumulate stale
 * rows between calls.  This job sweeps the entire table on a fixed interval
 * so the table stays bounded regardless of per-key traffic patterns.
 *
 * TTL policy: delete rows older than PRUNE_MAX_AGE_MS (5 minutes) — safely
 * beyond the longest window used by any rate limiter (currently 1 minute).
 * Interval: every PRUNE_INTERVAL_MS (5 minutes).
 *
 * Horizontal scale-out coordination
 * ----------------------------------
 * Under horizontal scale-out or blue/green deployments, multiple API server
 * instances run this job on the same interval.  Without coordination they
 * would each issue the same DELETE, wasting DB I/O and potentially causing
 * lock contention.  We use `pg_try_advisory_lock` (non-blocking) so exactly
 * one instance acquires the lock and runs the prune; all others skip silently.
 * The lock is released immediately after the prune completes (or on error)
 * so the next interval can run on any instance.
 *
 * The advisory lock has no effect in memory-backend mode (tests / local dev
 * without Postgres) because there is no shared database to coordinate through.
 */
import { logger } from "./logger.js";
import { pruneRateLimitEvents } from "../middlewares/rateLimit.js";
import { pool } from "@workspace/db";

export const PRUNE_MAX_AGE_MS = 5 * 60_000;
export const PRUNE_INTERVAL_MS = 5 * 60_000;

/**
 * Stable advisory lock key for the rate-limit prune job.
 *
 * All API server instances must share this value so pg_try_advisory_lock
 * acts as a cross-process mutex.  The constant is a 32-bit positive integer
 * derived from the ASCII bytes of "rlpj" (rate-limit prune job):
 *   r=0x72  l=0x6c  p=0x70  j=0x6a  →  0x726c706a = 1919898730
 */
export const PRUNE_ADVISORY_LOCK_KEY = 0x726c_706a;

/**
 * Start the rate-limit prune job. Runs once immediately, then on a fixed
 * interval. Returns a stop function that clears the interval — call it during
 * graceful shutdown so the interval cannot fire after the DB pool tears down.
 *
 * When the Postgres backend is active, each run attempts to acquire a
 * session-level advisory lock before executing the prune.  If the lock is
 * already held by another instance, this run is skipped silently.  The lock
 * is released in the `finally` block so the next interval can compete freely.
 */
export function startRateLimitPruneJob(): () => void {
  const useDb = process.env["RATE_LIMIT_BACKEND"] !== "memory";

  const run = async (): Promise<void> => {
    let lockAcquired = false;

    try {
      if (useDb) {
        // pg_try_advisory_lock returns true if this session acquired the lock,
        // false (without blocking) if another session already holds it.
        const lockResult = await pool.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock($1::int8) AS acquired",
          [PRUNE_ADVISORY_LOCK_KEY],
        );
        lockAcquired = lockResult.rows[0]?.acquired ?? false;
        if (!lockAcquired) {
          // Another instance is running the prune — skip this interval.
          return;
        }
      }

      const deleted = await pruneRateLimitEvents(PRUNE_MAX_AGE_MS);
      if (deleted > 0) {
        logger.info(
          { deleted, maxAgeMs: PRUNE_MAX_AGE_MS },
          "[rate-limit-prune] Swept stale rate_limit_events rows",
        );
      }
    } catch (err) {
      logger.warn({ err }, "[rate-limit-prune] Prune run failed (non-critical)");
    } finally {
      if (lockAcquired) {
        // Best-effort early unlock so the next interval can run on any instance.
        // Session-level advisory locks are automatically released when the
        // connection closes, so a failure here is non-fatal.
        try {
          await pool.query("SELECT pg_advisory_unlock($1::int8)", [
            PRUNE_ADVISORY_LOCK_KEY,
          ]);
        } catch {
          // Non-fatal: the pool will release the lock on connection teardown.
        }
      }
    }
  };

  void run();
  const handle = setInterval(() => {
    void run();
  }, PRUNE_INTERVAL_MS);
  handle.unref();

  return () => {
    clearInterval(handle);
  };
}
