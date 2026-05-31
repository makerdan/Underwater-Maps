import { pgTable, text, integer, timestamp, uuid, index } from "drizzle-orm/pg-core";

/**
 * Persists background upload-processing job state across server restarts.
 *
 * Created when a client calls POST /datasets/upload/chunk/finalize.
 * Updated at key milestones (processing start, done, error).
 * On server startup any rows still queued or processing are marked as error
 * so the client gets a clear "re-upload" message instead of an eternal spinner.
 *
 * Only the owning user (userId) can poll a job.
 */
export const uploadJobsTable = pgTable("upload_jobs", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  status: text("status").notNull().$type<"queued" | "processing" | "done" | "error">(),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  datasetId: uuid("dataset_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("upload_jobs_user_id_idx").on(table.userId),
  index("upload_jobs_status_idx").on(table.status),
]);

export type UploadJob = typeof uploadJobsTable.$inferSelect;
