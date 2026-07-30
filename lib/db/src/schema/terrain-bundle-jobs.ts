import { pgTable, text, timestamp, uuid, unique, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Tracks on-demand bathymetry bundle download jobs, one per user+preset.
 *
 * Created by POST /api/terrain/bundles when no existing bundle exists
 * in GCS.  Updated by the background worker as the job progresses.
 * Status survives server restarts because the row persists in Postgres
 * even when the in-flight async job is lost on a process restart.
 *
 * GCS bundle path: users/{userId}/terrain/{presetId}.bundle.json
 *
 * Status flow: pending → running → complete | error
 *
 * Note: preset_id stores dataset/catalog identifiers (e.g. "gulf-of-maine-ncei")
 * from ALL_PRESET_DATASETS or seeded catalog entries, NOT trolling preset UUIDs.
 * It is deliberately kept as text to accommodate these string identifiers.
 */
export const terrainBundleJobsTable = pgTable(
  "terrain_bundle_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    presetId: text("preset_id").notNull(),
    status: text("status")
      .notNull()
      .$type<"pending" | "running" | "complete" | "error">(),
    progressNote: text("progress_note"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    unique("terrain_bundle_jobs_user_preset_uniq").on(
      table.userId,
      table.presetId,
    ),
    index("terrain_bundle_jobs_user_idx").on(table.userId),
    index("terrain_bundle_jobs_status_idx").on(table.status),
    check(
      "terrain_bundle_jobs_status_check",
      sql`${table.status} IN ('pending', 'running', 'complete', 'error')`,
    ),
  ],
);

export type TerrainBundleJob = typeof terrainBundleJobsTable.$inferSelect;
export type InsertTerrainBundleJob =
  typeof terrainBundleJobsTable.$inferInsert;
