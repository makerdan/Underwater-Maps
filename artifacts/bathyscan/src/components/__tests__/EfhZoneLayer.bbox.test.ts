/**
 * Unit tests for the `polygonIntersectsBbox` helper exported from EfhZoneLayer.
 *
 * Covers:
 * - Polygon fully inside the bbox → true
 * - Polygon fully outside the bbox → false
 * - Partial overlap (one vertex inside the bbox) → true
 * - Bbox fully inside the polygon (ray-cast path) → true
 * - Edge case: empty ring → false
 * - Edge case: degenerate single-point ring → false
 * - Edge case: polygon exactly touching a bbox edge → true (inclusive boundary)
 * - Multiple polygons — only the intersecting one returns true
 *
 * The function is not a component, so no React or DOM setup is needed.
 */
import { describe, it, expect } from "vitest";
import { polygonIntersectsBbox } from "@/lib/efhBboxFilter";

const BBOX = {
  minLon: -150,
  maxLon: -140,
  minLat: 55,
  maxLat: 60,
};

describe("polygonIntersectsBbox", () => {
  // ── Polygon fully inside the bbox ────────────────────────────────────────

  it("returns true when the polygon is entirely inside the bbox", () => {
    const ring = [
      [-148, 56],
      [-145, 56],
      [-145, 58],
      [-148, 58],
      [-148, 56],
    ];
    expect(polygonIntersectsBbox(ring, BBOX)).toBe(true);
  });

  // ── Polygon fully outside the bbox ───────────────────────────────────────

  it("returns false when the polygon is entirely outside the bbox (far away)", () => {
    const ring = [
      [-130, 50],
      [-120, 50],
      [-120, 54],
      [-130, 54],
      [-130, 50],
    ];
    expect(polygonIntersectsBbox(ring, BBOX)).toBe(false);
  });

  it("returns false when the polygon is outside in each cardinal direction", () => {
    const toTheNorth = [
      [-148, 61],
      [-145, 61],
      [-145, 65],
      [-148, 65],
      [-148, 61],
    ];
    expect(polygonIntersectsBbox(toTheNorth, BBOX)).toBe(false);

    const toTheSouth = [
      [-148, 45],
      [-145, 45],
      [-145, 54],
      [-148, 54],
      [-148, 45],
    ];
    expect(polygonIntersectsBbox(toTheSouth, BBOX)).toBe(false);

    const toTheEast = [
      [-138, 56],
      [-135, 56],
      [-135, 59],
      [-138, 59],
      [-138, 56],
    ];
    expect(polygonIntersectsBbox(toTheEast, BBOX)).toBe(false);

    const toTheWest = [
      [-160, 56],
      [-155, 56],
      [-155, 59],
      [-160, 59],
      [-160, 56],
    ];
    expect(polygonIntersectsBbox(toTheWest, BBOX)).toBe(false);
  });

  // ── Partial overlap ───────────────────────────────────────────────────────

  it("returns true when one polygon vertex falls inside the bbox", () => {
    const ring = [
      [-155, 50],
      [-145, 50],
      [-145, 57],
      [-155, 57],
      [-155, 50],
    ];
    expect(polygonIntersectsBbox(ring, BBOX)).toBe(true);
  });

  it("returns true when the polygon straddles the bbox (overlaps but no vertex fully inside)", () => {
    // A tall thin strip that crosses the bbox vertically: no vertex is inside
    // the bbox, but the polygon edges cross through it.
    // Note: the current algorithm only checks vertices and corners-in-ring, so
    // a polygon that crosses bbox edges without any vertex inside and without
    // containing a bbox corner could still return false. This test documents
    // the actual behavior of the two-check algorithm for a crossing strip.
    const _crossingNSStrip = [
      [-146, 50],
      [-144, 50],
      [-144, 65],
      [-146, 65],
      [-146, 50],
    ];
    // The bbox corners (-150,55), (-140,55), (-140,60), (-150,60) are NOT all
    // inside this narrow strip. (-144 is inside the strip lon-range -146 to -144)
    // Actually (-140,55) IS inside the strip's lon range (-146 to -144)?
    // No: -140 > -144, so it's to the east of the strip. (-146 to -144 strip)
    // But (-144, 55) bbox corner is on the boundary.
    // Let's use a wider strip that contains bbox corners.
    const wideCrossNS = [
      [-155, 50],
      [-135, 50],
      [-135, 65],
      [-155, 65],
      [-155, 50],
    ];
    // All four bbox corners are inside this wide ring → should return true via ray-cast.
    expect(polygonIntersectsBbox(wideCrossNS, BBOX)).toBe(true);
  });

  // ── Bbox fully inside the polygon (ray-cast path) ─────────────────────────

  it("returns true when the bbox is fully contained inside the polygon (ray-cast)", () => {
    // A large polygon that completely surrounds the bbox; no polygon vertex
    // falls inside the bbox, but all bbox corners are inside the polygon.
    const ring = [
      [-160, 50],
      [-130, 50],
      [-130, 65],
      [-160, 65],
      [-160, 50],
    ];
    expect(polygonIntersectsBbox(ring, BBOX)).toBe(true);
  });

  it("returns true for a non-rectangular polygon surrounding the bbox", () => {
    // Diamond / rotated shape large enough to contain all bbox corners.
    const ring = [
      [-145, 50],
      [-135, 57.5],
      [-145, 65],
      [-155, 57.5],
      [-145, 50],
    ];
    expect(polygonIntersectsBbox(ring, BBOX)).toBe(true);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("returns false for an empty ring", () => {
    expect(polygonIntersectsBbox([], BBOX)).toBe(false);
  });

  it("returns false for a single-point (degenerate) ring outside the bbox", () => {
    const ring = [[-130, 50]];
    expect(polygonIntersectsBbox(ring, BBOX)).toBe(false);
  });

  it("returns true for a single-point ring whose vertex is inside the bbox", () => {
    const ring = [[-145, 57]];
    expect(polygonIntersectsBbox(ring, BBOX)).toBe(true);
  });

  it("returns false for a two-point (degenerate) ring that is outside the bbox", () => {
    const ring = [
      [-130, 50],
      [-125, 50],
    ];
    expect(polygonIntersectsBbox(ring, BBOX)).toBe(false);
  });

  it("returns true when a vertex touches the bbox boundary (inclusive)", () => {
    // Vertex exactly at the min-corner of the bbox.
    const ring = [
      [-150, 55],
      [-155, 55],
      [-155, 50],
      [-150, 55],
    ];
    expect(polygonIntersectsBbox(ring, BBOX)).toBe(true);
  });

  // ── Zones outside the bbox are excluded (the component filtering contract) ─

  it("correctly distinguishes an inside polygon from an outside polygon with the same bbox", () => {
    const inside = [
      [-148, 56],
      [-145, 56],
      [-145, 58],
      [-148, 58],
      [-148, 56],
    ];
    const outside = [
      [-130, 50],
      [-120, 50],
      [-120, 54],
      [-130, 54],
      [-130, 50],
    ];

    expect(polygonIntersectsBbox(inside, BBOX)).toBe(true);
    expect(polygonIntersectsBbox(outside, BBOX)).toBe(false);
  });

  it("returns false for a polygon near but not overlapping the bbox", () => {
    const justEast = [
      [-139.9, 56],
      [-138, 56],
      [-138, 58],
      [-139.9, 58],
      [-139.9, 56],
    ];
    expect(polygonIntersectsBbox(justEast, BBOX)).toBe(false);
  });

  // ── Edge-crossing cases (thin polygons that sneak through the two-check gap) ─
  //
  // The original two-check algorithm (vertex-in-bbox + bbox-corner-in-ring) has
  // a gap: a polygon whose edges cross bbox boundary lines but whose vertices are
  // all outside the bbox AND none of the four bbox corners fall inside the polygon
  // returns false even though the polygon visually overlaps the bbox.
  //
  // These tests exercise that gap.  With the segment-vs-bbox-edge check (check 3)
  // added to polygonIntersectsBbox they now correctly return true.

  it("returns true for a thin horizontal strip that crosses the left and right bbox edges (no vertex or corner inside)", () => {
    // A thin parallelogram at lat ~[56.5, 57.5], running west→east through the
    // entire bbox lon range.  All four vertices are outside the bbox (lon < minLon
    // or lon > maxLon).  No bbox corner has lat ∈ [56.5, 57.5] that would land
    // inside the strip, so the two-check algorithm returns false without check 3.
    //
    // BBOX: lon ∈ [-150, -140], lat ∈ [55, 60]
    //   P1 (-151, 56.5) — west of bbox
    //   P2 (-151, 57.5) — west of bbox
    //   P3 (-139, 57.5) — east of bbox
    //   P4 (-139, 56.5) — east of bbox
    //
    // Bbox corners at lat 55 and lat 60 are both outside this lat band → no
    // bbox corner is inside the polygon.  But the polygon's top and bottom edges
    // cross the left bbox edge (lon=-150) at lat ≈ 56.5–57.5, which is inside
    // the bbox's lat range [55, 60] → genuine overlap.
    const horizontalStrip = [
      [-151, 56.5],
      [-151, 57.5],
      [-139, 57.5],
      [-139, 56.5],
      [-151, 56.5],
    ];
    expect(polygonIntersectsBbox(horizontalStrip, BBOX)).toBe(true);
  });

  it("returns true for a thin diagonal strip that clips through the NE corner region without containing it", () => {
    // A thin parallelogram going from SW to NE, angled so that its edges cross
    // the top bbox edge (lat=60) and the right bbox edge (lon=-140) but the
    // actual NE corner point (-140, 60) is NOT inside the polygon.
    //
    // Strip direction: roughly (+1, +0.5), so the top and right bbox edges are
    // crossed while the corner sits just outside the narrow band.
    //
    // Vertices (all outside the bbox):
    //   P1 (-153, 53.0) — SW, south of bbox
    //   P2 (-151, 53.0) — SW, south of bbox
    //   P3 (-137, 63.0) — NE, north+east of bbox
    //   P4 (-139, 63.0) — NE, north+east of bbox
    //
    // The strip spans lon [-153, -137] and lat [53, 63], so it transects the
    // entire bbox region.  Its edges cross both the top (lat=60) and right
    // (lon=-140) bbox edges inside the valid bbox bounds.
    //
    // None of the four bbox corners (-150/−140, 55/60) fall inside this
    // narrow ~2-degree-wide strip (the strip's lat at lon=-150 is ≈ 56, and
    // at lon=-140 is ≈ 59 — both bbox corner lats of 55 and 60 miss the band).
    const diagonalStrip = [
      [-153, 53.0],
      [-151, 53.0],
      [-137, 63.0],
      [-139, 63.0],
      [-153, 53.0],
    ];
    expect(polygonIntersectsBbox(diagonalStrip, BBOX)).toBe(true);
  });

  it("returns false for a thin diagonal strip that passes close to the bbox but does not actually cross it", () => {
    // Same orientation as the diagonal strip above, but shifted so its edges
    // pass just east of the bbox's right edge — confirming no false positives.
    const missingStrip = [
      [-139, 53.0],
      [-137, 53.0],
      [-123, 63.0],
      [-125, 63.0],
      [-139, 53.0],
    ];
    expect(polygonIntersectsBbox(missingStrip, BBOX)).toBe(false);
  });

  it("returns true for a thin vertical strip that crosses the top and bottom bbox edges (no vertex or corner inside)", () => {
    // A narrow N-S strip at lon ≈ [-146, -144], extending well beyond the bbox
    // in latitude.  No vertex has lon ∈ [-150, -140] AND lat ∈ [55, 60]
    // (vertices have lat outside [55, 60]).  All bbox corners have lon outside
    // [-146, -144] (corners are at lon -150 and -140), so no corner is inside
    // the ring.  But the strip's left and right edges cross the top/bottom bbox
    // edges at lons that are inside the bbox lon range.
    const verticalStrip = [
      [-146, 50],
      [-144, 50],
      [-144, 65],
      [-146, 65],
      [-146, 50],
    ];
    // Note: the original crossingNSStrip test in "straddles the bbox" was an
    // exploratory comment; this test explicitly validates the edge-crossing fix.
    expect(polygonIntersectsBbox(verticalStrip, BBOX)).toBe(true);
  });
});
