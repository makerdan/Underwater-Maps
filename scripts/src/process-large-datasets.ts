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
 *   --skip-processed   Skip any file whose basename already exists under the
 *                      `processed-datasets/` prefix, preventing duplicates when
 *                      re-running after new files are added to Large_Datasets/.
 *
 * Environment:
 *   DEFAULT_OBJECT_STORAGE_BUCKET_ID — required; the GCS bucket name.
 */

import * as path from "path";
import { gcsClient, processObject, getJobByObjectKey } from "../../artifacts/api-server/src/lib/bucketMonitor.js";

const ADMIN_USER_ID = "user_3CXNXKFCFdZJTtcdKojJO0Ia4xB";
const SOURCE_PREFIX = "Large_Datasets/";
const PROCESSED_PREFIX = "processed-datasets/";

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

async function copyGcsObject(
  bucketName: string,
  srcKey: string,
  destKey: string
): Promise<void> {
  const bucket = gcsClient.bucket(bucketName);
  await bucket.file(srcKey).copy(bucket.file(destKey));
}

/**
 * Returns the set of basenames (e.g. "survey.csv") that already exist under
 * the `processed-datasets/` prefix.  Used by --skip-processed.
 */
async function fetchProcessedBasenames(bucketName: string): Promise<Set<string>> {
  const [files] = await gcsClient
    .bucket(bucketName)
    .getFiles({ prefix: PROCESSED_PREFIX });

  const basenames = new Set<string>();
  for (const f of files) {
    if (!f.name.endsWith("/")) {
      basenames.add(path.basename(f.name));
    }
  }
  return basenames;
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

  // If requested, collect already-processed filenames up front.
  let processedBasenames: Set<string> = new Set();
  if (skipProcessed) {
    console.log("Fetching processed-datasets/ to find already-processed files…");
    processedBasenames = await fetchProcessedBasenames(bucketName);
    console.log(`  ${processedBasenames.size} already-processed filename(s) found.\n`);
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

    // --skip-processed: skip files whose basename is already in processed-datasets/
    if (skipProcessed && processedBasenames.has(fileName)) {
      console.log(`${label} — skipped (already processed)`);
      skipped++;
      continue;
    }

    const uuid = crypto.randomUUID();
    const destKey = `pending-datasets/${ADMIN_USER_ID}/${uuid}/${fileName}`;

    process.stdout.write(`${label} — copying… `);

    try {
      await copyGcsObject(bucketName, srcKey, destKey);
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
