import { Router, type Request, type Response, type NextFunction } from "express";
import * as zlib from "zlib";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import multer from "multer";
import { eq, and, inArray, or, lt, isNull } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { db, customDatasetsTable, userSettingsTable, uploadJobsTable, disabledPresetsTable, uploadCalibrationTable, StoredTerrainJsonSchema, type StoredTerrainJson, type StoredTideStation } from "@workspace/db";
import { findNearestTideStation } from "./tides.js";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { createRateLimit } from "../middlewares/rateLimit.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody, validateQuery, validateParams } from "../middlewares/validateBody.js";
import { signDatasetUploadUrl, getJobByObjectKey, recoverGcsJobStatus, bucketJobDbId } from "../lib/bucketMonitor.js";
import {
  GetDatasetsResponse,
  GetDatasetsIdTerrainResponse,
  GetDatasetsIdOverviewResponse,
  PostDatasetsUploadResponse,
  GetDatasetZonesResponse,
  GetTerrainLandResponse,
  GetDatasetsIdPreviewResponse,
  GetTerrainDownloadInfoResponse,
  GetUploadJobStatusResponse,
  UploadDatasetChunkResponse,
  GetChunkUploadStatusResponse,
  FinalizeChunkedUploadResponse,
  RequestGcsUploadUrlResponse,
  GetGcsJobStatusResponse,
  StartChunkedUploadResponse,
} from "@workspace/api-zod";
import { validateResponse } from "../middlewares/validateResponse.js";
import {
  ALL_PRESET_DATASETS,
  buildTerrainGrid,
  NoDataError,
  parseXyzCsv,
  gridPoints,
  previewDataset,
  previewBboxForDownload,
  buildBboxCsvRows,
  type TerrainGrid,
} from "../lib/terrain.js";
import { parseUploadedFile } from "../lib/uploadParsers.js";
import { parsePdfContourFile, PdfStageError, PdfRasterOnlyError, type PdfDepthUnit } from "../lib/pdfContour.js";
import {
  parseRasterPdfContourFile,
  parseRasterImageContourFile,
  commitCachedExtraction,
  extractRasterImageContoursOnly,
  type RasterExtractionResult,
} from "../lib/pdfContourRaster.js";
import { routeTarEntries } from "../lib/noaaTarRouter.js";
import { gunzipBounded } from "../lib/gunzipBounded.js";
import { isTarBuffer, extractTarBuffer, isTarFile, extractTarFile, isGzipFile } from "../lib/tarDetect.js";
import { fetchCopernicusDem } from "../lib/copernicusDem.js";
// fetchSatelliteTile intentionally excluded — satellite-tile route was removed
// fetchTerrainTile intentionally excluded — terrain-tile route was removed
import { datasetZonesCache, readZoneDiskByHash, zoneCacheKey } from "./poe.js";
import {
  ChunkUploadBodySchema,
  ChunkFinalizeBodySchema,
  UploadIdParamSchema,
  JobIdParamSchema,
  GcsJobStatusQuerySchema,
  DatasetsQuerySchema,
  ZonesQuerySchema,
  TerrainLandQuerySchema,
  TerrainDownloadInfoQuerySchema,
} from "./schemas.js";
import { substrateFingerprintForDataset } from "../lib/substrateGrid.js";
import { registerCache } from "../lib/cacheRegistry.js";
import { logger } from "../lib/logger.js";
import {
  recordExtensionDuration as _recordExtensionDuration,
  updateProgressWithEta,
  extensionDurationHistory,
} from "../lib/etaCalibration.js";

/**
 * Best-effort resolution of the nearest NOAA tide station for a freshly
 * gridded terrain (bbox centroid). Never throws — returns null when the
 * bbox is unusable or the NOAA catalogue is unreachable, so dataset saves
 * are never blocked by tide-station lookup failures.
 */
async function resolveTideStationForTerrain(terrain: {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}): Promise<StoredTideStation | null> {
  try {
    const lat = (terrain.minLat + terrain.maxLat) / 2;
    const lon = (terrain.minLon + terrain.maxLon) / 2;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const s = await findNearestTideStation(lat, lon);
    if (!s) return null;
    return {
      stationId: s.id,
      stationName: s.name,
      lat: s.lat,
      lon: s.lon,
      distanceMiles: s.distanceMiles,
    };
  } catch (err) {
    logger.warn({ err }, "[datasets] tide-station resolution failed (non-fatal)");
    return null;
  }
}

/**
 * Validates a terrain or overview object against `StoredTerrainJsonSchema`
 * immediately before a DB write.  Throws with `code: "terrain_schema_mismatch"`
 * when required bbox/grid fields are missing or have the wrong type so that
 * worker output drift is caught at the write boundary rather than silently
 * stored as corrupt JSON.
 *
 * Job-path callers (processUploadJob) let the error propagate to the outer
 * catch which sets `job.status = "error"`.  HTTP-path callers must catch it and
 * return an explicit 500.
 */
export function validateTerrainForDb(terrain: unknown, context: string): StoredTerrainJson {
  const result = StoredTerrainJsonSchema.safeParse(terrain);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    logger.error({ context, issues }, "[datasets] terrain schema mismatch — aborting DB write");
    throw Object.assign(
      new Error(`terrain_schema_mismatch: ${issues}`),
      { code: "terrain_schema_mismatch" },
    );
  }
  return terrain as StoredTerrainJson;
}

// ─── Chunked-upload session + job stores ──────────────────────────────────────
// Sessions: keyed by uploadId, created on the first chunk, used to enforce
// that only the originating user can send subsequent chunks, finalize, or poll.
interface UploadSession {
  userId: string;
  /** True while chunk 0 is moving to disk and its durable row is being created. */
  initializing?: boolean;
  /** Whether this process created the session or restored it from upload_jobs. */
  source?: "live" | "rehydrated";
  /** Durable lifecycle state mirrored from upload_jobs. */
  lifecycleStatus?: "uploading" | "queued" | "processing" | "done" | "error";
  /** Expected chunk count once chunk 0 establishes it. */
  totalChunks?: number;
  /**
   * True while a finalize is in-flight (set synchronously before any await so
   * concurrent requests see it immediately and return 409 without racing).
   */
  finalizing?: boolean;
  /** Set when finalize has been called; prevents double-processing the same upload. */
  activeJobId?: string;
  /**
   * Pre-generated UUID created on chunk 0 and persisted to the DB as an
   * "uploading" row.  Reused as the finalize jobId so the same DB row
   * transitions uploading → queued → processing → done without spawning a
   * second row per upload.
   */
  sessionJobId?: string;
  /**
   * Epoch ms of the last request that touched this session (chunk received,
   * status polled, or finalize attempted).  Used by
   * sweepStaleUploadSessions() to evict abandoned sessions after
   * ABANDONED_UPLOAD_THRESHOLD_MS of inactivity.
   */
  lastActivityAt: number;
  /**
   * True when this session was created by POST /api/datasets/upload/start (the
   * server-owned uploadId endpoint).  Chunk-submit and finalize reject sessions
   * that are not server-issued so that a client-supplied UUID can never hijack
   * the upload pipeline.
   */
  serverIssued?: boolean;
}
const uploadSessions = new Map<string, UploadSession>();
registerCache(() => uploadSessions.clear());

// ─── Chunked-upload processing concurrency gate ────────────────────────────────
// Mirrors the GCS path's withProcessSlot so that large-file (chunked) uploads
// also wait in an orderly queue when multiple jobs are finalized simultaneously.
// Jobs sit in "queued" status until a slot is free, then flip to "processing" —
// the same sub-state distinction the GCS path already exposes to the UI.
const CHUNK_PROCESS_CONCURRENCY_CAP = 3;
let chunkActiveProcessCount = 0;
const chunkProcessWaitQueue: Array<() => void> = [];

async function withChunkProcessSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (chunkActiveProcessCount >= CHUNK_PROCESS_CONCURRENCY_CAP) {
    await new Promise<void>((resolve) => chunkProcessWaitQueue.push(resolve));
  }
  chunkActiveProcessCount++;
  try {
    return await fn();
  } finally {
    chunkActiveProcessCount--;
    const next = chunkProcessWaitQueue.shift();
    if (next) next();
  }
}

interface JobState {
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  error?: string;
  datasetId?: string;
  userId: string; // enforced on poll — only the owner can read job status
  /**
   * Epoch ms used by sweepStaleUploadSessions() to evict terminal
   * (done/error) job entries from memory after
   * ABANDONED_UPLOAD_THRESHOLD_MS. Refreshed on each sweep while the job is
   * still queued/processing so active jobs are never evicted mid-flight.
   */
  lastActivityAt?: number;
  /** Count of archive entries intentionally skipped (unsupported formats). */
  skippedCount?: number;
  /** Unique file extensions of skipped entries, e.g. [".sid.gz", ".pdf"]. */
  skippedFormats?: string[];
  /** Raw sounding points extracted from the archive (0 for substrate-only). */
  soundingCount?: number;
  /** Substrate annotation points extracted from the archive. */
  substrateCount?: number;
  /**
   * Human-readable warnings from the parser about non-canonical column names
   * that were auto-resolved via synonym matching (e.g. "long" → "lon").
   * Only present when at least one non-canonical synonym was matched.
   */
  parseWarnings?: string[];
  /**
   * Wall-clock timestamps (Date.now() ms) recorded at each progress milestone.
   * Used to compute a rolling progress-per-ms rate for ETA estimation.
   * Up to 5 entries are retained — enough to span the full milestone range.
   */
  stageTimestamps?: Array<{ progress: number; ts: number }>;
  /**
   * Estimated seconds remaining, derived from the milestone rate.
   * null = not yet calculable (fewer than 2 milestones recorded).
   * Omitted once the job reaches a terminal state (done / error).
   */
  eta?: number | null;
  /**
   * Assembled file size in bytes, recorded after streamChunksToFile.
   * Used as a proxy for remaining parsing/gridding work in the pre-40% window:
   * larger files typically take longer to parse and grid, so we apply a scale
   * factor that grows with file size.
   */
  fileBytes?: number;
  /**
   * ISO-serializable timestamp of the most recent progress milestone.
   * Persisted to DB so the DB-fallback path (after a server restart) can
   * include `currentStageStartedAt` in status responses even when the
   * in-memory job map is empty.
   */
  stageStartedAt?: Date | null;
  /**
   * Lowercase file extension (e.g. ".laz", ".gz", ".nc") derived from the
   * uploaded filename.  Used as the key into the per-file-type calibration
   * table so historical throughput can seed the first ETA estimate.
   */
  fileExt?: string;
  /**
   * Wall-clock timestamp (Date.now() ms) when processUploadJob entered the
   * "processing" state.  Combined with the completion timestamp to record the
   * total job duration in the per-extension calibration table.
   */
  jobStartedAt?: number;
}

// ─── Per-file-type throughput calibration — DB persistence layer ──────────────
// Pure calibration logic (ring buffer, median, ETA blending) lives in
// lib/etaCalibration.ts and is imported above.  This layer adds debounced DB
// upserts so the history survives server restarts, and a startup loader that
// seeds the in-memory map from the `upload_calibration` table.

// Debounce timers for per-extension DB writes (avoid a write on every job).
const CALIBRATION_PERSIST_DEBOUNCE_MS = 5_000;
const calibrationPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Upsert one extension's duration array to the DB.  Called via a debounced
 * timer so concurrent completions collapse into a single write per extension.
 */
async function persistCalibrationEntry(ext: string): Promise<void> {
  const durations = extensionDurationHistory.get(ext);
  if (!durations) return;
  try {
    await db
      .insert(uploadCalibrationTable)
      .values({ extension: ext, durations, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: uploadCalibrationTable.extension,
        set: { durations, updatedAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, ext }, "[calibration] failed to persist calibration entry");
  }
}

/**
 * Schedule a debounced DB write for the given extension.  If a write is
 * already queued for this extension, reset the timer so rapid completions
 * collapse into a single DB round-trip.
 */
function schedulePersistCalibrationEntry(ext: string): void {
  const existing = calibrationPersistTimers.get(ext);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    calibrationPersistTimers.delete(ext);
    void persistCalibrationEntry(ext);
  }, CALIBRATION_PERSIST_DEBOUNCE_MS);
  calibrationPersistTimers.set(ext, timer);
}

/**
 * Load previously recorded extension durations from the DB into the in-memory
 * calibration map.  Called once on server startup so ETAs are immediately
 * useful for the first upload of each file type after a restart.
 */
export async function loadCalibrationFromDb(): Promise<void> {
  try {
    const rows = await db.select().from(uploadCalibrationTable);
    for (const row of rows) {
      if (Array.isArray(row.durations) && row.durations.length > 0) {
        extensionDurationHistory.set(row.extension, row.durations as number[]);
      }
    }
    logger.info(
      { extensions: rows.map((r) => r.extension) },
      "[calibration] loaded extension duration history from DB",
    );
  } catch (err) {
    logger.warn({ err }, "[calibration] failed to load calibration from DB (non-critical)");
  }
}

/**
 * Record a completed job's total wall-clock duration (ms) for the given file
 * extension.  Delegates to the pure etaCalibration function for the ring-buffer
 * update, then schedules a debounced DB upsert so the history survives restarts.
 */
function recordExtensionDuration(ext: string, durationMs: number): void {
  _recordExtensionDuration(ext, durationMs);
  if (ext) schedulePersistCalibrationEntry(ext);
}

/**
 * Flush all pending debounced calibration writes immediately.
 * Exposed for test isolation only — do not call in production code.
 */
export async function flushCalibrationPersistForTest(): Promise<void> {
  const pending = [...calibrationPersistTimers.entries()];
  for (const [ext, timer] of pending) {
    clearTimeout(timer);
    calibrationPersistTimers.delete(ext);
  }
  await Promise.all(pending.map(([ext]) => persistCalibrationEntry(ext)));
}

/**
 * Schedule a debounced DB persist for the given extension.
 * Exposed for test isolation only — do not call in production code.
 */
export function scheduleCalibrationPersistForTest(ext: string): void {
  schedulePersistCalibrationEntry(ext);
}

const uploadJobs = new Map<string, JobState>();
registerCache(() => uploadJobs.clear());

/**
 * Chunk-upload metadata persisted to the DB alongside each job row.
 * Replaces the JSON sidecar files so recovery survives container restarts
 * (where /tmp is wiped but the PostgreSQL database persists).
 */
interface JobMetaForDB {
  uploadId: string;
  fileName: string;
  totalChunks: number;
  chunksReceived: number;
  resolution: number;
  smoothing: boolean;
}

/**
 * Persist a job's durable fields (status, progress, error, datasetId) to the
 * database.  Called at key milestones so that a fresh server process can
 * reconstruct job state without the in-memory Map.
 *
 * Pass `meta` on the initial insert (finalize route) to store the chunk-upload
 * parameters that replace the old JSON sidecar file.  Subsequent updates
 * (progress milestones) omit `meta` and only touch the mutable columns.
 *
 * Uses an upsert so it works for both initial creation and later updates.
 */
async function persistJobToDB(
  jobId: string,
  state: JobState,
  meta?: JobMetaForDB,
  options?: { strict?: boolean },
): Promise<void> {
  try {
    await db
      .insert(uploadJobsTable)
      .values({
        id: jobId,
        userId: state.userId,
        status: state.status,
        progress: state.progress,
        error: state.error ?? null,
        datasetId: state.datasetId ?? null,
        updatedAt: new Date(),
        stageStartedAt: state.stageStartedAt ?? null,
        ...(meta
          ? {
              uploadId: meta.uploadId,
              fileName: meta.fileName,
              totalChunks: meta.totalChunks,
              chunksReceived: meta.chunksReceived,
              resolution: meta.resolution,
              smoothing: meta.smoothing,
            }
          : {}),
      })
      .onConflictDoUpdate({
        target: uploadJobsTable.id,
        set: {
          status: state.status,
          progress: state.progress,
          error: state.error ?? null,
          datasetId: state.datasetId ?? null,
          updatedAt: new Date(),
          stageStartedAt: state.stageStartedAt ?? null,
          ...(meta
            ? {
                uploadId: meta.uploadId,
                fileName: meta.fileName,
                totalChunks: meta.totalChunks,
                chunksReceived: meta.chunksReceived,
                resolution: meta.resolution,
                smoothing: meta.smoothing,
              }
            : {}),
        },
      });
  } catch (err) {
    if (options?.strict) throw err;
    // Persistence failure is non-fatal during processing — the in-memory state
    // is still the source of truth for the current server process.
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ jobId, status: state.status, errMsg }, `[upload-job] persist failed { jobId: "${jobId}", status: "${state.status}", error: ${JSON.stringify(errMsg)} }`);
  }
}

async function persistTerminalJobToDB(jobId: string, state: JobState): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await persistJobToDB(jobId, state, undefined, { strict: true });
      return;
    } catch (err) {
      lastError = err;
      logger.warn(
        { err, jobId, status: state.status, attempt },
        "[upload-job] terminal state persistence retry failed",
      );
    }
  }
  logger.error(
    { err: lastError, jobId, status: state.status },
    "[upload-job] terminal state could not be persisted after retries",
  );
}

/**
 * Creates the durable "uploading" row after chunk 0 reaches its canonical disk
 * path. A failed insert is reported to the caller and the chunk is removed so
 * disk and durable state cannot disagree about whether the session started.
 */
async function createUploadSessionRow(
  sessionJobId: string,
  userId: string,
  uploadId: string,
  totalChunks: number,
): Promise<boolean> {
  try {
    await db
      .insert(uploadJobsTable)
      .values({
        id: sessionJobId,
        userId,
        status: "uploading",
        progress: 0,
        uploadId,
        totalChunks,
        chunksReceived: 1,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ sessionJobId, uploadId, errMsg }, `[upload-session] createUploadSessionRow failed`);
    return false;
  }
}

/**
 * Stores the exact number of chunk files present for an active upload session.
 * The precise index set remains disk-authoritative; this aggregate is advisory.
 */
async function updateChunksReceivedInDB(
  uploadId: string,
  chunksReceived: number,
): Promise<void> {
  try {
    await db
      .update(uploadJobsTable)
      .set({ chunksReceived, updatedAt: new Date() })
      .where(and(
        eq(uploadJobsTable.uploadId, uploadId),
        eq(uploadJobsTable.status, "uploading"),
      ));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ uploadId, chunksReceived, errMsg }, `[upload-session] updateChunksReceivedInDB failed`);
  }
}

async function countReceivedChunksOnDisk(uploadId: string): Promise<number> {
  try {
    const prefix = `${uploadId}-chunk-`;
    const entries = await fs.promises.readdir(CHUNK_BASE_DIR);
    return entries.filter((entry) => {
      if (!entry.startsWith(prefix)) return false;
      const index = Number(entry.slice(prefix.length));
      return Number.isInteger(index) && index >= 0;
    }).length;
  } catch {
    return 0;
  }
}

/**
 * On server startup, scan the database for any upload jobs that are still
 * queued or processing (meaning the previous process was killed mid-flight).
 *
 * For each stale job, reads the recovery metadata stored in the DB row
 * (uploadId, fileName, totalChunks, resolution, smoothing) — these columns
 * replaced the old JSON sidecar files so recovery survives a container restart
 * that wipes /tmp.
 *
 * When the assembled source file (or raw chunk files) still exists on disk
 * the job is re-queued so processing resumes transparently.  Jobs whose
 * source data is gone are marked as error so the client gets a clear message
 * instead of an eternal spinner.
 *
 * Called once from the server's startup sequence in index.ts, before
 * cleanupStaleChunks() runs.
 */
export async function recoverStaleUploadJobs(): Promise<boolean> {
  try {
    const staleJobs = await db
      .select({
        id: uploadJobsTable.id,
        userId: uploadJobsTable.userId,
        status: uploadJobsTable.status,
        uploadId: uploadJobsTable.uploadId,
        fileName: uploadJobsTable.fileName,
        totalChunks: uploadJobsTable.totalChunks,
        chunksReceived: uploadJobsTable.chunksReceived,
        resolution: uploadJobsTable.resolution,
        smoothing: uploadJobsTable.smoothing,
        updatedAt: uploadJobsTable.updatedAt,
      })
      .from(uploadJobsTable)
      .where(and(
        or(
          eq(uploadJobsTable.status, "uploading"),
          eq(uploadJobsTable.status, "queued"),
          eq(uploadJobsTable.status, "processing"),
        ),
        // Bucket-monitor jobs (objectKey set) are rehydrated by
        // rehydrateBucketJobsFromDb() in lib/bucketMonitor.ts — touching them
        // here would wrongly mark them as unrecoverable chunked uploads.
        isNull(uploadJobsTable.objectKey),
      ));

    if (staleJobs.length === 0) return true;

    const recoverable: string[] = [];
    const resumable: string[] = [];
    const failed: string[] = [];

    for (const job of staleJobs) {
      // Primary: use DB columns (populated since migration 0009).
      // Fallback: read legacy sidecar file for rows written before migration.
      let uploadId = job.uploadId;
      let fileName = job.fileName;
      let totalChunks = job.totalChunks;
      let resolution = job.resolution;
      let smoothing = job.smoothing;
      const lifecycleStatus = job.status ?? "queued";

      if (lifecycleStatus === "uploading" && uploadId && totalChunks != null) {
        uploadSessions.set(uploadId, {
          userId: job.userId,
          sessionJobId: job.id,
          serverIssued: true,
          source: "rehydrated",
          lifecycleStatus: "uploading",
          totalChunks,
          lastActivityAt: job.updatedAt?.getTime() ?? Date.now(),
        });
        resumable.push(job.id);
        continue;
      }

      if (!uploadId || !fileName || totalChunks == null || resolution == null || smoothing == null) {
        // Legacy sidecar fallback — rows predating the DB meta columns.
        try {
          const metaPath = path.join(CHUNK_BASE_DIR, `${job.id}-meta.json`);
          const raw = await fs.promises.readFile(metaPath, "utf8");
          const sidecar = JSON.parse(raw) as {
            uploadId: string; fileName: string; totalChunks: number;
            resolution: number; userId: string; smoothing: boolean;
          };
          uploadId   = sidecar.uploadId;
          fileName   = sidecar.fileName;
          totalChunks = sidecar.totalChunks;
          resolution  = sidecar.resolution;
          smoothing   = sidecar.smoothing;
        } catch {
          // No sidecar and no DB meta — cannot recover this job.
        }
      }

      if (uploadId && fileName && totalChunks != null && resolution != null && smoothing != null) {
        // A finalized job is recoverable only from its complete source: either
        // the assembled file or every expected chunk.
        const assembledPath = path.join(CHUNK_BASE_DIR, `${job.id}-assembled`);
        const assembledExists = await fs.promises.access(assembledPath)
          .then(() => true).catch(() => false);

        let chunksComplete = assembledExists;
        if (!assembledExists) {
          chunksComplete = true;
          for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join(CHUNK_BASE_DIR, `${uploadId}-chunk-${i}`);
            const exists = await fs.promises.access(chunkPath)
              .then(() => true).catch(() => false);
            if (!exists) {
              chunksComplete = false;
              break;
            }
          }
        }

        if (assembledExists || chunksComplete) {
          // Restore the in-memory upload session so chunk-status queries work.
          // Include sessionJobId so that if the client retries finalize the
          // same DB row is reused instead of spawning a second one.
          uploadSessions.set(uploadId, {
            userId: job.userId,
            sessionJobId: job.id,
            activeJobId: job.id,
            serverIssued: true,
            source: "rehydrated",
            lifecycleStatus: "queued",
            totalChunks,
            lastActivityAt: Date.now(),
          });

          // Re-queue the job with its original parameters.
          const requeued: JobState = { status: "queued", progress: 0, userId: job.userId };
          uploadJobs.set(job.id, requeued);
          await persistJobToDB(job.id, requeued);

          void processUploadJob(
            job.id,
            uploadId,
            totalChunks,
            fileName,
            resolution,
            job.userId,
            smoothing,
          ).catch((err: unknown) => {
            logger.error({ err, jobId: job.id }, "[upload-jobs] recovered job failed");
          });

          recoverable.push(job.id);
          continue;
        }
      }

      failed.push(job.id);
    }

    if (failed.length > 0) {
      await db
        .update(uploadJobsTable)
        .set({
          status: "error",
          error: "Server restarted while this job was in progress — please re-upload your file.",
          updatedAt: new Date(),
        })
        .where(inArray(uploadJobsTable.id, failed));
    }

    if (recoverable.length > 0) {
      logger.info(
        { count: recoverable.length },
        `[upload-jobs] recovered and re-queued ${recoverable.length} stale job(s) after restart`,
      );
    }
    if (resumable.length > 0) {
      logger.info(
        { count: resumable.length },
        `[upload-jobs] restored ${resumable.length} resumable upload session(s) after restart`,
      );
    }
    if (failed.length > 0) {
      logger.info(
        { count: failed.length },
        `[upload-jobs] marked ${failed.length} stale job(s) as error after restart (no recoverable source)`,
      );
    }
    return true;
  } catch (err) {
    // Non-fatal — the server continues, but startup cleanup must not run because
    // the active ownership set could not be reconstructed safely.
    logger.error({ err }, "[upload-jobs] failed to recover stale jobs on startup");
    return false;
  }
}

// Temp directory for received chunks: <tmpdir>/bathyscan-chunks/<uploadId>-chunk-<index>
const CHUNK_BASE_DIR = path.join(os.tmpdir(), "bathyscan-chunks");

// Disk-storage multer for chunk files. Each chunk lands as a temp file; the
// route handler renames it into the canonical <uploadId>-chunk-<index> name.
const chunkStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    fs.mkdir(CHUNK_BASE_DIR, { recursive: true }, (err) => cb(err as Error | null, CHUNK_BASE_DIR));
  },
  filename(_req, _file, cb) {
    cb(null, `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  },
});
// 6 MB limit per chunk (client sends 5 MB slices; a little headroom for overhead).
const uploadChunkMiddleware = multer({
  storage: chunkStorage,
  limits: { fileSize: 6 * 1024 * 1024 },
});

/**
 * Purge orphaned files from the staging directory on server startup.
 *
 * Removes:
 *   - Raw chunk slice files  (`<uploadId>-chunk-<N>` pattern)
 *   - Legacy JSON sidecar files (`<jobId>-meta.json`) — superseded by the
 *     DB meta columns added in migration 0009; kept here so old files left
 *     by a previous server version are cleaned up automatically.
 *
 * Assembled source files (`<jobId>-assembled`) and their decompressed
 * counterparts are preserved so that recoverStaleUploadJobs() can re-queue
 * in-flight jobs.  Those files are removed by processUploadJob on completion.
 *
 * Called once from index.ts after recoverStaleUploadJobs() has run.
 */
export async function cleanupStaleChunks(): Promise<void> {
  try {
    let entries: string[];
    try {
      entries = await fs.promises.readdir(CHUNK_BASE_DIR);
    } catch {
      // Directory doesn't exist yet — nothing to clean up.
      return;
    }

    const CHUNK_PATTERN = /-chunk-\d+$/;
    const SIDECAR_PATTERN = /-meta\.json$/;
    let removedChunks = 0;
    let removedSidecars = 0;
    for (const entry of entries) {
      if (CHUNK_PATTERN.test(entry)) {
        const uploadId = entry.replace(/-chunk-\d+$/, "");
        if (uploadSessions.has(uploadId)) {
          continue;
        }
        await fs.promises.unlink(path.join(CHUNK_BASE_DIR, entry)).catch(() => undefined);
        removedChunks++;
      } else if (SIDECAR_PATTERN.test(entry)) {
        await fs.promises.unlink(path.join(CHUNK_BASE_DIR, entry)).catch(() => undefined);
        removedSidecars++;
      }
    }

    if (removedChunks > 0) {
      logger.info({ removed: removedChunks }, "[upload-chunks] purged stale chunk files on startup");
    }
    if (removedSidecars > 0) {
      logger.info({ removed: removedSidecars }, "[upload-chunks] purged legacy meta sidecar files on startup");
    }
  } catch (err) {
    // Non-fatal — worst case the orphaned files persist until the OS clears /tmp.
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ msg }, `[upload-chunks] could not purge chunk files: ${msg}`);
  }
}

/**
 * Delete upload_jobs rows that are still in "uploading" status and are older
 * than ABANDONED_UPLOAD_THRESHOLD_MS (default 24 h).
 *
 * These rows are created on the first chunk of a multi-part upload.  If the
 * client never calls finalize (browser closed, network dropped, tab killed)
 * the row stays "uploading" forever. Recovery restores those rows for resume,
 * while this sweep removes only rows whose durable activity remains stale.
 *
 * Called once from the server's startup sequence in index.ts, after
 * recoverStaleUploadJobs() and cleanupStaleChunks() have run.
 */
export const ABANDONED_UPLOAD_THRESHOLD_MS =
  Number(process.env.ABANDONED_UPLOAD_THRESHOLD_MS) || 24 * 60 * 60 * 1000; // 24 h

export async function cleanupAbandonedUploadJobs(): Promise<void> {
  try {
    const now = Date.now();
    const cutoff = new Date(now - ABANDONED_UPLOAD_THRESHOLD_MS);

    // Keep DB activity in sync for every live resumable session before the
    // broad stale-row delete. If a heartbeat fails, abort this cleanup cycle:
    // retaining stale rows is safer than deleting a session that is active in
    // this process.
    for (const session of uploadSessions.values()) {
      const isLiveUploadingSession =
        session.lifecycleStatus === "uploading" &&
        (
          session.initializing === true ||
          session.finalizing === true ||
          now - session.lastActivityAt < ABANDONED_UPLOAD_THRESHOLD_MS
        );
      if (!isLiveUploadingSession || !session.sessionJobId) continue;

      await db
        .update(uploadJobsTable)
        .set({ updatedAt: new Date(now) })
        .where(
          and(
            eq(uploadJobsTable.id, session.sessionJobId),
            eq(uploadJobsTable.status, "uploading"),
          ),
        );
    }

    const deleted = await db
      .delete(uploadJobsTable)
      .where(
        and(
          eq(uploadJobsTable.status, "uploading"),
          lt(uploadJobsTable.updatedAt, cutoff),
        ),
      )
      .returning({ id: uploadJobsTable.id });

    if (deleted.length > 0) {
      logger.info(
        { count: deleted.length, thresholdMs: ABANDONED_UPLOAD_THRESHOLD_MS, cutoff },
        `[upload-jobs] purged ${deleted.length} abandoned "uploading" job(s) older than ${ABANDONED_UPLOAD_THRESHOLD_MS} ms`,
      );
    }
  } catch (err) {
    // Non-fatal — stale rows accumulate but the server remains healthy.
    logger.error({ err }, "[upload-jobs] failed to purge abandoned upload jobs on startup");
  }
}

/**
 * Evict abandoned in-memory upload state and its temp chunk files.
 *
 * `uploadSessions` and `uploadJobs` are module-level Maps with no other
 * eviction path — uploads that are started but never finalized (browser
 * closed, network dropped) would otherwise stay in memory until the server
 * restarts. This sweep runs periodically (from the upload cleanup job in
 * lib/uploadCleanupJob.ts, alongside the DB-side abandoned-upload cleanup)
 * and:
 *
 *   - Evicts sessions idle longer than ABANDONED_UPLOAD_THRESHOLD_MS and
 *     deletes their on-disk chunk files (<uploadId>-chunk-N).
 *   - Never evicts active sessions: a session that is mid-finalize or whose
 *     job is queued/processing gets its activity timestamp refreshed instead.
 *   - Evicts terminal (done/error) uploadJobs entries that have been idle
 *     past the same threshold — polling for those falls back to the DB row,
 *     so no client-visible behavior changes.  Queued/processing jobs are
 *     always kept and their timestamps refreshed.
 */
export async function sweepStaleUploadSessions(): Promise<void> {
  const now = Date.now();
  const evictedSessions: string[] = [];
  let evictedJobs = 0;

  for (const [uploadId, session] of uploadSessions) {
    const activeJob = session.activeJobId ? uploadJobs.get(session.activeJobId) : undefined;
    const isActive =
      session.initializing === true ||
      session.finalizing === true ||
      activeJob?.status === "queued" ||
      activeJob?.status === "processing";

    if (isActive) {
      session.lastActivityAt = now;
      continue;
    }
    if (now - session.lastActivityAt < ABANDONED_UPLOAD_THRESHOLD_MS) continue;

    uploadSessions.delete(uploadId);
    evictedSessions.push(uploadId);

    // Delete any temp chunk files left behind by the abandoned upload.
    const entries = await fs.promises.readdir(CHUNK_BASE_DIR).catch(() => [] as string[]);
    const prefix = `${uploadId}-chunk-`;
    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        await fs.promises.unlink(path.join(CHUNK_BASE_DIR, entry)).catch(() => undefined);
      }
    }
  }

  for (const [jobId, job] of uploadJobs) {
    if (job.status === "queued" || job.status === "processing") {
      job.lastActivityAt = now;
      continue;
    }
    if (job.lastActivityAt === undefined) {
      // First time this terminal job is observed by the sweep — start its
      // idle clock now rather than evicting immediately.
      job.lastActivityAt = now;
      continue;
    }
    if (now - job.lastActivityAt >= ABANDONED_UPLOAD_THRESHOLD_MS) {
      uploadJobs.delete(jobId);
      evictedJobs++;
    }
  }

  if (evictedSessions.length > 0 || evictedJobs > 0) {
    logger.info(
      { sessions: evictedSessions.length, jobs: evictedJobs, thresholdMs: ABANDONED_UPLOAD_THRESHOLD_MS },
      `[upload-sessions] evicted ${evictedSessions.length} abandoned session(s) and ${evictedJobs} terminal job entrie(s) from memory`,
    );
  }
}

/** Test-only: seed an in-memory upload session. */
export function setUploadSessionForTest(
  uploadId: string,
  session: {
    userId: string;
    lastActivityAt: number;
    initializing?: boolean;
    finalizing?: boolean;
    activeJobId?: string;
    sessionJobId?: string;
    lifecycleStatus?: UploadSession["lifecycleStatus"];
  },
): void {
  uploadSessions.set(uploadId, session);
}

/** Test-only: read an in-memory upload session. */
export function getUploadSessionForTest(uploadId: string): UploadSession | undefined {
  return uploadSessions.get(uploadId);
}

/** Test-only: seed an in-memory upload job entry. */
export function setUploadJobForTest(
  jobId: string,
  job: { status: "queued" | "processing" | "done" | "error"; progress: number; userId: string; lastActivityAt?: number },
): void {
  uploadJobs.set(jobId, job);
}

/** Test-only: read an in-memory upload job entry. */
export function getUploadJobForTest(jobId: string): JobState | undefined {
  return uploadJobs.get(jobId);
}

// Test-only: inject a runParseWorker replacement so processUploadJob can be
// exercised in unit tests without spawning a real worker thread.
let _parseWorkerOverrideForTest: typeof runParseWorker | null = null;

/**
 * Test-only: replace the runParseWorker used by processUploadJob.
 * Pass null to restore the real implementation.
 */
export function setParseWorkerOverrideForTest(fn: typeof runParseWorker | null): void {
  _parseWorkerOverrideForTest = fn;
}

async function cleanupChunks(uploadId: string, totalChunks: number): Promise<void> {
  for (let i = 0; i < totalChunks; i++) {
    const p = path.join(CHUNK_BASE_DIR, `${uploadId}-chunk-${i}`);
    await fs.promises.unlink(p).catch((err: unknown) => {
      const code = (err as { code?: string })?.code ?? "UNKNOWN";
      if (code !== "ENOENT") {
        logger.warn({ uploadId, chunkIndex: i, path: p, code, err }, `[cleanup-chunks:${uploadId}] failed to unlink chunk ${i} (${p}): code=${code}`);
      }
    });
  }
}

/**
 * Stream-appends each chunk file to `destPath` one at a time, respecting
 * write-stream backpressure. Peak RAM = one 5 MB chunk at a time.
 */
async function streamChunksToFile(
  uploadId: string,
  totalChunks: number,
  destPath: string,
): Promise<void> {
  const out = fs.createWriteStream(destPath);
  try {
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(CHUNK_BASE_DIR, `${uploadId}-chunk-${i}`);
      for await (const chunk of fs.createReadStream(chunkPath)) {
        const ok = out.write(chunk as Buffer);
        if (!ok) await new Promise<void>((r) => out.once("drain", r));
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => { if (err) reject(err); else resolve(); });
    });
  } catch (err) {
    out.destroy();
    throw err;
  }
}

/**
 * Stream-decompresses a gzip file to destPath with a hard cap on output size.
 * Destroys both streams and rejects with DECOMPRESS_TOO_LARGE if cap is hit.
 * Peak RAM = one zlib internal chunk (~64 KB) at a time.
 */
async function streamGunzipToFile(
  srcPath: string,
  destPath: string,
  maxBytes: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    function fail(err: Error) {
      if (settled) return;
      settled = true;
      reject(err);
    }

    const src = fs.createReadStream(srcPath);
    const gunzip = zlib.createGunzip();
    const dest = fs.createWriteStream(destPath);
    let total = 0;

    gunzip.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = Object.assign(new Error("DECOMPRESS_TOO_LARGE"), { code: "DECOMPRESS_TOO_LARGE" });
        gunzip.destroy(err);
        dest.destroy();
        fail(err);
      }
    });

    src.on("error", fail);
    gunzip.on("error", fail);
    dest.on("error", fail);
    dest.on("finish", () => { if (!settled) { settled = true; resolve(); } });

    src.pipe(gunzip).pipe(dest);
  });
}

// ---------------------------------------------------------------------------
// Worker-thread path — resolved relative to this bundle at runtime.
// esbuild preserves the src/ directory structure relative to the common
// ancestor of all entry points (src/), so:
//   src/index.ts          → dist/index.mjs           (the main bundle)
//   src/lib/parseWorker.ts → dist/lib/parseWorker.mjs (the worker bundle)
// ---------------------------------------------------------------------------
const PARSE_WORKER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "lib",
  "parseWorker.mjs",
);

interface ParseWorkerResult {
  terrain: TerrainGrid;
  overview: TerrainGrid;
}

/**
 * Spawns a dedicated worker thread to run the CPU-intensive parse + gridPoints
 * steps for a single upload job.  The main HTTP thread is never blocked: only
 * lightweight progress-update messages cross the thread boundary until the
 * worker finishes and posts its structured result.
 *
 * Progress milestones posted by the worker (matching the old inline values):
 *   40 → file read complete (or pre-points accepted)
 *   55 → parse complete
 *   60 → terrain grid starting
 *   80 → terrain grid done / overview grid starting
 *   88 → overview grid done
 *
 * @param filePath   Assembled (and decompressed) file on disk.
 * @param fileName   Original filename (used for extension detection).
 * @param resolution Grid resolution for the terrain (32–512).
 * @param gridId     UUID assigned to this dataset.
 * @param datasetName Display name derived from the filename.
 * @param smoothing  Whether to run the spike-smoothing pass.
 * @param prePoints  Pre-parsed points — when supplied, the worker skips the
 *                   file-read + parse steps and grids these points directly.
 *                   Used by the NOAA tar.gz router.
 * @param onProgress Callback invoked with each progress milestone.
 */
export function runParseWorker(params: {
  filePath: string;
  fileName: string;
  resolution: number;
  gridId: string;
  datasetName: string;
  smoothing: boolean;
  prePoints?: { lon: number; lat: number; depth: number }[];
  onProgress: (progress: number) => void;
}): Promise<ParseWorkerResult> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const worker = new Worker(PARSE_WORKER_PATH, {
      workerData: {
        filePath: params.filePath,
        fileName: params.fileName,
        resolution: params.resolution,
        gridId: params.gridId,
        datasetName: params.datasetName,
        smoothing: params.smoothing,
        prePoints: params.prePoints,
      },
    });

    worker.on("message", (msg: { type: string; progress?: number; terrain?: unknown; overview?: unknown; message?: string }) => {
      if (msg.type === "progress" && typeof msg.progress === "number") {
        params.onProgress(msg.progress);
      } else if (msg.type === "result") {
        if (settled) return;
        settled = true;
        // Worker posts result then exits naturally; terminate() ensures cleanup
        // even if the worker is still winding down when we resolve.
        worker.terminate().catch((terminateErr: unknown) => {
          logger.warn({ err: terminateErr }, "worker terminate error");
        });
        resolve({ terrain: msg.terrain as ParseWorkerResult["terrain"], overview: msg.overview as ParseWorkerResult["overview"] });
      } else if (msg.type === "error" && typeof msg.message === "string") {
        if (settled) return;
        settled = true;
        // Terminate explicitly — the worker may still be running if it posted
        // the error via parentPort but hasn't exited its event loop yet.
        worker.terminate().catch((terminateErr: unknown) => {
          logger.warn({ err: terminateErr }, "worker terminate error");
        });
        reject(new Error(msg.message));
      }
    });

    worker.on("error", (err) => {
      if (settled) return;
      settled = true;
      // An uncaught exception in the worker thread: terminate to guarantee the
      // OS thread is reclaimed, since it may not exit on its own after an error.
      worker.terminate().catch((terminateErr: unknown) => {
        logger.warn({ err: terminateErr }, "worker terminate error");
      });
      reject(err);
    });

    worker.on("exit", (code) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Parse worker exited unexpectedly with code ${code}`));
    });
  });
}

async function processUploadJob(
  jobId: string,
  uploadId: string,
  totalChunks: number,
  fileName: string,
  resolution: number,
  userId: string,
  smoothing: boolean,
): Promise<void> {
  const job = uploadJobs.get(jobId);
  if (!job) return;

  // Use jobId (not uploadId) as the assembled-file prefix so the crash-recovery
  // path in recoverStaleUploadJobs() can locate the file by jobId alone.
  const assembledPath = path.join(CHUNK_BASE_DIR, `${jobId}-assembled`);
  const decompressedPath = `${assembledPath}-decompressed`;
  const tarExtractedDir = path.join(CHUNK_BASE_DIR, `${uploadId}-tarcontents`);

  // The job is already registered as "queued" by the finalize route.  Wait
  // here for a concurrency slot before starting the heavy pipeline — this
  // keeps the job visible to pollers as "queued" (rather than jumping straight
  // to "processing") when multiple large-file uploads arrive simultaneously.
  await withChunkProcessSlot(async () => {
  try {
    job.status = "processing";
    const uploadSession = uploadSessions.get(uploadId);
    if (uploadSession) uploadSession.lifecycleStatus = "processing";
    // Capture wall-clock start time and file extension for the calibration table.
    job.jobStartedAt = Date.now();
    job.fileExt = path.extname(fileName).toLowerCase();
    updateProgressWithEta(job, 5);
    // Persist "processing" to DB so a future process knows this job started.
    await persistJobToDB(jobId, { ...job });

    // Recovery may already have a complete assembled source. Preserve and use
    // it instead of truncating it and attempting to rebuild from cleaned chunks.
    const assembledExists = await fs.promises.access(assembledPath)
      .then(() => true)
      .catch(() => false);
    if (!assembledExists) {
      // Stream chunks one-at-a-time into a single assembled file.
      // Peak RAM: one 5 MB chunk. No Buffer.concat across all chunks.
      await streamChunksToFile(uploadId, totalChunks, assembledPath);
    }
    // Record assembled file size for pre-40% ETA calibration (larger files
    // take proportionally longer to parse and grid than to assemble).
    job.fileBytes = await fs.promises.stat(assembledPath)
      .then((s) => s.size).catch(() => 0);
    updateProgressWithEta(job, 20);

    let processPath = assembledPath;

    // Detect gzip by magic bytes (0x1F 0x8B) as a fallback when the filename
    // does not carry a ".gz" extension.  NOAA archives are frequently downloaded
    // with descriptive names like "h09092.alaska - tolstoi bay - h09092" that
    // contain no extension hint even though the content is gzip-compressed.
    const looksLikeGzip =
      fileName.toLowerCase().endsWith(".gz") || await isGzipFile(assembledPath);
    // Normalise the stored extension: gzip-by-content files without a ".gz"
    // suffix still belong to the ".gz" calibration bucket.
    if (looksLikeGzip && !job.fileExt) job.fileExt = ".gz";

    if (looksLikeGzip) {
      // Stream-decompress with size guard; avoids full gz buffer in RAM.
      await streamGunzipToFile(assembledPath, decompressedPath, DECOMPRESS_MAX_BYTES);
      await fs.promises.unlink(assembledPath).catch(() => undefined);

      // Detect tar-inside-gz: NOAA smooth sheet archives are .tar.gz (a tar
      // wrapped in gzip), not a single file wrapped in gzip.  When detected,
      // extract all entries to a temp directory and route each entry to its
      // parser via the NOAA tar router.
      if (await isTarFile(decompressedPath)) {
        const entries = await extractTarFile(decompressedPath, tarExtractedDir);
        await fs.promises.unlink(decompressedPath).catch(() => undefined);

        // Walk entries, classify by path pattern, dispatch to parsers, and
        // merge all sounding points into a single array.  Throws with code
        // "NO_PARSEABLE_DATA" if nothing in the archive is parseable, or
        // "PARSER_NOT_IMPLEMENTED" for recognised-but-not-yet-implemented types.
        // IMPORTANT: every destructured key alias (tarPoints, tarDatasetName, …)
        // must be unique — TypeScript TS2451 will block compilation if the same
        // alias appears twice.  Check carefully when adding new fields.
        const {
          points: tarPoints,
          datasetName: tarDatasetName,
          substratePoints: tarSubstratePoints,
          hyd93Features: tarHyd93Features,
          skipped: tarSkipped,
          smoothSheetRasterBuffer,
          smoothSheetRasterFilename: _smoothSheetRasterFilename,
          parseWarnings: tarParseWarnings,
        } = await routeTarEntries(
          tarExtractedDir,
          entries,
          fileName,
        );

        // Compute skipped-file summary for the job-poll response.
        // Only "unsupported-format" entries are surfaced — metadata-only and
        // superseded files are expected NOAA archive artefacts, not user-visible
        // problems.
        const unsupportedSkipped = tarSkipped.filter((s) => s.reason === "unsupported-format");
        if (unsupportedSkipped.length > 0) {
          job.skippedCount = unsupportedSkipped.length;
          job.skippedFormats = [...new Set(
            unsupportedSkipped.map((s) => {
              const name = s.path.split("/").pop() ?? s.path;
              if (name.toLowerCase().endsWith(".gz")) {
                const withoutGz = name.slice(0, -3);
                const dot = withoutGz.lastIndexOf(".");
                return dot !== -1 ? withoutGz.slice(dot) + ".gz" : ".gz";
              }
              const dot = name.lastIndexOf(".");
              return dot !== -1 ? name.slice(dot) : name;
            }),
          )];
        }

        // Record sounding and substrate counts so the client can display a
        // meaningful import summary (e.g. "47 substrate annotations" for a
        // substrate-only archive instead of a confusing "0 soundings").
        job.soundingCount = tarPoints.length;
        job.substrateCount = tarSubstratePoints.length;

        // Surface any parser warnings about non-canonical column names to the
        // client so the user knows a synonym was matched (e.g. "long" → "lon").
        if (tarParseWarnings.length > 0) {
          job.parseWarnings = tarParseWarnings;
        }

        // Guard: at least one of sounding points, substrate annotations, or a
        // captured smooth-sheet raster must be present.  Substrate-only archives
        // (BSText with no XYZ soundings) are valid — they skip the gridding step
        // below but their substrate data is still persisted.
        if (tarPoints.length === 0 && tarSubstratePoints.length === 0 && !smoothSheetRasterBuffer) {
          throw Object.assign(
            new Error("No parseable bathymetric data found in this archive."),
            { code: "NO_PARSEABLE_DATA" },
          );
        }

        const gridId = crypto.randomUUID();
        updateProgressWithEta(job, 35);

        // Grid the merged points in a worker thread — same pipeline as
        // single-file uploads, but with pre-parsed points supplied directly.
        const { terrain, overview } = await (_parseWorkerOverrideForTest ?? runParseWorker)({
          filePath: "",
          fileName,
          resolution,
          gridId,
          datasetName: tarDatasetName,
          smoothing,
          prePoints: tarPoints,
          onProgress: (p) => { updateProgressWithEta(job, p); },
        });

        // Validate worker output before writing to DB — prevents silent corrupt
        // rows if the parse worker's output shape ever drifts from StoredTerrainJson.
        const validTarTerrain = validateTerrainForDb(terrain, "[tar-job]:terrain");
        const validTarOverview = validateTerrainForDb(overview, "[tar-job]:overview");

        // Encode the ungeoreferenced smooth-sheet raster for DB storage (if present).
        const pendingRasterGzBase64 = smoothSheetRasterBuffer
          ? smoothSheetRasterBuffer.toString("base64")
          : undefined;
        const needsGeoreferencing = smoothSheetRasterBuffer != null ? true : undefined;

        const [saved] = await db
          .insert(customDatasetsTable)
          .values({
            id: gridId,
            userId,
            name: tarDatasetName,
            minDepth: validTarTerrain.minDepth,
            maxDepth: validTarTerrain.maxDepth,
            terrainJson: validTarTerrain,
            overviewJson: validTarOverview,
            noaaSubstrateSamplesJson: tarSubstratePoints.length > 0 ? tarSubstratePoints : null,
            hyd93FeaturesJson: tarHyd93Features.length > 0 ? tarHyd93Features : null,
            needsGeoreferencing: needsGeoreferencing ?? null,
            pendingRasterGzBase64: pendingRasterGzBase64 ?? null,
            tideStationJson: await resolveTideStationForTerrain(terrain),
          })
          .returning({ id: customDatasetsTable.id });

        // Record total job duration for the tar/gz calibration bucket.
        if (job.fileExt && job.jobStartedAt != null) {
          recordExtensionDuration(job.fileExt, Date.now() - job.jobStartedAt);
        }
        updateProgressWithEta(job, 100);
        job.status = "done";
        job.datasetId = saved?.id ?? gridId;
        if (uploadSession) uploadSession.lifecycleStatus = "done";
        await persistTerminalJobToDB(jobId, { ...job });
        return;
      }

      processPath = decompressedPath;
    } else {
      // Enforce the same 200 MB cap for uncompressed files before reading.
      const { size } = await fs.promises.stat(assembledPath);
      if (size > DECOMPRESS_MAX_BYTES) {
        throw new Error(
          `File is ${Math.round(size / 1024 / 1024)} MB which exceeds the ` +
          `${Math.round(DECOMPRESS_MAX_BYTES / 1024 / 1024)} MB processing limit. ` +
          `Compress it as .gz before uploading (typically 5–10× smaller).`,
        );
      }
    }
    updateProgressWithEta(job, 35);

    // Derive names before spawning the worker (cheap, main-thread-safe).
    // Strip ".gz" only when the name actually ends in it — for gzip-by-content
    // files with descriptive NOAA names we keep the full name so dataset naming
    // stays readable (routeTarEntries will derive a name from archive internals).
    const baseFileName = fileName.toLowerCase().endsWith(".gz") ? fileName.slice(0, -3) : fileName;
    const datasetName = baseFileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
    const gridId = crypto.randomUUID();

    // Delegate parse + gridPoints to a dedicated worker thread.
    // The main event loop is completely free during this await — the worker
    // runs in its own OS thread and posts progress milestones back here.
    const { terrain, overview } = await (_parseWorkerOverrideForTest ?? runParseWorker)({
      filePath: processPath,
      fileName,
      resolution,
      gridId,
      datasetName,
      smoothing,
      onProgress: (p) => { updateProgressWithEta(job, p); },
    });

    // Validate worker output before writing to DB — prevents silent corrupt
    // rows if the parse worker's output shape ever drifts from StoredTerrainJson.
    const validChunkTerrain = validateTerrainForDb(terrain, "[chunk-job]:terrain");
    const validChunkOverview = validateTerrainForDb(overview, "[chunk-job]:overview");

    const [saved] = await db
      .insert(customDatasetsTable)
      .values({
        id: gridId,
        userId,
        name: datasetName,
        minDepth: validChunkTerrain.minDepth,
        maxDepth: validChunkTerrain.maxDepth,
        terrainJson: validChunkTerrain,
        overviewJson: validChunkOverview,
        tideStationJson: await resolveTideStationForTerrain(validChunkTerrain),
      })
      .returning({ id: customDatasetsTable.id });

    // Record total job duration in the per-extension calibration table so
    // subsequent jobs of the same file type start with a realistic ETA seed.
    if (job.fileExt && job.jobStartedAt != null) {
      recordExtensionDuration(job.fileExt, Date.now() - job.jobStartedAt);
    }
    updateProgressWithEta(job, 100);
    job.status = "done";
    job.datasetId = saved?.id ?? gridId;
    if (uploadSession) uploadSession.lifecycleStatus = "done";
    await persistTerminalJobToDB(jobId, { ...job });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Processing failed";
    job.status = "error";
    job.error = msg;
    const uploadSession = uploadSessions.get(uploadId);
    if (uploadSession) uploadSession.lifecycleStatus = "error";
    logger.error({ err, jobId }, `[chunk-job:${jobId}] failed`);
    // Persist the error state so polls return a clear failure instead of a
    // stale "processing" status. The in-memory state is already "error" above,
    // so subsequent polls on this process will be correct even if the DB write
    // fails. persistJobToDB logs its own warning on failure.
    await persistTerminalJobToDB(jobId, { ...job });
  } finally {
    await cleanupChunks(uploadId, totalChunks);
    await fs.promises.unlink(assembledPath).catch(() => undefined);
    await fs.promises.unlink(decompressedPath).catch(() => undefined);
    await fs.promises.rm(tarExtractedDir, { recursive: true, force: true }).catch(() => undefined);
    // Remove the recovery sidecar — the job has reached a terminal state and
    // its parameters are no longer needed for crash recovery.
    await fs.promises
      .unlink(path.join(CHUNK_BASE_DIR, `${jobId}-meta.json`))
      .catch(() => undefined);
  }
  }); // end withChunkProcessSlot
}

/**
 * Test-only: invoke processUploadJob directly so unit tests can assert on the
 * resulting in-memory job record (status, error) without going through the
 * HTTP finalize layer.
 */
export async function invokeProcessUploadJobForTest(
  jobId: string,
  uploadId: string,
  totalChunks: number,
  fileName: string,
  resolution: number,
  userId: string,
  smoothing: boolean,
): Promise<void> {
  return processUploadJob(jobId, uploadId, totalChunks, fileName, resolution, userId, smoothing);
}

const DECOMPRESS_MAX_BYTES = 200 * 1024 * 1024;

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  // Text-based formats
  ".csv", ".txt", ".xyz",
  // Compressed archive (wraps any of the above or binary formats)
  ".gz",
  // Binary / structured survey formats parsed by uploadParsers.ts
  ".tif", ".tiff", // GeoTIFF
  ".nc",           // NetCDF
  ".las", ".laz",  // LAS / compressed LAS
  ".bag",          // Bathymetric Attributed Grid (HDF5)
  ".gpx",          // GPS Exchange (track logs with elevation)
  ".nmea",         // NMEA-0183 depth sounder logs (primary extension)
  ".nme",          // NMEA-0183 depth sounder logs (alternate extension used by some devices)
  ".pdf",          // Vector or raster contour map (requires pdfBbox + pdfDepthUnit form fields)
  ".png",          // Raster contour map image (requires pdfBbox + pdfDepthUnit form fields)
  ".jpg", ".jpeg", // Raster contour map image (requires pdfBbox + pdfDepthUnit form fields)
]);

const datasetUploadRateLimit = createRateLimit({
  route: "dataset-upload",
  windowMs: 60_000,
  max: 10,
  mode: "ip",
});

const terrainFetchIpRateLimit = createRateLimit({
  route: "terrain-fetch",
  windowMs: 60_000,
  max: 90,
  mode: "ip",
});

const terrainFetchUserRateLimit = createRateLimit({
  route: "terrain-fetch",
  windowMs: 60_000,
  max: 30,
  mode: "user",
  skipIfNoUser: true,
});

const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter(_req, file, cb) {
    const ext = file.originalname.slice(file.originalname.lastIndexOf(".")).toLowerCase();
    if (ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(
        Object.assign(new Error(`Unsupported file type. Accepted: .csv, .txt, .xyz, .gz, .tif, .tiff, .nc, .las, .laz, .bag, .gpx, .nmea, .nme, .pdf, .png, .jpg, .jpeg`), {
          code: "LIMIT_UNEXPECTED_FILE",
        }) as unknown as null,
        false,
      );
    }
  },
});

/**
 * Translates multer errors (file too large, etc.) into the standard ApiError
 * shape so the client sees a structured 4xx instead of a stack-trace 500.
 */
function multerErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "file_too_large",
        details: `Uploaded file exceeds the ${Math.floor(UPLOAD_MAX_BYTES / (1024 * 1024))} MB limit.`,
      });
      return;
    }
    res.status(400).json({ error: "upload_error", details: err.message });
    return;
  }
  // fileFilter rejects unsupported extensions with a plain Error tagged with
  // code LIMIT_UNEXPECTED_FILE — surface it as a clear 415 instead of 500.
  if (
    err instanceof Error &&
    (err as { code?: string }).code === "LIMIT_UNEXPECTED_FILE"
  ) {
    res.status(415).json({
      error: "unsupported_file_type",
      details: err.message,
    });
    return;
  }
  next(err);
}

const router = Router();

/**
 * Look up the caller's "smoothTerrainSpikes" preference. Defaults to true
 * (smoothing on) when unauthenticated, missing, or unset.
 */
async function getSmoothingPreference(req: import("express").Request): Promise<boolean> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) return true;
  try {
    const rows = await db
      .select({ settings: userSettingsTable.settings })
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, userId));
    const settings = rows[0]?.settings as Record<string, unknown> | undefined;
    const value = settings?.["smoothTerrainSpikes"];
    return typeof value === "boolean" ? value : true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ userId, errMsg }, `[getSmoothingPreference] DB lookup failed for userId="${userId}", defaulting to true: ${errMsg}`);
    return true;
  }
}

// ── GET /datasets ─────────────────────────────────────────────────────────────
router.get("/datasets", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = DatasetsQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    logger.warn(
      { route: "GET /api/datasets", issues: queryParsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
      "GET /api/datasets — Zod query validation failed",
    );
    res.status(400).json({
      error: "invalid_param",
      details: queryParsed.error.issues[0]?.message ?? "Invalid query parameter",
    });
    return;
  }
  const waterTypeFilter = queryParsed.data.waterType ?? null;

  // Load suppressed preset IDs so they are excluded from the response.
  let disabledIds = new Set<string>();
  try {
    const rows = await db.select({ id: disabledPresetsTable.id }).from(disabledPresetsTable);
    disabledIds = new Set(rows.map((r) => r.id));
  } catch {
    // Non-fatal: if the table doesn't exist yet, serve all presets.
  }

  const source = (waterTypeFilter
    ? ALL_PRESET_DATASETS.filter((d) => d.waterType === waterTypeFilter)
    : ALL_PRESET_DATASETS
  ).filter((d) => !disabledIds.has(d.id));

  const list = source.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    waterType: d.waterType,
    minDepth: d.minDepth,
    maxDepth: d.maxDepth,
    centerLon: d.centerLon,
    centerLat: d.centerLat,
    bbox: d.bbox,
    ...(d.hasTopography === true ? { hasTopography: true as const } : {}),
    ...(d.hasEfh === true ? { hasEfh: true as const } : {}),
    ...(d.fetchStrategy ? { fetchStrategy: d.fetchStrategy.kind } : {}),
  }));
  try {
    res.json(GetDatasetsResponse.parse(list));
  } catch (err) {
    const details = err instanceof Error ? err.message : "Response schema validation failed";
    res.status(500).json({ error: "internal", details });
  }
}));

// ── DELETE /datasets/presets/:id ──────────────────────────────────────────────
// Globally suppresses a preset dataset for all users by inserting its ID into
// the disabled_presets table. The next GET /datasets response will omit it.
// Returns 204 on success, 404 if the id is not a known preset.
const PresetIdParamSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, "Preset id must contain only alphanumeric characters, hyphens, or underscores");

router.delete("/datasets/presets/:id", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const idParsed = PresetIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    logger.warn(
      { route: "DELETE /api/datasets/presets/:id", issues: idParsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
      "DELETE /api/datasets/presets/:id — Zod params validation failed",
    );
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid dataset id" });
    return;
  }
  const id = idParsed.data;
  const known = ALL_PRESET_DATASETS.find((d) => d.id === id);
  if (!known) {
    res.status(404).json({ error: "not_found", details: `'${id}' is not a known preset dataset` });
    return;
  }
  await db.insert(disabledPresetsTable).values({ id }).onConflictDoNothing();
  res.sendStatus(204);
}));

// ── GET /datasets/:id/terrain ─────────────────────────────────────────────────
// Dataset IDs may be preset slugs (e.g. "thorne-bay", "gebco") or custom
// dataset UUIDs. The schema rejects empty strings, strings containing dots /
// slashes / spaces, and other characters outside the alphanumeric-hyphen-
// underscore charset, returning 400 before any downstream processing.
const DatasetIdParamSchema = z
  .string()
  .min(1, "Dataset id is required")
  .max(128, "Dataset id must be at most 128 characters")
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
    "Dataset id must start with an alphanumeric character and contain only alphanumeric characters, hyphens, or underscores",
  );

// UUID pattern shared by the terrain/overview auth guards below.
const CUSTOM_DATASET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/datasets/:id/terrain", terrainFetchIpRateLimit, terrainFetchUserRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const idParsed = DatasetIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    logger.warn(
      { route: "GET /api/datasets/:id/terrain", issues: idParsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
      "GET /api/datasets/:id/terrain — Zod params validation failed",
    );
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid dataset id" });
    return;
  }
  const id = idParsed.data;

  // Auth + ownership guard for custom (UUID-format) dataset IDs.
  // Preset/catalog dataset IDs remain publicly accessible.
  // Non-owner requests (including unauthenticated) return 404 (not 401/403)
  // to avoid confirming existence of datasets belonging to other users.
  if (CUSTOM_DATASET_UUID_RE.test(id) && !ALL_PRESET_DATASETS.some((d) => d.id === id)) {
    const callerId = getAuth(req)?.userId ?? null;
    if (!callerId) {
      res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
      return;
    }
    const [ownRow] = await db
      .select({ userId: customDatasetsTable.userId, terrainJson: customDatasetsTable.terrainJson })
      .from(customDatasetsTable)
      .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, callerId)));
    if (!ownRow) {
      res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
      return;
    }
    // Validate the stored terrain JSON against the schema before serving it so
    // that a pre-validation DB row (or one written via a migration bypass) never
    // silently passes corrupt data to the 3D renderer.
    const stored = StoredTerrainJsonSchema.safeParse(ownRow.terrainJson);
    if (!stored.success) {
      const issues = stored.error.issues
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join("; ");
      logger.error({ id, issues }, "[datasets] GET terrain — stored terrain_schema_mismatch");
      res.status(500).json({ error: "terrain_schema_mismatch", details: issues });
      return;
    }
    res.json(GetDatasetsIdTerrainResponse.parse(stored.data));
    return;
  }

  const rawRes = req.query["resolution"];
  const resolution = rawRes ? Math.max(32, Math.min(512, parseInt(String(rawRes), 10))) : 256;

  const smoothing = await getSmoothingPreference(req);
  let grid;
  try {
    grid = await buildTerrainGrid(id, resolution, { smoothing });
  } catch (err) {
    if (err instanceof NoDataError) {
      res.status(503).json({ error: "no_data", details: err.message });
      return;
    }
    throw err;
  }
  if (!grid) {
    res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
    return;
  }
  res.json(GetDatasetsIdTerrainResponse.parse(grid));
}));

// ── GET /datasets/:id/overview ────────────────────────────────────────────────
router.get("/datasets/:id/overview", asyncHandler(async (req, res): Promise<void> => {
  const idParsed = DatasetIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    logger.warn(
      { route: "GET /api/datasets/:id/overview", issues: idParsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
      "GET /api/datasets/:id/overview — Zod params validation failed",
    );
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid dataset id" });
    return;
  }
  const id = idParsed.data;

  // Auth + ownership guard for custom (UUID-format) dataset IDs.
  // Preset/catalog dataset IDs remain publicly accessible.
  // Non-owner requests (including unauthenticated) return 404 (not 401/403)
  // to avoid confirming existence of datasets belonging to other users.
  if (CUSTOM_DATASET_UUID_RE.test(id) && !ALL_PRESET_DATASETS.some((d) => d.id === id)) {
    const callerId = getAuth(req)?.userId ?? null;
    if (!callerId) {
      res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
      return;
    }
    const [ownRow] = await db
      .select({ userId: customDatasetsTable.userId, overviewJson: customDatasetsTable.overviewJson })
      .from(customDatasetsTable)
      .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, callerId)));
    if (!ownRow) {
      res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
      return;
    }
    // Validate the stored overview JSON against the schema before serving it so
    // that a pre-validation DB row (or one written via a migration bypass) never
    // silently passes corrupt data to the overview map renderer.
    const stored = StoredTerrainJsonSchema.safeParse(ownRow.overviewJson);
    if (!stored.success) {
      const issues = stored.error.issues
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join("; ");
      logger.error({ id, issues }, "[datasets] GET overview — stored terrain_schema_mismatch");
      res.status(500).json({ error: "terrain_schema_mismatch", details: issues });
      return;
    }
    res.json(GetDatasetsIdOverviewResponse.parse(stored.data));
    return;
  }

  const smoothing = await getSmoothingPreference(req);
  let grid;
  try {
    grid = await buildTerrainGrid(id, 64, { smoothing });
  } catch (err) {
    if (err instanceof NoDataError) {
      res.status(503).json({ error: "no_data", details: err.message });
      return;
    }
    throw err;
  }
  if (!grid) {
    res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
    return;
  }
  res.json(GetDatasetsIdOverviewResponse.parse(grid));
}));

// ── GET /datasets/:id/preview ─────────────────────────────────────────────────
// Lightweight preflight: returns the resolved dataSource (ncei | gebco) for a
// preset dataset without transferring the full depth grid. The client uses
// this to warn users before loading low-resolution (gebco) bathymetry.
router.get("/datasets/:id/preview", asyncHandler(async (req, res): Promise<void> => {
  const idParsed = DatasetIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    logger.warn(
      { route: "GET /api/datasets/:id/preview", issues: idParsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
      "GET /api/datasets/:id/preview — Zod params validation failed",
    );
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid dataset id" });
    return;
  }
  const id = idParsed.data;
  try {
    const preview = await previewDataset(id);
    if (!preview) {
      // Custom (UUID-format) dataset — apply the same auth + ownership guard
      // used by the /terrain route, then build the preview from the row's
      // stored terrainJson so the client sees the real dataSource.
      if (CUSTOM_DATASET_UUID_RE.test(id) && !ALL_PRESET_DATASETS.some((d) => d.id === id)) {
        const callerId = getAuth(req)?.userId ?? null;
        if (!callerId) {
          res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
          return;
        }
        const [row] = await db
          .select({ name: customDatasetsTable.name, terrainJson: customDatasetsTable.terrainJson })
          .from(customDatasetsTable)
          .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, callerId)));
        if (!row) {
          res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
          return;
        }
        const tjParsed = StoredTerrainJsonSchema.safeParse(row.terrainJson);
        if (!tjParsed.success) {
          const issues = tjParsed.error.issues
            .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
            .join("; ");
          logger.error({ id, issues }, "[datasets] GET preview — stored terrain_schema_mismatch");
          res.status(500).json({ error: "terrain_schema_mismatch", details: issues });
          return;
        }
        const tj = tjParsed.data;
        // StoredTerrainJson.dataSource may include source labels not present in
        // the DatasetPreview enum (twdb, usace, usgs-3dep). User-uploaded sonar
        // is always real measured data, so map anything unrecognised to "ncei".
        // Stale DB rows may carry "synthetic" — that value was removed from
        // the schema; treat any unrecognised source as "ncei" (real upload).
        const rawSource = tj.dataSource;
        const dataSource: "ncei" | "gebco" = rawSource === "gebco" ? "gebco" : "ncei";
        res.json(validateResponse(GetDatasetsIdPreviewResponse, {
          datasetId: id,
          name: row.name,
          bbox: { minLon: tj.minLon, minLat: tj.minLat, maxLon: tj.maxLon, maxLat: tj.maxLat },
          dataSource,
        }, "GET /api/datasets/:id/preview (custom)"));
        return;
      }
      res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
      return;
    }
    res.json(validateResponse(GetDatasetsIdPreviewResponse, preview, "GET /api/datasets/:id/preview"));
  } catch (err) {
    // Preflight itself failed (rare — internal probes already catch). Always
    // return a graceful 200 with dataSource=unknown so the client can decide
    // whether to proceed.
    const meta = ALL_PRESET_DATASETS.find((d) => d.id === id);
    const msg = err instanceof Error ? err.message : "Preflight failed";
    res.json(validateResponse(GetDatasetsIdPreviewResponse, {
      datasetId: id,
      name: meta?.name ?? id,
      bbox: meta?.bbox ?? { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 },
      dataSource: "unknown" as const,
      syntheticReason: `Could not verify data source: ${msg}`,
    }, "GET /api/datasets/:id/preview (fallback)"));
  }
}));

// ── GET /datasets/:id/zones?h=<gridHash> ──────────────────────────────────────
// Returns the cached AI zone classification identified by gridHash.
// The :id path segment is used only for auth/ownership checks.
router.get("/datasets/:id/zones", asyncHandler(async (req, res): Promise<void> => {
  const { id } = req.params as { id: string };

  // Validate ?h= and ?w= via Zod — rejects array injection and unknown values.
  const parsedQuery = ZonesQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    logger.warn(
      { route: "GET /api/datasets/:id/zones", issues: parsedQuery.error.issues.map((i) => ({ path: i.path, code: i.code })) },
      "GET /api/datasets/:id/zones — Zod query validation failed",
    );
    const details = parsedQuery.error.issues.map((i) => i.message).join("; ");
    res.status(400).json({ error: "invalid_param", details });
    return;
  }
  const gridHash = parsedQuery.data.h;
  const waterType = parsedQuery.data.w;

  // --- Auth / ownership gate ---
  const isPreset = ALL_PRESET_DATASETS.some((d) => d.id === id);
  if (!isPreset) {
    // Only two non-preset ID shapes are recognised: UUID-format saved
    // uploads, and the placeholder "upload" used for anonymous uploads.
    // Anything else returns 404 cleanly.
    if (!CUSTOM_DATASET_UUID_RE.test(id) && id !== "upload") {
      res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
      return;
    }

    const auth = getAuth(req);
    const callerId = auth?.userId ?? null;

    if (!callerId) {
      res.status(401).json({ error: "unauthenticated", details: "Authentication required" });
      return;
    }

    // For UUID-format dataset IDs, verify ownership against the database.
    if (CUSTOM_DATASET_UUID_RE.test(id)) {
      const rows = await db
        .select({ userId: customDatasetsTable.userId })
        .from(customDatasetsTable)
        .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, callerId)));
      if (rows.length === 0) {
        // Either dataset doesn't exist or belongs to a different user.
        // Return 404 (not 403) to avoid leaking the existence of the dataset.
        res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
        return;
      }
    }
    // For "upload" placeholder ID, auth is sufficient; no DB row exists.
  }

  // --- Cache lookup ---
  // userId partitions the cache so two users who upload identical bathymetry
  // data cannot share each other's classification results. Preset datasets
  // are public, so they use "" as the userId.
  const cacheUserId = isPreset ? "" : (getAuth(req).userId ?? "");
  const substrateFp = substrateFingerprintForDataset(id);
  // Under the new sha256-namespaced cache scheme there are no "bare gridHash"
  // legacy entries — the hydrate pass unlinks any non-64-char files on
  // startup — so we look up only the namespaced key. Datasets with no
  // substrate coverage collapse to fp "00000000", which still produces a
  // stable namespaced key, so behaviour is unchanged for uploads.
  const namespacedKey = zoneCacheKey(cacheUserId, gridHash, waterType, substrateFp);
  const inMemory = datasetZonesCache.get(namespacedKey);
  if (inMemory && inMemory.waterType === waterType) {
    res.json(validateResponse(GetDatasetZonesResponse, {
      ...inMemory,
      source: inMemory.source ?? "ai",
      substrateFp,
      coarseWidth: inMemory.coarseWidth ?? 32,
      coarseHeight: inMemory.coarseHeight ?? 32,
    }, "GET /api/datasets/:id/zones (memory)"));
    return;
  }

  const onDisk = await readZoneDiskByHash(cacheUserId, gridHash, waterType, substrateFp);
  if (onDisk && onDisk.waterType === waterType) {
    datasetZonesCache.set(namespacedKey, onDisk);
    res.json(validateResponse(GetDatasetZonesResponse, {
      ...onDisk,
      source: onDisk.source ?? "ai",
      substrateFp,
      coarseWidth: onDisk.coarseWidth ?? 32,
      coarseHeight: onDisk.coarseHeight ?? 32,
    }, "GET /api/datasets/:id/zones (disk)"));
    return;
  }

  res.status(404).json({ error: "not_found", details: "No cached classification for this grid" });
}));

// ── GET /terrain/land ─────────────────────────────────────────────────────────
// Returns above-water Copernicus DEM 90 m elevation for a given bounding box.
// Results are cached server-side (memory + disk keyed by sha256 of bbox+size)
// so subsequent requests for the same region are served without an upstream
// round-trip. Falls back to a flat-plane (all-zero) grid on upstream failure.
//
// Query params:
//   bbox — comma-separated "minLon,minLat,maxLon,maxLat"
//   size — integer grid resolution, clamped to [32, 256] (default 128)
//
// No auth required — land elevation data is public.
router.get("/terrain/land", asyncHandler(async (req, res): Promise<void> => {
  // Validate bbox (string, not array) and size via Zod — rejects array injection
  // and non-finite values before any manual parseFloat.
  const parsedQuery = TerrainLandQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    logger.warn(
      { route: "GET /api/terrain/land", issues: parsedQuery.error.issues.map((i) => ({ path: i.path, code: i.code })) },
      "GET /api/terrain/land — Zod query validation failed",
    );
    const details = parsedQuery.error.issues.map((i) => i.message).join("; ");
    res.status(400).json({ error: "invalid_param", details });
    return;
  }

  const [minLon, minLat, maxLon, maxLat] = parsedQuery.data.bbox;

  if (
    minLon >= maxLon || minLat >= maxLat ||
    minLon < -180 || maxLon > 180 ||
    minLat < -90  || maxLat > 90
  ) {
    res.status(400).json({
      error: "invalid_bbox",
      details: "bbox values out of range or min >= max",
    });
    return;
  }

  const rawSizeNum = parsedQuery.data.size;
  const gridSize = Math.max(32, Math.min(256, isNaN(rawSizeNum) ? 128 : rawSizeNum));

  try {
    const grid = await fetchCopernicusDem({ minLon, minLat, maxLon, maxLat }, gridSize);
    res.json(validateResponse(GetTerrainLandResponse, grid, "GET /api/terrain/land"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Land DEM fetch failed";
    res.status(502).json({ error: "upstream_error", details: msg });
  }
}));

// ── GET /terrain/download/info ────────────────────────────────────────────────
// Lightweight preflight for the Overview Map download tool.  Returns the
// resolved source name, nominal resolution, and waterFraction (fraction of
// the N=32 probe grid that contains water cells, 0–1) for the requested bbox.
// The client derives estimatedPoints = resolution² × waterFraction locally so
// resolution switching is instant without an extra round-trip.
// Auth-required so anonymous users cannot probe our upstream APIs.
//
// Max bbox: 10° × 10°.  Returns 400 for out-of-range params.
router.get("/terrain/download/info", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  // Validate via Zod — rejects array injection on any cardinal param (e.g.
  // ?north[]=45&north[]=50 would previously resolve to parseFloat("45,50")=45).
  const parsedQuery = TerrainDownloadInfoQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    logger.warn(
      { route: "GET /api/terrain/download/info", issues: parsedQuery.error.issues.map((i) => ({ path: i.path, code: i.code })) },
      "GET /api/terrain/download/info — Zod query validation failed",
    );
    const details = parsedQuery.error.issues.map((i) => i.message).join("; ");
    res.status(400).json({ error: "invalid_bbox", details });
    return;
  }

  const { north, south, east, west } = parsedQuery.data;

  try {
    const info = await previewBboxForDownload({ north, south, east, west });
    res.json(validateResponse(GetTerrainDownloadInfoResponse, info, "GET /api/terrain/download/info"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Preflight failed";
    res.status(502).json({ error: "upstream_error", details: msg });
  }
}));

// ── GET /terrain/download ─────────────────────────────────────────────────────
// Builds the full bathymetric grid for the requested bbox and resolution, then
// streams it as a `text/csv` attachment.  Authenticated only — anonymous users
// get a 401 from requireAuth.
//
// Query params: north, south, east, west (degrees), resolution (64|256|512).
// Max bbox: 10° × 10°.
// Only water cells (depth > 0) are emitted; land/topography is excluded.
const TerrainDownloadQuerySchema = z.object({
  north: z.coerce.number({ invalid_type_error: "north must be a number" }).gte(-90).lte(90),
  south: z.coerce.number({ invalid_type_error: "south must be a number" }).gte(-90).lte(90),
  east:  z.coerce.number({ invalid_type_error: "east must be a number" }).gte(-180).lte(180),
  west:  z.coerce.number({ invalid_type_error: "west must be a number" }).gte(-180).lte(180),
  resolution: z.coerce.number().int().refine((v) => [64, 256, 512].includes(v), "resolution must be 64, 256, or 512").default(256),
}).refine((d) => d.north > d.south, { message: "north must be greater than south", path: ["north"] })
  .refine((d) => d.east > d.west, { message: "east must be greater than west", path: ["east"] })
  .refine((d) => d.north - d.south <= 10, { message: "Bounding box must be at most 10° latitude span", path: ["north"] })
  .refine((d) => d.east - d.west <= 10, { message: "Bounding box must be at most 10° longitude span", path: ["east"] });

router.get("/terrain/download", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsedQuery = TerrainDownloadQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    logger.warn(
      { route: "GET /api/terrain/download", issues: parsedQuery.error.issues.map((i) => ({ path: i.path, code: i.code })) },
      "GET /api/terrain/download — Zod query validation failed",
    );
    const details = parsedQuery.error.issues.map((i) => i.message).join("; ");
    res.status(400).json({ error: "invalid_bbox", details });
    return;
  }
  const { north, south, east, west, resolution } = parsedQuery.data;

  const centerLat = (north + south) / 2;
  const centerLon = (east + west) / 2;

  // Derive filename: bathyscan_<lat>N_<lon>W_<res>.csv
  const latAbs = Math.abs(centerLat).toFixed(1);
  const lonAbs = Math.abs(centerLon).toFixed(1);
  const latDir = centerLat >= 0 ? "N" : "S";
  const lonDir = centerLon >= 0 ? "E" : "W";
  const filename = `bathyscan_${latAbs}${latDir}_${lonAbs}${lonDir}_${resolution}.csv`;

  try {
    const rows = await buildBboxCsvRows({ north, south, east, west }, resolution);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");

    // Stream the CSV: header + data rows.
    res.write("lon,lat,depth\n");
    for (const row of rows) {
      res.write(`${row.lon.toFixed(7)},${row.lat.toFixed(7)},${row.depth.toFixed(3)}\n`);
    }
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Download failed";
    // Only send error header if not already started
    if (!res.headersSent) {
      res.status(502).json({ error: "upstream_error", details: msg });
    } else {
      res.end();
    }
  }
}));

// ── POST /datasets/upload (multipart/form-data via multer) ───────────────────
//
// Auth-required. Every successful upload is persisted into the caller's
// dataset library (`custom_datasets`) and the new row's UUID is returned as
// `savedDatasetId`. The viewer loads the uploaded terrain by hitting the
// unified per-user read path (/user/datasets/:id/{terrain,overview}) — there
// is no longer an anonymous "upload" placeholder dataset id.
router.post(
  "/datasets/upload",
  datasetUploadRateLimit,
  requireAuth,
  upload.single("file"),
  multerErrorHandler,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "missing_file", details: "No file uploaded. Send the XYZ/CSV/.gz as the 'file' field in a multipart/form-data request." });
      return;
    }

    const fileName = file.originalname;

  // Decompress .gz files before parsing.
  // gunzipBounded enforces the size cap *during* streaming inflate so a
  // deeply-compressed input cannot exhaust process memory before the check.
  // decompressedBuffer retains the raw bytes so binary parsers (LAS, GeoTIFF,
  // NetCDF, BAG) receive the decompressed Buffer, not a corrupted UTF-8
  // re-encoding of binary data.
  let fileContent: string;
  let decompressedBuffer: Buffer | null = null;
  if (fileName.toLowerCase().endsWith(".gz")) {
    let decompressed: Buffer;
    try {
      decompressed = await gunzipBounded(file.buffer, DECOMPRESS_MAX_BYTES);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "DECOMPRESS_TOO_LARGE") {
        res.status(422).json({
          error: "decompressed_too_large",
          details: "Decompressed content exceeds the 200 MB limit. Upload a smaller area or a more coarsely sampled file.",
        });
      } else {
        res.status(422).json({
          error: "decompress_error",
          details: "Failed to decompress the .gz file. Ensure it is a valid gzip archive.",
        });
      }
      return;
    }
    // Detect tar-inside-gz: NOAA smooth sheet archives are .tar.gz (a tar
    // wrapped in gzip), not a single file wrapped in gzip.  When detected,
    // extract all entries to a temp directory so the next processing stage
    // can route each entry to the appropriate parser.
    if (isTarBuffer(decompressed)) {
      const tarId = crypto.randomUUID();
      const tarDir = path.join(CHUNK_BASE_DIR, `${tarId}-tarcontents`);
    let entries: string[] = [];
      try {
        await fs.promises.mkdir(tarDir, { recursive: true });
        entries = await extractTarBuffer(decompressed, tarDir);
      } finally {
        await fs.promises.rm(tarDir, { recursive: true, force: true }).catch(() => undefined);
      }
      const preview = entries.slice(0, 5).join(", ");
      const more = entries.length > 5 ? ` … and ${entries.length - 5} more` : "";
      res.status(422).json({
        error: "tar_archive_detected",
        details:
          `This .gz file is a NOAA tar.gz archive containing ${entries.length} ` +
          `entr${entries.length === 1 ? "y" : "ies"}: ${preview}${more}. ` +
          `Full tar.gz parsing is not yet supported — please extract the archive ` +
          `and upload individual files.`,
      });
      return;
    }

    decompressedBuffer = decompressed;
    fileContent = decompressed.toString("utf8");
  } else {
    fileContent = file.buffer.toString("utf8");
  }

  const TEXT_EXTENSIONS = new Set(["csv", "xyz", "txt"]);
  // Strip the outer .gz suffix before deriving the inner extension so that
  // text formats (csv/xyz/txt) compressed as .gz are correctly routed to
  // parseXyzCsv with the already-decompressed fileContent.
  const baseFileName = fileName.toLowerCase().endsWith(".gz") ? fileName.slice(0, -3) : fileName;
  const fileExt = baseFileName.toLowerCase().split(".").pop() ?? "";

  // Parse the file BEFORE validating resolution so that parse failures (e.g.
  // GPX with no <ele>, NMEA with no depth sentences) return 422 parse_error
  // rather than falling through to the 400 "resolution required" check below.
    let points;
  try {
    if (fileExt === "pdf") {
      // Vector contour map: requires user-supplied georeferencing metadata.
      // pdfBbox is a JSON string {minLon,minLat,maxLon,maxLat}; pdfDepthUnit
      // is "feet" (default — US lake maps are almost always feet) or "meters".
      const rawBbox = req.body["pdfBbox"];
      if (typeof rawBbox !== "string" || rawBbox.length === 0) {
        res.status(400).json({
          error: "pdf_georeference_required",
          details:
            "PDF contour maps need georeferencing: include a 'pdfBbox' form field " +
            "with the map's corner coordinates as JSON " +
            '({"minLon":…,"minLat":…,"maxLon":…,"maxLat":…}).',
        });
        return;
      }
      let bboxJson: unknown;
      try {
        bboxJson = JSON.parse(rawBbox);
      } catch {
        res.status(400).json({ error: "invalid_param", details: "pdfBbox is not valid JSON." });
        return;
      }
      const bboxParsed = RasterCommitBboxSchema.safeParse(bboxJson);
      if (!bboxParsed.success) {
        res.status(400).json({
          error: "invalid_param",
          details: "pdfBbox: " + (bboxParsed.error.issues[0]?.message ?? "invalid bounding box"),
        });
        return;
      }
      const rawUnit = req.body["pdfDepthUnit"];
      if (rawUnit !== undefined && rawUnit !== "feet" && rawUnit !== "meters") {
        res.status(400).json({
          error: "invalid_param",
          details: 'pdfDepthUnit must be "feet" or "meters".',
        });
        return;
      }
      const depthUnit: PdfDepthUnit = (rawUnit as PdfDepthUnit | undefined) ?? "feet";
      try {
        points = await parsePdfContourFile(file.buffer, bboxParsed.data, depthUnit);
      } catch (err) {
        if (err instanceof PdfRasterOnlyError) {
          // The PDF is scanned/raster-only — re-run through the image-based
          // contour pipeline (render PDF → OCR + line detection → georef).
          try {
            points = await parseRasterPdfContourFile(file.buffer, bboxParsed.data, depthUnit);
          } catch (rasterErr) {
            if (rasterErr instanceof PdfStageError) {
              res.status(422).json({ error: `pdf_${rasterErr.stage}_error`, details: rasterErr.message });
              return;
            }
            throw rasterErr;
          }
        } else if (err instanceof PdfStageError) {
          res.status(422).json({ error: `pdf_${err.stage}_error`, details: err.message });
          return;
        } else {
          throw err;
        }
      }
    } else if (fileExt === "png" || fileExt === "jpg" || fileExt === "jpeg") {
      // Raster contour map image uploaded directly — same georeferencing
      // metadata required as for raster PDFs.
      const rawBbox = req.body["pdfBbox"] as unknown;
      if (typeof rawBbox !== "string" || rawBbox.length === 0) {
        res.status(400).json({
          error: "pdf_georeference_required",
          details:
            "Raster contour map images need georeferencing: include a 'pdfBbox' form field " +
            "with the map's corner coordinates as JSON " +
            '({"minLon":…,"minLat":…,"maxLon":…,"maxLat":…}).',
        });
        return;
      }
    let bboxJson: unknown;
    try {
      bboxJson = JSON.parse(rawBbox);
    } catch {
      res.status(400).json({ error: "invalid_param", details: "pdfBbox is not valid JSON." });
      return;
    }
    const bboxParsed = RasterCommitBboxSchema.safeParse(bboxJson);
      if (!bboxParsed.success) {
        res.status(400).json({
          error: "invalid_param",
          details: "pdfBbox: " + (bboxParsed.error.issues[0]?.message ?? "invalid bounding box"),
        });
        return;
      }
      const rawUnit = req.body["pdfDepthUnit"] as unknown;
      if (rawUnit !== undefined && rawUnit !== "feet" && rawUnit !== "meters") {
        res.status(400).json({
          error: "invalid_param",
          details: 'pdfDepthUnit must be "feet" or "meters".',
        });
        return;
      }
      const depthUnit: PdfDepthUnit = (rawUnit as PdfDepthUnit | undefined) ?? "feet";
      try {
        points = await parseRasterImageContourFile(file.buffer, bboxParsed.data, depthUnit);
      } catch (err) {
        if (err instanceof PdfStageError) {
          res.status(422).json({ error: `pdf_${err.stage}_error`, details: err.message });
          return;
        }
        throw err;
      }
    } else if (TEXT_EXTENSIONS.has(fileExt)) {
      points = parseXyzCsv(fileContent, baseFileName);
    } else {
      // For .gz-wrapped binary formats (LAS, GeoTIFF, NetCDF, BAG), pass the
      // decompressed Buffer and the inner filename (baseFileName, without the
      // .gz suffix) so the parser routes on the real extension and receives
      // uncorrupted binary content.
      const bufferForParser = decompressedBuffer ?? file.buffer;
      points = await parseUploadedFile(bufferForParser, baseFileName);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Parse error";
    res.status(422).json({ error: "parse_error", details: msg });
    return;
  }

  if (points.length < 10) {
    res.status(400).json({
      error: "insufficient_data",
      details: "File must contain at least 10 valid (lon, lat, depth) rows",
    });
    return;
  }

  // Validate numeric body params via Zod so malformed values surface as a
  // clear 400 instead of falling through `parseInt` → `NaN` and producing a
  // 5xx from a downstream grid call.
  const UploadParamsSchema = z
    .object({
      resolution: z.coerce.number().int().min(32).max(512).optional(),
      gridResolution: z.coerce.number().int().min(32).max(512).optional(),
    })
    .refine(
      (data) => data.resolution !== undefined || data.gridResolution !== undefined,
      { message: "resolution or gridResolution is required" },
    );
  const paramsParsed = UploadParamsSchema.safeParse({
    resolution: req.body["resolution"],
    gridResolution: req.body["gridResolution"],
  });
  if (!paramsParsed.success) {
    logger.warn(
      { route: "POST /api/datasets/upload", issues: paramsParsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
      "POST /api/datasets/upload — Zod body validation failed (resolution/gridResolution)",
    );
    res.status(400).json({
      error: "invalid_param",
      details: paramsParsed.error.issues
        .map((i) => `${i.path.join(".") || "param"}: ${i.message}`)
        .join("; "),
    });
    return;
  }
  // resolution takes priority; gridResolution is the legacy-client fallback.
  const resolution = (paramsParsed.data.resolution ?? paramsParsed.data.gridResolution) as number;

    const datasetName = fileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
    const smoothing = await getSmoothingPreference(req);

  // Auth-gated: requireAuth above guarantees a clerkUserId is present.
    const effectiveUserId = (req as AuthenticatedRequest).clerkUserId;
    const gridId = crypto.randomUUID();

    const terrain = gridPoints(points, resolution, gridId, datasetName, { smoothing });

  const MAX_NODATA_PERCENT = 70;
    const coveragePercent = terrain.coveragePercent ?? 100;

  const isTextPointSurvey = TEXT_EXTENSIONS.has(fileExt) || fileExt === "pdf" ||
    fileExt === "png" || fileExt === "jpg" || fileExt === "jpeg";
  if (!isTextPointSurvey && coveragePercent < (100 - MAX_NODATA_PERCENT)) {
    res.status(422).json({
      error: "sparse_survey",
      details:
        `Survey coverage is too sparse: only ${coveragePercent.toFixed(2)}% of the ` +
        `${terrain.resolution}×${terrain.resolution} grid has direct soundings. ` +
        `Upload a denser track or a larger survey area to avoid large no-data regions.`,
      coveragePercent,
    });
    return;
  }

    const overview = gridPoints(points, 64, gridId, datasetName, { smoothing });

    // Validate gridPoints output before DB write — prevents silent corrupt rows
    // if the gridder's output shape ever drifts from StoredTerrainJson.
    {
      const terrainCheck = StoredTerrainJsonSchema.safeParse(terrain);
      const overviewCheck = StoredTerrainJsonSchema.safeParse(overview);
      if (!terrainCheck.success || !overviewCheck.success) {
        const failedCheck = terrainCheck.success ? overviewCheck : terrainCheck;
        const issues = failedCheck.error!.issues
          .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
          .join("; ");
        logger.error({ issues, userId: effectiveUserId, datasetName }, "[direct-upload] terrain schema mismatch");
        res.status(500).json({ error: "terrain_schema_mismatch", details: issues });
        return;
      }
    }

    // H-2: treat dataset DB save failure as a hard error — never return a
    // false-positive success when the row was not actually persisted.
    let savedDatasetId: string;
    let savedDatasetMeta: { id: string; name: string; minDepth: number; maxDepth: number; createdAt: string };

    try {
      const [saved] = await db
        .insert(customDatasetsTable)
        .values({
          id: gridId,
          userId: effectiveUserId,
          name: datasetName,
          minDepth: terrain.minDepth,
          maxDepth: terrain.maxDepth,
          terrainJson: terrain as StoredTerrainJson,
          overviewJson: overview as StoredTerrainJson,
          tideStationJson: await resolveTideStationForTerrain(terrain),
        })
        .returning({
          id: customDatasetsTable.id,
          name: customDatasetsTable.name,
          minDepth: customDatasetsTable.minDepth,
          maxDepth: customDatasetsTable.maxDepth,
          createdAt: customDatasetsTable.createdAt,
        });
      if (!saved) throw new Error("Database insert returned no row");
      savedDatasetId = saved.id;
      savedDatasetMeta = {
        id: saved.id,
        name: saved.name,
        minDepth: saved.minDepth,
        maxDepth: saved.maxDepth,
        createdAt: saved.createdAt.toISOString(),
      };
    } catch (persistErr) {
      const errMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);
    logger.error(
      { err: persistErr, userId: effectiveUserId, datasetName },
      `[direct-upload] failed to persist (userId=${effectiveUserId}, name=${datasetName})`,
    );
    res.status(500).json({ error: "save_failed", details: errMsg });
    return;
  }

  res.json(
    PostDatasetsUploadResponse.parse({
      terrain,
      overview,
      coveragePercent,
      savedDatasetId,
      savedDatasetMeta,
    }),
  );
  }),
);

// ── POST /datasets/raster-extract ────────────────────────────────────────────
// Step 1 of the two-step raster contour pipeline.
// Accepts a PNG or JPEG contour-map image, runs OCR + line tracing, caches
// the polylines in memory, and returns a JSON response.
//
// Response: always HTTP 200 text/event-stream (SSE).
//   Success: data: { stage:"done", result:{ token, labels, polylineCount, width, height } }
//   Failure: data: { stage:"error", error:"pdf_extract_error", details }
//
// The token expires in 5 minutes.  Pass it to /datasets/raster-commit to
// complete the pipeline with (optionally corrected) labels.

router.post(
  "/datasets/raster-extract",
  datasetUploadRateLimit,
  requireAuth,
  upload.single("file"),
  multerErrorHandler,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "missing_file", details: "No image file uploaded. Send a PNG or JPEG as the 'file' field." });
      return;
    }

    const ext = (file.originalname.toLowerCase().split(".").pop() ?? "");
    if (ext !== "png" && ext !== "jpg" && ext !== "jpeg") {
      res.status(415).json({
        error: "unsupported_file_type",
        details: "raster-extract only accepts PNG and JPEG images.",
      });
      return;
    }

    // raster-extract always returns HTTP 200 with text/event-stream.
    // Errors and results are communicated as SSE data events so that progress
    // events can be streamed during long operations.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.status(200);

    function sendSseEvent(payload: Record<string, unknown>): void {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }

    let result: RasterExtractionResult;
    try {
      result = await extractRasterImageContoursOnly(file.buffer);
    } catch (err) {
      if (err instanceof PdfStageError) {
        sendSseEvent({ stage: "error", error: `pdf_${err.stage}_error`, details: err.message });
      } else {
        sendSseEvent({ stage: "error", error: "extraction_failed", details: "An unexpected error occurred during extraction." });
      }
      res.end();
      return;
    }

    sendSseEvent({
      stage: "done",
      result: {
        token: result.token,
        labels: result.labels,
        polylineCount: result.polylineCount,
        width: result.width,
        height: result.height,
      },
    });
    res.end();
  }),
);

// ── POST /datasets/raster-commit ──────────────────────────────────────────────
// Step 2 of the two-step raster contour pipeline.
// Accepts a cached extraction token (from /datasets/raster-extract), the
// user-reviewed depth labels, and the geographic bounding box. Applies the
// corrected labels, runs georeference + interpolation, grids the result, saves
// it to the user's library, and returns the same UploadResult shape as
// /datasets/upload.
const RasterCommitBodySchema = z.object({
  token: z.string().min(1),
  correctedLabels: z
    .array(z.object({
      x: z.number(),
      y: z.number(),
      value: z.number().positive("depth value must be positive"),
      text: z.string(),
    }))
    .min(1, "At least one depth label is required")
    .refine(
      (labels) => new Set(labels.map((l) => l.value)).size >= 2,
      "At least 2 distinct depth values are required — a single depth produces a flat grid with no terrain relief",
    ),
  pdfBbox: z.string().min(1),
  pdfDepthUnit: z.enum(["feet", "meters"]).default("feet"),
  resolution: z.coerce.number().int().min(32).max(512).default(256),
  fileName: z.string().min(1),
});

const RasterCommitBboxSchema = z.object({
  minLon: z.coerce.number().gte(-180).lte(180),
  minLat: z.coerce.number().gte(-90).lte(90),
  maxLon: z.coerce.number().gte(-180).lte(180),
  maxLat: z.coerce.number().gte(-90).lte(90),
}).refine((b) => b.minLon < b.maxLon && b.minLat < b.maxLat, {
  message: "min longitude/latitude must be strictly less than max",
});

router.post(
  "/datasets/raster-commit",
  datasetUploadRateLimit,
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parsed = RasterCommitBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_param",
        details: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    const { token, correctedLabels, pdfBbox, pdfDepthUnit, resolution, fileName } = parsed.data;

    let bboxJson: unknown;
    try {
      bboxJson = JSON.parse(pdfBbox);
    } catch {
      res.status(400).json({ error: "invalid_param", details: "pdfBbox is not valid JSON." });
      return;
    }
    const bboxParsed = RasterCommitBboxSchema.safeParse(bboxJson);
    if (!bboxParsed.success) {
      res.status(400).json({
        error: "invalid_param",
        details: "pdfBbox: " + (bboxParsed.error.issues[0]?.message ?? "invalid bounding box"),
      });
      return;
    }

    let points;
    try {
      points = commitCachedExtraction(token, correctedLabels, bboxParsed.data, pdfDepthUnit);
    } catch (err) {
      if (err instanceof PdfStageError) {
        res.status(422).json({ error: `pdf_${err.stage}_error`, details: err.message });
        return;
      }
      throw err;
    }

    if (points.length < 10) {
      res.status(400).json({
        error: "insufficient_data",
        details: "File must contain at least 10 valid (lon, lat, depth) rows. Check that your depth labels and bounding box are correct.",
      });
      return;
    }

    const datasetName = fileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
    const smoothing = await getSmoothingPreference(req);
    const effectiveUserId = (req as AuthenticatedRequest).clerkUserId;
    const gridId = crypto.randomUUID();
    const coveragePercent = 100;

    const terrain = gridPoints(points, resolution, gridId, datasetName, { smoothing });
    const overview = gridPoints(points, 64, gridId, datasetName, { smoothing });

    // Validate gridPoints output before DB write — prevents silent corrupt rows
    // if the gridder's output shape ever drifts from StoredTerrainJson.
    {
      const terrainCheck = StoredTerrainJsonSchema.safeParse(terrain);
      const overviewCheck = StoredTerrainJsonSchema.safeParse(overview);
      if (!terrainCheck.success || !overviewCheck.success) {
        const failedCheck = terrainCheck.success ? overviewCheck : terrainCheck;
        const issues = failedCheck.error!.issues
          .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
          .join("; ");
        logger.error({ issues, userId: effectiveUserId, datasetName }, "[raster-commit] terrain schema mismatch");
        res.status(500).json({ error: "terrain_schema_mismatch", details: issues });
        return;
      }
    }

    // H-2: treat dataset DB save failure as a hard error — never return a
    // false-positive success when the row was not actually persisted.
    let savedDatasetId: string;
    let savedDatasetMeta: { id: string; name: string; minDepth: number; maxDepth: number; createdAt: string };

    try {
      const [saved] = await db
        .insert(customDatasetsTable)
        .values({
          id: gridId,
          userId: effectiveUserId,
          name: datasetName,
          minDepth: terrain.minDepth,
          maxDepth: terrain.maxDepth,
          terrainJson: terrain as StoredTerrainJson,
          overviewJson: overview as StoredTerrainJson,
          tideStationJson: await resolveTideStationForTerrain(terrain),
        })
        .returning({
          id: customDatasetsTable.id,
          name: customDatasetsTable.name,
          minDepth: customDatasetsTable.minDepth,
          maxDepth: customDatasetsTable.maxDepth,
          createdAt: customDatasetsTable.createdAt,
        });
      if (!saved) throw new Error("Database insert returned no row");
      savedDatasetId = saved.id;
      savedDatasetMeta = {
        id: saved.id,
        name: saved.name,
        minDepth: saved.minDepth,
        maxDepth: saved.maxDepth,
        createdAt: saved.createdAt.toISOString(),
      };
    } catch (persistErr) {
      const errMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);
      logger.error(
        { err: persistErr, userId: effectiveUserId, datasetName },
        `[raster-commit] failed to persist (userId=${effectiveUserId}, name=${datasetName})`,
      );
      res.status(500).json({ error: "save_failed", details: errMsg });
      return;
    }

    res.json(
      PostDatasetsUploadResponse.parse({
        terrain,
        overview,
        coveragePercent,
        savedDatasetId,
        savedDatasetMeta,
      }),
    );
  }),
);

// ── POST /datasets/upload/start ───────────────────────────────────────────────
// Step 0 of the chunked-upload flow.  Generates a server-issued uploadId,
// registers the upload session in memory bound to the caller's userId, and
// returns the uploadId.  Subsequent chunk-submit and finalize calls must supply
// a uploadId that originated from this endpoint — client-supplied UUIDs are
// rejected with 403 to prevent session-slot squatting.
router.post(
  "/datasets/upload/start",
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).clerkUserId;
    const uploadId = crypto.randomUUID();
    // Pre-register the session so chunk-0 can verify it was server-issued.
    uploadSessions.set(uploadId, {
      userId,
      serverIssued: true,
      source: "live",
      lifecycleStatus: "uploading",
      lastActivityAt: Date.now(),
    });
    res.json(validateResponse(StartChunkedUploadResponse, { uploadId }, "POST /api/datasets/upload/start"));
  }),
);

// ── POST /datasets/upload/chunk ───────────────────────────────────────────────
// Receives one 5 MB slice of a large file. Fields (all required):
//   uploadId    — server-issued UUID returned by POST /api/datasets/upload/start
//   chunkIndex  — 0-based index of this slice
//   totalChunks — total number of slices the client will send
//   file        — the binary slice (multipart/form-data)
// The first chunk (chunkIndex === 0) verifies the server-issued session and
// registers the sessionJobId. Subsequent chunks must come from the same user.
// Returns { received: chunkIndex }.
router.post(
  "/datasets/upload/chunk",
  requireAuth,
  uploadChunkMiddleware.single("file"),
  multerErrorHandler,
  validateBody(ChunkUploadBodySchema, "POST /api/datasets/upload/chunk"),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "missing_file", details: "No chunk data received." });
      return;
    }

    const { uploadId, chunkIndex, totalChunks } = res.locals.parsedBody;

    if (chunkIndex >= totalChunks) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      res.status(400).json({ error: "invalid_request", details: "chunkIndex must be less than totalChunks" });
      return;
    }

    const userId = (req as AuthenticatedRequest).clerkUserId;
    let pendingSessionRow: {
      sessionJobId: string;
      userId: string;
      uploadId: string;
      totalChunks: number;
    } | null = null;

    if (chunkIndex === 0) {
      // First chunk: verify the session was server-issued (created by
      // POST /api/datasets/upload/start) and register the sessionJobId.
      // C-1: no server-issued session → client-supplied UUID → reject 403.
      // C-2: session from a different user → reject 409 (hijack guard).
      // C-3: same user retrying chunk 0 → refresh activity only (idempotent).
      const existingSession = uploadSessions.get(uploadId);
      if (!existingSession || !existingSession.serverIssued) {
        // No server-issued session — client supplied their own UUID or skipped start.
        await fs.promises.unlink(file.path).catch(() => undefined);
        res.status(403).json({
          error: "upload_not_started",
          details: "No server-issued upload session found for this uploadId. Call POST /api/datasets/upload/start first.",
        });
        return;
      }
      if (existingSession.userId !== userId) {
        // Different user trying to claim an already-owned uploadId — reject.
        await fs.promises.unlink(file.path).catch(() => undefined);
        res.status(409).json({
          error: "upload_conflict",
          details: "An upload with this uploadId is already in progress by another user.",
        });
        return;
      }
      if (existingSession.lifecycleStatus && existingSession.lifecycleStatus !== "uploading") {
        await fs.promises.unlink(file.path).catch(() => undefined);
        res.status(409).json({
          error: existingSession.lifecycleStatus === "done"
            ? "already_completed"
            : existingSession.lifecycleStatus === "error"
              ? "already_failed"
              : "already_processing",
          ...(existingSession.activeJobId ? { jobId: existingSession.activeJobId } : {}),
          details: "This upload has already been finalized.",
        });
        return;
      }
      if (existingSession.initializing) {
        await fs.promises.unlink(file.path).catch(() => undefined);
        res.status(409).json({
          error: "upload_session_initializing",
          details: "Chunk 0 is still being durably registered. Retry this chunk.",
        });
        return;
      }
      if (existingSession.totalChunks !== undefined && existingSession.totalChunks !== totalChunks) {
        await fs.promises.unlink(file.path).catch(() => undefined);
        res.status(409).json({
          error: "chunk_count_mismatch",
          details: `Upload session expects ${existingSession.totalChunks} chunks, not ${totalChunks}.`,
        });
        return;
      }
      if (!existingSession.sessionJobId) {
        // First time chunk-0 is received for this session — generate the
        // jobId now so the same DB row transitions uploading→queued.
        const sessionJobId = crypto.randomUUID();
        existingSession.initializing = true;
        existingSession.lastActivityAt = Date.now();
        pendingSessionRow = { sessionJobId, userId, uploadId, totalChunks };
      } else {
        // Same user retrying chunk 0 — refresh activity and continue.
        existingSession.lastActivityAt = Date.now();
      }
      existingSession.totalChunks = totalChunks;
      existingSession.lifecycleStatus = "uploading";
    } else {
      // Subsequent chunks: verify ownership.
    let session = uploadSessions.get(uploadId);

    if (!session) {
      // DB fallback — handles the case where the server restarted between the
      // last chunk arriving and finalize being called, clearing the in-memory
      // uploadSessions map.  The "uploading" row (written on chunk 0) carries
      // the uploadId, userId, and sessionJobId so we can reconstruct the
      // session and accept the finalize call without requiring a full re-upload.
      const [dbJob] = await db
        .select({
          userId: uploadJobsTable.userId,
          sessionJobId: uploadJobsTable.id,
          status: uploadJobsTable.status,
          totalChunks: uploadJobsTable.totalChunks,
        })
        .from(uploadJobsTable)
        .where(eq(uploadJobsTable.uploadId, uploadId));

        if (dbJob) {
          const durableStatus = dbJob.status ?? "uploading";
          // Session was originally created via the server-owned start endpoint;
          // mark it as such so the ownership chain remains intact after restart.
          session = {
            userId: dbJob.userId,
            sessionJobId: dbJob.sessionJobId,
            serverIssued: true,
            source: "rehydrated",
            activeJobId: durableStatus === "uploading" ? undefined : dbJob.sessionJobId,
            lifecycleStatus: durableStatus,
            totalChunks: dbJob.totalChunks ?? totalChunks,
            lastActivityAt: Date.now(),
          };
          uploadSessions.set(uploadId, session);
        }
      }

      if (!session) {
        await fs.promises.unlink(file.path).catch(() => undefined);
        res.status(404).json({ error: "session_not_found", details: "Upload session not found. Start from chunk 0." });
        return;
      }
      if (session.userId !== userId) {
        await fs.promises.unlink(file.path).catch(() => undefined);
        res.status(403).json({ error: "forbidden", details: "Upload session belongs to a different user." });
        return;
      }
      if (session.initializing) {
        await fs.promises.unlink(file.path).catch(() => undefined);
        res.status(409).json({
          error: "upload_session_initializing",
          details: "Chunk 0 is still being durably registered. Retry this chunk.",
        });
        return;
      }
      if (session.lifecycleStatus && session.lifecycleStatus !== "uploading") {
        await fs.promises.unlink(file.path).catch(() => undefined);
        res.status(409).json({
          error: session.lifecycleStatus === "done"
            ? "already_completed"
            : session.lifecycleStatus === "error"
              ? "already_failed"
              : "already_processing",
          ...(session.activeJobId ? { jobId: session.activeJobId } : {}),
          details: "This upload has already been finalized.",
        });
        return;
      }
      if (session.totalChunks !== undefined && session.totalChunks !== totalChunks) {
        await fs.promises.unlink(file.path).catch(() => undefined);
        res.status(409).json({
          error: "chunk_count_mismatch",
          details: `Upload session expects ${session.totalChunks} chunks, not ${totalChunks}.`,
        });
        return;
      }
      session.totalChunks = totalChunks;
      // Refresh activity so an in-progress upload is never swept mid-flight.
      session.lastActivityAt = Date.now();
    }

    // Rename the temp file to its canonical <uploadId>-chunk-<index> path
    const dest = path.join(CHUNK_BASE_DIR, `${uploadId}-chunk-${chunkIndex}`);
    try {
      await fs.promises.rename(file.path, dest);
    } catch {
      await fs.promises.unlink(file.path).catch(() => undefined);
      if (pendingSessionRow) {
        const failedSession = uploadSessions.get(uploadId);
        if (failedSession) failedSession.initializing = false;
      }
      res.status(500).json({ error: "chunk_write_error", details: "Failed to store chunk." });
      return;
    }

    if (pendingSessionRow) {
      const persisted = await createUploadSessionRow(
        pendingSessionRow.sessionJobId,
        pendingSessionRow.userId,
        pendingSessionRow.uploadId,
        pendingSessionRow.totalChunks,
      );
      if (!persisted) {
        await fs.promises.unlink(dest).catch(() => undefined);
        const failedSession = uploadSessions.get(uploadId);
        if (failedSession) failedSession.initializing = false;
        res.status(500).json({
          error: "upload_session_persist_failed",
          details: "Could not persist the upload session. Retry this chunk.",
        });
        return;
      }
      const persistedSession = uploadSessions.get(uploadId);
      if (persistedSession) {
        persistedSession.sessionJobId = pendingSessionRow.sessionJobId;
        persistedSession.initializing = false;
      }
    }

    // Persist an exact count of chunk files currently present. chunkIndex + 1
    // is only a high-water mark and overstates progress for out-of-order writes.
    if (chunkIndex > 0) {
      const chunksReceived = await countReceivedChunksOnDisk(uploadId);
      await updateChunksReceivedInDB(uploadId, chunksReceived);
    }

    res.json(validateResponse(UploadDatasetChunkResponse, { received: chunkIndex }, "POST /api/datasets/upload/chunk"));
  }),
);

// ── GET /datasets/upload/chunk/status/:uploadId ───────────────────────────────
// Returns which chunk indices have been received on disk for the given upload
// session.  Used by the frontend auto-resume logic after a server reconnect:
// the client fetches this endpoint to determine the next missing chunk and
// resumes the upload from that point rather than starting over.
//
// Session ownership is checked against the in-memory map first.  After a
// server restart where uploadSessions has been cleared, the handler falls back
// to the DB (the upload_jobs row stores the uploadId since migration 0009) so
// the caller's identity can still be verified without requiring chunk 0 to be
// re-sent.
router.get(
  "/datasets/upload/chunk/status/:uploadId",
  requireAuth,
  validateParams(UploadIdParamSchema, "GET /api/datasets/upload/chunk/status/:uploadId"),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { uploadId } = res.locals.parsedParams as { uploadId: string };
    const userId = (req as AuthenticatedRequest).clerkUserId;

    // Verify session ownership before queuing
    let session = uploadSessions.get(uploadId);

    if (!session) {
      // DB fallback — handles the case where the server restarted between
      // chunk uploads and the in-memory session was lost.  An "uploading"
      // row (written on chunk 0) carries the uploadId and chunksReceived so
      // we can reconstruct ownership and progress without any on-disk state.
      const [dbJob] = await db
        .select({
          userId: uploadJobsTable.userId,
          sessionJobId: uploadJobsTable.id,
          status: uploadJobsTable.status,
          totalChunks: uploadJobsTable.totalChunks,
          updatedAt: uploadJobsTable.updatedAt,
        })
        .from(uploadJobsTable)
        .where(eq(uploadJobsTable.uploadId, uploadId));

      if (dbJob) {
        const durableStatus = dbJob.status ?? "uploading";
        // Restore the in-memory session so future requests in this process
        // take the fast path.
        // Mark server-issued so the ownership chain survives a server restart.
        session = {
          userId: dbJob.userId,
          sessionJobId: dbJob.sessionJobId,
          activeJobId: durableStatus === "uploading" ? undefined : dbJob.sessionJobId,
          serverIssued: true,
          source: "rehydrated",
          lifecycleStatus: durableStatus,
          totalChunks: dbJob.totalChunks ?? undefined,
          lastActivityAt: dbJob.updatedAt?.getTime() ?? Date.now(),
        };
        uploadSessions.set(uploadId, session);
      }
    }

    if (!session || session.userId !== userId) {
      res.status(404).json({ error: "upload_not_found" });
      return;
    }
    if (session.initializing) {
      res.status(409).json({
        error: "upload_session_initializing",
        details: "Chunk 0 is still being durably registered. Retry shortly.",
      });
      return;
    }

    const touchedAt = new Date();
    session.lastActivityAt = touchedAt.getTime();
    if (session.lifecycleStatus === "uploading" && session.sessionJobId) {
      try {
        await db
          .update(uploadJobsTable)
          .set({ updatedAt: touchedAt })
          .where(
            and(
              eq(uploadJobsTable.id, session.sessionJobId),
              eq(uploadJobsTable.status, "uploading"),
            ),
          );
      } catch (err) {
        logger.warn(
          { err, uploadId, sessionJobId: session.sessionJobId },
          "[chunk-status] durable activity heartbeat failed",
        );
      }
    }

    // L-10: enumerate actual chunk files on disk — disk is always the
    // authoritative source of truth while chunks are actively arriving.
    //
    // A DB count cannot identify holes after out-of-order or retried chunks.
    // If the directory is inaccessible, [] is the only safe answer and causes
    // the client to re-upload rather than skip data that may be missing.
    const receivedChunks: number[] = [];
    let chunkDirAccessible = true;
    let dirEntries: string[] = [];
    try {
      dirEntries = await fs.promises.readdir(CHUNK_BASE_DIR);
    } catch {
      chunkDirAccessible = false;
      logger.warn(
        { uploadId, CHUNK_BASE_DIR },
        "[chunk-status] chunk directory not accessible; reporting no received chunks",
      );
    }

    if (chunkDirAccessible) {
      const prefix = `${uploadId}-chunk-`;
      for (const entry of dirEntries) {
        if (entry.startsWith(prefix)) {
          const idx = parseInt(entry.slice(prefix.length), 10);
          if (!Number.isNaN(idx)) receivedChunks.push(idx);
        }
      }
    }

    receivedChunks.sort((a, b) => a - b);
    res.json(validateResponse(GetChunkUploadStatusResponse, {
      uploadId,
      receivedChunks,
      lifecycleStatus: session.lifecycleStatus ?? "uploading",
      ...(session.activeJobId ? { jobId: session.activeJobId } : {}),
    }, "GET /api/datasets/upload/chunk/status/:uploadId"));
  }),
);

// ── POST /datasets/upload/chunk/finalize ──────────────────────────────────────
// Called after all chunks have been sent. Enqueues an async job that reassembles
// the chunks, parses the file, builds the terrain grid, and saves to DB.
// Body (JSON): { uploadId, fileName, totalChunks, resolution? }
// Returns { jobId }.
router.post(
  "/datasets/upload/chunk/finalize",
  requireAuth,
  validateBody(ChunkFinalizeBodySchema, "POST /api/datasets/upload/chunk/finalize"),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { uploadId, fileName, totalChunks, resolution } = res.locals.parsedBody;

    // PDF contour maps carry georeferencing metadata (bbox + depth unit) that
    // only the direct upload path accepts. PDFs are small (well under the
    // 50 MB direct limit), so the chunked path simply refuses them.
    if (String(fileName).toLowerCase().endsWith(".pdf")) {
      res.status(400).json({
        error: "pdf_direct_upload_required",
        details:
          "PDF contour maps must be uploaded via the standard upload (they need " +
          "georeferencing fields). Use the regular upload path instead of chunked upload.",
      });
      return;
    }

    const userId = (req as AuthenticatedRequest).clerkUserId;

    // Verify session ownership before queuing
    let session = uploadSessions.get(uploadId);

    if (!session) {
      // DB fallback — handles the case where the server restarted between the
      // last chunk arriving and finalize being called, clearing the in-memory
      // uploadSessions map.  The "uploading" row (written on chunk 0) carries
      // the uploadId, userId, and sessionJobId so we can reconstruct the
      // session and accept the finalize call without requiring a full re-upload.
      const [dbJob] = await db
        .select({
          userId: uploadJobsTable.userId,
          sessionJobId: uploadJobsTable.id,
          status: uploadJobsTable.status,
          totalChunks: uploadJobsTable.totalChunks,
        })
        .from(uploadJobsTable)
        .where(eq(uploadJobsTable.uploadId, uploadId));

      if (dbJob) {
        const durableStatus = dbJob.status ?? "uploading";
        // Mark server-issued — only legitimately started sessions have DB rows.
        session = {
          userId: dbJob.userId,
          sessionJobId: dbJob.sessionJobId,
          activeJobId: durableStatus === "uploading" ? undefined : dbJob.sessionJobId,
          serverIssued: true,
          source: "rehydrated",
          lifecycleStatus: durableStatus,
          totalChunks: dbJob.totalChunks ?? undefined,
          lastActivityAt: Date.now(),
        };
        uploadSessions.set(uploadId, session);
      }
    }

    if (!session) {
      res.status(404).json({ error: "session_not_found", details: "Upload session not found. Re-upload from chunk 0." });
      return;
    }
    if (session.userId !== userId) {
      res.status(403).json({ error: "forbidden", details: "Upload session belongs to a different user." });
      return;
    }
    if (!session.serverIssued) {
      res.status(403).json({ error: "upload_not_started", details: "This upload was not registered via the server. Call POST /api/datasets/upload/start first." });
      return;
    }
    if (session.initializing) {
      res.status(409).json({
        error: "upload_session_initializing",
        details: "Chunk 0 is still being durably registered. Retry shortly.",
      });
      return;
    }
    if (session.totalChunks !== undefined && session.totalChunks !== totalChunks) {
      res.status(409).json({
        error: "chunk_count_mismatch",
        details: `Upload session expects ${session.totalChunks} chunks, not ${totalChunks}.`,
      });
      return;
    }
    // Refresh activity so the session is never swept while finalize is underway.
    session.lastActivityAt = Date.now();

    // Idempotency guard — atomic: check AND lock synchronously before any await
    // so two concurrent finalize requests cannot both slip past the check.
    //
    // `session.finalizing` is set to true immediately (no yield point between
    // the check and the set), so the second request always sees the flag and
    // returns 409 without waiting for the first to finish.
    if (session.finalizing) {
      res.status(409).json({
        error: "already_processing",
        details: "This upload has already been handed off. Poll the existing jobId.",
      });
      return;
    }
    if (session.activeJobId) {
      const existingJob = uploadJobs.get(session.activeJobId);
      const existingStatus = existingJob?.status ?? session.lifecycleStatus;
      if (existingStatus && existingStatus !== "uploading") {
        res.status(409).json({
          error: existingStatus === "done"
            ? "already_completed"
            : existingStatus === "error"
              ? "already_failed"
              : "already_processing",
          jobId: session.activeJobId,
          details: "This upload has already been handed off. Poll the existing jobId.",
        });
        return;
      }
    }
    session.finalizing = true;

    // Verify all chunks only after the idempotent handoff checks above. If a
    // finalize response was lost and processing already removed temp files,
    // the client must recover the existing jobId instead of seeing a false
    // missing-chunks failure.
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(CHUNK_BASE_DIR, `${uploadId}-chunk-${i}`);
      const exists = await fs.promises.access(chunkPath).then(() => true).catch(() => false);
      if (!exists) {
        session.finalizing = false;
        res.status(409).json({
          error: "missing_chunks",
          details: `Chunk ${i} of ${totalChunks} not yet received. Re-upload missing chunks and retry.`,
        });
        return;
      }
    }

    let smoothing: Awaited<ReturnType<typeof getSmoothingPreference>>;
    let jobId: string;
    try {
      smoothing = await getSmoothingPreference(req);
      // Reuse the UUID generated on chunk 0 so the "uploading" DB row
      // transitions to "queued" in-place rather than creating a second row.
      if (!session.sessionJobId) {
        session.finalizing = false;
        res.status(500).json({
          error: "upload_session_missing",
          details: "The durable upload session is missing. Re-upload from chunk 0.",
        });
        return;
      }
      jobId = session.sessionJobId;

      // DB-backed idempotency guard — authoritative even across server
      // restarts (the in-memory flags above are just a fast path).  A
      // conditional status-transition UPDATE means only one caller can move
      // the row out of a non-active status into "queued"; losers observe an
      // already-queued/processing row and get a 409 with the existing jobId
      // instead of re-triggering the processing pipeline.
      try {
        const winners = await db
          .update(uploadJobsTable)
          .set({
            status: "queued",
            progress: 0,
            error: null,
            datasetId: null,
            updatedAt: new Date(),
            stageStartedAt: null,
            uploadId,
            fileName,
            totalChunks,
            chunksReceived: totalChunks,
            resolution,
            smoothing,
          })
          .where(
            and(
              eq(uploadJobsTable.id, jobId),
              eq(uploadJobsTable.status, "uploading"),
            ),
          )
          .returning({ id: uploadJobsTable.id });

        if (winners.length === 0) {
          // Another process may already have durably handed off this upload.
          // Read its status before deciding whether it is safe to expose jobId.
          const rows = await db
            .select()
            .from(uploadJobsTable)
            .where(eq(uploadJobsTable.id, jobId));
          const current = rows[0];
          const currentStatus = current?.status;
          if (current && currentStatus !== "uploading") {
            session.activeJobId = jobId;
            session.lifecycleStatus = currentStatus;
            session.finalizing = false;
            res.status(409).json({
              error: currentStatus === "done"
                ? "already_completed"
                : currentStatus === "error"
                  ? "already_failed"
                  : "already_processing",
              jobId,
              details: "This upload has already been handed off. Poll the existing jobId.",
            });
            return;
          }
          session.finalizing = false;
          res.status(current ? 409 : 500).json({
            error: current ? "finalize_conflict" : "upload_session_missing",
            details: current
              ? "The upload is still being finalized. Retry shortly."
              : "The durable upload session is missing. Re-upload from chunk 0.",
          });
          return;
        }
      } catch (guardErr) {
        const errMsg = guardErr instanceof Error ? guardErr.message : String(guardErr);
        session.finalizing = false;
        logger.error({ jobId, uploadId, errMsg }, `[finalize] DB idempotency guard failed: ${errMsg}`);
        res.status(500).json({
          error: "finalize_db_error",
          details: "Failed to register upload job. Please retry.",
        });
        return;
      }
    } catch (err) {
      // Release lock so the client can retry.
      session.finalizing = false;
      throw err;
    }

    const initialState: JobState = { status: "queued", progress: 0, userId, lastActivityAt: Date.now() };
    uploadJobs.set(jobId, initialState);

    // The conditional update above persisted the complete queued job metadata.
    // Only now is it safe to publish jobId to concurrent callers and pollers.
    session.activeJobId = jobId;
    session.lifecycleStatus = "queued";
    session.finalizing = false;

    // Fire-and-forget — the client polls /jobs/:jobId
    void processUploadJob(jobId, uploadId, totalChunks, fileName, resolution, userId, smoothing);

    res.json(validateResponse(FinalizeChunkedUploadResponse, { jobId }, "POST /api/datasets/upload/chunk/finalize"));
  }),
);

const GcsUrlBodySchema = z.object({
  fileName: z.string().min(1).max(255),
});

// ── POST /datasets/upload/request-gcs-url ────────────────────────────────────
// Auth-required. Generates a presigned GCS PUT URL for oversized files (>50 MB).
// The client uploads directly to GCS — the API server's memory is never involved.
// Body (JSON): { fileName: string }
// Returns: { uploadUrl, objectKey }
router.post(
  "/datasets/upload/request-gcs-url",
  requireAuth,
  datasetUploadRateLimit,
  validateBody(GcsUrlBodySchema, "POST /api/datasets/upload/request-gcs-url"),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { fileName } = res.locals.parsedBody;
    const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      res.status(415).json({
        error: "unsupported_file_type",
        details: `Unsupported file type. Accepted: .csv, .txt, .xyz, .gz, .tif, .tiff, .nc, .las, .laz, .bag, .gpx, .nmea`,
      });
      return;
    }

    const userId = (req as AuthenticatedRequest).clerkUserId;
    const { uploadUrl, objectKey } = await signDatasetUploadUrl(userId, fileName);
    res.json(validateResponse(RequestGcsUploadUrlResponse, { uploadUrl, objectKey }, "POST /api/datasets/upload/request-gcs-url"));
  }),
);

// ── GET /datasets/upload/gcs-job-status ──────────────────────────────────────
// Returns the status of a GCS background-processing job by objectKey.
// The objectKey must belong to the authenticated user (userId is encoded in the
// key path: pending-datasets/<userId>/...).
//
// When the job is not in the in-memory activeJobs map (e.g. after a server
// restart), the handler first consults the persisted upload_jobs row (which
// carries datasetId/error across restarts), then falls back to checking GCS
// object metadata directly:
//   failed-datasets/    → { status: "failed",  error: "<message>" }
//   processed-datasets/ → { status: "complete" }
//   pending-datasets/   → { status: "pending" }
//   not found anywhere  → { status: "unknown", error: "…re-upload…" }
//
// GCS fallback results are cached for 30 s to avoid hammering GCS on every poll.
// Response: { status, datasetId?, error? }
router.get(
  "/datasets/upload/gcs-job-status",
  requireAuth,
  validateQuery(GcsJobStatusQuerySchema, "GET /api/datasets/upload/gcs-job-status", {
    details: "objectKey is required",
  }),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { objectKey } = res.locals.parsedQuery as { objectKey: string };

    // Verify the objectKey belongs to this user (second path segment)
    const userId = (req as AuthenticatedRequest).clerkUserId;
    const parts = objectKey.split("/");
    const ownerSegment = parts[1] ?? "";
    if (ownerSegment !== userId) {
      res.status(403).json({ error: "forbidden", details: "Object key does not belong to this user" });
      return;
    }

    const job = getJobByObjectKey(objectKey);
    if (!job) {
      // Not in memory — try the persisted upload_jobs row first (survives
      // server restarts and carries datasetId/error, which GCS probing
      // cannot recover).  Bucket rows are keyed by the uuid path segment.
      const dbId = bucketJobDbId(objectKey);
      if (dbId) {
        const [dbJob] = await db
          .select({
            userId: uploadJobsTable.userId,
            status: uploadJobsTable.status,
            error: uploadJobsTable.error,
            datasetId: uploadJobsTable.datasetId,
            objectKey: uploadJobsTable.objectKey,
          })
          .from(uploadJobsTable)
          .where(eq(uploadJobsTable.id, dbId));

        // Guard against uuid collisions with chunked-upload rows: only trust
        // a row that records this exact objectKey and owner.
        if (dbJob && dbJob.objectKey === objectKey && dbJob.userId === userId) {
          const payload =
            dbJob.status === "done"
              ? dbJob.datasetId
                // Fully recorded success — client can load the dataset directly.
                ? { status: "done", datasetId: dbJob.datasetId }
                // Success recorded without a dataset id (restart hit the tiny
                // window between GCS move and final persist) — report
                // "complete" so the client refreshes its dataset list.
                : { status: "complete" }
              : dbJob.status === "error"
                ? { status: "failed", ...(dbJob.error ? { error: dbJob.error } : {}) }
                // queued/processing — the startup rehydrator / scanner will
                // advance the job; the client should keep polling.
                : { status: dbJob.status };
          res.json(validateResponse(GetGcsJobStatusResponse, payload, "GET /api/datasets/upload/gcs-job-status"));
          return;
        }
      }

      // No usable DB row — fall back to GCS metadata (handles server restarts)
      const recovered = await recoverGcsJobStatus(objectKey);
      if (recovered.status === "unknown") {
        res.json(validateResponse(GetGcsJobStatusResponse, { status: "unknown", error: "Job not found — please re-upload your file." }, "GET /api/datasets/upload/gcs-job-status"));
      } else {
        res.json(validateResponse(GetGcsJobStatusResponse, {
          status: recovered.status,
          ...(recovered.error !== undefined ? { error: recovered.error } : {}),
        }, "GET /api/datasets/upload/gcs-job-status"));
      }
      return;
    }

    res.json(validateResponse(GetGcsJobStatusResponse, {
      status: job.status,
      ...(job.datasetId !== undefined ? { datasetId: job.datasetId } : {}),
      ...(job.error !== undefined ? { error: job.error } : {}),
      ...(job.skippedCount !== undefined ? { skippedCount: job.skippedCount } : {}),
      ...(job.skippedFormats !== undefined ? { skippedFormats: job.skippedFormats } : {}),
      ...(job.soundingCount !== undefined ? { soundingCount: job.soundingCount } : {}),
      ...(job.substrateCount !== undefined ? { substrateCount: job.substrateCount } : {}),
      ...(job.parseWarnings !== undefined ? { parseWarnings: job.parseWarnings } : {}),
    }, "GET /api/datasets/upload/gcs-job-status"));
  }),
);

// ── GET /datasets/upload/jobs/:jobId ─────────────────────────────────────────
// Returns the current state of a background upload-processing job.
// Only the user who created the job (via /chunk/finalize) can poll it.
// Falls back to the database when the job is not in the in-memory map (e.g.
// after a server restart) so the client always gets a meaningful response
// instead of a bare 404 / eternal spinner.
// Response: { status, progress, error?, datasetId? }
router.get(
  "/datasets/upload/jobs/:jobId",
  requireAuth,
  validateParams(JobIdParamSchema, "GET /api/datasets/upload/jobs/:jobId"),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { jobId } = res.locals.parsedParams as { jobId: string };
    const userId = (req as AuthenticatedRequest).clerkUserId;

    // Fast path: in-memory map (current process)
    const memJob = uploadJobs.get(jobId);
    if (memJob) {
      if (memJob.userId !== userId) {
        res.status(403).json({ error: "forbidden", details: "This job belongs to a different user." });
        return;
      }
      const isTerminal = memJob.status === "done" || memJob.status === "error";
      res.json(validateResponse(GetUploadJobStatusResponse, {
        status: memJob.status,
        progress: memJob.progress,
        ...(memJob.error !== undefined ? { error: memJob.error } : {}),
        ...(memJob.datasetId !== undefined ? { datasetId: memJob.datasetId } : {}),
        ...(memJob.skippedCount !== undefined ? { skippedCount: memJob.skippedCount } : {}),
        ...(memJob.skippedFormats !== undefined ? { skippedFormats: memJob.skippedFormats } : {}),
        ...(memJob.soundingCount !== undefined ? { soundingCount: memJob.soundingCount } : {}),
        ...(memJob.substrateCount !== undefined ? { substrateCount: memJob.substrateCount } : {}),
        ...(memJob.parseWarnings !== undefined ? { parseWarnings: memJob.parseWarnings } : {}),
        ...(!isTerminal && memJob.eta !== undefined ? { eta: memJob.eta } : {}),
        ...(!isTerminal
          ? { currentStageStartedAt: memJob.stageStartedAt?.toISOString() ?? null }
          : {}),
      }, "GET /api/datasets/upload/jobs/:jobId (memory)"));
      return;
    }

    // Slow path: check the database (handles server restarts / new processes)
    const rows = await db
      .select()
      .from(uploadJobsTable)
      .where(eq(uploadJobsTable.id, jobId));

    const dbJob = rows[0];
    if (!dbJob) {
      res.status(404).json({
        error: "not_found",
        details: "Job not found — please re-upload your file.",
      });
      return;
    }

    if (dbJob.userId !== userId) {
      res.status(403).json({ error: "forbidden", details: "This job belongs to a different user." });
      return;
    }
    if (dbJob.status === "uploading") {
      res.status(409).json({
        error: "upload_not_finalized",
        details: "This upload is still receiving chunks and has not been finalized.",
      });
      return;
    }

    const isDbTerminal = dbJob.status === "done" || dbJob.status === "error";
    res.json(validateResponse(GetUploadJobStatusResponse, {
      status: dbJob.status,
      progress: dbJob.progress,
      ...(dbJob.error !== null ? { error: dbJob.error } : {}),
      ...(dbJob.datasetId !== null ? { datasetId: dbJob.datasetId } : {}),
      ...(!isDbTerminal
        ? { currentStageStartedAt: dbJob.stageStartedAt?.toISOString() ?? null }
        : {}),
    }, "GET /api/datasets/upload/jobs/:jobId (db)"));
    // Note: skippedCount/skippedFormats are in-memory only and not persisted to
    // DB (they are cosmetic toast metadata, not durable state).  After a server
    // restart the fields are simply absent, which the frontend handles gracefully
    // by showing no skipped note.
    // Note: eta is also in-memory only (derived from stageTimestamps which are
    // ephemeral).  After a restart clients see currentStageStartedAt from DB
    // and can compute elapsed time themselves, but no ETA until re-queued.
  }),
);

export default router;
