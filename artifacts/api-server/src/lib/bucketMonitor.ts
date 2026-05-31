/**
 * Bucket monitor — scans `pending-datasets/` every 30 s, processes any
 * unhandled objects (download → gunzip if needed → parse → grid → save),
 * then moves the object to `processed-datasets/` on success or
 * `failed-datasets/` with an error metadata tag on failure.
 *
 * Object key format:
 *   pending-datasets/<userId>/<uuid>/<filename>
 *
 * The owning userId is extracted from the second path segment so the saved
 * custom_dataset row belongs to the right user.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Storage } from "@google-cloud/storage";
import { db, customDatasetsTable } from "@workspace/db";
import { logger } from "./logger.js";
import { parseXyzCsv, gridPoints } from "./terrain.js";
import { parseUploadedFile } from "./uploadParsers.js";
import { registerCache } from "./cacheRegistry.js";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const gcsClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function getBucketName(): string {
  const id = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!id) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set");
  return id;
}

// ─── Presigned URL generation ──────────────────────────────────────────────

export async function signDatasetUploadUrl(
  userId: string,
  fileName: string,
): Promise<{ uploadUrl: string; objectKey: string }> {
  const uuid = crypto.randomUUID();
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectKey = `pending-datasets/${userId}/${uuid}/${safeName}`;
  const bucketName = getBucketName();

  const request = {
    bucket_name: bucketName,
    object_name: objectKey,
    method: "PUT",
    expires_at: new Date(Date.now() + 900_000).toISOString(), // 15 min
  };

  const resp = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!resp.ok) {
    throw new Error(
      `Failed to sign dataset upload URL: ${resp.status}`,
    );
  }

  const { signed_url: uploadUrl } = (await resp.json()) as { signed_url: string };
  return { uploadUrl, objectKey };
}

// ─── Job state ────────────────────────────────────────────────────────────

export interface BucketJob {
  objectKey: string;
  status: "processing" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  error?: string;
  userId?: string;
  datasetId?: string;
}

const activeJobs = new Map<string, BucketJob>();
registerCache(() => activeJobs.clear());

export function getJobByObjectKey(objectKey: string): BucketJob | undefined {
  return activeJobs.get(objectKey);
}

// ─── Processing pipeline ──────────────────────────────────────────────────

const DECOMPRESS_MAX_BYTES = 200 * 1024 * 1024;
const TEMP_DIR = path.join(os.tmpdir(), "bathyscan-gcs");
const TEXT_EXTENSIONS = new Set(["csv", "xyz", "txt"]);

async function streamGcsObjectToFile(
  bucketName: string,
  objectKey: string,
  destPath: string,
): Promise<void> {
  const file = gcsClient.bucket(bucketName).file(objectKey);
  await new Promise<void>((resolve, reject) => {
    const src = file.createReadStream();
    const dest = fs.createWriteStream(destPath);
    src.on("error", reject);
    dest.on("error", reject);
    dest.on("finish", resolve);
    src.pipe(dest);
  });
}

async function streamGunzip(srcPath: string, destPath: string): Promise<void> {
  const { createGunzip } = await import("zlib");
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let total = 0;

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      reject(err);
    }

    const src = fs.createReadStream(srcPath);
    const gunzip = createGunzip();
    const dest = fs.createWriteStream(destPath);

    gunzip.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > DECOMPRESS_MAX_BYTES) {
        const err = new Error("DECOMPRESS_TOO_LARGE");
        gunzip.destroy(err);
        dest.destroy();
        fail(err);
      }
    });

    src.on("error", fail);
    gunzip.on("error", fail);
    dest.on("error", fail);
    dest.on("finish", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });

    src.pipe(gunzip).pipe(dest);
  });
}

async function moveGcsObject(
  bucketName: string,
  srcKey: string,
  destKey: string,
  errorMsg?: string,
): Promise<void> {
  const bucket = gcsClient.bucket(bucketName);
  const srcFile = bucket.file(srcKey);

  if (errorMsg) {
    await srcFile.setMetadata({
      metadata: { "x-goog-meta-error": errorMsg.slice(0, 1024) },
    });
  }

  await srcFile.copy(bucket.file(destKey));
  await srcFile.delete();
}

async function processObject(bucketName: string, objectKey: string): Promise<void> {
  // Extract userId from path: pending-datasets/<userId>/<uuid>/<filename>
  const parts = objectKey.split("/");
  const userId = parts[1] ?? "unknown";
  const fileName = parts[parts.length - 1] ?? "file";

  const job: BucketJob = {
    objectKey,
    status: "processing",
    startedAt: Date.now(),
    userId,
  };
  activeJobs.set(objectKey, job);

  await fs.promises.mkdir(TEMP_DIR, { recursive: true });
  const tmpBase = path.join(TEMP_DIR, crypto.randomUUID());
  const downloadedPath = `${tmpBase}-downloaded`;
  const decompressedPath = `${tmpBase}-decompressed`;

  try {
    await streamGcsObjectToFile(bucketName, objectKey, downloadedPath);

    let processPath = downloadedPath;

    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith(".gz")) {
      await streamGunzip(downloadedPath, decompressedPath);
      processPath = decompressedPath;
    } else {
      const { size } = await fs.promises.stat(downloadedPath);
      if (size > DECOMPRESS_MAX_BYTES) {
        throw new Error(
          `File is ${Math.round(size / 1024 / 1024)} MB which exceeds the ` +
            `${Math.round(DECOMPRESS_MAX_BYTES / 1024 / 1024)} MB processing limit.`,
        );
      }
    }

    const baseName = lowerName.endsWith(".gz") ? fileName.slice(0, -3) : fileName;
    const ext = baseName.split(".").pop()?.toLowerCase() ?? "";

    let points;
    if (TEXT_EXTENSIONS.has(ext)) {
      const content = await fs.promises.readFile(processPath, "utf8");
      points = parseXyzCsv(content, fileName);
    } else {
      const raw = await fs.promises.readFile(processPath);
      points = await parseUploadedFile(raw, fileName);
    }

    if (points.length < 10) {
      throw new Error("File must contain at least 10 valid (lon, lat, depth) rows");
    }

    const datasetName = baseName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
    const gridId = crypto.randomUUID();
    const terrain = gridPoints(points, 256, gridId, datasetName, { smoothing: true });
    const overview = gridPoints(points, 64, gridId, datasetName, { smoothing: true });

    await db.insert(customDatasetsTable).values({
      id: gridId,
      userId,
      name: datasetName,
      minDepth: terrain.minDepth,
      maxDepth: terrain.maxDepth,
      terrainJson: terrain as unknown as Record<string, unknown>,
      overviewJson: overview as unknown as Record<string, unknown>,
    });

    const destKey = objectKey.replace(/^pending-datasets\//, "processed-datasets/");
    await moveGcsObject(bucketName, objectKey, destKey);

    job.status = "done";
    job.finishedAt = Date.now();
    job.datasetId = gridId;
    logger.info({ objectKey, userId, datasetId: gridId }, "[bucket-monitor] processed object");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Processing failed";
    job.status = "failed";
    job.finishedAt = Date.now();
    job.error = msg;

    try {
      const destKey = objectKey.replace(/^pending-datasets\//, "failed-datasets/");
      await moveGcsObject(bucketName, objectKey, destKey, msg);
    } catch (moveErr) {
      logger.warn({ objectKey, err: moveErr }, "[bucket-monitor] failed to move object to failed-datasets");
    }

    logger.error({ objectKey, userId, err }, "[bucket-monitor] processing error");
  } finally {
    await fs.promises.unlink(downloadedPath).catch(() => undefined);
    await fs.promises.unlink(decompressedPath).catch(() => undefined);
  }
}

// ─── Scanner ──────────────────────────────────────────────────────────────

const JOB_PRUNE_TTL_MS = 60 * 60 * 1000; // prune finished jobs after 1 hour

function pruneFinishedJobs(): void {
  const cutoff = Date.now() - JOB_PRUNE_TTL_MS;
  for (const [key, job] of activeJobs) {
    if ((job.status === "done" || job.status === "failed") && (job.finishedAt ?? 0) < cutoff) {
      activeJobs.delete(key);
    }
  }
}

async function scan(): Promise<void> {
  // Prune old finished jobs to keep memory bounded
  pruneFinishedJobs();

  const bucketName = getBucketName();

  let files;
  try {
    [files] = await gcsClient.bucket(bucketName).getFiles({ prefix: "pending-datasets/" });
  } catch (err) {
    logger.warn({ err }, "[bucket-monitor] scan failed (GCS list error)");
    return;
  }

  for (const file of files) {
    const key = file.name;
    // Skip "directory" placeholder objects
    if (key.endsWith("/")) continue;
    // Skip already-tracked jobs
    if (activeJobs.has(key)) continue;

    // Fire-and-forget — failures are recorded in the job map
    void processObject(bucketName, key);
  }
}

// ─── Admin status helper ──────────────────────────────────────────────────

export interface BucketStatusSummary {
  counts: { pending: number; processing: number; done: number; failed: number };
  pending: BucketObjectInfo[];
  processing: BucketObjectInfo[];
  done: BucketObjectInfo[];
  failed: BucketObjectInfo[];
}

export interface BucketObjectInfo {
  key: string;
  owner?: string;
  sizeBytes?: number;
  ageMs: number;
  error?: string;
}

function parseOwner(key: string): string | undefined {
  const parts = key.split("/");
  return parts[1] ?? undefined;
}

function ageMs(file: import("@google-cloud/storage").File): number {
  const updated = (file.metadata as { updated?: string })["updated"];
  if (!updated) return 0;
  return Date.now() - new Date(updated).getTime();
}

export async function getBucketStatus(): Promise<BucketStatusSummary> {
  const bucketName = getBucketName();
  const bucket = gcsClient.bucket(bucketName);

  const processingKeys = new Set(
    [...activeJobs.values()]
      .filter((j) => j.status === "processing")
      .map((j) => j.objectKey),
  );

  const [pendingFiles] = await bucket.getFiles({ prefix: "pending-datasets/" });
  const [processedFiles] = await bucket.getFiles({ prefix: "processed-datasets/" });
  const [failedFiles] = await bucket.getFiles({ prefix: "failed-datasets/" });

  const pending: BucketObjectInfo[] = [];
  const processing: BucketObjectInfo[] = [];

  for (const file of pendingFiles) {
    if (file.name.endsWith("/")) continue;
    const info: BucketObjectInfo = {
      key: file.name,
      owner: parseOwner(file.name),
      sizeBytes: Number((file.metadata as { size?: string | number })["size"] ?? 0),
      ageMs: ageMs(file),
    };
    if (processingKeys.has(file.name)) {
      processing.push(info);
    } else {
      pending.push(info);
    }
  }

  const done: BucketObjectInfo[] = processedFiles
    .filter((f) => !f.name.endsWith("/"))
    .map((f) => ({
      key: f.name,
      owner: parseOwner(f.name.replace(/^processed-datasets\//, "pending-datasets/")),
      sizeBytes: Number((f.metadata as { size?: string | number })["size"] ?? 0),
      ageMs: ageMs(f),
    }));

  const failed: BucketObjectInfo[] = failedFiles
    .filter((f) => !f.name.endsWith("/"))
    .map((f) => ({
      key: f.name,
      owner: parseOwner(f.name.replace(/^failed-datasets\//, "pending-datasets/")),
      sizeBytes: Number((f.metadata as { size?: string | number })["size"] ?? 0),
      ageMs: ageMs(f),
      error: (f.metadata as { metadata?: Record<string, string> })["metadata"]?.["x-goog-meta-error"],
    }));

  return {
    counts: {
      pending: pending.length,
      processing: processing.length,
      done: done.length,
      failed: failed.length,
    },
    pending,
    processing,
    done,
    failed,
  };
}

// ─── Startup ──────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS = 30_000;
let scanTimer: ReturnType<typeof setInterval> | null = null;

export function startBucketMonitor(): void {
  if (scanTimer) return;

  const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!bucketId) {
    logger.warn("[bucket-monitor] DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — monitor disabled");
    return;
  }

  logger.info({ bucket: bucketId, intervalMs: SCAN_INTERVAL_MS }, "[bucket-monitor] starting");

  // Initial scan shortly after startup, then every 30 s
  setTimeout(() => void scan(), 5_000);
  scanTimer = setInterval(() => void scan(), SCAN_INTERVAL_MS);
}
