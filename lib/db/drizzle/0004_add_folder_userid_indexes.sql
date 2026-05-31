-- userId indexes for folder tables (listing-by-user queries)
CREATE INDEX IF NOT EXISTS "dataset_folders_user_id_idx" ON "dataset_folders" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trolling_preset_folders_user_id_idx" ON "trolling_preset_folders" USING btree ("user_id");
