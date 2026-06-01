import { Router, type Request, type Response, type NextFunction } from "express";
import * as zlib from "zlib";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import multer from "multer";
import { eq, and, inArray, or } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { db, customDatasetsTable, userSettingsTable, uploadJobsTable, disabledPresetsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { createRateLimit } from "../middlewares/rateLimit.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { signDatasetUploadUrl, getJobByObjectKey, recoverGcsJobStatus } from "../lib/bucketMonitor.js";
import {
  GetDatasetsResponse,
  GetDatasetsIdTerrainResponse,
  GetDatasetsIdOverviewResponse,
  PostDatasetsUploadResponse,
} from "@workspace/api-zod";
import {
  ALL_PRESET_DATASETS,
  buildTerrainGrid,
  parseXyzCsv,
  gridPoints,
  previewDataset,
  previewBboxForDownload,
  buildBboxCsvRows,
  type TerrainGrid,
} from "../lib/terrain.js";
import { parseUploadedFile } from "../lib/uploadParsers.js";
import { gunzipBounded } from "../lib/gunzipBounded.js";
import { fetchCopernicusDem } from "../lib/copernicusDem.js";
import { fetchSatelliteTile } from "../lib/satelliteTile.js";
import { datasetZonesCache, readZoneDiskByHash, zoneCacheKey } from "./poe.js";
import { substrateFingerprintForDataset } from "../lib/substrateGrid.js";
import { registerCache } from "../lib/cacheRegistry.js";

// ─── Chunked-upload session + job stores ──────────────────────────────────────
// Sessions: keyed by uploadId, created on the first chunk, used to enforce
// that only the originating user can send subsequent chunks, finalize, or poll.
interface UploadSession {
  userId: string;
}
const uploadSessions = new Map<string, UploadSession>();
registerCache(() => uploadSessions.clear());

interface JobState {
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  error?: string;
  datasetId?: string;
  userId: string; // enforced on poll — only the owner can read job status
}
const uploadJobs = new Map<string, JobState>();
registerCache(() => uploadJobs.clear());

/**
 * Persist a job's durable fields (status, progress, error, datasetId) to the
 * database.  Called at key milestones so that a fresh server process can
 * reconstruct job state without the in-memory Map.
 *
 * Uses an upsert so it works for both initial creation and later updates.
 */
async function persistJobToDB(jobId: string, state: JobState): Promise<void> {
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
      })
      .onConflictDoUpdate({
        target: uploadJobsTable.id,
        set: {
          status: state.status,
          progress: state.progress,
          error: state.error ?? null,
          datasetId: state.datasetId ?? null,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    // Persistence failure is non-fatal during processing — the in-memory state
    // is still the source of truth for the current server process.
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[upload-job] persist failed { jobId: "${jobId}", status: "${state.status}", error: ${JSON.stringify(errMsg)} }`);
  }
}

/**
 * On server startup, scan the database for any upload jobs that are still
 * queued or processing (meaning the previous process was killed mid-flight).
 * Mark them as error so the client gets a clear "re-upload" message instead
 * of polling forever.
 *
 * Called once from the server's startup sequence in index.ts.
 */
export async function recoverStaleUploadJobs(): Promise<void> {
  try {
    const staleJobs = await db
      .select({ id: uploadJobsTable.id })
      .from(uploadJobsTable)
      .where(or(
        eq(uploadJobsTable.status, "queued"),
        eq(uploadJobsTable.status, "processing"),
      ));

    if (staleJobs.length === 0) return;

    const ids = staleJobs.map((j) => j.id);
    await db
      .update(uploadJobsTable)
      .set({
        status: "error",
        error: "Server restarted while this job was in progress — please re-upload your file.",
        updatedAt: new Date(),
      })
      .where(inArray(uploadJobsTable.id, ids));

    console.info(
      `[upload-jobs] marked ${ids.length} stale job(s) as error after restart`,
    );
  } catch (err) {
    // Non-fatal — the server continues; stale jobs will surface as 404 on poll
    // (still better than an eternal spinner) if the DB update fails.
    console.error("[upload-jobs] failed to recover stale jobs on startup:", err);
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
 * Purge the entire chunk staging directory on server startup.
 *
 * Any chunk files still present at startup belong to upload sessions that were
 * in flight when the previous process was killed — those jobs are already
 * marked "error" by recoverStaleUploadJobs() so no valid session can continue
 * to reference them. Removing the directory prevents unbounded /tmp growth.
 *
 * Called once from index.ts after the server begins listening.
 */
export async function cleanupStaleChunks(): Promise<void> {
  try {
    await fs.promises.rm(CHUNK_BASE_DIR, { recursive: true, force: true });
    console.info("[upload-chunks] purged stale chunk directory on startup");
  } catch (err) {
    // Non-fatal — worst case the orphaned files persist until the OS clears /tmp.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[upload-chunks] could not purge chunk directory: ${msg}`);
  }
}

async function cleanupChunks(uploadId: string, totalChunks: number): Promise<void> {
  for (let i = 0; i < totalChunks; i++) {
    const p = path.join(CHUNK_BASE_DIR, `${uploadId}-chunk-${i}`);
    await fs.promises.unlink(p).catch((err: unknown) => {
      const code = (err as { code?: string })?.code ?? "UNKNOWN";
      if (code !== "ENOENT") {
        console.warn(`[cleanup-chunks:${uploadId}] failed to unlink chunk ${i} (${p}): code=${code}`, err);
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
 *   40 → file read complete
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
 * @param onProgress Callback invoked with each progress milestone.
 */
export function runParseWorker(params: {
  filePath: string;
  fileName: string;
  resolution: number;
  gridId: string;
  datasetName: string;
  smoothing: boolean;
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
        void worker.terminate();
        resolve({ terrain: msg.terrain as ParseWorkerResult["terrain"], overview: msg.overview as ParseWorkerResult["overview"] });
      } else if (msg.type === "error" && typeof msg.message === "string") {
        if (settled) return;
        settled = true;
        // Terminate explicitly — the worker may still be running if it posted
        // the error via parentPort but hasn't exited its event loop yet.
        void worker.terminate();
        reject(new Error(msg.message));
      }
    });

    worker.on("error", (err) => {
      if (settled) return;
      settled = true;
      // An uncaught exception in the worker thread: terminate to guarantee the
      // OS thread is reclaimed, since it may not exit on its own after an error.
      void worker.terminate();
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

  const assembledPath = path.join(CHUNK_BASE_DIR, `${uploadId}-assembled`);
  const decompressedPath = `${assembledPath}-decompressed`;

  try {
    job.status = "processing";
    job.progress = 5;
    // Persist "processing" to DB so a future process knows this job started.
    await persistJobToDB(jobId, { ...job });

    // Stream chunks one-at-a-time into a single assembled file.
    // Peak RAM: one 5 MB chunk. No Buffer.concat across all chunks.
    await streamChunksToFile(uploadId, totalChunks, assembledPath);
    job.progress = 20;

    let processPath = assembledPath;

    if (fileName.toLowerCase().endsWith(".gz")) {
      // Stream-decompress with size guard; avoids full gz buffer in RAM.
      await streamGunzipToFile(assembledPath, decompressedPath, DECOMPRESS_MAX_BYTES);
      await fs.promises.unlink(assembledPath).catch(() => undefined);
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
    job.progress = 35;

    // Derive names before spawning the worker (cheap, main-thread-safe).
    const baseFileName = fileName.toLowerCase().endsWith(".gz") ? fileName.slice(0, -3) : fileName;
    const datasetName = baseFileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
    const gridId = crypto.randomUUID();

    // Delegate parse + gridPoints to a dedicated worker thread.
    // The main event loop is completely free during this await — the worker
    // runs in its own OS thread and posts progress milestones back here.
    const { terrain, overview } = await runParseWorker({
      filePath: processPath,
      fileName,
      resolution,
      gridId,
      datasetName,
      smoothing,
      onProgress: (p) => { job.progress = p; },
    });

    const [saved] = await db
      .insert(customDatasetsTable)
      .values({
        id: gridId,
        userId,
        name: datasetName,
        minDepth: terrain.minDepth,
        maxDepth: terrain.maxDepth,
        terrainJson: terrain as unknown as Record<string, unknown>,
        overviewJson: overview as unknown as Record<string, unknown>,
      })
      .returning({ id: customDatasetsTable.id });

    job.progress = 100;
    job.status = "done";
    job.datasetId = saved?.id ?? gridId;
    await persistJobToDB(jobId, { ...job });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Processing failed";
    job.status = "error";
    job.error = msg;
    console.error(`[chunk-job:${jobId}] failed:`, err);
    // Persist the error state so polls return a clear failure instead of a
    // stale "processing" status. The in-memory state is already "error" above,
    // so subsequent polls on this process will be correct even if the DB write
    // fails. persistJobToDB logs its own warning on failure.
    await persistJobToDB(jobId, { ...job });
  } finally {
    await cleanupChunks(uploadId, totalChunks);
    await fs.promises.unlink(assembledPath).catch(() => undefined);
    await fs.promises.unlink(decompressedPath).catch(() => undefined);
  }
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
        Object.assign(new Error(`Unsupported file type. Accepted: .csv, .txt, .xyz, .gz, .tif, .tiff, .nc, .las, .laz, .bag, .gpx, .nmea, .nme`), {
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
    console.warn(`[getSmoothingPreference] DB lookup failed for userId="${userId}", defaulting to true: ${errMsg}`);
    return true;
  }
}

// ── GET /datasets ─────────────────────────────────────────────────────────────
router.get("/datasets", asyncHandler(async (req, res): Promise<void> => {
  const rawWaterType = req.query["waterType"];
  const waterTypeFilter =
    rawWaterType === "freshwater" || rawWaterType === "saltwater"
      ? rawWaterType
      : null;

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

router.delete("/datasets/presets/:id", asyncHandler(async (req, res): Promise<void> => {
  const idParsed = PresetIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid preset id" });
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
const DatasetIdParamSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, "Dataset id must contain only alphanumeric characters, hyphens, or underscores");

router.get("/datasets/:id/terrain", terrainFetchIpRateLimit, terrainFetchUserRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const idParsed = DatasetIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid dataset id" });
    return;
  }
  const id = idParsed.data;
  const rawRes = req.query["resolution"];
  const resolution = rawRes ? Math.max(32, Math.min(512, parseInt(String(rawRes), 10))) : 256;

  const smoothing = await getSmoothingPreference(req);
  const grid = await buildTerrainGrid(id, resolution, { smoothing });
  if (!grid) {
    res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
    return;
  }
  res.json(GetDatasetsIdTerrainResponse.parse(grid));
}));

// ── GET /datasets/:id/preview ─────────────────────────────────────────────────
// Lightweight preflight: returns the resolved dataSource (ncei | gebco |
// synthetic) for a preset dataset without transferring the full depth grid.
// The client uses this to warn users before loading procedurally-generated
// (synthetic) bathymetry.
router.get("/datasets/:id/preview", asyncHandler(async (req, res): Promise<void> => {
  const idParsed = DatasetIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid dataset id" });
    return;
  }
  const id = idParsed.data;
  try {
    const preview = await previewDataset(id);
    if (!preview) {
      res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
      return;
    }
    res.json(preview);
  } catch (err) {
    // Preflight itself failed (rare — internal probes already catch). Always
    // return a graceful 200 with dataSource=unknown so the client can decide
    // whether to proceed; we do NOT gate on the preset registry here because
    // the registry is currently empty in production and user-saved catalog
    // entries should still get the same fallback shape.
    const meta = ALL_PRESET_DATASETS.find((d) => d.id === id);
    const msg = err instanceof Error ? err.message : "Preflight failed";
    res.json({
      datasetId: id,
      name: meta?.name ?? id,
      bbox: meta?.bbox ?? { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 },
      dataSource: "unknown" as const,
      syntheticReason: `Could not verify data source: ${msg}`,
    });
  }
}));

// ── GET /datasets/:id/overview ────────────────────────────────────────────────
router.get("/datasets/:id/overview", asyncHandler(async (req, res): Promise<void> => {
  const idParsed = DatasetIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid dataset id" });
    return;
  }
  const id = idParsed.data;

  const smoothing = await getSmoothingPreference(req);
  const grid = await buildTerrainGrid(id, 64, { smoothing });
  if (!grid) {
    res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
    return;
  }
  res.json(GetDatasetsIdOverviewResponse.parse(grid));
}));

// ── GET /datasets/:id/zones?h=<gridHash> ──────────────────────────────────────
// Returns the cached AI classification identified by gridHash (content hash of
// the depth grid). The :id path segment is used only for auth/ownership checks.
//
// Cache is keyed by gridHash, NOT by datasetId, which prevents collisions when
// multiple uploads share the synthetic datasetId "upload".
//
// Auth rules:
//  - Preset dataset IDs → public (no auth required)
//  - UUID-format IDs (user-saved datasets) → require auth + ownership check
//  - Other IDs ("upload", etc.) → require auth (no DB row to verify ownership)
router.get("/datasets/:id/zones", asyncHandler(async (req, res): Promise<void> => {
  const { id } = req.params as { id: string };
  const gridHash = (req.query["h"] as string | undefined) ?? "";
  const waterTypeRaw = (req.query["w"] as string | undefined) ?? "";

  // Accept either the legacy 8-char FNV-1a hex (for clients on older bundles
  // mid-rollout) or the new 64-char SHA-256 hex produced by the upgraded
  // client-side `hashGrid`. Both are valid lowercase-hex fingerprints; the
  // server then namespaces by waterType inside `zoneCacheKey`.
  const GRID_HASH_RE = /^([a-f0-9]{8}|[a-f0-9]{64})$/;
  if (!gridHash || !GRID_HASH_RE.test(gridHash)) {
    res.status(400).json({
      error: "invalid_param",
      details: "?h= must be a lowercase hex string (8 or 64 chars)",
    });
    return;
  }
  if (waterTypeRaw !== "saltwater" && waterTypeRaw !== "freshwater") {
    res
      .status(400)
      .json({ error: "invalid_param", details: "?w= must be 'saltwater' or 'freshwater'" });
    return;
  }
  const waterType = waterTypeRaw;

  // --- Auth / ownership gate ---
  const isPreset = ALL_PRESET_DATASETS.some((d) => d.id === id);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!isPreset) {
    // Only two non-preset ID shapes are recognised now that the bundled
    // presets have been retired: UUID-format saved uploads, and the
    // placeholder "upload" used for anonymous uploads. Anything else
    // (e.g. legacy preset IDs like `thorne-bay`) returns 404 cleanly so
    // the public /datasets/:id/* surface reflects an empty registry.
    if (!UUID_RE.test(id) && id !== "upload") {
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
    if (UUID_RE.test(id)) {
      const rows = await db
        .select({ userId: customDatasetsTable.userId })
        .from(customDatasetsTable)
        .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, callerId)));
      if (rows.length === 0) {
        // Either dataset doesn't exist or belongs to a different user
        res.status(403).json({ error: "forbidden", details: "Access denied" });
        return;
      }
    }
    // For "upload" placeholder ID, auth is sufficient; no DB row exists.
  }

  // --- Cache lookup by sha256(gridHash + "|" + waterType) ---
  // The zone cache only ever stores AI results — heuristic fallbacks are not
  // persisted — so every hit reports `source: "ai"`. We default the field on
  // the response so older cached entries written before the field existed
  const substrateFp = substrateFingerprintForDataset(id);
  // Under the new sha256-namespaced cache scheme there are no "bare gridHash"
  // legacy entries — the hydrate pass unlinks any non-64-char files on
  // startup — so we look up only the namespaced key. Datasets with no
  // substrate coverage collapse to fp "00000000", which still produces a
  // stable namespaced key, so behaviour is unchanged for uploads.
  const namespacedKey = zoneCacheKey(gridHash, waterType, substrateFp);
  const inMemory = datasetZonesCache.get(namespacedKey);
  if (inMemory && inMemory.waterType === waterType) {
    res.json({
      ...inMemory,
      source: inMemory.source ?? "ai",
      substrateFp,
      coarseWidth: inMemory.coarseWidth ?? 32,
      coarseHeight: inMemory.coarseHeight ?? 32,
    });
    return;
  }

  const onDisk = await readZoneDiskByHash(gridHash, waterType, substrateFp);
  if (onDisk && onDisk.waterType === waterType) {
    datasetZonesCache.set(namespacedKey, onDisk);
    res.json({
      ...onDisk,
      source: onDisk.source ?? "ai",
      substrateFp,
      coarseWidth: onDisk.coarseWidth ?? 32,
      coarseHeight: onDisk.coarseHeight ?? 32,
    });
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
  const rawBbox = String(req.query["bbox"] ?? "");
  const rawSize = req.query["size"];

  const parts = rawBbox.split(",").map((s) => parseFloat(s.trim()));
  if (
    parts.length !== 4 ||
    parts.some((v) => !isFinite(v))
  ) {
    res.status(400).json({
      error: "invalid_param",
      details: 'bbox must be "minLon,minLat,maxLon,maxLat" (four finite numbers)',
    });
    return;
  }

  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];

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

  const rawSizeNum = rawSize !== undefined ? parseInt(String(rawSize), 10) : 128;
  const gridSize = Math.max(32, Math.min(256, isNaN(rawSizeNum) ? 128 : rawSizeNum));

  try {
    const grid = await fetchCopernicusDem({ minLon, minLat, maxLon, maxLat }, gridSize);
    res.json(grid);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Land DEM fetch failed";
    res.status(502).json({ error: "upstream_error", details: msg });
  }
}));

// ── GET /terrain/satellite-tile ───────────────────────────────────────────────
// Proxies and caches a satellite/aerial imagery PNG from ESRI World Imagery
// for the given bounding box. The client uses this as a texture draped over
// the LandTerrainMesh so coastlines look photo-realistic instead of using the
// procedural green→brown→grey colour ramp.
//
// Query params:
//   bbox — comma-separated "minLon,minLat,maxLon,maxLat"
//   size — integer image resolution, clamped to [64, 1024] (default 512)
//
// No auth required — the underlying ESRI World Imagery service is public.
// Returns image/png on success; 502 on upstream failure (client falls back to
// procedural colour ramp gracefully).
router.get("/terrain/satellite-tile", asyncHandler(async (req, res): Promise<void> => {
  const rawBbox = String(req.query["bbox"] ?? "");
  const rawSize = req.query["size"];

  const parts = rawBbox.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length !== 4 || parts.some((v) => !isFinite(v))) {
    res.status(400).json({
      error: "invalid_param",
      details: 'bbox must be "minLon,minLat,maxLon,maxLat" (four finite numbers)',
    });
    return;
  }

  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];

  // An antimeridian-crossing bbox has minLon > maxLon (e.g. Bering Sea:
  // minLon=170, maxLon=-160). The lib/satelliteTile.ts helper handles the
  // split-and-composite automatically, so we allow minLon > maxLon here as
  // long as both values are valid longitudes in [-180, 180].  We only reject
  // the degenerate case where minLon === maxLon (zero-width bbox).
  if (
    minLon === maxLon ||
    minLat >= maxLat ||
    minLon < -180 || minLon > 180 ||
    maxLon < -180 || maxLon > 180 ||
    minLat < -90 ||
    maxLat > 90
  ) {
    res.status(400).json({
      error: "invalid_bbox",
      details: "bbox values out of range or degenerate",
    });
    return;
  }

  const rawSizeNum = rawSize !== undefined ? parseInt(String(rawSize), 10) : 512;
  const size = Math.max(64, Math.min(1024, isNaN(rawSizeNum) ? 512 : rawSizeNum));

  try {
    const imageBuffer = await fetchSatelliteTile({ minLon, minLat, maxLon, maxLat }, size);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("Content-Length", String(imageBuffer.length));
    res.end(imageBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Satellite tile fetch failed";
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
  const north = parseFloat(String(req.query["north"] ?? ""));
  const south = parseFloat(String(req.query["south"] ?? ""));
  const east  = parseFloat(String(req.query["east"] ?? ""));
  const west  = parseFloat(String(req.query["west"] ?? ""));

  if (
    !isFinite(north) || !isFinite(south) || !isFinite(east) || !isFinite(west) ||
    north <= south || east <= west ||
    north > 90 || south < -90 || east > 180 || west < -180
  ) {
    res.status(400).json({ error: "invalid_bbox", details: "Provide valid north, south, east, west query params." });
    return;
  }

  const dLon = east - west;
  const dLat = north - south;
  if (dLon > 10 || dLat > 10) {
    res.status(400).json({
      error: "bbox_too_large",
      details: `Bounding box must be at most 10° × 10° (got ${dLon.toFixed(2)}° × ${dLat.toFixed(2)}°).`,
    });
    return;
  }

  try {
    const info = await previewBboxForDownload({ north, south, east, west });
    res.json(info);
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
router.get("/terrain/download", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const north = parseFloat(String(req.query["north"] ?? ""));
  const south = parseFloat(String(req.query["south"] ?? ""));
  const east  = parseFloat(String(req.query["east"] ?? ""));
  const west  = parseFloat(String(req.query["west"] ?? ""));
  const rawRes = parseInt(String(req.query["resolution"] ?? "256"), 10);

  if (
    !isFinite(north) || !isFinite(south) || !isFinite(east) || !isFinite(west) ||
    north <= south || east <= west ||
    north > 90 || south < -90 || east > 180 || west < -180
  ) {
    res.status(400).json({ error: "invalid_bbox", details: "Provide valid north, south, east, west query params." });
    return;
  }

  const dLon = east - west;
  const dLat = north - south;
  if (dLon > 10 || dLat > 10) {
    res.status(400).json({
      error: "bbox_too_large",
      details: `Bounding box must be at most 10° × 10° (got ${dLon.toFixed(2)}° × ${dLat.toFixed(2)}°).`,
    });
    return;
  }

  const resolution = [64, 256, 512].includes(rawRes) ? rawRes : 256;
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
    decompressedBuffer = decompressed;
    fileContent = decompressed.toString("utf8");
  } else {
    fileContent = file.buffer.toString("utf8");
  }

  // Validate numeric body params via Zod so malformed values surface as a
  // clear 400 instead of falling through `parseInt` → `NaN` and producing a
  // 5xx from a downstream grid call.
  const UploadParamsSchema = z.object({
    resolution: z.coerce.number().int().min(32).max(512).default(256),
    gridResolution: z.coerce.number().int().min(32).max(512).optional(),
  });
  const paramsParsed = UploadParamsSchema.safeParse({
    resolution: req.body["resolution"] ?? req.body["gridResolution"],
    gridResolution: req.body["gridResolution"],
  });
  if (!paramsParsed.success) {
    res.status(400).json({
      error: "invalid_param",
      details: paramsParsed.error.issues
        .map((i) => `${i.path.join(".") || "param"}: ${i.message}`)
        .join("; "),
    });
    return;
  }
  const resolution = paramsParsed.data.gridResolution ?? paramsParsed.data.resolution;

  const TEXT_EXTENSIONS = new Set(["csv", "xyz", "txt"]);
  // Strip the outer .gz suffix before deriving the inner extension so that
  // text formats (csv/xyz/txt) compressed as .gz are correctly routed to
  // parseXyzCsv with the already-decompressed fileContent.
  const baseFileName = fileName.toLowerCase().endsWith(".gz") ? fileName.slice(0, -3) : fileName;
  const fileExt = baseFileName.toLowerCase().split(".").pop() ?? "";

  let points;
  try {
    if (TEXT_EXTENSIONS.has(fileExt)) {
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
  const datasetName = baseFileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
  const smoothing = await getSmoothingPreference(req);

  // Auth-gated: requireAuth above guarantees a clerkUserId is present.
  const effectiveUserId = (req as AuthenticatedRequest).clerkUserId;
  const gridId = crypto.randomUUID();

  const terrain = gridPoints(points, resolution, gridId, datasetName, { smoothing });
  const overview = gridPoints(points, 64, gridId, datasetName, { smoothing });

  let savedDatasetId: string | undefined;
  let savedDatasetMeta:
    | { id: string; name: string; minDepth: number; maxDepth: number; createdAt: string }
    | undefined;
  let saveError: string | undefined;

  try {
    const [saved] = await db
      .insert(customDatasetsTable)
      .values({
        id: gridId,
        userId: effectiveUserId,
        name: datasetName,
        minDepth: terrain.minDepth,
        maxDepth: terrain.maxDepth,
        terrainJson: terrain as unknown as Record<string, unknown>,
        overviewJson: overview as unknown as Record<string, unknown>,
      })
      .returning({
        id: customDatasetsTable.id,
        name: customDatasetsTable.name,
        minDepth: customDatasetsTable.minDepth,
        maxDepth: customDatasetsTable.maxDepth,
        createdAt: customDatasetsTable.createdAt,
      });
    if (saved) {
      savedDatasetId = saved.id;
      savedDatasetMeta = {
        id: saved.id,
        name: saved.name,
        minDepth: saved.minDepth,
        maxDepth: saved.maxDepth,
        createdAt: saved.createdAt.toISOString(),
      };
    } else {
      saveError = "Database insert returned no row";
      console.warn(
        `[datasets/upload] authenticated upload returned without savedDatasetId (userId=${effectiveUserId}, name=${datasetName})`,
      );
    }
  } catch (err) {
    saveError = err instanceof Error ? err.message : "Failed to save upload to account";
    console.error(
      `[datasets/upload] failed to persist authenticated upload (userId=${effectiveUserId}, name=${datasetName}):`,
      err,
    );
  }

  res.json(
    PostDatasetsUploadResponse.parse({
      terrain,
      overview,
      savedDatasetId,
      savedDatasetMeta,
      saveError,
    }),
  );
}));

// ── POST /datasets/upload/chunk ───────────────────────────────────────────────
// Receives one 5 MB slice of a large file. Fields (all required):
//   uploadId    — stable UUID chosen by the client for this upload session
//   chunkIndex  — 0-based index of this slice
//   totalChunks — total number of slices the client will send
//   file        — the binary slice (multipart/form-data)
// The first chunk (chunkIndex === 0) creates the upload session bound to the
// caller's userId. Subsequent chunks must come from the same authenticated user.
// Returns { received: chunkIndex }.
router.post(
  "/datasets/upload/chunk",
  requireAuth,
  uploadChunkMiddleware.single("file"),
  multerErrorHandler,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "missing_file", details: "No chunk data received." });
      return;
    }

    const uploadId = String(req.body["uploadId"] ?? "").trim();
    const chunkIndex = parseInt(String(req.body["chunkIndex"] ?? ""), 10);
    const totalChunks = parseInt(String(req.body["totalChunks"] ?? ""), 10);

    if (!uploadId || !/^[a-zA-Z0-9_-]{8,64}$/.test(uploadId)) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      res.status(400).json({ error: "invalid_param", details: "uploadId must be 8–64 alphanumeric characters." });
      return;
    }
    if (!isFinite(chunkIndex) || chunkIndex < 0) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      res.status(400).json({ error: "invalid_param", details: "chunkIndex must be a non-negative integer." });
      return;
    }
    if (!isFinite(totalChunks) || totalChunks < 1 || totalChunks > 4096) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      res.status(400).json({ error: "invalid_param", details: "totalChunks must be between 1 and 4096." });
      return;
    }

    const userId = (req as AuthenticatedRequest).clerkUserId;

    if (chunkIndex === 0) {
      // First chunk: create the upload session bound to this user.
      uploadSessions.set(uploadId, { userId });
    } else {
      // Subsequent chunks: verify ownership.
      const session = uploadSessions.get(uploadId);
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
    }

    // Rename the temp file to its canonical <uploadId>-chunk-<index> path
    const dest = path.join(CHUNK_BASE_DIR, `${uploadId}-chunk-${chunkIndex}`);
    try {
      await fs.promises.rename(file.path, dest);
    } catch {
      await fs.promises.unlink(file.path).catch(() => undefined);
      res.status(500).json({ error: "chunk_write_error", details: "Failed to store chunk." });
      return;
    }

    res.json({ received: chunkIndex });
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
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const FinalizeSchema = z.object({
      uploadId: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/, "Invalid uploadId"),
      fileName: z.string().min(1).max(255),
      totalChunks: z.coerce.number().int().min(1).max(4096),
      resolution: z.coerce.number().int().min(32).max(512).default(256),
    });
    const parsed = FinalizeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_param",
        details: parsed.error.issues.map((i) => `${i.path.join(".") || "param"}: ${i.message}`).join("; "),
      });
      return;
    }

    const { uploadId, fileName, totalChunks, resolution } = parsed.data;

    // Verify that all chunks are present before queuing
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(CHUNK_BASE_DIR, `${uploadId}-chunk-${i}`);
      const exists = await fs.promises.access(chunkPath).then(() => true).catch(() => false);
      if (!exists) {
        res.status(409).json({
          error: "missing_chunks",
          details: `Chunk ${i} of ${totalChunks} not yet received. Re-upload missing chunks and retry.`,
        });
        return;
      }
    }

    const userId = (req as AuthenticatedRequest).clerkUserId;

    // Verify session ownership before queuing
    const session = uploadSessions.get(uploadId);
    if (!session) {
      res.status(404).json({ error: "session_not_found", details: "Upload session not found. Re-upload from chunk 0." });
      return;
    }
    if (session.userId !== userId) {
      res.status(403).json({ error: "forbidden", details: "Upload session belongs to a different user." });
      return;
    }

    const smoothing = await getSmoothingPreference(req);
    const jobId = crypto.randomUUID();

    const initialState: JobState = { status: "queued", progress: 0, userId };
    uploadJobs.set(jobId, initialState);

    // Persist initial "queued" state to DB before firing the job so that if
    // the process dies immediately the row exists and can be recovered.
    await persistJobToDB(jobId, initialState);

    // Fire-and-forget — the client polls /jobs/:jobId
    void processUploadJob(jobId, uploadId, totalChunks, fileName, resolution, userId, smoothing);

    res.json({ jobId });
  }),
);

// ── POST /datasets/upload/request-gcs-url ────────────────────────────────────
// Auth-required. Generates a presigned GCS PUT URL for oversized files (>50 MB).
// The client uploads directly to GCS — the API server's memory is never involved.
// Body (JSON): { fileName: string }
// Returns: { uploadUrl, objectKey }
router.post(
  "/datasets/upload/request-gcs-url",
  requireAuth,
  datasetUploadRateLimit,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const BodySchema = z.object({
      fileName: z.string().min(1).max(255),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_param",
        details: parsed.error.issues.map((i) => `${i.path.join(".") || "param"}: ${i.message}`).join("; "),
      });
      return;
    }

    const { fileName } = parsed.data;
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
    res.json({ uploadUrl, objectKey });
  }),
);

// ── GET /datasets/upload/gcs-job-status ──────────────────────────────────────
// Returns the status of a GCS background-processing job by objectKey.
// The objectKey must belong to the authenticated user (userId is encoded in the
// key path: pending-datasets/<userId>/...).
//
// When the job is not in the in-memory activeJobs map (e.g. after a server
// restart), the handler falls back to checking GCS object metadata directly:
//   failed-datasets/    → { status: "failed",  error: "<message>" }
//   processed-datasets/ → { status: "complete" }
//   pending-datasets/   → { status: "pending" }
//   not found anywhere  → { status: "unknown", error: "…re-upload…" }
//
// Fallback results are cached for 30 s to avoid hammering GCS on every poll.
// Response: { status, datasetId?, error? }
router.get(
  "/datasets/upload/gcs-job-status",
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const objectKey = String(req.query["objectKey"] ?? "");
    if (!objectKey) {
      res.status(400).json({ error: "invalid_param", details: "objectKey is required" });
      return;
    }

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
      // Not in memory — fall back to GCS metadata (handles server restarts)
      const recovered = await recoverGcsJobStatus(objectKey);
      if (recovered.status === "unknown") {
        res.json({ status: "unknown", error: "Job not found — please re-upload your file." });
      } else {
        res.json({
          status: recovered.status,
          ...(recovered.error !== undefined ? { error: recovered.error } : {}),
        });
      }
      return;
    }

    res.json({
      status: job.status,
      ...(job.datasetId !== undefined ? { datasetId: job.datasetId } : {}),
      ...(job.error !== undefined ? { error: job.error } : {}),
    });
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
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const jobId = String(req.params["jobId"] ?? "");
    const userId = (req as AuthenticatedRequest).clerkUserId;

    // Fast path: in-memory map (current process)
    const memJob = uploadJobs.get(jobId);
    if (memJob) {
      if (memJob.userId !== userId) {
        res.status(403).json({ error: "forbidden", details: "This job belongs to a different user." });
        return;
      }
      res.json({
        status: memJob.status,
        progress: memJob.progress,
        ...(memJob.error !== undefined ? { error: memJob.error } : {}),
        ...(memJob.datasetId !== undefined ? { datasetId: memJob.datasetId } : {}),
      });
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

    res.json({
      status: dbJob.status,
      progress: dbJob.progress,
      ...(dbJob.error !== null ? { error: dbJob.error } : {}),
      ...(dbJob.datasetId !== null ? { datasetId: dbJob.datasetId } : {}),
    });
  }),
);

export default router;
