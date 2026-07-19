/**
 * orphanedPhotosCleanupJob.ts — Background job to garbage-collect photo
 * objects that are no longer referenced by any catch entry.
 *
 * Photos are uploaded to object storage via a signed PUT URL before the catch
 * entry is persisted.  If the user abandons the form, removes a photo from an
 * existing entry, or an entry is deleted, the underlying GCS object can be
 * left behind.  The route handlers already attempt synchronous best-effort
 * deletion on PATCH/DELETE, but this job is the safety net: it runs
 * periodically, lists every object under the private `uploads/` prefix that
 * was created more than ORPHANED_PHOTO_AGE_MS ago, and deletes any whose path
 * does not appear in any catch_entries.photos array.
 *
 * Configuration (env vars):
 *   PHOTO_CLEANUP_INTERVAL_MS   — how often the sweep runs  (default 6 h)
 *   ORPHANED_PHOTO_AGE_MS       — minimum object age before it is a candidate
 *                                  (default 24 h, to avoid racing in-flight
 *                                  POST /markers/:id/catches requests)
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage.js";
import { logger } from "./logger.js";

const CLEANUP_INTERVAL_MS =
  Number(process.env.PHOTO_CLEANUP_INTERVAL_MS) || 6 * 60 * 60 * 1000; // 6 h

const ORPHANED_PHOTO_AGE_MS =
  Number(process.env.ORPHANED_PHOTO_AGE_MS) || 24 * 60 * 60 * 1000; // 24 h

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the background orphaned-photos cleanup job.
 *
 * Mirrors the structure of `startUploadCleanupJob`:
 *  - fires one cycle immediately at startup;
 *  - repeats every PHOTO_CLEANUP_INTERVAL_MS;
 *  - interval is unref'd so it doesn't block process exit;
 *  - returns a `stop()` function for graceful shutdown.
 */
export function startOrphanedPhotosCleanupJob(): () => void {
  logger.info(
    { intervalMs: CLEANUP_INTERVAL_MS, ageMs: ORPHANED_PHOTO_AGE_MS },
    "[photo-cleanup] Orphaned-photos cleanup job started",
  );

  let cycleRunning = false;

  async function safeCycle(): Promise<void> {
    if (cycleRunning) {
      logger.info("[photo-cleanup] Previous cycle still running — skipping this tick");
      return;
    }
    cycleRunning = true;
    try {
      await sweepOrphanedPhotos();
    } catch (err: unknown) {
      logger.warn({ err }, "[photo-cleanup] Unexpected cleanup cycle error");
    } finally {
      cycleRunning = false;
    }
  }

  void safeCycle();

  const interval = setInterval(() => {
    void safeCycle();
  }, CLEANUP_INTERVAL_MS);

  interval.unref();

  return function stop(): void {
    clearInterval(interval);
    logger.info("[photo-cleanup] Orphaned-photos cleanup job stopped");
  };
}

// ---------------------------------------------------------------------------
// Sweep implementation
// ---------------------------------------------------------------------------

export async function sweepOrphanedPhotos(): Promise<void> {
  const service = new ObjectStorageService();

  // 1. List all upload objects older than ORPHANED_PHOTO_AGE_MS.
  let uploadPaths: string[];
  try {
    uploadPaths = await service.listUploadObjectPaths(ORPHANED_PHOTO_AGE_MS);
  } catch (err: unknown) {
    // If PRIVATE_OBJECT_DIR is not set (e.g. dev without object storage) the
    // listing throws — log a warning and bail rather than crashing the job.
    logger.warn({ err }, "[photo-cleanup] Could not list upload objects — skipping sweep");
    return;
  }

  if (uploadPaths.length === 0) {
    logger.info("[photo-cleanup] No aged upload objects found — nothing to sweep");
    return;
  }

  // 2. Collect the full set of photo paths referenced by any catch entry.
  //    jsonb_array_elements_text unnests each photos array into individual rows.
  const rows = await db.execute<{ photo: string }>(
    sql`SELECT DISTINCT jsonb_array_elements_text(photos) AS photo
        FROM catch_entries
        WHERE jsonb_array_length(photos) > 0`,
  );
  const referenced = new Set(rows.rows.map((r) => r.photo));

  // 3. Identify orphans and delete them.
  const orphans = uploadPaths.filter((p) => !referenced.has(p));

  if (orphans.length === 0) {
    logger.info(
      { candidateCount: uploadPaths.length },
      "[photo-cleanup] All aged upload objects are still referenced — nothing to delete",
    );
    return;
  }

  logger.info(
    { orphanCount: orphans.length, candidateCount: uploadPaths.length },
    "[photo-cleanup] Deleting orphaned photo objects",
  );

  const results = await Promise.allSettled(
    orphans.map((p) => service.deleteObjectEntity(p)),
  );

  let deleted = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      deleted++;
    } else {
      failed++;
      logger.warn({ err: result.reason }, "[photo-cleanup] Failed to delete orphaned photo");
    }
  }

  logger.info(
    { deleted, failed },
    "[photo-cleanup] Orphaned-photos sweep complete",
  );
}
