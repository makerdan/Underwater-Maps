/**
 * user-catalog-saves.test.ts — DB-level FK constraint tests for the
 * user_catalog_saves table.
 *
 * Covers:
 *  - folderId FK: valid insert, ON DELETE SET NULL from dataset_folders
 *  - datasetId FK: valid insert, ON DELETE SET NULL from custom_datasets
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestContext } from "./test-db.js";
import { datasetFoldersTable } from "../schema/dataset-folders.js";
import { customDatasetsTable } from "../schema/custom-datasets.js";
import { userCatalogSavesTable } from "../schema/user-catalog-saves.js";

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
  minLon: -1,
  maxLon: 1,
  minLat: -1,
  maxLat: 1,
  centerLon: 0,
  centerLat: 0,
};

async function insertFolder(userId = "u1", name = "TestFolder") {
  const [row] = await ctx.db
    .insert(datasetFoldersTable)
    .values({ userId, name })
    .returning({ id: datasetFoldersTable.id });
  return row!.id;
}

async function insertDataset(userId = "u1") {
  const [row] = await ctx.db
    .insert(customDatasetsTable)
    .values({
      userId,
      name: "TestDataset",
      minDepth: 0,
      maxDepth: 10,
      terrainJson: TERRAIN_JSON,
      overviewJson: TERRAIN_JSON,
    })
    .returning({ id: customDatasetsTable.id });
  return row!.id;
}

async function insertSave(overrides?: {
  folderId?: string | null;
  datasetId?: string | null;
}) {
  const [row] = await ctx.db
    .insert(userCatalogSavesTable)
    .values({
      userId: "u1",
      catalogId: "cat-123",
      folderId: overrides?.folderId ?? null,
      datasetId: overrides?.datasetId ?? null,
    })
    .returning({ id: userCatalogSavesTable.id });
  return row!.id;
}

describe("user_catalog_saves — folderId FK (ON DELETE SET NULL)", () => {
  it("accepts a save with a valid folderId", async () => {
    const folderId = await insertFolder();
    const saveId = await insertSave({ folderId });

    const [save] = await ctx.db
      .select({ folderId: userCatalogSavesTable.folderId })
      .from(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.id, saveId));

    expect(save!.folderId).toBe(folderId);
  });

  it("sets folderId to NULL when the referenced folder is deleted (ON DELETE SET NULL)", async () => {
    const folderId = await insertFolder();
    const saveId = await insertSave({ folderId });

    await ctx.db
      .delete(datasetFoldersTable)
      .where(eq(datasetFoldersTable.id, folderId));

    const [save] = await ctx.db
      .select({ folderId: userCatalogSavesTable.folderId })
      .from(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.id, saveId));

    expect(save!.folderId).toBeNull();
  });

  it("accepts a save with no folderId (null)", async () => {
    const saveId = await insertSave({ folderId: null });

    const [save] = await ctx.db
      .select({ folderId: userCatalogSavesTable.folderId })
      .from(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.id, saveId));

    expect(save!.folderId).toBeNull();
  });
});

describe("user_catalog_saves — datasetId FK (ON DELETE SET NULL)", () => {
  it("accepts a save with a valid datasetId", async () => {
    const datasetId = await insertDataset();
    const saveId = await insertSave({ datasetId });

    const [save] = await ctx.db
      .select({ datasetId: userCatalogSavesTable.datasetId })
      .from(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.id, saveId));

    expect(save!.datasetId).toBe(datasetId);
  });

  it("sets datasetId to NULL when the referenced custom_dataset is deleted (ON DELETE SET NULL)", async () => {
    const datasetId = await insertDataset();
    const saveId = await insertSave({ datasetId });

    await ctx.db
      .delete(customDatasetsTable)
      .where(eq(customDatasetsTable.id, datasetId));

    const [save] = await ctx.db
      .select({ datasetId: userCatalogSavesTable.datasetId })
      .from(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.id, saveId));

    expect(save!.datasetId).toBeNull();
  });

  it("accepts a save with no datasetId (null)", async () => {
    const saveId = await insertSave({ datasetId: null });

    const [save] = await ctx.db
      .select({ datasetId: userCatalogSavesTable.datasetId })
      .from(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.id, saveId));

    expect(save!.datasetId).toBeNull();
  });
});

describe("user_catalog_saves — combined FK nulling on folder delete", () => {
  it("nulls folderId without affecting datasetId when the folder is deleted", async () => {
    const folderId = await insertFolder();
    const datasetId = await insertDataset();
    const saveId = await insertSave({ folderId, datasetId });

    await ctx.db
      .delete(datasetFoldersTable)
      .where(eq(datasetFoldersTable.id, folderId));

    const [save] = await ctx.db
      .select({
        folderId: userCatalogSavesTable.folderId,
        datasetId: userCatalogSavesTable.datasetId,
      })
      .from(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.id, saveId));

    expect(save!.folderId).toBeNull();
    expect(save!.datasetId).toBe(datasetId);
  });
});

// ---------------------------------------------------------------------------
// (userId, catalogId) index — non-unique by design
//
// The schema intentionally uses a plain index (not uniqueIndex) on
// (user_id, catalog_id) so a user can save the same catalog entry for
// multiple terrain areas, each distinguished by a different requestBboxJson.
// These tests verify that duplicates are accepted and the column semantics
// are correct.
// ---------------------------------------------------------------------------

describe("user_catalog_saves — (userId, catalogId) is non-unique", () => {
  it("allows two saves with the same (userId, catalogId) pair", async () => {
    // First insert: userId="u1", catalogId="cat-123"
    const saveId1 = await insertSave();

    // Second insert with identical userId + catalogId must also succeed
    // (the schema has a plain index, not a unique constraint).
    const [row2] = await ctx.db
      .insert(userCatalogSavesTable)
      .values({ userId: "u1", catalogId: "cat-123" })
      .returning({ id: userCatalogSavesTable.id });

    expect(saveId1).toBeTruthy();
    expect(row2!.id).toBeTruthy();
    expect(row2!.id).not.toBe(saveId1);
  });

  it("allows two saves with the same catalogId for different users", async () => {
    const saveId1 = await insertSave(); // userId="u1"

    const [row2] = await ctx.db
      .insert(userCatalogSavesTable)
      .values({ userId: "u2", catalogId: "cat-123" })
      .returning({ id: userCatalogSavesTable.id });

    expect(saveId1).toBeTruthy();
    expect(row2!.id).toBeTruthy();
    expect(row2!.id).not.toBe(saveId1);
  });

  it("allows the same user to save two different catalog entries", async () => {
    const saveId1 = await insertSave(); // catalogId="cat-123"

    const [row2] = await ctx.db
      .insert(userCatalogSavesTable)
      .values({ userId: "u1", catalogId: "cat-456" })
      .returning({ id: userCatalogSavesTable.id });

    expect(saveId1).toBeTruthy();
    expect(row2!.id).toBeTruthy();
    expect(row2!.id).not.toBe(saveId1);
  });
});

// ---------------------------------------------------------------------------
// areaRequestId — storage and retrieval
//
// areaRequestId groups saves that originated from the same area search bbox so
// the server can auto-create a folder for the request. These tests verify the
// column accepts arbitrary string ids, persists them faithfully, and allows
// null (the common case for single-entry saves).
// ---------------------------------------------------------------------------

describe("user_catalog_saves — areaRequestId storage and retrieval", () => {
  it("stores and retrieves a non-null areaRequestId", async () => {
    const [row] = await ctx.db
      .insert(userCatalogSavesTable)
      .values({
        userId: "u1",
        catalogId: "cat-area-123",
        areaRequestId: "area-req-abc-001",
      })
      .returning({
        id: userCatalogSavesTable.id,
        areaRequestId: userCatalogSavesTable.areaRequestId,
      });

    expect(row!.areaRequestId).toBe("area-req-abc-001");

    // Verify round-trip through a separate SELECT.
    const [fetched] = await ctx.db
      .select({ areaRequestId: userCatalogSavesTable.areaRequestId })
      .from(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.id, row!.id));

    expect(fetched!.areaRequestId).toBe("area-req-abc-001");
  });

  it("defaults areaRequestId to null when not supplied", async () => {
    const saveId = await insertSave();

    const [fetched] = await ctx.db
      .select({ areaRequestId: userCatalogSavesTable.areaRequestId })
      .from(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.id, saveId));

    expect(fetched!.areaRequestId).toBeNull();
  });

  it("allows multiple saves for different catalog entries to share the same areaRequestId", async () => {
    const sharedAreaId = "area-req-shared-xyz";

    const [rowA] = await ctx.db
      .insert(userCatalogSavesTable)
      .values({ userId: "u1", catalogId: "cat-area-a", areaRequestId: sharedAreaId })
      .returning({ id: userCatalogSavesTable.id, areaRequestId: userCatalogSavesTable.areaRequestId });

    const [rowB] = await ctx.db
      .insert(userCatalogSavesTable)
      .values({ userId: "u1", catalogId: "cat-area-b", areaRequestId: sharedAreaId })
      .returning({ id: userCatalogSavesTable.id, areaRequestId: userCatalogSavesTable.areaRequestId });

    expect(rowA!.areaRequestId).toBe(sharedAreaId);
    expect(rowB!.areaRequestId).toBe(sharedAreaId);
    expect(rowA!.id).not.toBe(rowB!.id);
  });
});
