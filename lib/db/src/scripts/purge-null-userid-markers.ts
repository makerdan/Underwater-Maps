import { isNull } from "drizzle-orm";
import { db, pool, markersTable } from "../index.js";

async function main() {
  const deleted = await db
    .delete(markersTable)
    .where(isNull(markersTable.userId))
    .returning({ id: markersTable.id });

  if (deleted.length === 0) {
    console.log("[purge] No orphaned markers found (userId IS NULL). Nothing to delete.");
  } else {
    console.log(`[purge] Deleted ${deleted.length} marker(s) with null userId:`);
    for (const row of deleted) {
      console.log(`  - ${row.id}`);
    }
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
