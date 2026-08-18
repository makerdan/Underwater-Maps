ALTER TABLE "dataset_collections" ADD COLUMN "collection_kind" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset_collections" ADD COLUMN "special_collection_meta" jsonb;--> statement-breakpoint
ALTER TABLE "dataset_collections" ADD CONSTRAINT "dataset_collections_kind_check" CHECK ("dataset_collections"."collection_kind" IN ('standard', 'special'));