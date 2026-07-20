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
 */
import { logger } from "./logger.js";
import { pruneRateLimitEvents } from "../middlewares/rateLimit.js";

export const PRUNE_MAX_AGE_MS = 5 * 60_000;
export const PRUNE_INTERVAL_MS = 5 * 60_000;

/**
 * Start the rate-limit prune job. Runs once immediately, then on a fixed
 * interval. Returns a stop function that clears the interval — call it during
 * graceful shutdown so the interval cannot fire after the DB pool tears down.
 */
export function startRateLimitPruneJob(): () => void {
  const run = async (): Promise<void> => {
    try {
      const deleted = await pruneRateLimitEvents(PRUNE_MAX_AGE_MS);
      if (deleted > 0) {
        logger.info(
          { deleted, maxAgeMs: PRUNE_MAX_AGE_MS },
          "[rate-limit-prune] Swept stale rate_limit_events rows",
        );
      }
    } catch (err) {
      logger.warn({ err }, "[rate-limit-prune] Prune run failed (non-critical)");
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
