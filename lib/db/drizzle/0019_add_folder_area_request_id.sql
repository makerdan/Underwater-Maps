ALTER TABLE "dataset_folders" ADD COLUMN "area_request_id" text;--> statement-breakpoint
CREATE INDEX "dataset_folders_area_request_idx" ON "dataset_folders" USING btree ("user_id","area_request_id");