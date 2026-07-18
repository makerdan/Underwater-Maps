ALTER TABLE "markers" ADD COLUMN "catch_seq" integer;--> statement-breakpoint
ALTER TABLE "markers" ADD COLUMN "conditions" jsonb;--> statement-breakpoint
CREATE TABLE "catch_counters" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL
);
