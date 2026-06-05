import { pgTable, text, integer, boolean, timestamp, uuid, index } from "drizzle-orm/pg-core";

/**
 * Persists background upload-processing job state across server restarts.
 *
 * Created when a client calls POST /datasets/upload/chunk/finalize.
 * Updated at key milestones (processing start, done, error).
 *
 * The meta columns (uploadId … smoothing) replace the JSON sidecar files that
 * previously lived in /tmp so that recovery survives a full container restart
 * where the OS temp directory is wiped.
 *
 * On server startup any rows still queued or processing are inspected:
 *   - rows whose assembled source file still exists are re-queued
 *   - rows with no recoverable source are marked as error
 *
 * Only the owning user (userId) can poll a job.
 */
export const uploadJobsTable = pgTable("upload_jobs", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  status: text("status").notNull().$type<"uploading" | "queued" | "processing" | "done" | "error">(),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  datasetId: uuid("dataset_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

  // ── Chunk-upload recovery metadata (replaces JSON sidecar files) ──────────
  // Populated by the finalize route; used by recoverStaleUploadJobs() and the
  // chunk-status endpoint so container restarts don't lose upload context.
  uploadId: text("upload_id"),
  fileName: text("file_name"),
  totalChunks: integer("total_chunks"),
  chunksReceived: integer("chunks_received").default(0),
  resolution: integer("resolution"),
  smoothing: boolean("smoothing"),
  /**
   * ISO timestamp of the most recent processing milestone — recorded whenever
   * updateProgressWithEta() advances the job to a new stage.  Used to expose
   * `currentStageStartedAt` on the status endpoint so polls (and the DB-
   * fallback path after a server restart) can tell the client how long the
   * current stage has been running.
   */
  stageStartedAt: timestamp("stage_started_at", { withTimezone: true }),
}, (table) => [
  index("upload_jobs_user_id_idx").on(table.userId),
  index("upload_jobs_status_idx").on(table.status),
  index("upload_jobs_upload_id_idx").on(table.uploadId),
]);

export type UploadJob = typeof uploadJobsTable.$inferSelect;
