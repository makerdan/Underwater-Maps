import terrainBundlesRouter, {
  recoverStaleTerrainBundleJobs,
} from "../../../routes/terrain-bundles.js";
import { db, terrainBundleJobsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "../../../lib/logger.js";

const DEFAULT_STALE_JOB_THRESHOLD_MS = 15 * 60 * 1000;
const DEFAULT_STALE_JOB_CHECK_INTERVAL_MS = 60 * 1000;

function configuredDuration(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Age at which an active terrain bundle job should page an operator. */
export const TERRAIN_BUNDLE_STALE_JOB_THRESHOLD_MS = configuredDuration(
  "TERRAIN_BUNDLE_STALE_JOB_THRESHOLD_MS",
  DEFAULT_STALE_JOB_THRESHOLD_MS,
);

export const TERRAIN_BUNDLE_STALE_JOB_CHECK_INTERVAL_MS = configuredDuration(
  "TERRAIN_BUNDLE_STALE_JOB_CHECK_INTERVAL_MS",
  DEFAULT_STALE_JOB_CHECK_INTERVAL_MS,
);

const alertedStaleJobIds = new Set<string>();

function jobAgeMs(createdAt: Date | string | number | null | undefined): number | undefined {
  if (createdAt == null) return undefined;
  const timestamp = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : undefined;
}

/**
 * Emits one warning per active job while it remains beyond the configured age.
 * The durable row is the source of truth so this also catches jobs that are
 * stuck after a process restart or in another server instance.
 */
export async function checkStaleTerrainBundleJobs(): Promise<number> {
  const activeJobs = await db
    .select()
    .from(terrainBundleJobsTable)
    .where(inArray(terrainBundleJobsTable.status, ["pending", "running"]))
    .limit(1000);
  const activeJobIds = new Set(activeJobs.map((job) => job.id));
  let alertedCount = 0;

  for (const job of activeJobs) {
    const ageMs = jobAgeMs(job.createdAt);
    if (
      ageMs === undefined ||
      ageMs < TERRAIN_BUNDLE_STALE_JOB_THRESHOLD_MS ||
      alertedStaleJobIds.has(job.id)
    ) {
      continue;
    }

    alertedStaleJobIds.add(job.id);
    alertedCount += 1;
    logger.warn(
      {
        code: "terrain_bundle_stale_job",
        alert: true,
        jobId: job.id,
        presetId: job.presetId,
        status: job.status,
        jobAgeMs: ageMs,
        failureReason: job.errorMessage ?? undefined,
        staleJobThresholdMs: TERRAIN_BUNDLE_STALE_JOB_THRESHOLD_MS,
      },
      "[terrain-bundles] active job exceeded stale-job threshold",
    );
  }

  for (const jobId of alertedStaleJobIds) {
    if (!activeJobIds.has(jobId)) alertedStaleJobIds.delete(jobId);
  }
  return alertedCount;
}

/** Starts the periodic operator warning sweep and returns its shutdown hook. */
export function startTerrainJobMonitor(): () => void {
  let cycleRunning = false;
  const safeCheck = async (): Promise<void> => {
    if (cycleRunning) return;
    cycleRunning = true;
    try {
      await checkStaleTerrainBundleJobs();
    } catch (err) {
      logger.warn({ err }, "[terrain-bundles] stale-job check failed");
    } finally {
      cycleRunning = false;
    }
  };

  logger.info(
    {
      thresholdMs: TERRAIN_BUNDLE_STALE_JOB_THRESHOLD_MS,
      intervalMs: TERRAIN_BUNDLE_STALE_JOB_CHECK_INTERVAL_MS,
    },
    "[terrain-bundles] stale-job monitor started",
  );
  void safeCheck();
  const interval = setInterval(() => void safeCheck(), TERRAIN_BUNDLE_STALE_JOB_CHECK_INTERVAL_MS);
  interval.unref();

  return () => {
    clearInterval(interval);
    logger.info("[terrain-bundles] stale-job monitor stopped");
  };
}

/**
 * Bundle routes and their durable-job lifecycle live behind this boundary.
 * The route implementation remains independently testable while terrain owns
 * the public composition point.
 */
export async function recoverTerrainJobs(): Promise<number> {
  return recoverStaleTerrainBundleJobs();
}

export { terrainBundlesRouter };
export default terrainBundlesRouter;