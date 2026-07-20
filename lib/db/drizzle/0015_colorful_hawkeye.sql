CREATE TABLE "terrain_bundle_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"preset_id" text NOT NULL,
	"status" text NOT NULL,
	"progress_note" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "terrain_bundle_jobs_user_preset_uniq" UNIQUE("user_id","preset_id")
);
--> statement-breakpoint
CREATE INDEX "terrain_bundle_jobs_user_idx" ON "terrain_bundle_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "terrain_bundle_jobs_status_idx" ON "terrain_bundle_jobs" USING btree ("status");