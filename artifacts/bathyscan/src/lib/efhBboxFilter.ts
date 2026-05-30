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
 * Returns true if the polygon ring (outer ring of a GeoJSON Polygon)
 * intersects the given bounding box.
 *
 * Two checks cover all cases:
 *   1. Any polygon vertex falls inside the bbox (polygon overlaps or is contained).
 *   2. Any bbox corner falls inside the ring via ray-casting (bbox is fully
 *      contained by the polygon).
 */
export function polygonIntersectsBbox(ring: number[][], bbox: Bbox): boolean {
  const { minLon, maxLon, minLat, maxLat } = bbox;

  for (const pt of ring) {
    const lon = pt[0] ?? 0;
    const lat = pt[1] ?? 0;
    if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) {
      return true;
    }
  }

  const corners: [number, number][] = [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
  ];
  for (const [cx, cy] of corners) {
    if (pointInRing(cx, cy, ring)) return true;
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
