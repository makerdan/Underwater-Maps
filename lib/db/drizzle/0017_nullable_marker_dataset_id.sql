-- Custom SQL migration file, put your code below! --

-- Make dataset_id nullable on markers so markers can be saved without a
-- dataset (dataset-free GPS import). Existing rows retain their current value.

--> statement-breakpoint
ALTER TABLE "markers" ALTER COLUMN "dataset_id" DROP NOT NULL;

--> statement-breakpoint
-- Index to support fast look-up of unassigned markers (dataset_id IS NULL)
-- within a user's account.
CREATE INDEX IF NOT EXISTS "markers_user_id_dataset_id_idx" ON "markers" USING btree ("user_id", "dataset_id");
