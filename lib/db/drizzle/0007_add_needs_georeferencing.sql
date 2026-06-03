ALTER TABLE "custom_datasets" ADD COLUMN IF NOT EXISTS "needs_georeferencing" jsonb;
ALTER TABLE "custom_datasets" ADD COLUMN IF NOT EXISTS "pending_raster_gz_base64" text;
ALTER TABLE "custom_datasets" ADD COLUMN IF NOT EXISTS "georef_control_points_json" jsonb;
