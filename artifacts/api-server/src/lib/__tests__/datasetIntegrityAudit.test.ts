import { describe, expect, it } from "vitest";

import {
  auditDatasetIntegrity,
  compareTerrainArtifacts,
  DATASET_INTEGRITY_AUDIT_VERSION,
} from "../datasetIntegrityAudit.js";

function healthy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    datasetId: "audit-fixture",
    width: 2,
    height: 2,
    depths: [1, 2, 3, 4],
    minDepth: 1,
    maxDepth: 4,
    minLon: 170,
    maxLon: -170,
    minLat: 10,
    maxLat: 20,
    centerLon: 180,
    centerLat: 15,
    orientation: { row0: "south", columns: "west-to-east" },
    sourceOrientation: { row0: "south", columns: "west-to-east" },
    crs: "EPSG:4326",
    dataSource: "ncei",
    ...overrides,
  };
}

function reasons(report: ReturnType<typeof auditDatasetIntegrity>): string[] {
  return report.findings.map((finding) => finding.reason);
}

describe("dataset integrity audit", () => {
  it("returns a deterministic passing contract for a complete antimeridian artifact", () => {
    const input = healthy();
    const first = auditDatasetIntegrity(input);
    const second = auditDatasetIntegrity(input);

    expect(first).toEqual(second);
    expect(first.version).toBe(DATASET_INTEGRITY_AUDIT_VERSION);
    expect(first.datasetId).toBe("audit-fixture");
    expect(first.metrics.antimeridianCrossing).toBe(true);
    expect(first.gpsPlacementReady).toBe(true);
    expect(first.status).toBe("pass");
    expect(first.findings.every((finding) => finding.severity === "pass")).toBe(true);
  });

  it("blocks malformed shape and non-finite values without throwing", () => {
    const report = auditDatasetIntegrity({
      ...healthy(),
      width: 3,
      depths: [1, Number.POSITIVE_INFINITY],
    });

    expect(report.status).toBe("blocked");
    expect(reasons(report)).toEqual(expect.arrayContaining([
      "grid_cardinality_mismatch",
      "grid_values_non_finite",
    ]));
    expect(report.metrics.depthInvalidFiniteCount).toBe(1);
  });

  it("treats null and NaN as no-data, but blocks an all-no-data grid", () => {
    const partial = auditDatasetIntegrity(healthy({ depths: [1, null, Number.NaN, 4] }));
    expect(partial.status).toBe("warning");
    expect(partial.metrics.depthNoDataCount).toBe(2);
    expect(partial.metrics.depthNoDataRatio).toBe(0.5);

    const empty = auditDatasetIntegrity(healthy({ depths: [null, null, Number.NaN, null] }));
    expect(empty.status).toBe("blocked");
    expect(reasons(empty)).toEqual(expect.arrayContaining(["grid_all_nodata"]));
  });

  it("blocks negative depth/topography values instead of guessing the convention", () => {
    const report = auditDatasetIntegrity(healthy({
      depths: [-1, 2, 3, 4],
      topography: [0, 1, -2, 0],
    }));

    expect(report.status).toBe("blocked");
    expect(reasons(report)).toEqual(expect.arrayContaining([
      "depth_semantics_invalid",
      "topography_semantics_invalid",
    ]));
  });

  it("warns when a supplied topography layer is mostly no-data", () => {
    const report = auditDatasetIntegrity(healthy({
      topography: [null, Number.NaN, 2, 0],
    }));

    expect(report.status).toBe("warning");
    expect(report.metrics.topographyNoDataRatio).toBe(0.5);
    expect(reasons(report)).toContain("topography_nodata_ratio_high");
  });

  it("reports missing orientation, CRS, and provenance as uncertainty", () => {
    const input = healthy();
    delete input.orientation;
    delete input.crs;
    delete input.dataSource;
    const report = auditDatasetIntegrity(input);

    expect(report.status).toBe("warning");
    expect(report.gpsPlacementReady).toBe(false);
    expect(reasons(report)).toEqual(expect.arrayContaining([
      "orientation_unknown",
      "crs_unknown",
      "provenance_unknown",
      "gps_placement_uncertain",
    ]));
  });

  it("blocks an explicitly north-first served grid and invalid geographic metadata", () => {
    const report = auditDatasetIntegrity(healthy({
      orientation: { row0: "north", columns: "west-to-east" },
      minLat: 20,
      maxLat: 10,
      centerLat: 15,
      crs: "EPSG:3857",
    }));

    expect(report.status).toBe("blocked");
    expect(reasons(report)).toEqual(expect.arrayContaining([
      "bbox_invalid",
      "orientation_not_row_zero_south",
      "crs_not_wgs84",
    ]));
  });

  it("compares lifecycle stages and names shape, bounds, and orientation drift", () => {
    const persisted = healthy();
    const served = healthy({
      width: 4,
      height: 1,
      depths: [1, 2, 3, 4],
      minLon: -170,
      maxLon: 170,
      orientation: { row0: "north", columns: "west-to-east" },
    });
    const report = compareTerrainArtifacts(persisted, served);

    expect(report.status).toBe("blocked");
    expect(report.findings.map((finding) => finding.reason)).toEqual(expect.arrayContaining([
      "parity_shape_drift",
      "parity_bounds_drift",
      "parity_orientation_drift",
    ]));
    expect(persisted).toEqual(healthy());
    expect(served).toEqual(expect.objectContaining({ width: 4 }));
  });

  it("bounds report size even when a caller requests an excessive limit", () => {
    const report = auditDatasetIntegrity({}, { maxFindings: 10_000 });
    expect(report.findings.length).toBeLessThanOrEqual(32);
  });
});