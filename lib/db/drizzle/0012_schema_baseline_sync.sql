CREATE TABLE "poe_usage_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "poe_usage_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"model" text NOT NULL,
	"endpoint" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rate_limit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bucket_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" text NOT NULL,
	"lon" real NOT NULL,
	"lat" real NOT NULL,
	"depth" real NOT NULL,
	"type" text DEFAULT 'custom' NOT NULL,
	"label" text NOT NULL,
	"notes" text,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"min_depth" real NOT NULL,
	"max_depth" real NOT NULL,
	"terrain_json" jsonb NOT NULL,
	"overview_json" jsonb NOT NULL,
	"folder_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"hyd93_features_json" jsonb,
	"noaa_substrate_samples_json" jsonb,
	"needs_georeferencing" jsonb,
	"pending_raster_gz_base64" text,
	"georef_control_points_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "gps_trail_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trail_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"lon" real NOT NULL,
	"lat" real NOT NULL,
	"accuracy" real DEFAULT 0 NOT NULL,
	"recorded_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gps_trails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"name" text NOT NULL,
	"colour" text DEFAULT '#ff6600' NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp NOT NULL,
	"point_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source_agency" text NOT NULL,
	"data_type" text NOT NULL,
	"resolution_m_min" real,
	"resolution_m_max" real,
	"coverage_bbox" jsonb NOT NULL,
	"endpoint_url" text,
	"access_notes" text,
	"description" text,
	"keywords" text,
	"last_updated" text,
	"water_type" text DEFAULT 'saltwater' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_catalog_saves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"ready_at" timestamp,
	"cache_key" text,
	"error_message" text,
	"folder_id" uuid,
	"dataset_id" uuid
);
--> statement-breakpoint
CREATE TABLE "trolling_preset_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trolling_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"heading_deg" real NOT NULL,
	"speed_knots" real NOT NULL,
	"start_lat" real,
	"start_lon" real,
	"waypoints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"folder_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"name" text NOT NULL,
	"waypoints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"waypoint_count" integer DEFAULT 0 NOT NULL,
	"total_distance_m" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weather_station_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"result" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disabled_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"disabled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_calibration" (
	"extension" text PRIMARY KEY NOT NULL,
	"durations" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "upload_id" text;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "total_chunks" integer;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "chunks_received" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "resolution" integer;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "smoothing" boolean;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "stage_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dataset_folders" ADD CONSTRAINT "dataset_folders_parent_id_dataset_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."dataset_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_datasets" ADD CONSTRAINT "custom_datasets_folder_id_dataset_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."dataset_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_trail_points" ADD CONSTRAINT "gps_trail_points_trail_id_gps_trails_id_fk" FOREIGN KEY ("trail_id") REFERENCES "public"."gps_trails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_catalog_saves" ADD CONSTRAINT "user_catalog_saves_folder_id_dataset_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."dataset_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_catalog_saves" ADD CONSTRAINT "user_catalog_saves_dataset_id_custom_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."custom_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trolling_presets" ADD CONSTRAINT "trolling_presets_folder_id_trolling_preset_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."trolling_preset_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limit_events_bucket_created_idx" ON "rate_limit_events" USING btree ("bucket_key","created_at");--> statement-breakpoint
CREATE INDEX "rate_limit_events_created_at_idx" ON "rate_limit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "markers_user_id_idx" ON "markers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dataset_folders_user_id_idx" ON "dataset_folders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_folders_unique_sibling_name" ON "dataset_folders" USING btree ("user_id","parent_id",lower("name"));--> statement-breakpoint
CREATE INDEX "custom_datasets_user_id_idx" ON "custom_datasets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gps_trails_user_id_idx" ON "gps_trails" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_catalog_saves_user_id_idx" ON "user_catalog_saves" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trolling_preset_folders_user_id_idx" ON "trolling_preset_folders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trolling_preset_folders_unique_user_name" ON "trolling_preset_folders" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "trolling_presets_user_id_idx" ON "trolling_presets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trolling_presets_folder_id_idx" ON "trolling_presets" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "routes_user_id_idx" ON "routes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "upload_jobs_upload_id_idx" ON "upload_jobs" USING btree ("upload_id");