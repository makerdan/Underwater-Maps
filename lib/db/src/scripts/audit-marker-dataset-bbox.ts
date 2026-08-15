/**
 * audit-marker-dataset-bbox.ts
 *
 * Audit: checks every marker whose `dataset_id IS NOT NULL` against
 * the coverage bbox of its referenced dataset (catalog or user-dataset).
 *
 * Default mode — read-only, prints a report to stdout, exits 0.
 *
 * Options:
 *   --ci            Exit with code 1 when any out-of-bounds or unknown-dataset
 *                   markers are found. Use this flag in CI / scheduled jobs so
 *                   the run fails when drift is detected.
 *   --fix           UPDATE out-of-bounds and unknown-dataset markers to
 *                   set dataset_id = NULL (they become unassigned).
 *   --fix --dry-run Print what would be updated without writing to the DB.
 *
 * Run manually:
 *   pnpm --filter @workspace/db audit:marker-bbox
 *   pnpm --filter @workspace/db audit:marker-bbox -- --fix
 *   pnpm --filter @workspace/db audit:marker-bbox -- --fix --dry-run
 *
 * Run in CI (fails when problems are found):
 *   pnpm --filter @workspace/db audit:marker-bbox -- --ci
 */

import { isNotNull, inArray } from "drizzle-orm";
import { db, pool, markersTable } from "../index.js";
import { classifyMarkers, ciExitCode, resolveBboxes } from "./audit-marker-dataset-bbox-helpers.js";

// ---------------------------------------------------------------------------
// Env-var guard
//
// The script requires a live DATABASE_URL. Rather than crashing with a
// connection error when invoked in an environment that has no DB (e.g. a
// plain CI job running unit tests), it exits 0 immediately unless
// AUDIT_MARKER_BBOX_ENABLED=1 is explicitly set by the caller.
//
// The registered `audit-marker-bbox` validation command omits this flag so
// it is a graceful no-op during normal per-task completion checks.
// The scheduled trigger (post-merge.sh) sets it so the audit actually runs.
// ---------------------------------------------------------------------------
if (!process.env["AUDIT_MARKER_BBOX_ENABLED"]) {
  console.log(
    "[audit] Skipped — set AUDIT_MARKER_BBOX_ENABLED=1 to enable. " +
    "Run via: AUDIT_MARKER_BBOX_ENABLED=1 pnpm --filter @workspace/db audit:marker-bbox -- --ci",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const FIX_MODE = args.includes("--fix");
const DRY_RUN = args.includes("--dry-run");
const CI_MODE = args.includes("--ci");
async function main() {
  // 1. Fetch all markers with a non-null datasetId
  const markers = await db
    .select({
      id: markersTable.id,
      userId: markersTable.userId,
      datasetId: markersTable.datasetId,
      lon: markersTable.lon,
      lat: markersTable.lat,
    })
    .from(markersTable)
    .where(isNotNull(markersTable.datasetId));

  console.log(`[audit] Total markers with dataset_id IS NOT NULL: ${markers.length}`);

  if (markers.length === 0) {
    console.log("[audit] Nothing to check.");
    return;
  }

  // 2. Collect unique dataset IDs and resolve their bboxes (batched)
  const uniqueDatasetIds = [...new Set(markers.map((m) => m.datasetId as string))];
  console.log(`[audit] Unique dataset IDs to resolve: ${uniqueDatasetIds.length}`);

  const bboxMap = await resolveBboxes(db, uniqueDatasetIds);

  const resolvedCount = [...bboxMap.values()].filter((v) => v !== null).length;
  const unresolvableCount = uniqueDatasetIds.length - resolvedCount;
  console.log(`[audit] Resolved: ${resolvedCount}  Unresolvable (dataset deleted): ${unresolvableCount}`);

  // 3. Classify markers (pure helper — no DB)
  const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);

  // 4. Print table of out-of-bounds + unknown markers
  const problematic = [...outOfBounds, ...unknownDataset];

  if (problematic.length > 0) {
    console.log("\n[audit] Out-of-bounds / unknown-dataset markers:");
    console.log(
      "  id".padEnd(38) +
      "userId".padEnd(32) +
      "datasetId".padEnd(38) +
      "lon".padEnd(14) +
      "lat".padEnd(14) +
      "bbox / status",
    );
    console.log("  " + "-".repeat(140));

    for (const marker of outOfBounds) {
      const bbox = bboxMap.get(marker.datasetId as string)!;
      const bboxStr = `[${bbox.minLon.toFixed(4)},${bbox.minLat.toFixed(4)},${bbox.maxLon.toFixed(4)},${bbox.maxLat.toFixed(4)}]`;
      console.log(
        `  ${marker.id.padEnd(36)} ${(marker.userId ?? "").padEnd(30)} ${(marker.datasetId ?? "").padEnd(36)} ${marker.lon.toFixed(6).padEnd(12)} ${marker.lat.toFixed(6).padEnd(12)} OUT-OF-BOUNDS bbox=${bboxStr}`,
      );
    }

    for (const marker of unknownDataset) {
      console.log(
        `  ${marker.id.padEnd(36)} ${(marker.userId ?? "").padEnd(30)} ${(marker.datasetId ?? "").padEnd(36)} ${marker.lon.toFixed(6).padEnd(12)} ${marker.lat.toFixed(6).padEnd(12)} UNKNOWN-DATASET (deleted)`,
      );
    }
  } else {
    console.log("\n[audit] All markers are within their dataset's bbox. ✓");
  }

  console.log(
    `\n[audit] Summary: ${outOfBounds.length} out-of-bounds, ${unknownDataset.length} with unknown dataset` +
    ` (${problematic.length} total problems out of ${markers.length} checked)`,
  );

  // 5. CI mode — non-zero exit when any findings exist
  const exitCode = ciExitCode(problematic.length, CI_MODE);
  if (exitCode !== 0) {
    console.error(
      `\n[audit] --ci: ${problematic.length} problem(s) found. Exiting with code 1.`,
    );
    process.exitCode = exitCode;
  }

  // 6. Fix mode
  if (FIX_MODE && problematic.length > 0) {
    if (DRY_RUN) {
      console.log(
        `\n[audit] --dry-run: would set dataset_id = NULL on ${problematic.length} marker(s). No writes performed.`,
      );
    } else {
      const ids = problematic.map((m) => m.id);
      const updated = await db
        .update(markersTable)
        .set({ datasetId: null })
        .where(inArray(markersTable.id, ids))
        .returning({ id: markersTable.id });

      console.log(`\n[audit] --fix: set dataset_id = NULL on ${updated.length} marker(s).`);
    }
  } else if (FIX_MODE && problematic.length === 0) {
    console.log("\n[audit] --fix: nothing to fix.");
  }
}

main()
  .catch((err) => {
    console.error("[audit] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
