/**
 * coordinateParser — pure parsing helpers for the manual coordinate search.
 *
 * Accepts a single free-text input containing a latitude/longitude pair in
 * any of three common formats (mixed formats per half are also fine):
 *
 *   Decimal degrees:            "58.30126, -134.41978"  /  "58.3 N 134.42 W"
 *   Degrees + decimal minutes:  "58 18.076 N, 134 25.187 W"
 *                               "58°18.076'N 134°25.187'W"
 *   Degrees minutes seconds:    "58°18'4.5\"N 134°25'11.2\"W"
 *                               "58 18 04.5 N, 134 25 11.2 W"
 *
 * Hemisphere letters (N/S/E/W, case-insensitive) may appear before or after
 * each half. A leading minus sign is also honoured. When no comma separates
 * the halves the parser splits after the first N/S hemisphere letter, or —
 * for plain signed decimals — between the two numbers.
 */

export interface ParsedCoordinates {
  lat: number;
  lon: number;
}

export type CoordinateParseResult =
  | { ok: true; coords: ParsedCoordinates }
  | { ok: false; error: string };

/** Radius caps mirroring the server's point-radius endpoint validation. */
export const COORD_SEARCH_MIN_RADIUS_KM = 0.0055;
export const COORD_SEARCH_MAX_RADIUS_KM = 9399;

export const KM_PER_NMI = 1.852;

export type RadiusUnit = "km" | "nmi";

export function radiusToKm(value: number, unit: RadiusUnit): number {
  return unit === "nmi" ? value * KM_PER_NMI : value;
}

/**
 * Validate a radius value (in the given unit) against the server caps.
 * Returns an error message, or null when the radius is acceptable.
 */
export function validateRadius(value: number, unit: RadiusUnit): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return "Enter a radius greater than zero.";
  }
  const km = radiusToKm(value, unit);
  if (km < COORD_SEARCH_MIN_RADIUS_KM) {
    const min = unit === "nmi"
      ? (COORD_SEARCH_MIN_RADIUS_KM / KM_PER_NMI).toFixed(4)
      : COORD_SEARCH_MIN_RADIUS_KM.toFixed(4);
    return `Radius too small — minimum is ${min} ${unit}.`;
  }
  if (km > COORD_SEARCH_MAX_RADIUS_KM) {
    const max = unit === "nmi"
      ? Math.floor(COORD_SEARCH_MAX_RADIUS_KM / KM_PER_NMI)
      : COORD_SEARCH_MAX_RADIUS_KM;
    return `Radius too large — maximum is ${max} ${unit}.`;
  }
  return null;
}

interface HalfParse {
  value: number;
  /** Hemisphere letter found (upper-case) or null. */
  hemi: "N" | "S" | "E" | "W" | null;
  /** True when an explicit leading minus sign was present. */
  negative: boolean;
  /** Number of numeric components (1 = decimal, 2 = DDM, 3 = DMS). */
  parts: number;
}

const HEMI_RE = /[NSEWnsew]/;

/** Parse one half (lat or lon) of the input. Returns null on failure. */
function parseHalf(text: string): HalfParse | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { error: "empty" };

  let hemi: HalfParse["hemi"] = null;
  let rest = trimmed;

  // Hemisphere letter at start or end.
  const first = rest[0]!;
  const last = rest[rest.length - 1]!;
  if (HEMI_RE.test(last) && /[A-Za-z]/.test(last)) {
    hemi = last.toUpperCase() as HalfParse["hemi"];
    rest = rest.slice(0, -1);
  } else if (HEMI_RE.test(first) && /[A-Za-z]/.test(first)) {
    hemi = first.toUpperCase() as HalfParse["hemi"];
    rest = rest.slice(1);
  }

  // Reject any remaining letters.
  if (/[A-Za-z]/.test(rest)) {
    return { error: `Unrecognised characters in "${trimmed}"` };
  }

  const negative = /^\s*-/.test(rest);
  // Split into numeric components on degree/minute/second symbols and spaces.
  const nums = rest
    .replace(/[°ºdD]/g, " ")
    .replace(/['′mM]/g, " ")
    .replace(/["″sS]/g, " ")
    .trim()
    .split(/[\s,;]+/)
    .filter((p) => p.length > 0);

  if (nums.length === 0 || nums.length > 3) {
    return { error: `Could not read a coordinate from "${trimmed}"` };
  }

  const parsed = nums.map((n) => Number(n));
  if (parsed.some((n) => !Number.isFinite(n))) {
    return { error: `Invalid number in "${trimmed}"` };
  }

  const [deg, min = 0, sec = 0] = parsed as [number, number?, number?];
  if (nums.length > 1) {
    if (!Number.isInteger(Math.abs(deg))) {
      return { error: "Degrees must be a whole number when minutes are given." };
    }
    if (min < 0 || min >= 60) {
      return { error: "Minutes must be between 0 and 59.999…" };
    }
  }
  if (nums.length === 3) {
    if (!Number.isInteger(min)) {
      return { error: "Minutes must be a whole number when seconds are given." };
    }
    if (sec < 0 || sec >= 60) {
      return { error: "Seconds must be between 0 and 59.999…" };
    }
  }

  const magnitude = Math.abs(deg) + min / 60 + sec / 3600;
  let value = negative ? -magnitude : magnitude;
  if (hemi === "S" || hemi === "W") {
    if (negative) return { error: "Use either a minus sign or S/W — not both." };
    value = -magnitude;
  }

  return { value, hemi, negative, parts: nums.length };
}

function isHalfError(h: HalfParse | { error: string }): h is { error: string } {
  return "error" in h;
}

/** Split the raw input into a lat half and a lon half. */
function splitHalves(input: string): [string, string] | null {
  const commaParts = input.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  if (commaParts.length === 2) return [commaParts[0]!, commaParts[1]!];
  if (commaParts.length !== 1) return null;

  const text = commaParts[0]!;
  // Split after the first N or S hemisphere letter (lat comes first).
  const nsMatch = /^(.*?[NSns])[\s,]+(.+)$/.exec(text);
  if (nsMatch) return [nsMatch[1]!, nsMatch[2]!];

  // Plain signed decimals separated by whitespace: "58.3 -134.42"
  const tokens = text.trim().split(/\s+/);
  if (tokens.length === 2) return [tokens[0]!, tokens[1]!];
  if (tokens.length === 4 || tokens.length === 6) {
    // "58 18.0 134 25.2" (DDM) or "58 18 00 134 25 12" (DMS) without letters —
    // ambiguous but split evenly.
    const mid = tokens.length / 2;
    return [tokens.slice(0, mid).join(" "), tokens.slice(mid).join(" ")];
  }
  return null;
}

/**
 * Parse a free-text coordinate pair. Latitude first, longitude second.
 */
export function parseCoordinates(input: string): CoordinateParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter coordinates — e.g. 58.30, -134.42" };
  }

  const halves = splitHalves(trimmed);
  if (!halves) {
    return {
      ok: false,
      error: "Could not split into latitude and longitude — separate them with a comma.",
    };
  }

  let [latRaw, lonRaw] = halves;
  let latHalf = parseHalf(latRaw);
  let lonHalf = parseHalf(lonRaw);
  if (isHalfError(latHalf)) return { ok: false, error: `Latitude: ${latHalf.error}` };
  if (isHalfError(lonHalf)) return { ok: false, error: `Longitude: ${lonHalf.error}` };

  // If hemispheres are swapped ("134.4 W, 58.3 N"), flip the halves.
  const latIsLon = latHalf.hemi === "E" || latHalf.hemi === "W";
  const lonIsLat = lonHalf.hemi === "N" || lonHalf.hemi === "S";
  if (latIsLon && lonIsLat) {
    [latHalf, lonHalf] = [lonHalf, latHalf];
  } else if (latIsLon || lonIsLat) {
    return {
      ok: false,
      error: "Hemisphere letters don't match — expected latitude (N/S) first, longitude (E/W) second.",
    };
  }

  if (latHalf.hemi === "E" || latHalf.hemi === "W") {
    return { ok: false, error: "Latitude must use N or S, not E/W." };
  }
  if (lonHalf.hemi === "N" || lonHalf.hemi === "S") {
    return { ok: false, error: "Longitude must use E or W, not N/S." };
  }

  const lat = latHalf.value;
  const lon = lonHalf.value;
  if (Math.abs(lat) > 90) {
    return { ok: false, error: `Latitude ${lat.toFixed(4)}° is out of range (−90 to 90).` };
  }
  if (Math.abs(lon) > 180) {
    return { ok: false, error: `Longitude ${lon.toFixed(4)}° is out of range (−180 to 180).` };
  }

  return { ok: true, coords: { lat, lon } };
}

/**
 * Approximate bbox for a centre + radius, mirroring the server's projection
 * (used for drawing before the server response arrives).
 */
export function approxBboxForRadius(
  lat: number,
  lon: number,
  radiusKm: number,
): { north: number; south: number; east: number; west: number } {
  const KM_PER_DEG_LAT = 111.32;
  const latDelta = radiusKm / KM_PER_DEG_LAT;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const lonDelta = radiusKm / (KM_PER_DEG_LAT * cosLat);
  return {
    north: Math.min(90, lat + latDelta),
    south: Math.max(-90, lat - latDelta),
    east: lon + lonDelta,
    west: lon - lonDelta,
  };
}
