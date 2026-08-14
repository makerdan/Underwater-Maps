/**
 * audit-marker-dataset-bbox.test.ts
 *
 * Unit tests for the pure classification helpers extracted from
 * audit-marker-dataset-bbox.ts. No database connection required.
 *
 * Covers:
 *  - isInBbox: inclusive boundary checks
 *  - classifyMarkers: in-bounds, out-of-bounds, and unknown-dataset paths
 *  - ciExitCode: returns 1 with --ci + problems, 0 otherwise
 */

import { describe, it, expect } from "vitest";
import {
  isInBbox,
  classifyMarkers,
  ciExitCode,
  type Bbox,
  type MarkerRow,
} from "../scripts/audit-marker-dataset-bbox-helpers.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BBOX_SE_ALASKA: Bbox = {
  minLon: -136.0,
  minLat: 55.0,
  maxLon: -130.0,
  maxLat: 60.0,
};

const DATASET_ID_A = "aaaaaaaa-0000-0000-0000-000000000001";
const DATASET_ID_B = "bbbbbbbb-0000-0000-0000-000000000002";
const DATASET_ID_DELETED = "cccccccc-0000-0000-0000-000000000003";

function makeMarker(
  overrides: Partial<MarkerRow> & { id: string; datasetId: string; lon: number; lat: number },
): MarkerRow {
  return {
    userId: "user-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isInBbox
// ---------------------------------------------------------------------------

describe("isInBbox", () => {
  it("returns true for a point well inside the bbox", () => {
    expect(isInBbox(-133.0, 57.5, BBOX_SE_ALASKA)).toBe(true);
  });

  it("returns true on the exact minimum corner (inclusive)", () => {
    expect(isInBbox(-136.0, 55.0, BBOX_SE_ALASKA)).toBe(true);
  });

  it("returns true on the exact maximum corner (inclusive)", () => {
    expect(isInBbox(-130.0, 60.0, BBOX_SE_ALASKA)).toBe(true);
  });

  it("returns false for a point just outside minLon", () => {
    expect(isInBbox(-136.0001, 57.0, BBOX_SE_ALASKA)).toBe(false);
  });

  it("returns false for a point just outside maxLon", () => {
    expect(isInBbox(-129.9999, 57.0, BBOX_SE_ALASKA)).toBe(false);
  });

  it("returns false for a point just outside minLat", () => {
    expect(isInBbox(-133.0, 54.9999, BBOX_SE_ALASKA)).toBe(false);
  });

  it("returns false for a point just outside maxLat", () => {
    expect(isInBbox(-133.0, 60.0001, BBOX_SE_ALASKA)).toBe(false);
  });

  it("returns false for a completely different region", () => {
    // Gulf of Mexico
    expect(isInBbox(-90.0, 25.0, BBOX_SE_ALASKA)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyMarkers
// ---------------------------------------------------------------------------

describe("classifyMarkers", () => {
  it("returns empty buckets when all markers are in-bounds", () => {
    const markers: MarkerRow[] = [
      makeMarker({ id: "m1", datasetId: DATASET_ID_A, lon: -133.0, lat: 57.5 }),
      makeMarker({ id: "m2", datasetId: DATASET_ID_A, lon: -131.0, lat: 58.0 }),
    ];
    const bboxMap = new Map<string, Bbox | null>([
      [DATASET_ID_A, BBOX_SE_ALASKA],
    ]);

    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);

    expect(outOfBounds).toHaveLength(0);
    expect(unknownDataset).toHaveLength(0);
  });

  it("classifies a marker outside the dataset bbox as out-of-bounds", () => {
    const markers: MarkerRow[] = [
      makeMarker({ id: "m1", datasetId: DATASET_ID_A, lon: -133.0, lat: 57.5 }), // in-bounds
      makeMarker({ id: "m2", datasetId: DATASET_ID_A, lon: -80.0, lat: 25.0 }),  // out-of-bounds (Gulf of Mexico)
    ];
    const bboxMap = new Map<string, Bbox | null>([
      [DATASET_ID_A, BBOX_SE_ALASKA],
    ]);

    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);

    expect(outOfBounds).toHaveLength(1);
    expect(outOfBounds[0]!.id).toBe("m2");
    expect(unknownDataset).toHaveLength(0);
  });

  it("classifies a marker whose dataset no longer exists as unknownDataset", () => {
    const markers: MarkerRow[] = [
      makeMarker({ id: "m1", datasetId: DATASET_ID_DELETED, lon: -133.0, lat: 57.5 }),
    ];
    // bboxMap entry is null → dataset deleted
    const bboxMap = new Map<string, Bbox | null>([
      [DATASET_ID_DELETED, null],
    ]);

    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);

    expect(unknownDataset).toHaveLength(1);
    expect(unknownDataset[0]!.id).toBe("m1");
    expect(outOfBounds).toHaveLength(0);
  });

  it("handles a mix of in-bounds, out-of-bounds, and unknown-dataset markers", () => {
    const markers: MarkerRow[] = [
      makeMarker({ id: "in1",  datasetId: DATASET_ID_A,       lon: -133.0, lat: 57.5 }),
      makeMarker({ id: "out1", datasetId: DATASET_ID_A,       lon: -80.0,  lat: 25.0 }),
      makeMarker({ id: "unk1", datasetId: DATASET_ID_DELETED, lon: -133.0, lat: 57.5 }),
      makeMarker({ id: "in2",  datasetId: DATASET_ID_B,       lon: -132.0, lat: 56.0 }),
      makeMarker({ id: "out2", datasetId: DATASET_ID_B,       lon: 10.0,   lat: 0.0  }),
    ];
    const bboxMap = new Map<string, Bbox | null>([
      [DATASET_ID_A,       BBOX_SE_ALASKA],
      [DATASET_ID_B,       BBOX_SE_ALASKA],
      [DATASET_ID_DELETED, null],
    ]);

    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);

    expect(outOfBounds.map((m) => m.id)).toEqual(expect.arrayContaining(["out1", "out2"]));
    expect(outOfBounds).toHaveLength(2);

    expect(unknownDataset.map((m) => m.id)).toEqual(["unk1"]);
    expect(unknownDataset).toHaveLength(1);
  });

  it("returns empty buckets when the markers array is empty", () => {
    const { outOfBounds, unknownDataset } = classifyMarkers([], new Map());
    expect(outOfBounds).toHaveLength(0);
    expect(unknownDataset).toHaveLength(0);
  });

  it("counts boundary-edge markers as in-bounds (not out-of-bounds)", () => {
    // Exactly on bbox corner — should be in-bounds (inclusive)
    const markers: MarkerRow[] = [
      makeMarker({ id: "edge", datasetId: DATASET_ID_A, lon: -136.0, lat: 55.0 }),
    ];
    const bboxMap = new Map<string, Bbox | null>([
      [DATASET_ID_A, BBOX_SE_ALASKA],
    ]);

    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);

    expect(outOfBounds).toHaveLength(0);
    expect(unknownDataset).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ciExitCode
// ---------------------------------------------------------------------------

describe("ciExitCode", () => {
  it("returns 0 when there are no problems, regardless of ciMode", () => {
    expect(ciExitCode(0, true)).toBe(0);
    expect(ciExitCode(0, false)).toBe(0);
  });

  it("returns 1 when ciMode is true and there are problems", () => {
    expect(ciExitCode(1, true)).toBe(1);
    expect(ciExitCode(5, true)).toBe(1);
  });

  it("returns 0 when ciMode is false even with problems", () => {
    expect(ciExitCode(3, false)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration-style: classifyMarkers result feeds ciExitCode correctly
// ---------------------------------------------------------------------------

describe("classifyMarkers → ciExitCode integration", () => {
  it("yields exit 0 when all markers are in-bounds", () => {
    const markers: MarkerRow[] = [
      makeMarker({ id: "m1", datasetId: DATASET_ID_A, lon: -133.0, lat: 57.5 }),
    ];
    const bboxMap = new Map<string, Bbox | null>([[DATASET_ID_A, BBOX_SE_ALASKA]]);
    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);
    const problematic = outOfBounds.length + unknownDataset.length;
    expect(ciExitCode(problematic, true)).toBe(0);
  });

  it("yields exit 1 with --ci when there are out-of-bounds markers", () => {
    const markers: MarkerRow[] = [
      makeMarker({ id: "m1", datasetId: DATASET_ID_A, lon: -80.0, lat: 25.0 }),
    ];
    const bboxMap = new Map<string, Bbox | null>([[DATASET_ID_A, BBOX_SE_ALASKA]]);
    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);
    const problematic = outOfBounds.length + unknownDataset.length;
    expect(ciExitCode(problematic, true)).toBe(1);
  });

  it("yields exit 1 with --ci when there are unknown-dataset markers", () => {
    const markers: MarkerRow[] = [
      makeMarker({ id: "m1", datasetId: DATASET_ID_DELETED, lon: -133.0, lat: 57.5 }),
    ];
    const bboxMap = new Map<string, Bbox | null>([[DATASET_ID_DELETED, null]]);
    const { outOfBounds, unknownDataset } = classifyMarkers(markers, bboxMap);
    const problematic = outOfBounds.length + unknownDataset.length;
    expect(ciExitCode(problematic, true)).toBe(1);
  });
});
