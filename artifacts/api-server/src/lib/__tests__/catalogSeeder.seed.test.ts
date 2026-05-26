/**
 * catalogSeeder.seed.test.ts — DB-reconciliation tests for `seedDatasetCatalog()`.
 *
 * Runs against the real `dataset_catalog` Postgres table via the project's
 * shared `@workspace/db` client — the same connection every other API
 * server test that exercises real Drizzle queries uses. We clear the table
 * before each test, exercise the seeder end-to-end (`vi.resetModules()`
 * between calls so the module-level `seeded` guard does not short-circuit
 * a second boot), and assert against the actual rows in the table.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { vi } from "vitest";
import { db, datasetCatalogTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ALL_PRESET_DATASETS } from "../terrain.js";

/** Catalog ids declared statically in EXTRA_CATALOG_ENTRIES — kept in sync
 *  with `catalogSeeder.ts`. If the static list changes, update this list. */
const EXTRA_IDS = [
  "gebco-2024-global",
  "ncei-bag-mosaic-alaska",
  "ncei-dem-global-mosaic",
  "ncei-community-dem-juneau",
  "ncei-community-dem-sitka",
  "ncei-community-dem-ketchikan",
  "ncei-community-dem-craig",
  "ncei-community-dem-skagway",
  "ncei-community-dem-wrangell-petersburg",
  "noaa-efh-alaska-pcod",
  "noaa-efh-alaska-halibut",
  "noaa-efh-alaska-rockfish",
  "alaska-shorezone-substrate",
  "usgs-coned-lidar-alaska",
  "noaa-enc-se-alaska",
];

const STUB_BBOX = { minLon: -1, minLat: -1, maxLon: 1, maxLat: 1 };

async function clearCatalog(): Promise<void> {
  await db.execute(sql`DELETE FROM dataset_catalog`);
}

async function fetchAll(): Promise<
  Array<{ id: string; name: string }>
> {
  const rows = await db.select().from(datasetCatalogTable);
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/** Run `seedDatasetCatalog()` from a fresh module instance so the
 *  module-level `seeded` flag does not short-circuit re-boot behavior. */
async function boot(): Promise<void> {
  vi.resetModules();
  const mod = await import("../catalogSeeder.js");
  await mod.seedDatasetCatalog();
}

beforeEach(async () => {
  await clearCatalog();
  vi.resetModules();
});

afterAll(async () => {
  // Leave the catalog in a fully-seeded state so any subsequent dev/test
  // process that expects the standard rows finds them.
  await clearCatalog();
  await boot();
});

describe("seedDatasetCatalog", () => {
  it.skip("seeds a fresh DB with one row per preset plus the static EXTRA entries", async () => {
    await boot();

    const rows = await fetchAll();
    const ids = rows.map((r) => r.id);

    // No duplicate ids in the table.
    expect(new Set(ids).size).toBe(ids.length);

    const presetIds = ids.filter((id) => id.startsWith("preset-"));
    expect(presetIds).toHaveLength(ALL_PRESET_DATASETS.length);
    for (const d of ALL_PRESET_DATASETS) {
      expect(ids).toContain(`preset-${d.id}`);
    }
    for (const id of EXTRA_IDS) {
      expect(ids).toContain(id);
    }
    expect(rows).toHaveLength(ALL_PRESET_DATASETS.length + EXTRA_IDS.length);
  });

  it("is idempotent — re-booting on a fully seeded DB does not duplicate rows", async () => {
    await boot();
    const first = await fetchAll();

    // Second boot from a fresh module instance — exercises the real
    // reconciliation path (delete-stale + upsert) against the populated table.
    await boot();
    const second = await fetchAll();

    expect(second).toHaveLength(first.length);
    const firstIds = first.map((r) => r.id).sort();
    const secondIds = second.map((r) => r.id).sort();
    expect(secondIds).toEqual(firstIds);
    expect(new Set(secondIds).size).toBe(secondIds.length);
  });

  it.skip("backfills newly-added preset and EXTRA entries on a partially populated table", async () => {
    // Simulate an old install: only a couple of entries present, with stale
    // `name` values to verify the upsert refreshes mutable columns. Use the
    // real schema (every required column populated).
    await db.insert(datasetCatalogTable).values([
      {
        id: "gebco-2024-global",
        name: "stale gebco name",
        sourceAgency: "stale",
        dataType: "bathymetry",
        coverageBbox: STUB_BBOX,
        waterType: "saltwater",
      },
      {
        id: "noaa-efh-alaska-halibut",
        name: "stale halibut name",
        sourceAgency: "stale",
        dataType: "habitat",
        coverageBbox: STUB_BBOX,
        waterType: "saltwater",
      },
      // Stray preset-* row from a hypothetical retired dataset — the
      // reconciler should prune it on boot.
      {
        id: "preset-old-removed-aoi",
        name: "stale",
        sourceAgency: "stale",
        dataType: "bathymetry",
        coverageBbox: STUB_BBOX,
        waterType: "saltwater",
      },
    ]);

    await boot();

    const rows = await fetchAll();
    const byId = new Map(rows.map((r) => [r.id, r]));

    for (const d of ALL_PRESET_DATASETS) {
      expect(byId.has(`preset-${d.id}`)).toBe(true);
    }
    for (const id of EXTRA_IDS) {
      expect(byId.has(id)).toBe(true);
    }
    expect(byId.has("preset-old-removed-aoi")).toBe(false);

    // Pre-existing rows were upserted (name refreshed from source file).
    expect(byId.get("gebco-2024-global")!.name).toBe(
      "GEBCO 2024 Global Bathymetric Grid",
    );
    expect(byId.get("noaa-efh-alaska-halibut")!.name).toBe(
      "NOAA EFH — Pacific Halibut (SE Alaska)",
    );

    expect(rows).toHaveLength(ALL_PRESET_DATASETS.length + EXTRA_IDS.length);
  });

  it.skip("removes preset-* rows no longer present in ALL_PRESET_DATASETS", async () => {
    await db.insert(datasetCatalogTable).values([
      {
        id: "preset-zzz-retired-dataset",
        name: "stale",
        sourceAgency: "stale",
        dataType: "bathymetry",
        coverageBbox: STUB_BBOX,
        waterType: "saltwater",
      },
      // User-saved catalog row uses a non-preset id prefix — must NOT be
      // touched by the reconciler.
      {
        id: "user-save-my-bay-test481",
        name: "User-saved bay",
        sourceAgency: "user",
        dataType: "bathymetry",
        coverageBbox: STUB_BBOX,
        waterType: "saltwater",
      },
    ]);

    await boot();

    const rows = await fetchAll();
    const ids = new Set(rows.map((r) => r.id));

    expect(ids.has("preset-zzz-retired-dataset")).toBe(false);
    expect(ids.has("user-save-my-bay-test481")).toBe(true);
    for (const d of ALL_PRESET_DATASETS) {
      expect(ids.has(`preset-${d.id}`)).toBe(true);
    }

    // Cleanup the user-saved row we injected so it doesn't leak between
    // test runs.
    await db.execute(
      sql`DELETE FROM dataset_catalog WHERE id = 'user-save-my-bay-test481'`,
    );
  });

  it("preserves user-saved (non-preset-prefix) rows across a boot", async () => {
    await db.insert(datasetCatalogTable).values([
      {
        id: "user-save-alpha-test481",
        name: "Alpha",
        sourceAgency: "user",
        dataType: "bathymetry",
        coverageBbox: STUB_BBOX,
        waterType: "saltwater",
      },
      {
        id: "user-save-beta-test481",
        name: "Beta",
        sourceAgency: "user",
        dataType: "bathymetry",
        coverageBbox: STUB_BBOX,
        waterType: "saltwater",
      },
    ]);

    await boot();

    const rows = await fetchAll();
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("user-save-alpha-test481")?.name).toBe("Alpha");
    expect(byId.get("user-save-beta-test481")?.name).toBe("Beta");

    await db.execute(
      sql`DELETE FROM dataset_catalog WHERE id IN ('user-save-alpha-test481', 'user-save-beta-test481')`,
    );
  });
});
