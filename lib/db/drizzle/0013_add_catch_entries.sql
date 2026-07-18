CREATE TABLE "catch_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marker_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"symbol_name" text DEFAULT '' NOT NULL,
	"notes" text,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catch_entries" ADD CONSTRAINT "catch_entries_marker_id_markers_id_fk" FOREIGN KEY ("marker_id") REFERENCES "public"."markers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catch_entries_marker_id_idx" ON "catch_entries" USING btree ("marker_id");--> statement-breakpoint
CREATE INDEX "catch_entries_user_id_idx" ON "catch_entries" USING btree ("user_id");
