/**
 * RemoteData<T> — discriminated union for async data fields.
 *
 * Replaces the common pattern of `T | null` (or `T | null` + `loading: boolean`
 * + `error: Error | null`) with a single field that makes every state explicit
 * and unrepresentable-invalid.
 *
 * Usage in a Zustand store:
 *
 *   interface MyStore {
 *     userData: RemoteData<User>;
 *     loadUser: (id: string) => Promise<void>;
 *   }
 *
 *   // Reading:
 *   const userData = useMyStore((s) => s.userData);
 *   if (userData.status === 'done') {
 *     console.log(userData.data.name);
 *   }
 *
 * Candidate fields for follow-on migration to RemoteData<T>:
 *   - tidalStore: station + stationStatus → RemoteData<TideStationInfo>
 *   - tidalStore: samples + predictionsStatus → RemoteData<TideSample[]>
 *   - tidalStore: datums + datumsStatus → RemoteData<TideStationDatums>
 *   - classificationStore: zoneMap + loading + error → RemoteData<Uint8Array>
 *   - habitatStore: scores + implicit-loading → RemoteData<Float32Array>
 */

/** Data has not been requested yet. */
export interface RemoteDataIdle {
  readonly status: "idle";
}

/** A fetch/compute is in progress. */
export interface RemoteDataLoading {
  readonly status: "loading";
}

/** Data was successfully fetched/computed. */
export interface RemoteDataDone<T> {
  readonly status: "done";
  readonly data: T;
}

/** The fetch/compute failed. */
export interface RemoteDataError {
  readonly status: "error";
  readonly error: Error;
}

/**
 * Discriminated union for async data. Use `rd.status` to narrow to a branch.
 *
 * - `"idle"`: not yet requested
 * - `"loading"`: request in flight
 * - `"done"`: data available at `rd.data`
 * - `"error"`: failed, reason at `rd.error`
 */
export type RemoteData<T> =
  | RemoteDataIdle
  | RemoteDataLoading
  | RemoteDataDone<T>
  | RemoteDataError;

/** Convenience constructors so call-sites stay terse. */
export const RemoteData = {
  idle: (): RemoteDataIdle => ({ status: "idle" }),
  loading: (): RemoteDataLoading => ({ status: "loading" }),
  done: <T>(data: T): RemoteDataDone<T> => ({ status: "done", data }),
  error: (error: Error): RemoteDataError => ({ status: "error", error }),
} as const;

// ---------------------------------------------------------------------------
// Geographic frame
// ---------------------------------------------------------------------------

/**
 * A latitude/longitude rectangle in the canonical geographic frame.
 *
 * Longitudes are normally in [-180, 180].  A rectangle may cross the
 * antimeridian, in which case minLon > maxLon (for example 170..-170).
 * The interval is always the shorter, continuous west-to-east arc described
 * by those endpoints.  This contract, rather than ordinary numeric bbox
 * arithmetic, is the authority for 2D map-frame continuity.
 *
 * Terrain grids retain their serving convention separately: row 0 is south
 * and columns increase west-to-east.  This frame does not repair source
 * metadata or reinterpret positive-down depth values.
 */
export interface GeoBounds {
  readonly minLon: number;
  readonly maxLon: number;
  readonly minLat: number;
  readonly maxLat: number;
}

export interface GeoPoint {
  readonly lon: number;
  readonly lat: number;
}

export interface GeoCanvasPoint {
  readonly x: number;
  readonly y: number;
}

const GEO_FULL_CIRCLE = 360;

/** Normalize a longitude into the half-open interval [-180, 180). */
export function normalizeLongitude(lon: number): number {
  const wrapped = ((lon + 180) % GEO_FULL_CIRCLE + GEO_FULL_CIRCLE) % GEO_FULL_CIRCLE - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

/** Return the continuous west-to-east span of a bounds interval. */
export function longitudeSpan(bounds: Pick<GeoBounds, "minLon" | "maxLon">): number {
  const span =
    ((bounds.maxLon - bounds.minLon) % GEO_FULL_CIRCLE + GEO_FULL_CIRCLE) %
    GEO_FULL_CIRCLE;
  return span || (bounds.minLon !== bounds.maxLon ? GEO_FULL_CIRCLE : 1);
}

/** Put a longitude on the continuous number line beginning at bounds.minLon. */
export function unwrapLongitude(
  lon: number,
  bounds: Pick<GeoBounds, "minLon" | "maxLon">,
): number {
  const start = bounds.minLon;
  let result = normalizeLongitude(lon);
  while (result < start) result += GEO_FULL_CIRCLE;
  while (result >= start + GEO_FULL_CIRCLE) result -= GEO_FULL_CIRCLE;
  return result;
}

function mergeCircularIntervals(
  bounds: readonly Pick<GeoBounds, "minLon" | "maxLon">[],
): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  for (const boundsItem of bounds) {
    const start = ((normalizeLongitude(boundsItem.minLon) + 180) % 360 + 360) % 360;
    const span = Math.min(360, Math.max(0, longitudeSpan(boundsItem)));
    const end = start + span;
    if (span >= 360) return [[0, 360]];
    if (end <= 360) segments.push([start, end]);
    else {
      segments.push([start, 360]);
      segments.push([0, end - 360]);
    }
  }
  segments.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && segment[0] <= last[1]) last[1] = Math.max(last[1], segment[1]);
    else merged.push([...segment]);
  }
  return merged;
}

/**
 * Compute an order-independent continuous union.  When separate extents
 * leave more than one possible wrap, the largest uncovered circular gap is
 * used as the cut; ties use the westernmost cut deterministically.
 */
export function unionGeoBounds(
  bounds: readonly (GeoBounds | null | undefined)[],
): GeoBounds | null {
  const valid = bounds.filter((item): item is GeoBounds => Boolean(item));
  if (valid.length === 0) return null;
  const merged = mergeCircularIntervals(valid);
  const latMin = Math.min(...valid.map((item) => item.minLat));
  const latMax = Math.max(...valid.map((item) => item.maxLat));
  if (merged.length === 1 && merged[0]![0] === 0 && merged[0]![1] === 360) {
    return { minLon: -180, maxLon: 180, minLat: latMin, maxLat: latMax };
  }

  let largestGap = -1;
  let cut = 0;
  for (let i = 0; i < merged.length; i++) {
    const current = merged[i]!;
    const next = merged[(i + 1) % merged.length]!;
    const gapStart = current[1];
    const gap = i === merged.length - 1 ? next[0] + 360 - gapStart : next[0] - gapStart;
    if (gap > largestGap) {
      largestGap = gap;
      // The continuous covered arc begins after the largest uncovered gap,
      // i.e. at the next segment's start (not at the gap's start).
      cut = next[0] % 360;
    }
  }
  const coveredSpan = 360 - largestGap;
  const minLon = normalizeLongitude(cut - 180);
  const maxLon = normalizeLongitude(cut - 180 + coveredSpan);
  return { minLon, maxLon, minLat: latMin, maxLat: latMax };
}

/** Center of a continuous bounds interval, wrapped for public GPS values. */
export function geoBoundsCenter(bounds: GeoBounds): GeoPoint {
  return {
    lon: normalizeLongitude(bounds.minLon + longitudeSpan(bounds) / 2),
    lat: (bounds.minLat + bounds.maxLat) / 2,
  };
}

/** Test a point against a bounds interval using the same wrapped continuity. */
export function geoBoundsContains(bounds: GeoBounds, point: GeoPoint): boolean {
  const lon = unwrapLongitude(point.lon, bounds);
  return (
    lon <= bounds.minLon + longitudeSpan(bounds) &&
    point.lat >= bounds.minLat &&
    point.lat <= bounds.maxLat
  );
}

/** Project GPS coordinates into a north-up canvas. */
export function projectGeoPoint(
  point: GeoPoint,
  bounds: GeoBounds,
  width: number,
  height: number,
): GeoCanvasPoint {
  const lonSpan = longitudeSpan(bounds);
  const latSpan = bounds.maxLat - bounds.minLat || 1;
  return {
    x: ((unwrapLongitude(point.lon, bounds) - bounds.minLon) / lonSpan) * width,
    y: (1 - (point.lat - bounds.minLat) / latSpan) * height,
  };
}

/** Inverse of projectGeoPoint; output longitude is wrapped to [-180, 180). */
export function unprojectGeoPoint(
  point: GeoCanvasPoint,
  bounds: GeoBounds,
  width: number,
  height: number,
): GeoPoint {
  const lonSpan = longitudeSpan(bounds);
  const latSpan = bounds.maxLat - bounds.minLat || 1;
  return {
    lon: normalizeLongitude(bounds.minLon + (point.x / width) * lonSpan),
    lat: bounds.minLat + (1 - point.y / height) * latSpan,
  };
}
