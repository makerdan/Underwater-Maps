/**
 * test-db.ts — Shared test-database setup for lib/db constraint tests.
 *
 * Creates a uniquely-named PostgreSQL schema per test run so that multiple
 * concurrent CI runs can coexist without table-name collisions.  All tables
 * are created fresh (without schema prefix in FK references so they resolve
 * within the isolated test schema) and the schema is dropped in cleanup.
 *
 * Usage:
 *   let ctx: TestContext;
 *   beforeAll(async () => { ctx = await createTestDb(); });
 *   afterAll(async () => { await ctx.cleanup(); });
 *   beforeEach(async () => { await ctx.truncate(); });
 */
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema/index.js";

const { Client } = pg;

export type TestDb = NodePgDatabase<typeof schema>;

export interface TestContext {
  db: TestDb;
  /** Drop all rows from the constraint-test tables (fast between-test isolation). */
  truncate: () => Promise<void>;
  /** Drop the entire test schema. Call in afterAll. */
  cleanup: () => Promise<void>;
}

/**
 * Spins up an isolated PostgreSQL schema with only the tables required for
 * constraint testing.  FK references use unqualified names so they resolve
 * inside the test schema rather than pointing back to `public.*`.
 *
 * Requires DATABASE_URL to be set in the environment.
 */
export async function createTestDb(): Promise<TestContext> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for lib/db constraint tests — ensure the database is provisioned",
    );
  }

  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 8);
  const schemaName = `test_db_constr_${ts}_${rnd}`;

  // Single client ensures SET search_path persists for the lifetime of the
  // connection — avoids the "pool.on('connect') is fire-and-forget" race.
  const client = new Client({ connectionString: url });
  await client.connect();

  await client.query(`CREATE SCHEMA "${schemaName}"`);
  await client.query(`SET search_path TO "${schemaName}"`);

  // Create only the tables needed for constraint tests, with FK references
  // written as unqualified names so they resolve within the test schema.
  await client.query(`
    CREATE TABLE dataset_folders (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     text NOT NULL,
      parent_id   uuid REFERENCES dataset_folders(id) ON DELETE CASCADE,
      name        text NOT NULL,
      area_request_id text,
      created_at  timestamp NOT NULL DEFAULT now(),
      updated_at  timestamp NOT NULL DEFAULT now()
    );

    -- Root-level folders (parent_id IS NULL): unique by (user_id, lower(name)).
    CREATE UNIQUE INDEX dataset_folders_root_name_uniq
      ON dataset_folders (user_id, lower(name))
      WHERE parent_id IS NULL;

    -- Non-root folders: unique by (user_id, parent_id, lower(name)).
    CREATE UNIQUE INDEX dataset_folders_child_name_uniq
      ON dataset_folders (user_id, parent_id, lower(name))
      WHERE parent_id IS NOT NULL;

    CREATE TABLE dataset_catalog (
      id                text PRIMARY KEY,
      name              text NOT NULL,
      source_agency     text NOT NULL,
      data_type         text NOT NULL,
      resolution_m_min  real,
      resolution_m_max  real,
      coverage_bbox     jsonb NOT NULL,
      endpoint_url      text,
      access_notes      text,
      description       text,
      keywords          text,
      last_updated      text,
      water_type        text NOT NULL DEFAULT 'saltwater',
      created_at        timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE custom_datasets (
      id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                     text NOT NULL,
      name                        text NOT NULL,
      min_depth                   real NOT NULL,
      max_depth                   real NOT NULL,
      terrain_json                jsonb NOT NULL,
      overview_json               jsonb NOT NULL,
      folder_id                   uuid REFERENCES dataset_folders(id) ON DELETE SET NULL,
      created_at                  timestamp NOT NULL DEFAULT now(),
      hyd93_features_json         jsonb,
      noaa_substrate_samples_json jsonb,
      needs_georeferencing        jsonb,
      pending_raster_gz_base64    text,
      georef_control_points_json  jsonb,
      tide_station_json           jsonb
    );

    CREATE TABLE user_catalog_saves (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           text NOT NULL,
      catalog_id        text NOT NULL,
      status            text NOT NULL DEFAULT 'queued',
      requested_at      timestamp NOT NULL DEFAULT now(),
      ready_at          timestamp,
      cache_key         text,
      error_message     text,
      display_label     text,
      folder_id         uuid REFERENCES dataset_folders(id) ON DELETE SET NULL,
      area_request_id   text,
      dataset_id        uuid REFERENCES custom_datasets(id) ON DELETE SET NULL,
      request_bbox_json text
    );

    -- Non-unique: mirrors the schema's index("user_catalog_saves_user_catalog_idx")
    -- which was intentionally changed from uniqueIndex so a user can save the same
    -- catalog entry for multiple terrain areas (different requestBboxJson tiles).
    CREATE INDEX user_catalog_saves_user_catalog_idx
      ON user_catalog_saves (user_id, catalog_id);

    CREATE TABLE dataset_collections (
      id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                  text NOT NULL,
      name                     text NOT NULL,
      collection_kind          text NOT NULL DEFAULT 'standard',
      special_collection_meta  jsonb,
      created_at               timestamp NOT NULL DEFAULT now(),
      updated_at               timestamp NOT NULL DEFAULT now(),
      CONSTRAINT dataset_collections_kind_check
        CHECK (collection_kind IN ('standard', 'special'))
    );

    CREATE INDEX dataset_collections_user_id_idx
      ON dataset_collections (user_id);

    -- Collection names are unique per user, case-insensitively.
    CREATE UNIQUE INDEX dataset_collections_user_name_uniq
      ON dataset_collections (user_id, lower(name));

    CREATE TABLE dataset_collection_members (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      collection_id   uuid NOT NULL REFERENCES dataset_collections(id) ON DELETE CASCADE,
      dataset_id      uuid REFERENCES custom_datasets(id) ON DELETE CASCADE,
      catalog_save_id uuid REFERENCES user_catalog_saves(id) ON DELETE CASCADE,
      created_at      timestamp NOT NULL DEFAULT now(),
      CONSTRAINT dataset_collection_members_exactly_one_ref
        CHECK ((dataset_id IS NOT NULL) <> (catalog_save_id IS NOT NULL))
    );

    CREATE INDEX dataset_collection_members_collection_idx
      ON dataset_collection_members (collection_id);
    CREATE INDEX dataset_collection_members_dataset_idx
      ON dataset_collection_members (dataset_id);
    CREATE INDEX dataset_collection_members_save_idx
      ON dataset_collection_members (catalog_save_id);

    -- A given dataset / catalog save appears at most once per collection.
    CREATE UNIQUE INDEX dataset_collection_members_dataset_uniq
      ON dataset_collection_members (collection_id, dataset_id)
      WHERE dataset_id IS NOT NULL;
    CREATE UNIQUE INDEX dataset_collection_members_save_uniq
      ON dataset_collection_members (collection_id, catalog_save_id)
      WHERE catalog_save_id IS NOT NULL;

    CREATE TABLE markers (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      dataset_id text,
      lon        real NOT NULL,
      lat        real NOT NULL,
      depth      real NOT NULL,
      type       text NOT NULL DEFAULT 'custom',
      label      text NOT NULL,
      notes      text,
      user_id    text NOT NULL,
      catch_seq  integer,
      conditions jsonb,
      geometry jsonb,
      created_at timestamp NOT NULL DEFAULT now(),
      expires_at timestamp
    );
  `);

  const db = drizzle(client, { schema });

  const truncate = async () => {
    await client.query(`
      TRUNCATE TABLE dataset_collection_members, dataset_collections, user_catalog_saves,
        markers, custom_datasets, dataset_folders, dataset_catalog
        RESTART IDENTITY CASCADE
    `);
  };

  const cleanup = async () => {
    const dropClient = new Client({ connectionString: url });
    await dropClient.connect();
    await dropClient.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await dropClient.end();
    await client.end();
  };

  return { db, truncate, cleanup };
}
