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
 */

import { db, weatherStationCacheTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { fetchWeatherStations } from "./noaaWeatherFetcher.js";
import { logger } from "./logger.js";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // refresh rows older than 15 min
const PRUNE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // prune rows older than 24 h

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
 */
export function startWeatherCacheRefresher(): void {
  logger.info(
    { intervalMs: REFRESH_INTERVAL_MS },
    "[weather-refresher] Background weather cache refresher started",
  );

  let cycleRunning = false;

  async function safeCycle(): Promise<void> {
    if (cycleRunning) {
      logger.info(
        "[weather-refresher] Previous cycle still running — skipping this tick",
      );
      return;
    }
    cycleRunning = true;
    try {
      await runRefreshCycle();
    } catch (err: unknown) {
      logger.warn({ err }, "[weather-refresher] Unexpected refresh cycle error");
    } finally {
      cycleRunning = false;
    }
  }

  // Immediate startup cycle — fire-and-forget; errors are caught inside safeCycle.
  void safeCycle();

  const interval = setInterval(() => {
    void safeCycle();
  }, REFRESH_INTERVAL_MS);

  interval.unref();
}
