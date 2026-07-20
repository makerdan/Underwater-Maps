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
import { getFetcher } from "../lib/fetchers/index.js";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody, validateParams } from "../middlewares/validateBody.js";
import { logger } from "../lib/logger.js";
import type { BathyFetchBundle } from "../lib/fetchers/types.js";

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
// Background job worker
// ---------------------------------------------------------------------------

/**
 * Runs asynchronously after the POST route responds. Downloads the bundle,
 * writes it to GCS, and updates the DB job row.
 */
async function runBundleJob(
  jobId: string,
  userId: string,
  presetId: string,
): Promise<void> {
  const meta = ALL_PRESET_DATASETS.find((d) => d.id === presetId);
  if (!meta) {
    await db
      .update(terrainBundleJobsTable)
      .set({ status: "error", errorMessage: `Unknown preset: ${presetId}`, completedAt: new Date() })
      .where(eq(terrainBundleJobsTable.id, jobId));
    return;
  }

  if (!meta.fetchStrategy) {
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

    const fetcher = getFetcher(meta.fetchStrategy);
    const bundle = await fetcher.fetch(meta.fetchStrategy, meta.bbox, 256);

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

    const meta = ALL_PRESET_DATASETS.find((d) => d.id === presetId);
    if (!meta) {
      res.status(404).json({ error: "Unknown preset", presetId });
      return;
    }
    if (!meta.fetchStrategy) {
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
        void runBundleJob(job.id, userId, presetId);
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
        void runBundleJob(job.id, userId, presetId);
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

    void runBundleJob(newJob.id, userId, presetId);
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
