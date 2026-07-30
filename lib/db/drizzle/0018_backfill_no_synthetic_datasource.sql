-- Migration: back-fill and constrain synthetic dataSource values
-- Task #3177 removed "synthetic" from StoredTerrainJson.dataSource but left
-- no migration to clean up existing rows.  This migration:
--   1. Removes the dataSource key (sets it absent/null) in both terrain_json
--      and overview_json wherever the stored value is "synthetic".
--   2. Adds CHECK constraints so no future row can carry dataSource="synthetic".

-- ─── 1. Back-fill terrain_json ───────────────────────────────────────────────
UPDATE "custom_datasets"
  SET terrain_json = terrain_json - 'dataSource'
  WHERE terrain_json->>'dataSource' = 'synthetic';
--> statement-breakpoint

-- ─── 2. Back-fill overview_json ──────────────────────────────────────────────
UPDATE "custom_datasets"
  SET overview_json = overview_json - 'dataSource'
  WHERE overview_json->>'dataSource' = 'synthetic';
--> statement-breakpoint

-- ─── 3. Guard: reject dataSource = 'synthetic' going forward ─────────────────
ALTER TABLE "custom_datasets"
  ADD CONSTRAINT "custom_datasets_no_synthetic_terrain_datasource"
  CHECK ((terrain_json->>'dataSource') IS DISTINCT FROM 'synthetic');
--> statement-breakpoint

ALTER TABLE "custom_datasets"
  ADD CONSTRAINT "custom_datasets_no_synthetic_overview_datasource"
  CHECK ((overview_json->>'dataSource') IS DISTINCT FROM 'synthetic');
