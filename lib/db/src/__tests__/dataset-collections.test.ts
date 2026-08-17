/**
 * dataset-collections.test.ts — DB-level constraint tests for the
 * dataset_collections + dataset_collection_members tables.
 *
 * Covers:
 *  - Case-insensitive unique collection name per user
 *    (dataset_collections_user_name_uniq); different users may share a name
 *  - Exactly-one-reference CHECK on membership rows
 *    (dataset_collection_members_exactly_one_ref)
 *  - Per-collection membership uniqueness (partial unique indexes)
 *  - ON DELETE CASCADE:
 *      collection deleted   → members deleted, datasets/saves untouched
 *      dataset deleted      → its membership rows deleted, collection remains
 *      catalog save deleted → its membership rows deleted, collection remains
 *
 * The cascade tests are the DB-level regression guard for Task "User-defined
 * dataset collections": deleting a dataset (or save) that belongs to
 * collections must succeed and silently drop its membership rows.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestContext } from "./test-db.js";
import {
  datasetCollectionsTable,
  datasetCollectionMembersTable,
} from "../schema/dataset-collections.js";
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

async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
  const err: any = await promise.catch((e) => e);
  expect(err, "expected insert to fail").toBeDefined();
  const cause: any = err?.cause ?? err;
  expect(
    cause?.code,
    `expected PostgreSQL error code ${code} but got: ${JSON.stringify(cause?.code)} — message: ${String(cause?.message ?? err?.message)}`,
  ).toBe(code);
}

async function insertCollection(userId: string, name: string): Promise<string> {
  const [row] = await ctx.db
    .insert(datasetCollectionsTable)
    .values({ userId, name })
    .returning({ id: datasetCollectionsTable.id });
  return row!.id;
}

async function insertDataset(userId: string, name = "ds"): Promise<string> {
  const [row] = await ctx.db
    .insert(customDatasetsTable)
    .values({
      userId,
      name,
      minDepth: 0,
      maxDepth: 10,
      terrainJson: {} as never,
      overviewJson: {} as never,
    })
    .returning({ id: customDatasetsTable.id });
  return row!.id;
}

async function insertSave(userId: string, catalogId = "cat-1"): Promise<string> {
  const [row] = await ctx.db
    .insert(userCatalogSavesTable)
    .values({ userId, catalogId })
    .returning({ id: userCatalogSavesTable.id });
  return row!.id;
}

describe("dataset_collections — unique name per user (dataset_collections_user_name_uniq)", () => {
  it("rejects two collections with the same name (exact case) for the same user", async () => {
    await insertCollection("u1", "Trip Prep");
    await expectPgError(
      ctx.db.insert(datasetCollectionsTable).values({ userId: "u1", name: "Trip Prep" }),
      "23505",
    );
  });

  it("rejects duplicate names differing only in case for the same user", async () => {
    await insertCollection("u1", "Trip Prep");
    await expectPgError(
      ctx.db.insert(datasetCollectionsTable).values({ userId: "u1", name: "TRIP PREP" }),
      "23505",
    );
  });

  it("allows the same name for different users", async () => {
    await insertCollection("u1", "Trip Prep");
    const id = await insertCollection("u2", "Trip Prep");
    expect(id).toBeTruthy();
  });
});

describe("dataset_collection_members — exactly-one-reference CHECK", () => {
  it("rejects a member with neither datasetId nor catalogSaveId", async () => {
    const collectionId = await insertCollection("u1", "C");
    await expectPgError(
      ctx.db.insert(datasetCollectionMembersTable).values({ collectionId }),
      "23514",
    );
  });

  it("rejects a member with both datasetId and catalogSaveId", async () => {
    const collectionId = await insertCollection("u1", "C");
    const datasetId = await insertDataset("u1");
    const catalogSaveId = await insertSave("u1");
    await expectPgError(
      ctx.db
        .insert(datasetCollectionMembersTable)
        .values({ collectionId, datasetId, catalogSaveId }),
      "23514",
    );
  });

  it("accepts dataset-kind and save-kind members in the same collection", async () => {
    const collectionId = await insertCollection("u1", "C");
    const datasetId = await insertDataset("u1");
    const catalogSaveId = await insertSave("u1");
    await ctx.db.insert(datasetCollectionMembersTable).values({ collectionId, datasetId });
    await ctx.db.insert(datasetCollectionMembersTable).values({ collectionId, catalogSaveId });
    const members = await ctx.db
      .select()
      .from(datasetCollectionMembersTable)
      .where(eq(datasetCollectionMembersTable.collectionId, collectionId));
    expect(members).toHaveLength(2);
  });
});

describe("dataset_collection_members — per-collection uniqueness", () => {
  it("rejects the same dataset twice in one collection", async () => {
    const collectionId = await insertCollection("u1", "C");
    const datasetId = await insertDataset("u1");
    await ctx.db.insert(datasetCollectionMembersTable).values({ collectionId, datasetId });
    await expectPgError(
      ctx.db.insert(datasetCollectionMembersTable).values({ collectionId, datasetId }),
      "23505",
    );
  });

  it("rejects the same catalog save twice in one collection", async () => {
    const collectionId = await insertCollection("u1", "C");
    const catalogSaveId = await insertSave("u1");
    await ctx.db.insert(datasetCollectionMembersTable).values({ collectionId, catalogSaveId });
    await expectPgError(
      ctx.db.insert(datasetCollectionMembersTable).values({ collectionId, catalogSaveId }),
      "23505",
    );
  });

  it("allows the same dataset in two different collections", async () => {
    const c1 = await insertCollection("u1", "C1");
    const c2 = await insertCollection("u1", "C2");
    const datasetId = await insertDataset("u1");
    await ctx.db.insert(datasetCollectionMembersTable).values({ collectionId: c1, datasetId });
    await ctx.db.insert(datasetCollectionMembersTable).values({ collectionId: c2, datasetId });
    const members = await ctx.db
      .select()
      .from(datasetCollectionMembersTable)
      .where(eq(datasetCollectionMembersTable.datasetId, datasetId));
    expect(members).toHaveLength(2);
  });
});

describe("dataset_collection_members — cascade behavior (regression guard)", () => {
  it("deleting a collection removes its members but never the datasets/saves", async () => {
    const collectionId = await insertCollection("u1", "C");
    const datasetId = await insertDataset("u1");
    const catalogSaveId = await insertSave("u1");
    await ctx.db.insert(datasetCollectionMembersTable).values({ collectionId, datasetId });
    await ctx.db.insert(datasetCollectionMembersTable).values({ collectionId, catalogSaveId });

    await ctx.db
      .delete(datasetCollectionsTable)
      .where(eq(datasetCollectionsTable.id, collectionId));

    const members = await ctx.db.select().from(datasetCollectionMembersTable);
    expect(members).toHaveLength(0);
    const datasets = await ctx.db.select().from(customDatasetsTable);
    expect(datasets).toHaveLength(1);
    const saves = await ctx.db.select().from(userCatalogSavesTable);
    expect(saves).toHaveLength(1);
  });

  it("deleting a dataset that belongs to collections succeeds and drops its membership rows", async () => {
    const c1 = await insertCollection("u1", "C1");
    const c2 = await insertCollection("u1", "C2");
    const datasetId = await insertDataset("u1");
    await ctx.db.insert(datasetCollectionMembersTable).values({ collectionId: c1, datasetId });
    await ctx.db.insert(datasetCollectionMembersTable).values({ collectionId: c2, datasetId });

    // Must not throw despite membership rows referencing the dataset.
    await ctx.db.delete(customDatasetsTable).where(eq(customDatasetsTable.id, datasetId));

    const members = await ctx.db.select().from(datasetCollectionMembersTable);
    expect(members).toHaveLength(0);
    // Collections themselves survive.
    const collections = await ctx.db.select().from(datasetCollectionsTable);
    expect(collections).toHaveLength(2);
  });

  it("deleting a catalog save that belongs to a collection succeeds and drops its membership row", async () => {
    const collectionId = await insertCollection("u1", "C");
    const catalogSaveId = await insertSave("u1");
    await ctx.db.insert(datasetCollectionMembersTable).values({ collectionId, catalogSaveId });

    await ctx.db
      .delete(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.id, catalogSaveId));

    const members = await ctx.db.select().from(datasetCollectionMembersTable);
    expect(members).toHaveLength(0);
    const collections = await ctx.db.select().from(datasetCollectionsTable);
    expect(collections).toHaveLength(1);
  });
});
