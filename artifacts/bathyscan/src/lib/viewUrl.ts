/**
 * viewUrl.ts — URL serialisation / deserialisation for BathyScan share links.
 *
 * Encodes { lon, lat, depth, heading, datasetId } into URL search parameters
 * and parses them back with full validation so bad / missing params fall back
 * to normal startup behaviour rather than crashing.
 *
 * Search-param names are short to keep share URLs tidy:
 *   ?lon=<deg>&lat=<deg>&depth=<m>&hdg=<deg>&ds=<datasetId>
 */

export interface ViewParams {
  lon: number;
  lat: number;
  depth: number;
  heading: number;
  datasetId: string;
}

type Range = [number, number];
const LON_RANGE: Range = [-180, 180];
const LAT_RANGE: Range = [-90, 90];
const DEPTH_RANGE: Range = [0, 12_000];
const HDG_RANGE: Range = [0, 360];

function inRange(v: number, [min, max]: Range): boolean {
  return Number.isFinite(v) && v >= min && v <= max;
}

/**
 * Encode a ViewParams object into a URL search string (no leading "?").
 * Depth is rounded to the nearest metre; heading to the nearest degree;
 * lon/lat are kept to 6 decimal places (~0.1 m precision).
 */
export function encodeViewParams(p: ViewParams): string {
  const sp = new URLSearchParams();
  sp.set("lon", p.lon.toFixed(6));
  sp.set("lat", p.lat.toFixed(6));
  sp.set("depth", Math.round(p.depth).toString());
  sp.set("hdg", (Math.round(p.heading) % 360).toString());
  sp.set("ds", p.datasetId);
  return sp.toString();
}

/**
 * Parse a URL search string and return a validated ViewParams, or `null` if
 * any required param is absent or out of its valid range.
 */
export function decodeViewParams(search: string): ViewParams | null {
  try {
    const sp = new URLSearchParams(search);
    const lon = parseFloat(sp.get("lon") ?? "");
    const lat = parseFloat(sp.get("lat") ?? "");
    const depth = parseFloat(sp.get("depth") ?? "");
    const heading = parseFloat(sp.get("hdg") ?? "");
    const datasetId = (sp.get("ds") ?? "").trim();

    if (!inRange(lon, LON_RANGE)) return null;
    if (!inRange(lat, LAT_RANGE)) return null;
    if (!inRange(depth, DEPTH_RANGE)) return null;
    if (!inRange(heading, HDG_RANGE)) return null;
    if (!datasetId) return null;

    return { lon, lat, depth, heading, datasetId };
  } catch {
    return null;
  }
}

/**
 * The URL params that were present when the page first loaded.
 * Parsed once at module-load time and exported as a stable constant so any
 * module can read the initial deep-link state without re-parsing the URL.
 * `null` when no valid share link params are present.
 */
export const initialViewParams: ViewParams | null =
  typeof window !== "undefined"
    ? decodeViewParams(window.location.search)
    : null;
