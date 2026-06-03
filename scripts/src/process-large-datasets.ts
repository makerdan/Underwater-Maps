/**
 * process-large-datasets.ts — One-time script to process files in Large_Datasets/.
 *
 * Walks every object under the `Large_Datasets/` prefix in GCS (App Storage),
 * copies each one into `pending-datasets/<adminUserId>/<uuid>/<filename>`,
 * then calls the existing processObject() pipeline sequentially so each file
 * is parsed, gridded, and saved to the database under the admin user's account.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run process-large-datasets
 *
 * Environment:
 *   DEFAULT_OBJECT_STORAGE_BUCKET_ID — required; the GCS bucket name.
 */

import * as path from "path";
import { gcsClient, processObject, getJobByObjectKey } from "../../artifacts/api-server/src/lib/bucketMonitor.js";

const ADMIN_USER_ID = "user_3CXNXKFCFdZJTtcdKojJO0Ia4xB";
const SOURCE_PREFIX = "Large_Datasets/";

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

async function main(): Promise<void> {
  const bucketName = getBucketName();

  console.log(`\n=== process-large-datasets ===`);
  console.log(`Bucket : ${bucketName}`);
  console.log(`Prefix : ${SOURCE_PREFIX}`);
  console.log(`Owner  : ${ADMIN_USER_ID}\n`);

  console.log("Listing objects…");
  const [files] = await gcsClient.bucket(bucketName).getFiles({ prefix: SOURCE_PREFIX });

  const objects = files.filter((f) => !f.name.endsWith("/"));

  if (objects.length === 0) {
    console.log("No files found under Large_Datasets/. Nothing to do.");
    return;
  }

  console.log(`Found ${objects.length} file(s) to process.\n`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < objects.length; i++) {
    const srcKey = objects[i]!.name;
    const fileName = path.basename(srcKey);
    const uuid = crypto.randomUUID();
    const destKey = `pending-datasets/${ADMIN_USER_ID}/${uuid}/${fileName}`;
    const label = `[${i + 1}/${objects.length}] ${fileName}`;

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
