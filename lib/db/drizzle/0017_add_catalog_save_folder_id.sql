ALTER TABLE "user_catalog_saves" ADD COLUMN "folder_id" uuid REFERENCES "dataset_folders"("id") ON DELETE SET NULL;
