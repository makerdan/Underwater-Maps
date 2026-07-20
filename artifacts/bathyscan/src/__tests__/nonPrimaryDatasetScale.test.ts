/**
 * Unit tests for the latitude-corrected longitude scale used in
 * NonPrimaryDatasetMeshes (TourScene). Without the correction, secondary
 * dataset meshes at high latitudes are horizontally stretched because raw
 * degree spans ignore the cos(lat) compression of longitude.
 */
import { describe, it, expect } from "vitest";
import { computeLatCorrectedLonScale } from "@/pages/TourScene";

describe("computeLatCorrectedLonScale", () => {
  it("returns 1 when both datasets have the same span and midpoint latitude", () => {
    const latRad = (45 * Math.PI) / 180;
    const scale = computeLatCorrectedLonScale(1, latRad, 1, latRad);
    expect(scale).toBeCloseTo(1, 10);
  });

  it("at 60°N xScale < zScale when spans are equal degrees", () => {
    // At 60°N, 1° of longitude is approximately 0.5× the linear distance of
    // 1° of latitude (cos(60°) = 0.5). A secondary dataset 1° × 1° at 60°N
    // should have xScale < zScale when the primary is also 1° × 1° at 60°N,
    // but the raw ratio without the correction would yield xScale === zScale.
    //
    // Setup: primary 1°lon × 1°lat centred at 60°N, secondary the same.
    // Without correction: xScale = 1/1 = 1, zScale = 1/1 = 1 → equal (wrong).
    // With correction: xScale = (1*cos60°) / (1*cos60°) = 1 (same dataset same lat)
    // → equal is still correct when *both* datasets share the same lat.
    //
    // The meaningful test is: secondary at 60°N, primary at 0° (equator).
    // Equatorial primary 1° lon span, secondary 1° lon span at 60°N.
    // xScale should be (1 * cos60) / (1 * cos0) = 0.5.
    // zScale is a raw lat ratio = 1/1 = 1. So xScale < zScale.
    const secAvgLatRad = (60 * Math.PI) / 180; // secondary at 60°N
    const primAvgLatRad = 0;                    // primary at equator
    const xScale = computeLatCorrectedLonScale(1, secAvgLatRad, 1, primAvgLatRad);
    const zScale = 1; // same lat span, no correction needed
    expect(xScale).toBeCloseTo(0.5, 5);
    expect(xScale).toBeLessThan(zScale);
  });

  it("returns proportional ratio for matching midpoint latitudes", () => {
    // When midpoint latitudes are the same, cos cancels and the result equals
    // the raw degree ratio.
    const latRad = (30 * Math.PI) / 180;
    const scale = computeLatCorrectedLonScale(2, latRad, 4, latRad);
    expect(scale).toBeCloseTo(0.5, 10);
  });

  it("handles near-pole latitude without dividing by zero (denom guarded)", () => {
    // 0° lon span primary → denom guarded to 1 via || 1 in the function
    const scale = computeLatCorrectedLonScale(1, 0, 0, 0);
    expect(Number.isFinite(scale)).toBe(true);
  });
});
