CREATE TABLE "raws_observation_cache" (
	"dataset_id" text PRIMARY KEY NOT NULL,
	"observation" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
