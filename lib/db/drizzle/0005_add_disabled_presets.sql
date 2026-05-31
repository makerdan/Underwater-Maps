CREATE TABLE IF NOT EXISTS "disabled_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"disabled_at" timestamp DEFAULT now() NOT NULL
);
