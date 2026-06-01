import { sql } from "drizzle-orm";
import { db, pool, customDatasetsTable } from "../index.js";

async function main() {
  const rows = await db
    .select({
      id: customDatasetsTable.id,
      terrainJson: customDatasetsTable.terrainJson,
      overviewJson: customDatasetsTable.overviewJson,
    })
    .from(customDatasetsTable);

  let updated = 0;
  let scanned = 0;

  for (const row of rows) {
    scanned++;
    const terrain = ((row.terrainJson as unknown) ?? {}) as Record<string, unknown>;
    const overview = ((row.overviewJson as unknown) ?? {}) as Record<string, unknown>;

    // Per the task spec, only rewrite rows whose stored datasetId is the
    // legacy "upload" placeholder. Other mismatches are out of scope.
    const terrainNeedsFix = terrain["datasetId"] === "upload";
    const overviewNeedsFix = overview["datasetId"] === "upload";

    if (!terrainNeedsFix && !overviewNeedsFix) continue;

    const newTerrain = terrainNeedsFix ? { ...terrain, datasetId: row.id } : terrain;
    const newOverview = overviewNeedsFix ? { ...overview, datasetId: row.id } : overview;

    await db
      .update(customDatasetsTable)
      .set({
        terrainJson: newTerrain as unknown as import("../schema/custom-datasets.js").StoredTerrainJson,
        overviewJson: newOverview as unknown as import("../schema/custom-datasets.js").StoredTerrainJson,
      })
      .where(sql`${customDatasetsTable.id} = ${row.id}`);

    updated++;
    console.log(
      `[backfill] ${row.id}: terrain=${terrainNeedsFix ? "fixed" : "ok"} overview=${overviewNeedsFix ? "fixed" : "ok"}`
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
