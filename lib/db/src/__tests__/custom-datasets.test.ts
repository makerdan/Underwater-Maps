/**
 * custom-datasets.test.ts — DB-level FK constraint tests for the
 * custom_datasets table.
 *
 * Covers:
 *  - folderId FK: valid insert, ON DELETE SET NULL from dataset_folders,
 *    rejection of dangling folder references
 *
 * These tests fail if a future migration drops the
 * custom_datasets.folder_id → dataset_folders(id) ON DELETE SET NULL foreign
 * key: deleting a folder would then leave datasets holding stale folder ids
 * (the SET NULL test fails) and dangling folder ids would be insertable (the
 * FK-violation test fails).
 *
 * Error-checking note: drizzle-orm wraps PG errors into a DrizzleError whose
 * `.message` is "Failed query: ...".  The underlying constraint violation is
 * in `error.cause` (a native pg Error with `.code === '23503'` for FK
 * violations).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createTestDb, type TestContext } from "./test-db.js";
import { datasetFoldersTable } from "../schema/dataset-folders.js";
import { customDatasetsTable } from "../schema/custom-datasets.js";

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

async function insertDataset(overrides?: { folderId?: string | null }) {
  const [row] = await ctx.db
    .insert(customDatasetsTable)
    .values({
      userId: "u1",
      name: "TestDataset",
      minDepth: 0,
      maxDepth: 10,
      terrainJson: TERRAIN_JSON,
      overviewJson: TERRAIN_JSON,
      folderId: overrides?.folderId ?? null,
    })
    .returning({ id: customDatasetsTable.id });
  return row!.id;
}

/**
 * Asserts that a rejected promise carries a PostgreSQL foreign-key-violation
 * error (code 23503), unwrapping the drizzle DrizzleError wrapper.
 */
async function expectFkViolation(promise: Promise<unknown>): Promise<void> {
  const err: any = await promise.catch((e) => e);
  expect(err, "expected insert to fail").toBeDefined();
  const cause: any = err?.cause ?? err;
  expect(
    cause?.code,
    `expected PostgreSQL error code 23503 (FK violation) but got: ${JSON.stringify(cause?.code)} — message: ${String(cause?.message ?? err?.message)}`,
  ).toBe("23503");
}

describe("custom_datasets — folderId FK (ON DELETE SET NULL)", () => {
  it("accepts a dataset with a valid folderId", async () => {
    const folderId = await insertFolder();
    const datasetId = await insertDataset({ folderId });

    const [ds] = await ctx.db
      .select({ folderId: customDatasetsTable.folderId })
      .from(customDatasetsTable)
      .where(eq(customDatasetsTable.id, datasetId));

    expect(ds!.folderId).toBe(folderId);
  });

  it("sets folderId to NULL when the referenced folder is deleted (ON DELETE SET NULL)", async () => {
    const folderId = await insertFolder();
    const datasetId = await insertDataset({ folderId });

    await ctx.db
      .delete(datasetFoldersTable)
      .where(eq(datasetFoldersTable.id, folderId));

    const [ds] = await ctx.db
      .select({ folderId: customDatasetsTable.folderId })
      .from(customDatasetsTable)
      .where(eq(customDatasetsTable.id, datasetId));

    expect(ds!.folderId).toBeNull();
  });

  it("keeps the dataset row (only nulls folderId) when its folder is deleted", async () => {
    const folderId = await insertFolder();
    const datasetId = await insertDataset({ folderId });

    await ctx.db
      .delete(datasetFoldersTable)
      .where(eq(datasetFoldersTable.id, folderId));

    const rows = await ctx.db
      .select({ id: customDatasetsTable.id, name: customDatasetsTable.name })
      .from(customDatasetsTable)
      .where(eq(customDatasetsTable.id, datasetId));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("TestDataset");
  });

  it("only nulls datasets in the deleted folder, not datasets in other folders", async () => {
    const folderA = await insertFolder("u1", "FolderA");
    const folderB = await insertFolder("u1", "FolderB");
    const inA = await insertDataset({ folderId: folderA });
    const inB = await insertDataset({ folderId: folderB });

    await ctx.db
      .delete(datasetFoldersTable)
      .where(eq(datasetFoldersTable.id, folderA));

    const [dsA] = await ctx.db
      .select({ folderId: customDatasetsTable.folderId })
      .from(customDatasetsTable)
      .where(eq(customDatasetsTable.id, inA));
    const [dsB] = await ctx.db
      .select({ folderId: customDatasetsTable.folderId })
      .from(customDatasetsTable)
      .where(eq(customDatasetsTable.id, inB));

    expect(dsA!.folderId).toBeNull();
    expect(dsB!.folderId).toBe(folderB);
  });

  it("accepts a dataset with no folderId (null)", async () => {
    const datasetId = await insertDataset({ folderId: null });

    const [ds] = await ctx.db
      .select({ folderId: customDatasetsTable.folderId })
      .from(customDatasetsTable)
      .where(eq(customDatasetsTable.id, datasetId));

    expect(ds!.folderId).toBeNull();
  });

  it("rejects a dataset referencing a non-existent folder (FK enforced)", async () => {
    await expectFkViolation(insertDataset({ folderId: randomUUID() }));
  });
});
