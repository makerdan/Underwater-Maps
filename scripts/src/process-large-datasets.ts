/**
 * process-large-datasets.ts — Script to process files in Large_Datasets/.
 *
 * Walks every object under the `Large_Datasets/` prefix in GCS (App Storage),
 * copies each one into `pending-datasets/<adminUserId>/<uuid>/<filename>`,
 * then calls the existing processObject() pipeline sequentially so each file
 * is parsed, gridded, and saved to the database under the admin user's account.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run process-large-datasets
 *
 * Options:
 *   --skip-processed   Skip any file that was already processed AND whose
 *                      content hash (MD5) and last-modified timestamp both
 *                      match what was recorded at import time.  If either
 *                      piece of metadata is unavailable the check falls back
 *                      to basename-only matching (legacy behaviour).
 *
 * Environment:
 *   DEFAULT_OBJECT_STORAGE_BUCKET_ID — required; the GCS bucket name.
 */

import * as path from "path";
import { gcsClient, processObject, getJobByObjectKey } from "../../artifacts/api-server/src/lib/bucketMonitor.js";

const ADMIN_USER_ID = "user_3CXNXKFCFdZJTtcdKojJO0Ia4xB";
const SOURCE_PREFIX = "Large_Datasets/";
const PROCESSED_PREFIX = "processed-datasets/";

/**
 * Custom GCS metadata keys written onto the pending-datasets copy so they are
 * preserved (GCS copy retains custom metadata) when moveGcsObject moves the
 * object into processed-datasets/.
 */
const META_SOURCE_MD5 = "x-goog-meta-source-md5";
const META_SOURCE_UPDATED = "x-goog-meta-source-updated";

function getBucketName(): string {
  const id = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!id) {
    throw new Error(
      "DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set. " +
        "Export it before running this script."
    );
  }
  return id;
}

/** Content-fingerprint recorded for an already-processed file. */
interface ProcessedFileInfo {
  /** Base64-encoded MD5 from GCS object metadata, if available. */
  md5Hash?: string;
  /** ISO-8601 last-modified timestamp, if available. */
  updated?: string;
}

async function copyGcsObject(
  bucketName: string,
  srcKey: string,
  destKey: string
): Promise<void> {
  const bucket = gcsClient.bucket(bucketName);
  await bucket.file(srcKey).copy(bucket.file(destKey));
}

/**
 * Stamps the source-file fingerprint as custom metadata on a GCS object.
 * This lets us later detect whether the source file has changed even though
 * the object has already been moved to processed-datasets/.
 */
async function stampSourceMetadata(
  bucketName: string,
  objectKey: string,
  md5Hash: string | undefined,
  updated: string | undefined
): Promise<void> {
  const custom: Record<string, string> = {};
  if (md5Hash) custom[META_SOURCE_MD5] = md5Hash;
  if (updated) custom[META_SOURCE_UPDATED] = updated;
  if (Object.keys(custom).length === 0) return;

  await gcsClient.bucket(bucketName).file(objectKey).setMetadata({ metadata: custom });
}

/**
 * Returns per-basename fingerprint info for every file that already exists
 * under the `processed-datasets/` prefix.  Used by --skip-processed.
 *
 * The custom metadata keys (META_SOURCE_MD5 / META_SOURCE_UPDATED) are written
 * by this script when each file is first imported.  For files imported before
 * this feature existed those keys will be absent, and the returned entry will
 * have undefined values — the caller falls back to basename-only matching.
 */
async function fetchProcessedFileInfo(
  bucketName: string
): Promise<Map<string, ProcessedFileInfo>> {
  const [files] = await gcsClient
    .bucket(bucketName)
    .getFiles({ prefix: PROCESSED_PREFIX });

  const result = new Map<string, ProcessedFileInfo>();
  for (const f of files) {
    if (f.name.endsWith("/")) continue;

    const basename = path.basename(f.name);
    const meta = (f.metadata as { metadata?: Record<string, string> }).metadata ?? {};

    result.set(basename, {
      md5Hash: meta[META_SOURCE_MD5],
      updated: meta[META_SOURCE_UPDATED],
    });
  }
  return result;
}

/**
 * Reads the GCS object metadata for a source file and returns its content
 * fingerprint (MD5 hash and last-modified timestamp).
 *
 * Both values come from GCS system metadata — no download required.
 */
async function getSourceFingerprint(
  bucketName: string,
  srcKey: string
): Promise<{ md5Hash?: string; updated?: string }> {
  try {
    const [meta] = await gcsClient.bucket(bucketName).file(srcKey).getMetadata();
    const m = meta as { md5Hash?: string; updated?: string };
    return { md5Hash: m.md5Hash, updated: m.updated };
  } catch {
    return {};
  }
}

/**
 * Determines whether a source file should be skipped because an identical
 * copy has already been processed.
 *
 * Priority:
 *   1. If source md5Hash matches the recorded md5Hash → skip.
 *   2. Else if source updated timestamp matches the recorded updated → skip.
 *   3. If neither piece of metadata is available → fall back to basename-only
 *      (legacy behaviour: skip if basename is in the processed set).
 *
 * Returns an object describing the decision so the caller can log it.
 */
function shouldSkip(
  fileName: string,
  sourceFingerprint: { md5Hash?: string; updated?: string },
  processedInfo: Map<string, ProcessedFileInfo>
): { skip: boolean; reason: string } {
  const recorded = processedInfo.get(fileName);
  if (!recorded) {
    return { skip: false, reason: "" };
  }

  // --- content-hash comparison ---
  if (sourceFingerprint.md5Hash && recorded.md5Hash) {
    if (sourceFingerprint.md5Hash === recorded.md5Hash) {
      return { skip: true, reason: "content hash matches" };
    }
    return {
      skip: false,
      reason: `content hash changed (was ${recorded.md5Hash.slice(0, 8)}…, now ${sourceFingerprint.md5Hash.slice(0, 8)}…)`,
    };
  }

  // --- last-modified timestamp comparison ---
  if (sourceFingerprint.updated && recorded.updated) {
    if (sourceFingerprint.updated === recorded.updated) {
      return { skip: true, reason: "last-modified timestamp matches" };
    }
    return {
      skip: false,
      reason: `last-modified changed (was ${recorded.updated}, now ${sourceFingerprint.updated})`,
    };
  }

  // --- fallback: basename-only (metadata unavailable) ---
  return { skip: true, reason: "basename match (no hash/timestamp metadata available)" };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const skipProcessed = args.includes("--skip-processed");

  const bucketName = getBucketName();

  console.log(`\n=== process-large-datasets ===`);
  console.log(`Bucket         : ${bucketName}`);
  console.log(`Prefix         : ${SOURCE_PREFIX}`);
  console.log(`Owner          : ${ADMIN_USER_ID}`);
  console.log(`Skip processed : ${skipProcessed}\n`);

  // If requested, collect already-processed file fingerprints up front.
  let processedInfo: Map<string, ProcessedFileInfo> = new Map();
  if (skipProcessed) {
    console.log("Fetching processed-datasets/ to find already-processed files…");
    processedInfo = await fetchProcessedFileInfo(bucketName);
    console.log(`  ${processedInfo.size} already-processed filename(s) found.\n`);
  }

  console.log("Listing objects…");
  const [files] = await gcsClient.bucket(bucketName).getFiles({ prefix: SOURCE_PREFIX });

  const objects = files.filter((f) => !f.name.endsWith("/"));

  if (objects.length === 0) {
    console.log("No files found under Large_Datasets/. Nothing to do.");
    return;
  }

  console.log(`Found ${objects.length} file(s) under Large_Datasets/.\n`);

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < objects.length; i++) {
    const srcKey = objects[i]!.name;
    const fileName = path.basename(srcKey);
    const label = `[${i + 1}/${objects.length}] ${fileName}`;

    if (skipProcessed) {
      // Read the source file's content fingerprint from GCS metadata
      // (no download — just a metadata API call).
      const sourceFingerprint = await getSourceFingerprint(bucketName, srcKey);
      const { skip, reason } = shouldSkip(fileName, sourceFingerprint, processedInfo);

      if (skip) {
        console.log(`${label} — skipped (${reason})`);
        skipped++;
        continue;
      } else if (reason) {
        // Basename was in processed set but content changed — explain why we re-process.
        console.log(`${label} — re-processing: ${reason}`);
      }
    }

    const uuid = crypto.randomUUID();
    const destKey = `pending-datasets/${ADMIN_USER_ID}/${uuid}/${fileName}`;

    process.stdout.write(`${label} — copying… `);

    let sourceFingerprint: { md5Hash?: string; updated?: string } = {};
    try {
      await copyGcsObject(bucketName, srcKey, destKey);

      // Read source fingerprint so we can stamp it onto the copy before
      // processObject() moves it to processed-datasets/.  GCS copy preserves
      // custom metadata, so the fingerprint will be readable on the
      // processed-datasets file on the next run.
      sourceFingerprint = await getSourceFingerprint(bucketName, srcKey);
      await stampSourceMetadata(
        bucketName,
        destKey,
        sourceFingerprint.md5Hash,
        sourceFingerprint.updated
      );

      process.stdout.write("processing… ");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`✗ failed to copy: ${reason}`);
      failed++;
      continue;
    }

    try {
      await processObject(bucketName, destKey);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`✗ failed: ${reason}`);
      failed++;
      continue;
    }

    const job = getJobByObjectKey(destKey);
    if (job?.status === "done") {
      console.log(`✔ done (datasetId: ${job.datasetId ?? "unknown"})`);
      succeeded++;
    } else {
      const reason = job?.error ?? "unknown error";
      console.log(`✗ failed: ${reason}`);
      failed++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Succeeded : ${succeeded}`);
  console.log(`  Skipped   : ${skipped}`);
  console.log(`  Failed    : ${failed}`);
  console.log(`  Total     : ${objects.length}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
