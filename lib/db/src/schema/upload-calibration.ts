import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Persists per-extension upload throughput history across server restarts.
 *
 * One row per file extension (e.g. ".laz", ".gz", ".nc").  The `durations`
 * column is an ordered JSON array of the last CALIBRATION_MAX_SAMPLES total
 * job durations in milliseconds, newest last.  On startup the API server
 * reads this table into its in-memory `extensionDurationHistory` map so ETA
 * estimates are available from the very first job after a restart.
 *
 * Rows are upserted (debounced) after every completed upload job so the table
 * stays current without hammering the DB on high-throughput periods.
 */
export const uploadCalibrationTable = pgTable("upload_calibration", {
  extension: text("extension").primaryKey(),
  durations: jsonb("durations").notNull().$type<number[]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UploadCalibration = typeof uploadCalibrationTable.$inferSelect;
