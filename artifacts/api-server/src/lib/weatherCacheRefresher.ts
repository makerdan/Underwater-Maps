/**
 * weatherCacheRefresher.ts — Background job to keep weather_station_cache fresh.
 *
 * Runs every 30 minutes and:
 *   1. Prunes rows that are >24 hours old (nobody is actively requesting them).
 *   2. Re-fetches rows that are >15 minutes old so the DB cache is maximally
 *      fresh and the 1-hour stale fallback window is never reached in practice.
 *
 * The refresh reuses the existing `fetchWeatherStations` function — no
 * duplication of fetch / normalise / persist logic.
 *
 * Cross-process coordination
 * --------------------------
 * Under horizontal scale-out or blue/green deployments multiple API server
 * instances run this job on the same interval.  Without coordination they
 * would each hammer NOAA with duplicate re-fetches.  We use
 * `pg_try_advisory_lock` (non-blocking) so exactly one instance runs the
 * cycle; others skip silently.  The lock is acquired and released on a single
 * dedicated `pg.Client` checked out from the pool for the duration of the
 * cycle — this guarantees the session-level lock is never split across two
 * different backend connections.
 */

import type { PoolClient } from "pg";
import { db, pool, weatherStationCacheTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { fetchWeatherStations } from "./noaaWeatherFetcher.js";
import { logger } from "./logger.js";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // refresh rows older than 15 min
const PRUNE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // prune rows older than 24 h

/**
 * Stable advisory lock key for the weather cache refresher.
 *
 * Distinct from the rate-limit prune job key so both jobs can run in parallel
 * across instances without blocking each other.  Derived from ASCII "wcat"
 * (weather cache): w=0x77 c=0x63 a=0x61 t=0x74 → 0x77636174 = 2003134836
 */
export const WEATHER_ADVISORY_LOCK_KEY = 0x7763_6174;

// ---------------------------------------------------------------------------
// Cache-key parser
// ---------------------------------------------------------------------------

function parseCacheKey(
  key: string,
): { lat: number; lon: number; radiusMiles: number } | null {
  const parts = key.split(",");
  if (parts.length !== 3) return null;
  const lat = parseFloat(parts[0]!);
  const lon = parseFloat(parts[1]!);
  const radiusMiles = parseFloat(parts[2]!);
  if (!isFinite(lat) || !isFinite(lon) || !isFinite(radiusMiles)) return null;
  return { lat, lon, radiusMiles };
}

// ---------------------------------------------------------------------------
// Single refresh cycle
// ---------------------------------------------------------------------------

async function runRefreshCycle(): Promise<void> {
  const now = Date.now();
  const pruneThreshold = new Date(now - PRUNE_THRESHOLD_MS);
  const staleThreshold = new Date(now - STALE_THRESHOLD_MS);

  // Step 1: Prune rows older than 24 hours.
  // These belong to coordinates that haven't been requested recently; keeping
  // them indefinitely would waste DB space and trigger needless NOAA calls.
  try {
    const pruned = await db
      .delete(weatherStationCacheTable)
      .where(lt(weatherStationCacheTable.fetchedAt, pruneThreshold));
    const count = Number(
      (pruned as unknown as { rowCount?: number | null }).rowCount ?? 0,
    );
    if (count > 0) {
      logger.info({ count }, "[weather-refresher] Pruned old cache rows (>24 h)");
    }
  } catch (err) {
    logger.warn({ err }, "[weather-refresher] Failed to prune old cache rows");
  }

  // Step 2: Find rows that are stale (>15 min old).
  // After step 1 the remaining rows are all ≤24 h old, so this query naturally
  // covers only the 15-min–24-h window.
  let staleRows: { cacheKey: string }[];
  try {
    staleRows = await db
      .select({ cacheKey: weatherStationCacheTable.cacheKey })
      .from(weatherStationCacheTable)
      .where(lt(weatherStationCacheTable.fetchedAt, staleThreshold));
  } catch (err) {
    logger.warn({ err }, "[weather-refresher] Failed to query stale cache rows");
    return;
  }

  if (staleRows.length === 0) {
    logger.info("[weather-refresher] All cache rows are fresh — nothing to refresh");
    return;
  }

  logger.info(
    { count: staleRows.length },
    "[weather-refresher] Refreshing stale cache row(s)",
  );

  // Step 3: Re-fetch each stale key sequentially to avoid hammering NOAA.
  // The in-memory TTL is 10 minutes, so by the time we run (every 30 min)
  // the in-memory cache is always expired and a live NOAA call will be made,
  // updating both the in-memory cache and the DB row via persistToDb.
  for (const row of staleRows) {
    const parsed = parseCacheKey(row.cacheKey);
    if (!parsed) {
      logger.warn(
        { cacheKey: row.cacheKey },
        "[weather-refresher] Skipping unparseable cache key",
      );
      continue;
    }
    try {
      await fetchWeatherStations(parsed.lat, parsed.lon, parsed.radiusMiles);
      logger.info(
        { cacheKey: row.cacheKey },
        "[weather-refresher] Refreshed cache row",
      );
    } catch (err) {
      // NOAA is temporarily unreachable — the existing DB row stays in place
      // as a fallback; log and move on to the next key.
      logger.warn(
        { err, cacheKey: row.cacheKey },
        "[weather-refresher] Failed to refresh cache row (will retry next cycle)",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the background weather cache refresher.
 *
 * - Runs one cycle immediately at startup so any rows that aged out during a
 *   server restart are refreshed right away rather than waiting up to 30 min.
 * - Schedules a repeat every 30 minutes. An in-progress guard (`cycleRunning`)
 *   prevents a slow cycle (many stale keys + sequential NOAA calls) from
 *   overlapping with the next tick and compounding upstream load.
 * - The interval is unref'd so it does not prevent a clean shutdown when no
 *   other work remains.
 * - Each cycle acquires a session-level Postgres advisory lock on a dedicated
 *   client so only one instance across a scaled-out deployment runs the prune
 *   + refresh.  If the lock is already held, the cycle is skipped at debug
 *   level.
 *
 * Returns a stop function that:
 *   1. Clears the interval so no new cycles start.
 *   2. Waits for any in-flight cycle to finish (up to STOP_TIMEOUT_MS).
 */
export function startWeatherCacheRefresher(): () => Promise<void> {
  logger.info(
    { intervalMs: REFRESH_INTERVAL_MS },
    "[weather-refresher] Background weather cache refresher started",
  );

  let cycleRunning = false;
  // Holds a reference to the current in-flight cycle so stop() can await it.
  let currentCycle: Promise<void> = Promise.resolve();

  async function safeCycle(): Promise<void> {
    if (cycleRunning) {
      logger.info(
        "[weather-refresher] Previous cycle still running — skipping this tick",
      );
      return;
    }
    cycleRunning = true;

    let client: PoolClient | null = null;
    let lockAcquired = false;

    try {
      // Check out a dedicated connection for the lifetime of this cycle's
      // advisory lock.  Session locks are scoped to the backend connection,
      // so acquire and release must share the same client.
      client = await pool.connect();

      const lockResult = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1::int8) AS acquired",
        [WEATHER_ADVISORY_LOCK_KEY],
      );
      lockAcquired = lockResult.rows[0]?.acquired ?? false;

      if (!lockAcquired) {
        // Another instance is running this cycle — skip.
        logger.debug(
          "[weather-refresher] Advisory lock held by another instance — skipping cycle",
        );
        return;
      }

      await runRefreshCycle();
    } catch (err: unknown) {
      logger.warn({ err }, "[weather-refresher] Unexpected refresh cycle error");
    } finally {
      cycleRunning = false;
      if (client) {
        if (lockAcquired) {
          try {
            await client.query("SELECT pg_advisory_unlock($1::int8)", [
              WEATHER_ADVISORY_LOCK_KEY,
            ]);
          } catch {
            // Non-fatal: lock released on connection teardown.
          }
        }
        client.release();
      }
    }
  }

  // Immediate startup cycle — fire-and-forget; errors are caught inside safeCycle.
  currentCycle = safeCycle();
  void currentCycle;

  const interval = setInterval(() => {
    currentCycle = safeCycle();
    void currentCycle;
  }, REFRESH_INTERVAL_MS);

  interval.unref();

  // Maximum time to wait for an in-flight cycle to finish during shutdown.
  const STOP_TIMEOUT_MS = 5_000;

  return async (): Promise<void> => {
    clearInterval(interval);
    // Wait for any in-flight cycle to complete, but don't block shutdown forever.
    await Promise.race([
      currentCycle,
      new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS).unref()),
    ]);
  };
}
