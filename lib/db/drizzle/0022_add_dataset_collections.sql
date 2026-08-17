CREATE TABLE "dataset_collection_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"dataset_id" uuid,
	"catalog_save_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dataset_collection_members_exactly_one_ref" CHECK (("dataset_collection_members"."dataset_id" IS NOT NULL) <> ("dataset_collection_members"."catalog_save_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "dataset_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dataset_collection_members" ADD CONSTRAINT "dataset_collection_members_collection_id_dataset_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."dataset_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_collection_members" ADD CONSTRAINT "dataset_collection_members_dataset_id_custom_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."custom_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_collection_members" ADD CONSTRAINT "dataset_collection_members_catalog_save_id_user_catalog_saves_id_fk" FOREIGN KEY ("catalog_save_id") REFERENCES "public"."user_catalog_saves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataset_collection_members_collection_idx" ON "dataset_collection_members" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "dataset_collection_members_dataset_idx" ON "dataset_collection_members" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "dataset_collection_members_save_idx" ON "dataset_collection_members" USING btree ("catalog_save_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_collection_members_dataset_uniq" ON "dataset_collection_members" USING btree ("collection_id","dataset_id") WHERE "dataset_collection_members"."dataset_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_collection_members_save_uniq" ON "dataset_collection_members" USING btree ("collection_id","catalog_save_id") WHERE "dataset_collection_members"."catalog_save_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "dataset_collections_user_id_idx" ON "dataset_collections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_collections_user_name_uniq" ON "dataset_collections" USING btree ("user_id",lower("name"));