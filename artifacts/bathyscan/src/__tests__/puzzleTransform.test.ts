/**
 * Unit tests for the Apply-to-3D pipeline (Task: apply saved puzzle layout to
 * 3D scene geography):
 *
 *  - puzzleLayoutToGeoCorrections: identity transforms → deltas ≈ 0
 *    (Regression Guard: an all-identity layout must never shift any dataset),
 *    known pixel translation → expected degree shift, rotation around the
 *    tile centre → no centre shift (angle retained as heading only).
 *  - applyGeoCorrectionToGrid: zero/absent corrections return the SAME grid
 *    object (parameter presence alone can never move the render origin);
 *    non-zero corrections shift the bbox copy without mutating the input.
 *  - terrainStore promote path: setDatasetGeoCorrections / setPrimary store
 *    corrections without touching the stored grids' bboxes.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import {
  applyPuzzleTransformToLonLat,
  puzzleLayoutToGeoCorrections,
  type GeoBbox,
} from "@/lib/puzzleTransform";
import type { OverviewTransform } from "@/lib/overviewRenderer";
import {
  applyGeoCorrectionToGrid,
  computeSecondaryMeshTransform,
} from "@/components/NonPrimaryDatasetMeshes";
import { useTerrainStore } from "@/lib/terrainStore";

// Reference grid spanning 10° × 10°. With pxPerDeg=10 and scale=1, the canvas
// maps exactly 10 px per degree in both axes — easy mental math for expected
// deltas (tx=+20 px → dLon=+2°; ty=+10 px → dLat=−1°, canvas Y points south).
const REF_GRID = {
  datasetId: "ref",
  minLon: -100,
  maxLon: -90,
  minLat: 30,
  maxLat: 40,
  minDepth: 0,
  maxDepth: 10,
  width: 2,
  height: 2,
  resolution: 2,
  depths: [0, 5, 5, 10],
} as unknown as TerrainData;

const OV: OverviewTransform = { scale: 1, offsetX: 0, offsetY: 0, pxPerDeg: 10 };

const BBOXES: Record<string, GeoBbox> = {
  "ds-a": { minLon: -99, maxLon: -97, minLat: 31, maxLat: 33 },
  "ds-b": { minLon: -95, maxLon: -93, minLat: 35, maxLat: 37 },
};

function makeGrid(datasetId: string, bbox?: GeoBbox): TerrainData {
  return {
    datasetId,
    minLon: bbox?.minLon ?? 0,
    maxLon: bbox?.maxLon ?? 1,
    minLat: bbox?.minLat ?? 0,
    maxLat: bbox?.maxLat ?? 1,
    minDepth: 0,
    maxDepth: 10,
    width: 2,
    height: 2,
    resolution: 2,
    depths: [0, 5, 5, 10],
  } as unknown as TerrainData;
}

describe("puzzleLayoutToGeoCorrections", () => {
  it("all-identity transforms produce deltas ≈ 0 for every tile (Regression Guard)", () => {
    const out = puzzleLayoutToGeoCorrections(
      [
        { datasetId: "ds-a", tx: 0, ty: 0, angleDeg: 0 },
        { datasetId: "ds-b", tx: 0, ty: 0, angleDeg: 0 },
      ],
      BBOXES,
      REF_GRID,
      OV,
    );
    expect(Object.keys(out).sort()).toEqual(["ds-a", "ds-b"]);
    for (const id of ["ds-a", "ds-b"]) {
      expect(Math.abs(out[id]!.dLon)).toBeLessThan(1e-9);
      expect(Math.abs(out[id]!.dLat)).toBeLessThan(1e-9);
      expect(out[id]!.angleDeg).toBe(0);
    }
  });

  it("known pixel translation produces the expected degree shift", () => {
    // 10 px per degree: tx=+20 px → +2° lon; ty=+10 px → −1° lat (Y is south-down).
    const out = puzzleLayoutToGeoCorrections(
      [{ datasetId: "ds-a", tx: 20, ty: 10, angleDeg: 0 }],
      BBOXES,
      REF_GRID,
      OV,
    );
    expect(out["ds-a"]!.dLon).toBeCloseTo(2, 9);
    expect(out["ds-a"]!.dLat).toBeCloseTo(-1, 9);
  });

  it("scale is honoured: the same tx at scale=2 shifts half as many degrees", () => {
    const out = puzzleLayoutToGeoCorrections(
      [{ datasetId: "ds-a", tx: 20, ty: 0, angleDeg: 0 }],
      BBOXES,
      REF_GRID,
      { ...OV, scale: 2 },
    );
    expect(out["ds-a"]!.dLon).toBeCloseTo(1, 9);
    expect(out["ds-a"]!.dLat).toBeCloseTo(0, 9);
  });

  it("90° rotation around the tile centre leaves the centre unmoved and retains angleDeg", () => {
    const out = puzzleLayoutToGeoCorrections(
      [{ datasetId: "ds-a", tx: 0, ty: 0, angleDeg: 90 }],
      BBOXES,
      REF_GRID,
      OV,
    );
    // The pivot IS the tile centre — rotating a point around itself is a no-op.
    expect(Math.abs(out["ds-a"]!.dLon)).toBeLessThan(1e-9);
    expect(Math.abs(out["ds-a"]!.dLat)).toBeLessThan(1e-9);
    expect(out["ds-a"]!.angleDeg).toBe(90);
  });

  it("90° rotation quarter-turns an OFF-centre point (matches applyPuzzleTransformToLonLat)", () => {
    // Sanity-check the underlying transform the corrections are derived from:
    // a point 1° east of the tile centre, rotated +90° (canvas clockwise,
    // Y-down), must land 1° SOUTH of the centre (identical square spans → the
    // px offset is symmetric in x and y).
    const center = { lon: -98, lat: 32 }; // ds-a bbox centre
    const rotated = applyPuzzleTransformToLonLat(
      center.lon + 1,
      center.lat,
      center.lon,
      center.lat,
      { tx: 0, ty: 0, angleDeg: 90, flipH: false, flipV: false },
      REF_GRID,
      OV,
    );
    expect(rotated.lon).toBeCloseTo(center.lon, 9);
    expect(rotated.lat).toBeCloseTo(center.lat - 1, 9);
  });

  it("skips tiles whose dataset has no known bbox", () => {
    const out = puzzleLayoutToGeoCorrections(
      [{ datasetId: "ds-unknown", tx: 5, ty: 5, angleDeg: 0 }],
      BBOXES,
      REF_GRID,
      OV,
    );
    expect(out).toEqual({});
  });
});

describe("applyGeoCorrectionToGrid", () => {
  const grid = makeGrid("ds-a", BBOXES["ds-a"]);

  it("returns the SAME grid object for absent, null, and zero corrections", () => {
    expect(applyGeoCorrectionToGrid(grid, undefined)).toBe(grid);
    expect(applyGeoCorrectionToGrid(grid, null)).toBe(grid);
    // Regression Guard: a zero correction must be EXACTLY equivalent to no
    // correction — same reference, so the render origin cannot shift.
    expect(applyGeoCorrectionToGrid(grid, { dLon: 0, dLat: 0 })).toBe(grid);
  });

  it("zero correction yields a render transform identical to no correction", () => {
    const primary = makeGrid("primary", { minLon: -99.5, maxLon: -96.5, minLat: 30.5, maxLat: 33.5 });
    const withZero = computeSecondaryMeshTransform(
      primary,
      applyGeoCorrectionToGrid(grid, { dLon: 0, dLat: 0 }),
    );
    const without = computeSecondaryMeshTransform(primary, grid);
    expect(withZero).toEqual(without);
  });

  it("uses the saved heading as a secondary group Y rotation while zero stays identity (Regression Guard)", () => {
    const primary = makeGrid("primary", { minLon: -99.5, maxLon: -96.5, minLat: 30.5, maxLat: 33.5 });
    const identity = computeSecondaryMeshTransform(primary, grid, { angleDeg: 0 });
    const rotated = computeSecondaryMeshTransform(primary, grid, { angleDeg: 90 });

    // The heading is the only changed part of the shared terrain/marker group
    // transform, so rotation cannot alter the established placement or scale.
    expect({ ...rotated, rotationY: 0 }).toEqual(identity);
    expect(identity.rotationY).toBe(0);
    expect(rotated.rotationY).toBeCloseTo(Math.PI / 2, 12);
  });

  it("shifts the bbox copy by the delta and never mutates the input grid", () => {
    const before = { minLon: grid.minLon, maxLon: grid.maxLon, minLat: grid.minLat, maxLat: grid.maxLat };
    const shifted = applyGeoCorrectionToGrid(grid, { dLon: 0.5, dLat: -0.25 });
    expect(shifted).not.toBe(grid);
    expect(shifted.minLon).toBeCloseTo(before.minLon + 0.5, 12);
    expect(shifted.maxLon).toBeCloseTo(before.maxLon + 0.5, 12);
    expect(shifted.minLat).toBeCloseTo(before.minLat - 0.25, 12);
    expect(shifted.maxLat).toBeCloseTo(before.maxLat - 0.25, 12);
    // Spans are preserved — corrections translate, never resize.
    expect(shifted.maxLon - shifted.minLon).toBeCloseTo(before.maxLon - before.minLon, 12);
    // Grid data is carried by reference, untouched.
    expect(shifted.depths).toBe(grid.depths);
    // Input grid unchanged (stored bboxes must never be mutated).
    expect(grid.minLon).toBe(before.minLon);
    expect(grid.maxLat).toBe(before.maxLat);
  });

  it("shifting the secondary grid moves the mesh centre by the same geographic delta", () => {
    const primary = makeGrid("primary", { minLon: -99.5, maxLon: -96.5, minLat: 30.5, maxLat: 33.5 });
    const base = computeSecondaryMeshTransform(primary, grid);
    const shifted = computeSecondaryMeshTransform(
      primary,
      applyGeoCorrectionToGrid(grid, { dLon: 1, dLat: 0 }),
    );
    // Same scale (spans unchanged), different centre — placement-only change.
    expect(shifted.xScale).toBeCloseTo(base.xScale, 12);
    expect(shifted.zScale).toBeCloseTo(base.zScale, 12);
    expect(shifted.cx).not.toBeCloseTo(base.cx, 6);
    expect(shifted.cz).toBeCloseTo(base.cz, 12);
  });
});

describe("terrainStore geo corrections", () => {
  beforeEach(() => {
    useTerrainStore.getState().clear();
  });

  it("setDatasetGeoCorrections stores corrections and leaves stored grid bboxes intact", () => {
    const gA = makeGrid("ds-a", BBOXES["ds-a"]);
    const gB = makeGrid("ds-b", BBOXES["ds-b"]);
    useTerrainStore.getState().setGrids({ activeGrid: gA, overviewGrid: gA });
    useTerrainStore.getState().toggleVisible({ datasetId: "ds-b", source: "preset" });
    useTerrainStore.getState().setDatasetGrids("ds-b", { activeGrid: gB, overviewGrid: gB });

    useTerrainStore.getState().setDatasetGeoCorrections({
      "ds-a": { dLon: 0.1, dLat: -0.2, angleDeg: 15 },
    });

    const s = useTerrainStore.getState();
    const a = s.visibleDatasets.find((v) => v.datasetId === "ds-a")!;
    const b = s.visibleDatasets.find((v) => v.datasetId === "ds-b")!;
    expect(a.geoCorrection).toEqual({ dLon: 0.1, dLat: -0.2, angleDeg: 15 });
    expect(b.geoCorrection ?? null).toBeNull();
    // Stored grids are the SAME objects with untouched bboxes.
    expect(a.activeGrid).toBe(gA);
    expect(a.activeGrid!.minLon).toBe(BBOXES["ds-a"]!.minLon);
    expect(b.activeGrid).toBe(gB);
    // Grids survive the bulk update (no null-grid rebuild).
    expect(a.overviewGrid).toBe(gA);
    expect(b.overviewGrid).toBe(gB);
  });

  it("setDatasetGeoCorrections(null) clears all corrections", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("ds-a") });
    useTerrainStore.getState().setDatasetGeoCorrections({
      "ds-a": { dLon: 1, dLat: 1, angleDeg: 0 },
    });
    useTerrainStore.getState().setDatasetGeoCorrections(null);
    const a = useTerrainStore.getState().visibleDatasets[0]!;
    expect(a.geoCorrection ?? null).toBeNull();
  });

  it("setPrimary preserves an existing correction when the parameter is omitted", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("ds-a") });
    useTerrainStore.getState().toggleVisible({ datasetId: "ds-b", source: "preset" });
    useTerrainStore.getState().setDatasetGeoCorrections({
      "ds-b": { dLon: 0.3, dLat: 0.4, angleDeg: 0 },
    });
    // Promote ds-b with NO geoCorrection argument — correction must survive.
    useTerrainStore.getState().setPrimary("ds-b");
    const s = useTerrainStore.getState();
    expect(s.primaryDatasetId).toBe("ds-b");
    expect(s.visibleDatasets[0]!.geoCorrection).toEqual({ dLon: 0.3, dLat: 0.4, angleDeg: 0 });
  });

  it("setPrimary can set and explicitly clear a correction", () => {
    useTerrainStore.getState().setPrimary("ds-a", "preset", null, { dLon: 1, dLat: 2, angleDeg: 90 });
    expect(useTerrainStore.getState().visibleDatasets[0]!.geoCorrection).toEqual({
      dLon: 1,
      dLat: 2,
      angleDeg: 90,
    });
    useTerrainStore.getState().setPrimary("ds-a", "preset", null, null);
    expect(useTerrainStore.getState().visibleDatasets[0]!.geoCorrection).toBeNull();
  });
});
