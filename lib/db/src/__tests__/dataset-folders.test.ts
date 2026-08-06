/**
 * dataset-folders.test.ts — DB-level constraint tests for the dataset_folders
 * table.
 *
 * Covers:
 *  - Unique sibling-name index (case-insensitive, per user+parent)
 *  - Self-referential ON DELETE CASCADE from parent to children
 *  - Siblings under different parents may share a name
 *
 * The schema defines two partial unique indexes:
 *   dataset_folders_root_name_uniq  — (user_id, lower(name)) WHERE parent_id IS NULL
 *   dataset_folders_child_name_uniq — (user_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL
 *
 * Both root-level and child-level duplicate names are therefore enforced at
 * the DB level.  Tests below cover both cases.
 *
 * Error-checking note: drizzle-orm wraps PG errors into a DrizzleError whose
 * `.message` is "Failed query: ...".  The underlying constraint violation is
 * in `error.cause` (a native pg Error with `.code === '23505'` for unique
 * violations).  The `expectUniqueViolation` helper extracts the cause so the
 * assertion targets the actual DB error, not the drizzle wrapper.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestContext } from "./test-db.js";
import {
  datasetFoldersTable,
} from "../schema/dataset-folders.js";

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

function makeFolder(overrides: Partial<typeof datasetFoldersTable.$inferInsert> & { userId: string; name: string }) {
  return {
    userId: overrides.userId,
    name: overrides.name,
    parentId: overrides.parentId ?? null,
  };
}

/**
 * Asserts that a rejected promise carries a PostgreSQL unique-violation error
 * (code 23505).  Works around drizzle-orm wrapping the native pg error in a
 * DrizzleError with message "Failed query: ...".
 */
async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  const err: any = await promise.catch((e) => e);
  expect(err, "expected insert to fail").toBeDefined();
  const cause: any = err?.cause ?? err;
  expect(
    cause?.code,
    `expected PostgreSQL error code 23505 (unique violation) but got: ${JSON.stringify(cause?.code)} — message: ${String(cause?.message ?? err?.message)}`,
  ).toBe("23505");
}

describe("dataset_folders — unique root-name constraint (dataset_folders_root_name_uniq)", () => {
  it("rejects two root-level folders with the same name (exact case) for the same user", async () => {
    await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "Lakes" }));

    await expectUniqueViolation(
      ctx.db
        .insert(datasetFoldersTable)
        .values(makeFolder({ userId: "u1", name: "Lakes" })),
    );
  });

  it("rejects two root-level folders with the same name in different case for the same user", async () => {
    await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "Rivers" }));

    await expectUniqueViolation(
      ctx.db
        .insert(datasetFoldersTable)
        .values(makeFolder({ userId: "u1", name: "RIVERS" })),
    );
  });

  it("allows two root-level folders with the same name for different users", async () => {
    await expect(
      ctx.db.insert(datasetFoldersTable).values([
        makeFolder({ userId: "u1", name: "Oceans" }),
        makeFolder({ userId: "u2", name: "Oceans" }),
      ]),
    ).resolves.not.toThrow();
  });
});

describe("dataset_folders — unique child-name constraint (dataset_folders_child_name_uniq)", () => {
  it("rejects two siblings with the same name (exact case) under the same parent", async () => {
    const parent = await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "Root" }))
      .returning({ id: datasetFoldersTable.id });

    const parentId = parent[0]!.id;

    await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "Reefs", parentId }));

    await expectUniqueViolation(
      ctx.db
        .insert(datasetFoldersTable)
        .values(makeFolder({ userId: "u1", name: "Reefs", parentId })),
    );
  });

  it("rejects two siblings with the same name in different case under the same parent", async () => {
    const parent = await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "Root" }))
      .returning({ id: datasetFoldersTable.id });

    const parentId = parent[0]!.id;

    await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "Wrecks", parentId }));

    await expectUniqueViolation(
      ctx.db
        .insert(datasetFoldersTable)
        .values(makeFolder({ userId: "u1", name: "WRECKS", parentId })),
    );
  });

  it("allows two folders with the same name under different parents", async () => {
    const parents = await ctx.db
      .insert(datasetFoldersTable)
      .values([
        makeFolder({ userId: "u1", name: "ParentA" }),
        makeFolder({ userId: "u1", name: "ParentB" }),
      ])
      .returning({ id: datasetFoldersTable.id });

    const [parentA, parentB] = parents;

    await expect(
      ctx.db.insert(datasetFoldersTable).values([
        makeFolder({ userId: "u1", name: "Inner", parentId: parentA!.id }),
        makeFolder({ userId: "u1", name: "Inner", parentId: parentB!.id }),
      ]),
    ).resolves.not.toThrow();
  });

  it("allows two folders with the same name for different users under the same logical parent position", async () => {
    const [pA] = await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "Root" }))
      .returning({ id: datasetFoldersTable.id });
    const [pB] = await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u2", name: "Root" }))
      .returning({ id: datasetFoldersTable.id });

    await expect(
      ctx.db.insert(datasetFoldersTable).values([
        makeFolder({ userId: "u1", name: "Shared", parentId: pA!.id }),
        makeFolder({ userId: "u2", name: "Shared", parentId: pB!.id }),
      ]),
    ).resolves.not.toThrow();
  });
});

describe("dataset_folders — ON DELETE CASCADE", () => {
  it("deleting a parent cascades to its direct children", async () => {
    const [parent] = await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "Parent" }))
      .returning({ id: datasetFoldersTable.id });

    await ctx.db.insert(datasetFoldersTable).values([
      makeFolder({ userId: "u1", name: "Child1", parentId: parent!.id }),
      makeFolder({ userId: "u1", name: "Child2", parentId: parent!.id }),
    ]);

    await ctx.db
      .delete(datasetFoldersTable)
      .where(eq(datasetFoldersTable.id, parent!.id));

    const remaining = await ctx.db
      .select({ id: datasetFoldersTable.id })
      .from(datasetFoldersTable);

    expect(remaining).toHaveLength(0);
  });

  it("deleting a grandparent cascades transitively through all generations", async () => {
    const [gp] = await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "GrandParent" }))
      .returning({ id: datasetFoldersTable.id });

    const [parent] = await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "Parent", parentId: gp!.id }))
      .returning({ id: datasetFoldersTable.id });

    await ctx.db.insert(datasetFoldersTable).values(
      makeFolder({ userId: "u1", name: "Child", parentId: parent!.id }),
    );

    await ctx.db
      .delete(datasetFoldersTable)
      .where(eq(datasetFoldersTable.id, gp!.id));

    const remaining = await ctx.db
      .select({ id: datasetFoldersTable.id })
      .from(datasetFoldersTable);

    expect(remaining).toHaveLength(0);
  });

  it("deleting a parent does not affect unrelated folders for the same user", async () => {
    const [targetParent] = await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "ToDelete" }))
      .returning({ id: datasetFoldersTable.id });

    const [kept] = await ctx.db
      .insert(datasetFoldersTable)
      .values(makeFolder({ userId: "u1", name: "Keeper" }))
      .returning({ id: datasetFoldersTable.id });

    await ctx.db.insert(datasetFoldersTable).values(
      makeFolder({ userId: "u1", name: "Child", parentId: targetParent!.id }),
    );

    await ctx.db
      .delete(datasetFoldersTable)
      .where(eq(datasetFoldersTable.id, targetParent!.id));

    const remaining = await ctx.db
      .select({ id: datasetFoldersTable.id })
      .from(datasetFoldersTable);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(kept!.id);
  });
});
