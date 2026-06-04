ALTER TABLE "upload_jobs" ADD COLUMN "upload_id" text;
--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "file_name" text;
--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "total_chunks" integer;
--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "chunks_received" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "resolution" integer;
--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "smoothing" boolean;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_jobs_upload_id_idx" ON "upload_jobs" USING btree ("upload_id");
