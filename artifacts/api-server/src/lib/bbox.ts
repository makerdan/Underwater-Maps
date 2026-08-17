/**
 * bbox.ts — shared bbox shape/containment helpers.
 *
 * Coverage bboxes arrive from JSONB blobs (dataset_catalog.coverage_bbox,
 * custom_datasets.terrain_json) whose shape is not enforced at the DB level.
 * A partially-populated or malformed bbox (missing fields, null, NaN,
 * ±Infinity, inverted bounds) silently poisons point-containment checks:
 * `NaN` comparisons always evaluate to false, so a marker that should be
 * rejected may be accepted — or rejected for the wrong reason.
 *
 * Every consumer must validate with `isValidBbox` before trusting a stored
 * bbox, and `isInsideBbox` independently fails closed (returns false) on
 * non-finite bounds so it is safe even if a caller forgets to pre-validate.
 */

export interface NormalisedBbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Returns true only when all four bbox fields are finite numbers and the
 * bounds are correctly ordered (minLon < maxLon, minLat < maxLat).
 * Rejects partial blobs (missing / null / non-numeric fields), non-finite
 * values (NaN, ±Infinity), and inverted or zero-area bounds.
 */
export function isValidBbox(b: unknown): b is NormalisedBbox {
  if (!b || typeof b !== "object") return false;
  const { minLon, minLat, maxLon, maxLat } = b as Record<string, unknown>;
  return (
    typeof minLon === "number" && Number.isFinite(minLon) &&
    typeof minLat === "number" && Number.isFinite(minLat) &&
    typeof maxLon === "number" && Number.isFinite(maxLon) &&
    typeof maxLat === "number" && Number.isFinite(maxLat) &&
    minLon < maxLon &&
    minLat < maxLat
  );
}

/**
 * Inclusive point-in-bbox check. Fails closed: returns false when any bbox
 * field is not a finite number, so a malformed bbox can never make every
 * point appear "inside".
 */
export function isInsideBbox(lon: number, lat: number, bbox: NormalisedBbox): boolean {
  if (
    !Number.isFinite(bbox.minLon) ||
    !Number.isFinite(bbox.minLat) ||
    !Number.isFinite(bbox.maxLon) ||
    !Number.isFinite(bbox.maxLat)
  ) {
    return false;
  }
  return lon >= bbox.minLon && lon <= bbox.maxLon && lat >= bbox.minLat && lat <= bbox.maxLat;
}
