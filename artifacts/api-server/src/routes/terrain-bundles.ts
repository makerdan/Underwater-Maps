/**
 * terrain-bundles.ts
 *
 * On-demand bathymetry bundle API routes.
 *
 * POST /api/terrain/bundles
 *   Auth required. Checks GCS for an existing bundle; if absent, creates a
 *   DB job row and kicks off a background download.  Returns the job id.
 *
 * GET /api/terrain/bundles/:presetId/status
 *   Auth required. Returns job state from the DB.
 *
 * GET /api/terrain/bundles/:presetId
 *   Auth required. Returns the processed bundle if complete, 202 if still
 *   running, 404 if no job exists for this user+preset.
 */

import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db, terrainBundleJobsTable } from "@workspace/db";
import { objectStorageClient } from "../lib/objectStorage.js";
import { ALL_PRESET_DATASETS } from "../lib/terrain.js";
import { getCatalogEntries } from "../lib/catalogSeeder.js";
import { deriveCatalogFetchStrategy } from "../lib/catalogFetchStrategy.js";
import { getFetcher } from "../lib/fetchers/index.js";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody, validateParams } from "../middlewares/validateBody.js";
import { logger } from "../lib/logger.js";
import type { BathyFetchBundle, Bbox, FetchStrategy } from "../lib/fetchers/types.js";

const router = Router();

// ---------------------------------------------------------------------------
// GCS bundle storage helpers
// ---------------------------------------------------------------------------

/**
 * Returns { bucketName, objectName } for the terrain bundle path.
 * Bucket is derived from PRIVATE_OBJECT_DIR (first path segment).
 * Object name: users/{userId}/terrain/{presetId}.bundle.json
 */
function bundlePath(userId: string, presetId: string): { bucketName: string; objectName: string } {
  const privateDir = process.env["PRIVATE_OBJECT_DIR"] ?? "";
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const parts = privateDir.replace(/^\//, "").split("/");
  const bucketName = parts[0]!;
  if (!bucketName) throw new Error("Cannot parse bucket name from PRIVATE_OBJECT_DIR");
  const objectName = `users/${userId}/terrain/${presetId}.bundle.json`;
  return { bucketName, objectName };
}

async function bundleExistsInGcs(userId: string, presetId: string): Promise<boolean> {
  try {
    const { bucketName, objectName } = bundlePath(userId, presetId);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    return exists;
  } catch {
    return false;
  }
}

async function writeBundleToGcs(
  userId: string,
  presetId: string,
  bundle: BathyFetchBundle,
): Promise<void> {
  const { bucketName, objectName } = bundlePath(userId, presetId);
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  const json = JSON.stringify({ ...bundle, userId, presetId, fetchedAt: new Date().toISOString() });
  await file.save(json, {
    contentType: "application/json",
    metadata: { cacheControl: "private, max-age=3600" },
  });
}

async function readBundleFromGcs(userId: string, presetId: string): Promise<unknown | null> {
  try {
    const { bucketName, objectName } = bundlePath(userId, presetId);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [contents] = await file.download();
    return JSON.parse(contents.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Preset / catalog resolution
// ---------------------------------------------------------------------------

interface BundleTarget {
  fetchStrategy: FetchStrategy | null;
  bbox: Bbox;
}

/**
 * Resolves a presetId to a fetch strategy + bbox. Checks the in-memory
 * preset registry first, then falls back to seeded catalog entries
 * (bathymetry rows only) using the derived strategy for their source.
 * Returns null when the id is unknown in both places.
 */
async function resolveBundleTarget(presetId: string): Promise<BundleTarget | null> {
  const meta = ALL_PRESET_DATASETS.find((d) => d.id === presetId);
  if (meta) {
    return { fetchStrategy: meta.fetchStrategy ?? null, bbox: meta.bbox };
  }
  try {
    const entries = await getCatalogEntries();
    const entry = entries.find(
      (e) => e.id === presetId && e.dataType === "bathymetry",
    );
    if (!entry || !entry.coverageBbox) return null;
    return {
      fetchStrategy: deriveCatalogFetchStrategy(entry),
      bbox: entry.coverageBbox,
    };
  } catch (err) {
    logger.warn({ err, presetId }, "[terrain-bundles] catalog lookup failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Background job worker
// ---------------------------------------------------------------------------

/**
 * In-memory set of job ids currently being processed by this process.
 * Guards against the same job being dispatched twice (e.g. a POST retry
 * racing the startup recovery sweep). Best-effort: single-process only,
 * which matches the single-instance deploy model.
 */
const inFlightJobs = new Set<string>();

/**
 * Dispatches a job to run in the background exactly once per process at a
 * time. No-op when the job id is already in flight.
 */
export function dispatchBundleJob(jobId: string, userId: string, presetId: string): void {
  if (inFlightJobs.has(jobId)) {
    logger.info({ jobId, presetId }, "[terrain-bundles] dispatch skipped — job already in flight");
    return;
  }
  inFlightJobs.add(jobId);
  void runBundleJob(jobId, userId, presetId)
    .catch((err: unknown) => {
      logger.warn({ err, jobId }, "[terrain-bundles] unexpected job dispatch failure");
    })
    .finally(() => {
      inFlightJobs.delete(jobId);
    });
}

/** Test-only visibility into the duplicate-dispatch guard. */
export function __getInFlightJobIds(): ReadonlySet<string> {
  return inFlightJobs;
}

/**
 * Startup recovery: any job left in status="running" by a previous process
 * (killed mid-download) is reset to "pending", then all pending jobs are
 * re-dispatched. Called from the server "listening" handler.
 * Returns the number of jobs re-dispatched.
 */
export async function recoverStaleTerrainBundleJobs(): Promise<number> {
  const recovered = await db
    .update(terrainBundleJobsTable)
    .set({
      status: "pending",
      progressNote: "Recovered after server restart — re-queued",
      errorMessage: null,
    })
    .where(eq(terrainBundleJobsTable.status, "running"))
    .returning();

  const pending = await db
    .select()
    .from(terrainBundleJobsTable)
    .where(eq(terrainBundleJobsTable.status, "pending"));

  for (const job of pending) {
    dispatchBundleJob(job.id, job.userId, job.presetId);
  }

  if (recovered.length > 0 || pending.length > 0) {
    logger.info(
      { resetFromRunning: recovered.length, redispatched: pending.length },
      "[terrain-bundles] startup recovery re-dispatched stale jobs",
    );
  }
  return pending.length;
}

/**
 * Runs asynchronously after the POST route responds. Downloads the bundle,
 * writes it to GCS, and updates the DB job row.
 */
async function runBundleJob(
  jobId: string,
  userId: string,
  presetId: string,
): Promise<void> {
  const target = await resolveBundleTarget(presetId);
  if (!target) {
    await db
      .update(terrainBundleJobsTable)
      .set({ status: "error", errorMessage: `Unknown preset: ${presetId}`, completedAt: new Date() })
      .where(eq(terrainBundleJobsTable.id, jobId));
    return;
  }

  if (!target.fetchStrategy) {
    await db
      .update(terrainBundleJobsTable)
      .set({ status: "error", errorMessage: `Preset ${presetId} has no fetchStrategy`, completedAt: new Date() })
      .where(eq(terrainBundleJobsTable.id, jobId));
    return;
  }

  try {
    await db
      .update(terrainBundleJobsTable)
      .set({ status: "running", progressNote: "Fetching bathymetry data…" })
      .where(eq(terrainBundleJobsTable.id, jobId));

    const fetcher = getFetcher(target.fetchStrategy);
    const bundle = await fetcher.fetch(target.fetchStrategy, target.bbox, 256);

    await db
      .update(terrainBundleJobsTable)
      .set({ progressNote: "Writing to storage…" })
      .where(eq(terrainBundleJobsTable.id, jobId));

    await writeBundleToGcs(userId, presetId, bundle);

    await db
      .update(terrainBundleJobsTable)
      .set({ status: "complete", progressNote: "Done", completedAt: new Date() })
      .where(eq(terrainBundleJobsTable.id, jobId));

    logger.info({ jobId, userId, presetId }, "[terrain-bundles] job complete");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ jobId, userId, presetId, err }, "[terrain-bundles] job error");
    try {
      await db
        .update(terrainBundleJobsTable)
        .set({ status: "error", errorMessage: msg, completedAt: new Date() })
        .where(eq(terrainBundleJobsTable.id, jobId));
    } catch (dbErr) {
      logger.warn({ dbErr, jobId }, "[terrain-bundles] failed to update job to error state");
    }
  }
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const PostBundleBodySchema = z.object({
  presetId: z.string().min(1).max(128),
});

const PresetIdParamSchema = z.object({
  presetId: z.string().min(1).max(128),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/terrain/bundles
 * Trigger an on-demand bundle download for the authenticated user.
 */
router.post(
  "/terrain/bundles",
  requireAuth,
  validateBody(PostBundleBodySchema, "POST /api/terrain/bundles"),
  asyncHandler(async (req, res) => {
    const { clerkUserId: userId } = req as AuthenticatedRequest;
    const { presetId } = req.body as z.infer<typeof PostBundleBodySchema>;

    const target = await resolveBundleTarget(presetId);
    if (!target) {
      res.status(404).json({ error: "Unknown preset", presetId });
      return;
    }
    if (!target.fetchStrategy) {
      res.status(422).json({ error: "Preset has no fetchStrategy", presetId });
      return;
    }

    const existing = await db
      .select()
      .from(terrainBundleJobsTable)
      .where(
        and(
          eq(terrainBundleJobsTable.userId, userId),
          eq(terrainBundleJobsTable.presetId, presetId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const job = existing[0]!;
      if (job.status === "complete") {
        const bundleExists = await bundleExistsInGcs(userId, presetId);
        if (bundleExists) {
          res.status(200).json({ jobId: job.id, status: job.status, message: "Bundle already available" });
          return;
        }
        await db
          .update(terrainBundleJobsTable)
          .set({ status: "pending", progressNote: "Re-queued (GCS bundle missing)", completedAt: null, errorMessage: null })
          .where(eq(terrainBundleJobsTable.id, job.id));
        dispatchBundleJob(job.id, userId, presetId);
        res.status(202).json({ jobId: job.id, status: "pending", message: "Download re-queued" });
        return;
      }
      if (job.status === "running" || job.status === "pending") {
        res.status(202).json({ jobId: job.id, status: job.status, message: "Download already in progress" });
        return;
      }
      if (job.status === "error") {
        await db
          .update(terrainBundleJobsTable)
          .set({ status: "pending", progressNote: "Retrying…", errorMessage: null, completedAt: null })
          .where(eq(terrainBundleJobsTable.id, job.id));
        dispatchBundleJob(job.id, userId, presetId);
        res.status(202).json({ jobId: job.id, status: "pending", message: "Retrying failed job" });
        return;
      }
    }

    const [newJob] = await db
      .insert(terrainBundleJobsTable)
      .values({
        userId,
        presetId,
        status: "pending",
        progressNote: "Queued",
      })
      .returning();

    if (!newJob) {
      res.status(500).json({ error: "Failed to create job" });
      return;
    }

    dispatchBundleJob(newJob.id, userId, presetId);
    res.status(202).json({ jobId: newJob.id, status: "pending", message: "Download started" });
  }),
);

/**
 * GET /api/terrain/bundles/:presetId/status
 * Returns job state (pending / running / complete / error) and progress notes.
 */
router.get(
  "/terrain/bundles/:presetId/status",
  requireAuth,
  validateParams(PresetIdParamSchema, "GET /api/terrain/bundles/:presetId/status"),
  asyncHandler(async (req, res) => {
    const { clerkUserId: userId } = req as AuthenticatedRequest;
    const { presetId } = req.params as z.infer<typeof PresetIdParamSchema>;

    const jobs = await db
      .select()
      .from(terrainBundleJobsTable)
      .where(
        and(
          eq(terrainBundleJobsTable.userId, userId),
          eq(terrainBundleJobsTable.presetId, presetId),
        ),
      )
      .limit(1);

    if (jobs.length === 0) {
      res.status(404).json({ error: "No job found", presetId });
      return;
    }

    const job = jobs[0]!;
    res.status(200).json({
      jobId: job.id,
      status: job.status,
      progressNote: job.progressNote,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  }),
);

/**
 * GET /api/terrain/bundles/:presetId
 * Returns the processed bundle (complete) or 202 (running/pending) or 404.
 */
router.get(
  "/terrain/bundles/:presetId",
  requireAuth,
  validateParams(PresetIdParamSchema, "GET /api/terrain/bundles/:presetId"),
  asyncHandler(async (req, res) => {
    const { clerkUserId: userId } = req as AuthenticatedRequest;
    const { presetId } = req.params as z.infer<typeof PresetIdParamSchema>;

    const jobs = await db
      .select()
      .from(terrainBundleJobsTable)
      .where(
        and(
          eq(terrainBundleJobsTable.userId, userId),
          eq(terrainBundleJobsTable.presetId, presetId),
        ),
      )
      .limit(1);

    if (jobs.length === 0) {
      res.status(404).json({ error: "No bundle found for this preset", presetId });
      return;
    }

    const job = jobs[0]!;

    if (job.status !== "complete") {
      res.status(202).json({
        jobId: job.id,
        status: job.status,
        progressNote: job.progressNote,
        errorMessage: job.errorMessage,
        message: job.status === "error" ? "Download failed" : "Download in progress",
      });
      return;
    }

    const bundle = await readBundleFromGcs(userId, presetId);
    if (!bundle) {
      res.status(404).json({ error: "Bundle file not found in storage", presetId });
      return;
    }

    res.status(200).json(bundle);
  }),
);

export default router;
