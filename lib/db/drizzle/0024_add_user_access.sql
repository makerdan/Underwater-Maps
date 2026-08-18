CREATE TYPE "public"."user_access_status" AS ENUM('pending', 'approved', 'banned');--> statement-breakpoint
CREATE TABLE "user_access" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"status" "user_access_status" DEFAULT 'pending' NOT NULL,
	"email" text,
	"display_name" text,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
