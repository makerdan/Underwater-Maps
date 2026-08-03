ALTER TABLE "user_catalog_saves" ADD COLUMN "request_bbox_json" text;--> statement-breakpoint
DROP INDEX IF EXISTS "user_catalog_saves_user_catalog_uniq";--> statement-breakpoint
CREATE INDEX "user_catalog_saves_user_catalog_idx" ON "user_catalog_saves" USING btree ("user_id","catalog_id");
