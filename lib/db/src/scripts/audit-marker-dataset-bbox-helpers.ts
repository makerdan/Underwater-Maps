/**
 * audit-marker-dataset-bbox-helpers.ts
 *
 * Pure, side-effect-free helpers extracted from audit-marker-dataset-bbox.ts
 * so they can be unit-tested without a real database connection.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface MarkerRow {
  id: string;
  userId: string | null;
  datasetId: string | null;
  lon: number;
  lat: number;
}

// ---------------------------------------------------------------------------
// Point-in-bbox check (inclusive boundaries)
// ---------------------------------------------------------------------------

export function isInBbox(lon: number, lat: number, bbox: Bbox): boolean {
  return (
    lon >= bbox.minLon &&
    lon <= bbox.maxLon &&
    lat >= bbox.minLat &&
    lat <= bbox.maxLat
  );
}

// ---------------------------------------------------------------------------
// Classify markers into out-of-bounds and unknown-dataset buckets.
//
// bboxMap is expected to have an entry for every unique datasetId:
//   - Bbox object  → dataset exists; check point containment
//   - null         → dataset was deleted / not found in either table
// ---------------------------------------------------------------------------

export interface ClassifyResult {
  outOfBounds: MarkerRow[];
  unknownDataset: MarkerRow[];
}

export function classifyMarkers(
  markers: MarkerRow[],
  bboxMap: Map<string, Bbox | null>,
): ClassifyResult {
  const outOfBounds: MarkerRow[] = [];
  const unknownDataset: MarkerRow[] = [];

  for (const marker of markers) {
    const bbox = bboxMap.get(marker.datasetId as string);
    if (bbox === null) {
      unknownDataset.push(marker);
    } else if (bbox !== undefined && !isInBbox(marker.lon, marker.lat, bbox)) {
      outOfBounds.push(marker);
    }
    // bbox is defined and point is inside → in-bounds, no action
  }

  return { outOfBounds, unknownDataset };
}

// ---------------------------------------------------------------------------
// CI exit-code decision
//
// Returns 1 when ciMode is true and there are problematic entries, 0 otherwise.
// Callers are responsible for setting process.exitCode.
// ---------------------------------------------------------------------------

export function ciExitCode(
  problematicCount: number,
  ciMode: boolean,
): 0 | 1 {
  return ciMode && problematicCount > 0 ? 1 : 0;
}
