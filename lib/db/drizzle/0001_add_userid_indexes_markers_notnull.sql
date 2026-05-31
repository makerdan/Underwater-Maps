-- Custom SQL migration file, put your code below! --

-- Safety: remove any marker rows that have no owner before applying NOT NULL.
-- These rows would be invisible to auth checks and must not persist.
DELETE FROM "markers" WHERE "user_id" IS NULL;

--> statement-breakpoint
-- userId indexes for high-traffic user-scoped tables (listing queries)
CREATE INDEX IF NOT EXISTS "markers_user_id_idx" ON "markers" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_datasets_user_id_idx" ON "custom_datasets" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gps_trails_user_id_idx" ON "gps_trails" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routes_user_id_idx" ON "routes" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_catalog_saves_user_id_idx" ON "user_catalog_saves" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trolling_presets_user_id_idx" ON "trolling_presets" USING btree ("user_id");
--> statement-breakpoint
-- folderId index on trolling_presets (also missing; used in folder-listing queries)
CREATE INDEX IF NOT EXISTS "trolling_presets_folder_id_idx" ON "trolling_presets" USING btree ("folder_id");
--> statement-breakpoint
-- Enforce ownership: markers must always belong to a user
ALTER TABLE "markers" ALTER COLUMN "user_id" SET NOT NULL;
