/**
 * Geographic bounds helpers shared by GPS and map interaction code.
 *
 * A bbox with minLon > maxLon crosses the antimeridian.  For those boxes the
 * longitude interval is continuous from minLon eastward through 180/-180 to
 * maxLon (for example 170..-170 is a 20° interval).  Keeping the conversion
 * here prevents GPS eligibility and map hit-testing from disagreeing.
 */

export interface GeographicBbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/** Longitude span in degrees on the bbox's continuous longitude frame. */
export function geographicLonRange(bbox: Pick<GeographicBbox, "minLon" | "maxLon">): number {
  const span = bbox.minLon > bbox.maxLon
    ? bbox.maxLon + 360 - bbox.minLon
    : bbox.maxLon - bbox.minLon;
  return span || 1;
}

/**
 * Put a longitude on the continuous frame beginning at bbox.minLon.
 * Normal bboxes retain their ordinary values; wrapped bboxes map values such
 * as -175 to 185 when minLon is 170.
 */
export function longitudeOnBboxFrame(
  lon: number,
  bbox: Pick<GeographicBbox, "minLon" | "maxLon">,
): number {
  if (bbox.minLon <= bbox.maxLon) return lon;
  let frameLon = lon;
  while (frameLon < bbox.minLon) frameLon += 360;
  while (frameLon >= bbox.minLon + 360) frameLon -= 360;
  return frameLon;
}

/** True when a point is inside a normal or antimeridian-crossing bbox. */
export function isPointInGeographicBounds(
  lon: number,
  lat: number,
  bbox: GeographicBbox,
): boolean {
  if (lat < bbox.minLat || lat > bbox.maxLat) return false;
  const frameLon = longitudeOnBboxFrame(lon, bbox);
  return frameLon >= bbox.minLon &&
    frameLon <= bbox.minLon + geographicLonRange(bbox);
}
