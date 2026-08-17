/**
 * backfill-water-type-and-datasource.ts
 *
 * One-time backfill for custom_datasets rows created before the freshwater
 * feature was added (before 2026-07-19):
 *
 *   1. `waterType` was not yet emitted by gridPoints(), so pre-freshwater
 *      terrainJson / overviewJson blobs lack the field entirely.  The correct
 *      value is resolved per row from the linked catalog save
 *      (user_catalog_saves.dataset_id → catalog_id → dataset_catalog row),
 *      with the mirrored preset registry as fallback when the catalog row is
 *      absent (see backfill-water-type-helpers.ts).  Only genuinely unlinked
 *      legacy rows default to "saltwater" — every *upload* that predates the
 *      freshwater feature is a saltwater/ocean dataset, but catalog saves may
 *      be freshwater (e.g. Lake Ray Roberts).
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
import {
  db,
  pool,
  customDatasetsTable,
  userCatalogSavesTable,
  datasetCatalogTable,
} from "../index.js";
import {
  needsBackfill,
  patchBlob,
  resolveLegacyWaterType,
} from "./backfill-water-type-helpers.js";

async function main() {
  const [rows, saves, catalogRows] = await Promise.all([
    db
      .select({
        id: customDatasetsTable.id,
        terrainJson: customDatasetsTable.terrainJson,
        overviewJson: customDatasetsTable.overviewJson,
      })
      .from(customDatasetsTable),
    db
      .select({
        datasetId: userCatalogSavesTable.datasetId,
        catalogId: userCatalogSavesTable.catalogId,
      })
      .from(userCatalogSavesTable),
    db
      .select({
        id: datasetCatalogTable.id,
        waterType: datasetCatalogTable.waterType,
      })
      .from(datasetCatalogTable),
  ]);

  const catalogIdByDatasetId = new Map<string, string>();
  for (const save of saves) {
    if (typeof save.datasetId === "string" && save.datasetId && typeof save.catalogId === "string" && save.catalogId) {
      catalogIdByDatasetId.set(save.datasetId, save.catalogId);
    }
  }
  const catalogWaterTypeById = new Map<string, string>(
    catalogRows.map((r) => [r.id, r.waterType]),
  );

  let scanned = 0;
  let updated = 0;

  for (const row of rows) {
    scanned++;

    const terrainNeedsFix = needsBackfill(row.terrainJson);
    const overviewNeedsFix = needsBackfill(row.overviewJson);

    if (!terrainNeedsFix && !overviewNeedsFix) continue;

    const catalogId = catalogIdByDatasetId.get(row.id);
    const waterType = resolveLegacyWaterType(catalogId, catalogWaterTypeById);

    const newTerrain = terrainNeedsFix
      ? patchBlob(row.terrainJson, waterType)
      : (row.terrainJson as unknown as Record<string, unknown>);
    const newOverview = overviewNeedsFix
      ? patchBlob(row.overviewJson, waterType)
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
      `[backfill] ${row.id}: terrain=${terrainNeedsFix ? "fixed" : "ok"} ` +
        `overview=${overviewNeedsFix ? "fixed" : "ok"} ` +
        `waterType=${waterType} (${catalogId ? `linked to ${catalogId}` : "no linked catalog save"})`,
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
