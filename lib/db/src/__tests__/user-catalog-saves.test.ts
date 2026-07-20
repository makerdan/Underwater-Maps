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
