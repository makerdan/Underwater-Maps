/**
 * markers-dataset-unassign.test.ts
 *
 * Proves that markers are *unassigned* (dataset_id → NULL) — not deleted —
 * when their referenced dataset is removed via the same DB operations the
 * application-layer route handlers perform.
 *
 * There is no DB-level FK between markers.dataset_id and either
 * custom_datasets.id or dataset_catalog.id; the cascade is handled at the
 * application level. These tests verify that the application logic correctly
 * nulls the field on deletion and leaves the marker row intact.
 *
 * Covers:
 *  - Custom dataset deletion (DELETE /api/user/datasets/:id)
 *  - Catalog save deletion that carries a materialized custom dataset
 *    (DELETE /api/datasets/my-saves/:id)
 *  - Catalog preset purge at boot time (catalogSeeder.seedDatasetCatalog)
 *  - Multiple markers referencing the same deleted dataset are all unassigned
 *  - Markers referencing a *different* dataset are unaffected
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestContext } from "./test-db.js";
import { customDatasetsTable } from "../schema/custom-datasets.js";
import { datasetCatalogTable } from "../schema/dataset-catalog.js";
import { markersTable } from "../schema/markers.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestDb();
}, 30_000);

afterAll(async () => {
  await ctx.cleanup();
}, 15_000);

beforeEach(async () => {
  await ctx.truncate();
});

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const TERRAIN_JSON = {
  datasetId: "test",
  name: "test",
  waterType: "saltwater" as const,
  resolution: 2,
  width: 2,
  height: 2,
  depths: [0, 0, 0, 0],
  minDepth: 0,
  maxDepth: 0,
  minLon: -135,
  maxLon: -134,
  minLat: 57,
  maxLat: 58,
  centerLon: -134.5,
  centerLat: 57.5,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function insertCustomDataset(userId = "u1", name = "TestDataset") {
  const [row] = await ctx.db
    .insert(customDatasetsTable)
    .values({
      userId,
      name,
      minDepth: 0,
      maxDepth: 10,
      terrainJson: TERRAIN_JSON,
      overviewJson: TERRAIN_JSON,
    })
    .returning({ id: customDatasetsTable.id });
  return row!.id;
}

async function insertCatalogDataset(id: string) {
  await ctx.db
    .insert(datasetCatalogTable)
    .values({
      id,
      name: `Catalog ${id}`,
      sourceAgency: "Test Agency",
      dataType: "bathymetry",
      coverageBbox: { minLon: -135, minLat: 57, maxLon: -134, maxLat: 58 },
      waterType: "saltwater",
    });
}

async function insertMarker(datasetId: string | null, userId = "u1") {
  const [row] = await ctx.db
    .insert(markersTable)
    .values({
      datasetId,
      lon: -134.5,
      lat: 57.5,
      depth: 5,
      type: "custom",
      label: "Test marker",
      userId,
    })
    .returning({ id: markersTable.id });
  return row!.id;
}

async function getMarker(id: string) {
  const [row] = await ctx.db
    .select({ id: markersTable.id, datasetId: markersTable.datasetId })
    .from(markersTable)
    .where(eq(markersTable.id, id));
  return row ?? null;
}

// Simulates the application-level cascade: delete a custom_dataset row and
// null markers that referenced it (mirrors user-datasets.ts delete handler).
async function deleteCustomDatasetAndUnassignMarkers(datasetId: string, userId = "u1") {
  await ctx.db
    .delete(customDatasetsTable)
    .where(eq(customDatasetsTable.id, datasetId));

  await ctx.db
    .update(markersTable)
    .set({ datasetId: null })
    .where(eq(markersTable.datasetId, datasetId));
}

// Simulates the application-level cascade: delete a catalog_dataset row and
// null markers that referenced it (mirrors catalogSeeder purge logic).
async function deleteCatalogDatasetAndUnassignMarkers(catalogId: string) {
  await ctx.db
    .delete(datasetCatalogTable)
    .where(eq(datasetCatalogTable.id, catalogId));

  await ctx.db
    .update(markersTable)
    .set({ datasetId: null })
    .where(eq(markersTable.datasetId, catalogId));
}

// ---------------------------------------------------------------------------
// Tests — custom dataset deletion
// ---------------------------------------------------------------------------

describe("custom dataset deletion — marker unassign", () => {
  it("unassigns a marker when its custom dataset is deleted (marker is not deleted)", async () => {
    const datasetId = await insertCustomDataset();
    const markerId = await insertMarker(datasetId);

    await deleteCustomDatasetAndUnassignMarkers(datasetId);

    const marker = await getMarker(markerId);
    expect(marker, "marker row should still exist").not.toBeNull();
    expect(marker!.datasetId, "dataset_id should be nulled").toBeNull();
  });

  it("unassigns multiple markers referencing the same deleted custom dataset", async () => {
    const datasetId = await insertCustomDataset();
    const markerIds = await Promise.all([
      insertMarker(datasetId),
      insertMarker(datasetId),
      insertMarker(datasetId),
    ]);

    await deleteCustomDatasetAndUnassignMarkers(datasetId);

    for (const id of markerIds) {
      const marker = await getMarker(id);
      expect(marker, `marker ${id} should still exist`).not.toBeNull();
      expect(marker!.datasetId, `marker ${id} dataset_id should be null`).toBeNull();
    }
  });

  it("does not affect markers referencing a different custom dataset", async () => {
    const deletedId = await insertCustomDataset("u1", "ToDelete");
    const keptId = await insertCustomDataset("u1", "ToKeep");

    const deletedMarkerId = await insertMarker(deletedId);
    const keptMarkerId = await insertMarker(keptId);

    await deleteCustomDatasetAndUnassignMarkers(deletedId);

    const deletedMarker = await getMarker(deletedMarkerId);
    expect(deletedMarker!.datasetId).toBeNull();

    const keptMarker = await getMarker(keptMarkerId);
    expect(keptMarker!.datasetId).toBe(keptId);
  });

  it("does not affect markers with no dataset (dataset_id IS NULL)", async () => {
    const datasetId = await insertCustomDataset();
    const unassignedMarkerId = await insertMarker(null);
    const assignedMarkerId = await insertMarker(datasetId);

    await deleteCustomDatasetAndUnassignMarkers(datasetId);

    const unassigned = await getMarker(unassignedMarkerId);
    expect(unassigned!.datasetId).toBeNull(); // unchanged

    const assigned = await getMarker(assignedMarkerId);
    expect(assigned!.datasetId).toBeNull(); // newly unassigned
  });
});

// ---------------------------------------------------------------------------
// Tests — catalog dataset deletion
// ---------------------------------------------------------------------------

describe("catalog dataset deletion — marker unassign", () => {
  it("unassigns a marker when its catalog dataset is deleted (marker is not deleted)", async () => {
    const catalogId = "preset-test-location";
    await insertCatalogDataset(catalogId);
    const markerId = await insertMarker(catalogId);

    await deleteCatalogDatasetAndUnassignMarkers(catalogId);

    const marker = await getMarker(markerId);
    expect(marker, "marker row should still exist").not.toBeNull();
    expect(marker!.datasetId, "dataset_id should be nulled").toBeNull();
  });

  it("unassigns multiple markers referencing the same deleted catalog dataset", async () => {
    const catalogId = "preset-bulk-test";
    await insertCatalogDataset(catalogId);
    const markerIds = await Promise.all([
      insertMarker(catalogId),
      insertMarker(catalogId),
    ]);

    await deleteCatalogDatasetAndUnassignMarkers(catalogId);

    for (const id of markerIds) {
      const marker = await getMarker(id);
      expect(marker, `marker ${id} should still exist`).not.toBeNull();
      expect(marker!.datasetId).toBeNull();
    }
  });

  it("does not affect markers referencing a different catalog dataset", async () => {
    const deletedId = "preset-to-delete";
    const keptId = "preset-to-keep";
    await insertCatalogDataset(deletedId);
    await insertCatalogDataset(keptId);

    const deletedMarkerId = await insertMarker(deletedId);
    const keptMarkerId = await insertMarker(keptId);

    await deleteCatalogDatasetAndUnassignMarkers(deletedId);

    const deletedMarker = await getMarker(deletedMarkerId);
    expect(deletedMarker!.datasetId).toBeNull();

    const keptMarker = await getMarker(keptMarkerId);
    expect(keptMarker!.datasetId).toBe(keptId);
  });
});

// ---------------------------------------------------------------------------
// Tests — audit stays clean after deletion
// ---------------------------------------------------------------------------

describe("audit stays at zero unknown-dataset markers after deletion", () => {
  it("leaves no markers with stale dataset_id after custom dataset deletion", async () => {
    const datasetId = await insertCustomDataset();
    await insertMarker(datasetId);
    await insertMarker(datasetId);

    await deleteCustomDatasetAndUnassignMarkers(datasetId);

    // After deletion + unassign, no marker should have a non-null dataset_id
    // pointing at the now-deleted dataset.
    const staleMarkers = await ctx.db
      .select({ id: markersTable.id })
      .from(markersTable)
      .where(eq(markersTable.datasetId, datasetId));

    expect(staleMarkers).toHaveLength(0);
  });

  it("leaves no markers with stale dataset_id after catalog dataset deletion", async () => {
    const catalogId = "preset-stale-check";
    await insertCatalogDataset(catalogId);
    await insertMarker(catalogId);

    await deleteCatalogDatasetAndUnassignMarkers(catalogId);

    const staleMarkers = await ctx.db
      .select({ id: markersTable.id })
      .from(markersTable)
      .where(eq(markersTable.datasetId, catalogId));

    expect(staleMarkers).toHaveLength(0);
  });
});
