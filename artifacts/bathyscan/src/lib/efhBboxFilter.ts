/**
 * Shared EFH bbox-intersection helpers used by both the 3D EfhZoneLayer and
 * the 2D OverviewMap so that they clip polygons identically.
 */
import type { EfhFeature } from "@workspace/api-client-react";

export interface Bbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/** Ray-casting point-in-polygon test for a single ring. */
export function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i]?.[0] ?? 0;
    const yi = ring[i]?.[1] ?? 0;
    const xj = ring[j]?.[0] ?? 0;
    const yj = ring[j]?.[1] ?? 0;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Returns true if the segment (x1,y1)→(x2,y2) crosses an axis-aligned bbox
 * edge.  The bbox edge is identified by:
 *   - fixedX=true  → a vertical edge at x=fixedVal, bounded by [boundMin,boundMax] in y
 *   - fixedX=false → a horizontal edge at y=fixedVal, bounded by [boundMin,boundMax] in x
 *
 * Used internally by polygonIntersectsBbox to catch the "edge-crossing" gap
 * where a thin diagonal polygon crosses bbox boundary edges without any vertex
 * falling inside the bbox and without any bbox corner falling inside the polygon.
 */
function segmentCrossesBboxEdge(
  x1: number, y1: number,
  x2: number, y2: number,
  fixedX: boolean,
  fixedVal: number,
  boundMin: number,
  boundMax: number,
): boolean {
  // Rotate coordinate system so "a" is always the axis of the fixed edge value
  // and "b" is the bounded axis.
  const a1 = fixedX ? x1 : y1;
  const b1 = fixedX ? y1 : x1;
  const a2 = fixedX ? x2 : y2;
  const b2 = fixedX ? y2 : x2;

  if (a1 === a2) return false; // segment is parallel to the edge — no crossing
  const t = (fixedVal - a1) / (a2 - a1);
  if (t < 0 || t > 1) return false; // crossing point is outside the segment
  const b = b1 + t * (b2 - b1);
  return b >= boundMin && b <= boundMax;
}

/**
 * Returns true if the polygon ring (outer ring of a GeoJSON Polygon)
 * intersects the given bounding box.
 *
 * Three checks together cover all intersection cases:
 *   1. Any polygon vertex falls inside the bbox (polygon overlaps or is contained).
 *   2. Any bbox corner falls inside the ring via ray-casting (bbox is fully
 *      contained by the polygon).
 *   3. Any polygon edge crosses any of the four bbox edges (edge-crossing case:
 *      thin/diagonal polygons that cross the bbox boundary without satisfying
 *      checks 1 or 2 — e.g. a narrow strip that threads between bbox corners).
 */
export function polygonIntersectsBbox(ring: number[][], bbox: Bbox): boolean {
  const { minLon, maxLon, minLat, maxLat } = bbox;

  // Check 1: vertex inside bbox
  for (const pt of ring) {
    const lon = pt[0] ?? 0;
    const lat = pt[1] ?? 0;
    if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) {
      return true;
    }
  }

  // Check 2: bbox corner inside polygon
  const corners: [number, number][] = [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
  ];
  for (const [cx, cy] of corners) {
    if (pointInRing(cx, cy, ring)) return true;
  }

  // Check 3: polygon edge crosses a bbox edge
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x1 = ring[j]?.[0] ?? 0;
    const y1 = ring[j]?.[1] ?? 0;
    const x2 = ring[i]?.[0] ?? 0;
    const y2 = ring[i]?.[1] ?? 0;
    if (
      // vertical bbox edges (left and right)
      segmentCrossesBboxEdge(x1, y1, x2, y2, true, minLon, minLat, maxLat) ||
      segmentCrossesBboxEdge(x1, y1, x2, y2, true, maxLon, minLat, maxLat) ||
      // horizontal bbox edges (bottom and top)
      segmentCrossesBboxEdge(x1, y1, x2, y2, false, minLat, minLon, maxLon) ||
      segmentCrossesBboxEdge(x1, y1, x2, y2, false, maxLat, minLon, maxLon)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Filters an EFH feature list to only those whose geometry intersects the given
 * bbox.  If the bbox is degenerate (zero extent in either dimension) every
 * feature is kept so callers never end up with an empty overlay by accident.
 *
 * This mirrors the clipping logic in EfhZoneLayer so the 2D overview map and
 * the 3D scene always show the same set of polygons.
 */
export function filterEfhByBbox(features: EfhFeature[], bbox: Bbox): EfhFeature[] {
  const hasBbox = bbox.minLon !== bbox.maxLon && bbox.minLat !== bbox.maxLat;
  if (!hasBbox) return features;

  return features.filter((f) => {
    const geom = f.geometry as {
      type?: string;
      coordinates?: number[][][] | number[][][][];
    };

    if (geom.type === "Polygon") {
      const outerRing = (geom.coordinates as number[][][] | undefined)?.[0];
      return outerRing ? polygonIntersectsBbox(outerRing, bbox) : false;
    } else if (geom.type === "MultiPolygon") {
      const polys = geom.coordinates as number[][][][] | undefined;
      return (
        polys?.some((rings) => {
          const outerRing = rings[0];
          return outerRing ? polygonIntersectsBbox(outerRing, bbox) : false;
        }) ?? false
      );
    }
    return false;
  });
}

/**
 * Returns the subset of EFH features that are both within the given bbox and
 * not suppressed by the hidden-species filter.  This is the single source of
 * truth for "what the user can currently see and interact with", used by both
 * the 2D render loop and the 2D click/hit-test path so they can never drift
 * apart.
 */
export function getVisibleEfhFeatures(
  features: EfhFeature[],
  bbox: Bbox,
  hiddenSpecies: ReadonlySet<string>,
): EfhFeature[] {
  return filterEfhByBbox(features, bbox).filter(
    (f) => !hiddenSpecies.has(f.properties.commonName ?? ""),
  );
}
