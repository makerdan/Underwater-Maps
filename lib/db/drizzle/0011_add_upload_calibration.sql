CREATE TABLE "upload_calibration" (
  "extension" text PRIMARY KEY NOT NULL,
  "durations" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
