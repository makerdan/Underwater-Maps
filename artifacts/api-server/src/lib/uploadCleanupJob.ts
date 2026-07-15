/**
 * uploadCleanupJob.ts — Background job to purge abandoned upload_jobs rows.
 *
 * Runs on a configurable interval (default 12 h, override with
 * UPLOAD_CLEANUP_INTERVAL_MS env var) and deletes upload_jobs rows that have
 * been stuck in "uploading" status longer than the abandoned-upload threshold
 * (ABANDONED_UPLOAD_THRESHOLD_MS, default 24 h).
 *
 * Running only at startup is insufficient for long-lived server processes:
 * a server that stays up for weeks would accumulate abandoned rows between
 * restarts. This job fills that gap by running cleanup periodically.
 */

import { cleanupAbandonedUploadJobs, sweepStaleUploadSessions } from "../routes/datasets.js";
import { logger } from "./logger.js";

const CLEANUP_INTERVAL_MS =
  Number(process.env.UPLOAD_CLEANUP_INTERVAL_MS) || 12 * 60 * 60 * 1000; // 12 h

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the background abandoned-upload cleanup job.
 *
 * - Runs one cycle immediately at startup so any rows that accumulated before
 *   the last restart are purged right away rather than waiting up to 12 h.
 * - Schedules a repeat every UPLOAD_CLEANUP_INTERVAL_MS. An in-progress guard
 *   (`cycleRunning`) prevents a slow DB call from overlapping with the next
 *   tick.
 * - The interval is unref'd so it does not keep the Node.js event loop alive
 *   after all other work is done, complementing the explicit stop path.
 * - Returns a `stop()` function that clears the interval immediately. Call it
 *   in your SIGTERM handler so the timer is explicitly torn down and cannot
 *   fire after shutdown begins — critical for clean process exit in tests.
 */
export function startUploadCleanupJob(): () => void {
  logger.info(
    { intervalMs: CLEANUP_INTERVAL_MS },
    "[upload-cleanup] Background abandoned-upload cleanup job started",
  );

  let cycleRunning = false;

  async function safeCycle(): Promise<void> {
    if (cycleRunning) {
      logger.info(
        "[upload-cleanup] Previous cycle still running — skipping this tick",
      );
      return;
    }
    cycleRunning = true;
    try {
      await cleanupAbandonedUploadJobs();
      // Also evict abandoned in-memory upload sessions/jobs and their temp
      // chunk files — same TTL as the DB-side cleanup above.
      await sweepStaleUploadSessions();
    } catch (err: unknown) {
      logger.warn({ err }, "[upload-cleanup] Unexpected cleanup cycle error");
    } finally {
      cycleRunning = false;
    }
  }

  // Immediate startup cycle — fire-and-forget; errors are caught inside safeCycle.
  void safeCycle();

  const interval = setInterval(() => {
    void safeCycle();
  }, CLEANUP_INTERVAL_MS);

  // unref so the interval alone won't keep the process alive if everything
  // else has finished — defence-in-depth alongside the explicit stop() below.
  interval.unref();

  return function stop(): void {
    clearInterval(interval);
    logger.info("[upload-cleanup] Background abandoned-upload cleanup job stopped");
  };
}
