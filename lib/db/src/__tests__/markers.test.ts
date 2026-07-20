/**
 * markers.test.ts — DB-level NOT NULL constraint test for the markers table.
 *
 * Covers:
 *  - Inserting a marker without userId throws a DB-level NOT NULL constraint
 *    error (not a silent null stored in the row).
 *  - A valid marker with all required fields inserts successfully.
 *
 * Error-checking note: drizzle-orm wraps PG errors into a DrizzleError with
 * `.message = "Failed query: ..."`.  The actual NOT NULL violation is in
 * `error.cause` (a native pg Error with `.code === '23502'`).  We use raw SQL
 * via `ctx.db.execute(sql`...`)` to bypass drizzle's type-level NOT NULL guard
 * and hit the database constraint directly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestContext } from "./test-db.js";
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

describe("markers — userId NOT NULL constraint", () => {
  it("inserts a valid marker with userId successfully", async () => {
    await expect(
      ctx.db.insert(markersTable).values({
        userId: "u1",
        lon: -122.5,
        lat: 37.8,
        depth: 15,
        label: "Test Marker",
        type: "custom",
      }),
    ).resolves.not.toThrow();
  });

  it("throws a DB-level NOT NULL violation (code 23502) when userId is NULL via raw SQL", async () => {
    const err: any = await ctx.db.execute(sql`
      INSERT INTO markers (lon, lat, depth, label, type, user_id)
      VALUES (-122.5, 37.8, 15.0, 'No User', 'custom', NULL)
    `).catch((e) => e);

    expect(err, "expected insert to fail").toBeDefined();
    const cause: any = err?.cause ?? err;
    expect(
      cause?.code,
      `expected PostgreSQL NOT NULL error code 23502 but got: ${JSON.stringify(cause?.code)} — message: ${String(cause?.message ?? err?.message)}`,
    ).toBe("23502");
  });

  it("stores all optional fields as null when not provided", async () => {
    await ctx.db.insert(markersTable).values({
      userId: "u1",
      lon: -120,
      lat: 38,
      depth: 5,
      label: "Minimal",
      type: "fish",
    });

    const rows = await ctx.db.select().from(markersTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.notes).toBeNull();
    expect(rows[0]!.datasetId).toBeNull();
    expect(rows[0]!.userId).toBe("u1");
  });

  it("allows multiple markers with the same userId (no unique constraint on userId)", async () => {
    await expect(
      ctx.db.insert(markersTable).values([
        { userId: "u1", lon: -120, lat: 38, depth: 5, label: "A", type: "custom" },
        { userId: "u1", lon: -121, lat: 39, depth: 6, label: "B", type: "fish" },
      ]),
    ).resolves.not.toThrow();

    const rows = await ctx.db.select().from(markersTable);
    expect(rows).toHaveLength(2);
  });
});
