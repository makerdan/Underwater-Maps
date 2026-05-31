import { inArray, and, eq } from "drizzle-orm";
import {
  db,
  pool,
  customDatasetsTable,
  userCatalogSavesTable,
  datasetFoldersTable,
} from "../index.js";

const EFH_DATASET_IDS = [
  "dc45ac7c-67cb-4f25-8685-c340ccafa8b9",
  "76f2c647-f5c9-4b91-804a-dc881a54f997",
  "d703e159-e17e-497c-9c52-25c1f9230e44",
  "02d56308-6654-4378-b7c8-f6b7aa14b2f8",
  "109d7ecb-7f16-44a0-9904-bc6e6d468d09",
];

const EFH_CATALOG_IDS = [
  "noaa-efh-alaska-pcod",
  "noaa-efh-alaska-halibut",
  "noaa-efh-alaska-rockfish",
  "noaa-efh-alaska-pollock",
  "noaa-efh-alaska-sablefish",
  "ncei-bag-mosaic-alaska",
  "noaa-enc-se-alaska",
];

const EFH_USER_ID = "user_3EC2yfBTNuDIhn2B4Z4FpnZfa9e";
const EFH_FOLDER_ID = "b249cda8-f68d-465f-97c3-bcafa6c51612";

async function main() {
  // Step 1: Delete the 5 synthetic EFH custom_datasets rows
  const deletedDatasets = await db
    .delete(customDatasetsTable)
    .where(inArray(customDatasetsTable.id, EFH_DATASET_IDS))
    .returning({ id: customDatasetsTable.id, name: customDatasetsTable.name });

  if (deletedDatasets.length === 0) {
    console.log("[purge] No EFH custom_datasets rows found — already cleaned up.");
  } else {
    console.log(`[purge] Deleted ${deletedDatasets.length} synthetic EFH dataset(s):`);
    for (const row of deletedDatasets) {
      console.log(`  - ${row.id} "${row.name}"`);
    }
  }

  // Step 2: Delete all 7 user_catalog_saves rows (5 EFH ready + 2 queued-never-materialized)
  const deletedSaves = await db
    .delete(userCatalogSavesTable)
    .where(
      and(
        eq(userCatalogSavesTable.userId, EFH_USER_ID),
        inArray(userCatalogSavesTable.catalogId, EFH_CATALOG_IDS),
      ),
    )
    .returning({ catalogId: userCatalogSavesTable.catalogId, status: userCatalogSavesTable.status });

  if (deletedSaves.length === 0) {
    console.log("[purge] No EFH user_catalog_saves rows found — already cleaned up.");
  } else {
    console.log(`[purge] Deleted ${deletedSaves.length} catalog save(s):`);
    for (const row of deletedSaves) {
      console.log(`  - ${row.catalogId} (${row.status})`);
    }
  }

  // Step 3: Delete the now-empty "EFH Species" folder
  const deletedFolders = await db
    .delete(datasetFoldersTable)
    .where(eq(datasetFoldersTable.id, EFH_FOLDER_ID))
    .returning({ id: datasetFoldersTable.id, name: datasetFoldersTable.name });

  if (deletedFolders.length === 0) {
    console.log('[purge] "EFH Species" folder not found — already cleaned up.');
  } else {
    console.log(`[purge] Deleted folder "${deletedFolders[0]?.name}" (${EFH_FOLDER_ID})`);
  }

  // Step 4: Verify final state
  const remainingDatasets = await db.select({ id: customDatasetsTable.id, name: customDatasetsTable.name }).from(customDatasetsTable);
  const remainingFolders = await db.select({ id: datasetFoldersTable.id, name: datasetFoldersTable.name }).from(datasetFoldersTable);
  const remainingSaves = await db
    .select({ catalogId: userCatalogSavesTable.catalogId, status: userCatalogSavesTable.status })
    .from(userCatalogSavesTable)
    .where(eq(userCatalogSavesTable.userId, EFH_USER_ID));

  console.log("\n[verify] Final state:");
  console.log(`  custom_datasets (${remainingDatasets.length}):`);
  for (const r of remainingDatasets) console.log(`    - ${r.id} "${r.name}"`);
  console.log(`  dataset_folders (${remainingFolders.length}):`);
  for (const r of remainingFolders) console.log(`    - ${r.id} "${r.name}"`);
  console.log(`  user_catalog_saves for ${EFH_USER_ID} (${remainingSaves.length}):`);
  for (const r of remainingSaves) console.log(`    - ${r.catalogId} (${r.status})`);

  const ok =
    remainingDatasets.length === 1 &&
    remainingDatasets[0]?.id.startsWith("6e25ba23") &&
    remainingFolders.length === 1 &&
    remainingFolders[0]?.name === "Southeast Alaska" &&
    remainingSaves.length === 1 &&
    remainingSaves[0]?.catalogId === "preset-thorne-bay";

  if (!ok) {
    console.error("[verify] UNEXPECTED STATE — manual review required.");
    process.exitCode = 1;
  } else {
    console.log("[verify] All checks passed.");
  }
}

main()
  .catch((err) => {
    console.error("[purge] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
