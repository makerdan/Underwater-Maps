/**
 * backfill-water-type-and-datasource.ts
 *
 * One-time backfill for custom_datasets rows created before the freshwater
 * feature was added (before 2026-07-19):
 *
 *   1. `waterType` was not yet emitted by gridPoints(), so pre-freshwater
 *      terrainJson / overviewJson blobs lack the field entirely.  We default
 *      these rows to "saltwater" because every dataset that predates the
 *      freshwater feature is a saltwater/ocean dataset.
 *
 *   2. Some rows carry `dataSource: "synthetic"` — the fbm procedural fallback
 *      was removed and "synthetic" is no longer a valid enum value.  We delete
 *      the key so the optional field is simply absent.
 *
 * The script is idempotent: rows that are already correct are left untouched.
 *
 * Run with:
 *   pnpm --filter @workspace/db tsx src/scripts/backfill-water-type-and-datasource.ts
 */

import { sql } from "drizzle-orm";
import { db, pool, customDatasetsTable } from "../index.js";

const VALID_WATER_TYPES = new Set(["saltwater", "freshwater"]);

function needsBackfill(blob: unknown): boolean {
  const obj = (blob ?? {}) as Record<string, unknown>;
  if (!VALID_WATER_TYPES.has(obj["waterType"] as string)) return true;
  if (obj["dataSource"] === "synthetic") return true;
  return false;
}

function patchBlob(blob: unknown): Record<string, unknown> {
  const obj = (blob ?? {}) as Record<string, unknown>;
  const patched: Record<string, unknown> = { ...obj };

  if (!VALID_WATER_TYPES.has(patched["waterType"] as string)) {
    patched["waterType"] = "saltwater";
  }

  if (patched["dataSource"] === "synthetic") {
    delete patched["dataSource"];
  }

  return patched;
}

async function main() {
  const rows = await db
    .select({
      id: customDatasetsTable.id,
      terrainJson: customDatasetsTable.terrainJson,
      overviewJson: customDatasetsTable.overviewJson,
    })
    .from(customDatasetsTable);

  let scanned = 0;
  let updated = 0;

  for (const row of rows) {
    scanned++;

    const terrainNeedsFix = needsBackfill(row.terrainJson);
    const overviewNeedsFix = needsBackfill(row.overviewJson);

    if (!terrainNeedsFix && !overviewNeedsFix) continue;

    const newTerrain = terrainNeedsFix
      ? patchBlob(row.terrainJson)
      : (row.terrainJson as unknown as Record<string, unknown>);
    const newOverview = overviewNeedsFix
      ? patchBlob(row.overviewJson)
      : (row.overviewJson as unknown as Record<string, unknown>);

    await db
      .update(customDatasetsTable)
      .set({
        terrainJson: newTerrain as unknown as import("../schema/custom-datasets.js").StoredTerrainJson,
        overviewJson: newOverview as unknown as import("../schema/custom-datasets.js").StoredTerrainJson,
      })
      .where(sql`${customDatasetsTable.id} = ${row.id}`);

    updated++;
    console.log(
      `[backfill] ${row.id}: terrain=${terrainNeedsFix ? "fixed" : "ok"} overview=${overviewNeedsFix ? "fixed" : "ok"}`,
    );
  }

  console.log(`[backfill] done. scanned=${scanned} updated=${updated}`);
}

main()
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
