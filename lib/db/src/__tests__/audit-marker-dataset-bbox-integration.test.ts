/**
 * audit-marker-dataset-bbox-integration.test.ts
 *
 * Integration tests for resolveBboxes() + classifyMarkers() against a real
 * isolated PostgreSQL schema (via createTestDb).
 *
 * Focus: verifying that a custom_datasets row whose terrain_json stores the
 * bbox in the wrong JSON shape is treated as an unresolvable dataset, so any
 * marker referencing it lands in the `unknownDataset` bucket.
 *
 * The three malformed shapes exercised here are the most plausible silent-
 * corruption patterns:
 *   1. snake_case keys  ({ min_lon, min_lat, max_lon, max_lat })
 *   2. Partial keys     (minLon/minLat present, maxLon/maxLat absent)
 *   3. String values    ({ minLon: "-130", … } — correct keys, wrong type)
 *
 * A positive-control test confirms that a correctly-formed terrain_json does
 * resolve to a usable Bbox so the logic is not trivially always-null.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestContext } from "./test-db.js";
import { customDatasetsTable } from "../schema/custom-datasets.js";
import { markersTable } from "../schema/markers.js";
import {
  resolveBboxes,
  classifyMarkers,
} from "../scripts/audit-marker-dataset-bbox-helpers.js";

// ---------------------------------------------------------------------------
// Shared test schema setup
// ---------------------------------------------------------------------------

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
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid terrain_json that resolveBboxes CAN parse. */
function validTerrainJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    datasetId: "test-dataset",
    name: "Test",
    waterType: "saltwater",
    resolution: 10,
    width: 100,
    height: 100,
    depths: [],
    minDepth: 0,
    maxDepth: 100,
    minLon: -136.0,
    maxLon: -130.0,
    minLat: 55.0,
    maxLat: 60.0,
    centerLon: -133.0,
    centerLat: 57.5,
    ...overrides,
  };
}

/** Minimal valid overview_json (content does not affect bbox resolution). */
const OVERVIEW_JSON = { tiles: [] };

/** Insert a custom_datasets row and return its generated UUID as a string. */
async function insertCustomDataset(terrainJson: Record<string, unknown>): Promise<string> {
  const rows = await ctx.db
    .insert(customDatasetsTable)
    .values({
      userId: "user-test",
      name: "Test dataset",
      minDepth: 0,
      maxDepth: 100,
      terrainJson,
      overviewJson: OVERVIEW_JSON,
    })
    .returning({ id: customDatasetsTable.id });

  const id = rows[0]?.id;
  if (!id) throw new Error("insert did not return an id");
  return id;
}

/** Insert a marker row that references the given dataset id (stored as text). */
async function insertMarker(datasetId: string, lon: number, lat: number): Promise<string> {
  // dataset_id in the markers table is TEXT, not a FK, so any string works.
  const rows = await ctx.db.execute(sql`
    INSERT INTO markers (dataset_id, lon, lat, depth, type, label, user_id)
    VALUES (${datasetId}, ${lon}, ${lat}, 10.0, 'custom', 'Test Marker', 'user-test')
    RETURNING id
  `);
  const id = (rows.rows[0] as { id: string } | undefined)?.id;
  if (!id) throw new Error("marker insert did not return an id");
  return id;
}

// ---------------------------------------------------------------------------
// Positive control — correctly formed terrain_json resolves to a valid Bbox
// ---------------------------------------------------------------------------

describe("resolveBboxes — correctly formed terrain_json", () => {
  it("resolves a custom_dataset with valid camelCase bbox fields", async () => {
    const datasetId = await insertCustomDataset(validTerrainJson());
    const bboxMap = await resolveBboxes(ctx.db, [datasetId]);

    expect(bboxMap.get(datasetId)).toEqual({
      minLon: -136.0,
      minLat: 55.0,
      maxLon: -130.0,
      maxLat: 60.0,
    });
  });

  it("classifies a marker inside the bbox as in-bounds (not in any problem bucket)", async () => {
    const datasetId = await insertCustomDataset(validTerrainJson());
    await insertMarker(datasetId, -133.0, 57.5); // well inside SE Alaska bbox

    const bboxMap = await resolveBboxes(ctx.db, [datasetId]);
    const markers = [{ id: "m1", userId: "u1", datasetId, lon: -133.0, lat: 57.5 }];
    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);

    expect(outOfBounds).toHaveLength(0);
    expect(unknownDataset).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Malformed shape 1 — snake_case keys instead of camelCase
// ---------------------------------------------------------------------------

describe("resolveBboxes — snake_case bbox keys (e.g. min_lon instead of minLon)", () => {
  it("maps the dataset id to null (bbox unresolvable)", async () => {
    const datasetId = await insertCustomDataset({
      ...validTerrainJson({ minLon: undefined, maxLon: undefined, minLat: undefined, maxLat: undefined }),
      // Store the bbox under snake_case keys — the shape the audit guard must NOT silently accept
      min_lon: -136.0,
      max_lon: -130.0,
      min_lat: 55.0,
      max_lat: 60.0,
    });

    const bboxMap = await resolveBboxes(ctx.db, [datasetId]);
    expect(bboxMap.get(datasetId)).toBeNull();
  });

  it("classifies a marker referencing a snake_case-bbox dataset as unknownDataset", async () => {
    const datasetId = await insertCustomDataset({
      ...validTerrainJson({ minLon: undefined, maxLon: undefined, minLat: undefined, maxLat: undefined }),
      min_lon: -136.0,
      max_lon: -130.0,
      min_lat: 55.0,
      max_lat: 60.0,
    });

    const bboxMap = await resolveBboxes(ctx.db, [datasetId]);
    const markers = [{ id: "m1", userId: "u1", datasetId, lon: -133.0, lat: 57.5 }];
    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);

    expect(unknownDataset).toHaveLength(1);
    expect(unknownDataset[0]!.datasetId).toBe(datasetId);
    expect(outOfBounds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Malformed shape 2 — partial keys (some camelCase fields absent)
// ---------------------------------------------------------------------------

describe("resolveBboxes — partial bbox fields (maxLon / maxLat missing)", () => {
  it("maps the dataset id to null when required bbox keys are absent", async () => {
    // terrain_json has minLon/minLat but is missing maxLon/maxLat
    const datasetId = await insertCustomDataset(
      validTerrainJson({ maxLon: undefined, maxLat: undefined }),
    );

    const bboxMap = await resolveBboxes(ctx.db, [datasetId]);
    expect(bboxMap.get(datasetId)).toBeNull();
  });

  it("classifies a marker referencing a partial-bbox dataset as unknownDataset", async () => {
    const datasetId = await insertCustomDataset(
      validTerrainJson({ maxLon: undefined, maxLat: undefined }),
    );

    const bboxMap = await resolveBboxes(ctx.db, [datasetId]);
    const markers = [{ id: "m1", userId: "u1", datasetId, lon: -133.0, lat: 57.5 }];
    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);

    expect(unknownDataset).toHaveLength(1);
    expect(unknownDataset[0]!.datasetId).toBe(datasetId);
    expect(outOfBounds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Malformed shape 3 — string values instead of numbers
// ---------------------------------------------------------------------------

describe("resolveBboxes — string-typed bbox values (correct keys, wrong type)", () => {
  it("maps the dataset id to null when bbox values are strings not numbers", async () => {
    const datasetId = await insertCustomDataset(
      validTerrainJson({ minLon: "-136.0", maxLon: "-130.0", minLat: "55.0", maxLat: "60.0" }),
    );

    const bboxMap = await resolveBboxes(ctx.db, [datasetId]);
    expect(bboxMap.get(datasetId)).toBeNull();
  });

  it("classifies a marker referencing a string-valued-bbox dataset as unknownDataset", async () => {
    const datasetId = await insertCustomDataset(
      validTerrainJson({ minLon: "-136.0", maxLon: "-130.0", minLat: "55.0", maxLat: "60.0" }),
    );

    const bboxMap = await resolveBboxes(ctx.db, [datasetId]);
    const markers = [{ id: "m1", userId: "u1", datasetId, lon: -133.0, lat: 57.5 }];
    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);

    expect(unknownDataset).toHaveLength(1);
    expect(unknownDataset[0]!.datasetId).toBe(datasetId);
    expect(outOfBounds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Mixed batch — one good dataset, one malformed, one truly deleted
// ---------------------------------------------------------------------------

describe("resolveBboxes — mixed batch of dataset ids", () => {
  it("resolves each id independently regardless of shape", async () => {
    const goodId = await insertCustomDataset(validTerrainJson());
    const badId = await insertCustomDataset(
      validTerrainJson({ minLon: undefined, maxLon: undefined, minLat: undefined, maxLat: undefined }),
    );
    const deletedId = "00000000-0000-0000-0000-000000000099"; // never inserted

    const bboxMap = await resolveBboxes(ctx.db, [goodId, badId, deletedId]);

    expect(bboxMap.get(goodId)).toEqual({
      minLon: -136.0,
      minLat: 55.0,
      maxLon: -130.0,
      maxLat: 60.0,
    });
    expect(bboxMap.get(badId)).toBeNull();
    expect(bboxMap.get(deletedId)).toBeNull();
  });

  it("classifies markers across the batch correctly", async () => {
    const goodId = await insertCustomDataset(validTerrainJson());
    const badId = await insertCustomDataset(
      validTerrainJson({ minLon: undefined, maxLon: undefined, minLat: undefined, maxLat: undefined }),
    );
    const deletedId = "00000000-0000-0000-0000-000000000099";

    const bboxMap = await resolveBboxes(ctx.db, [goodId, badId, deletedId]);

    const markers = [
      { id: "m1", userId: "u1", datasetId: goodId,   lon: -133.0, lat: 57.5 }, // in-bounds
      { id: "m2", userId: "u1", datasetId: goodId,   lon:  -80.0, lat: 25.0 }, // out-of-bounds
      { id: "m3", userId: "u1", datasetId: badId,    lon: -133.0, lat: 57.5 }, // unknownDataset (bad shape)
      { id: "m4", userId: "u1", datasetId: deletedId, lon: -133.0, lat: 57.5 }, // unknownDataset (deleted)
    ];

    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);

    expect(outOfBounds.map((m) => m.id)).toEqual(["m2"]);
    expect(unknownDataset.map((m) => m.id)).toEqual(["m3", "m4"]);
  });
});
