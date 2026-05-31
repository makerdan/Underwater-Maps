CREATE TABLE "upload_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" text,
	"dataset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "upload_jobs_user_id_idx" ON "upload_jobs" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "upload_jobs_status_idx" ON "upload_jobs" USING btree ("status");
