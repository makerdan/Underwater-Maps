/**
 * gpsImport.ts — parsers for GPS waypoint / route / track files.
 *
 * Supports GPX (waypoints + routes + tracks), KML / KMZ (Placemark Point and
 * LineString), and CSV (header-detected lat/lon plus optional name, depth,
 * type, notes). All formats are normalised into a common shape so the rest of
 * the import flow can treat them uniformly.
 *
 * Pure utility module — no React, no DOM mutations, no network. Parsers
 * accept already-decoded strings (XML/CSV text) or, for KMZ, an ArrayBuffer.
 * `parseGpsFile(file)` is the convenience entry point used by the UI.
 */
import { unzipSync, strFromU8 } from "fflate";

/** Maximum number of points (waypoints + route/track points) per import. */
export const MAX_IMPORT_POINTS = 5000;

export type PointSource = "waypoint" | "route" | "track";

export interface ParsedPoint {
  lat: number;
  lon: number;
  name?: string;
  notes?: string;
  depth?: number;
  type?: string;
  source: PointSource;
}

export interface ParsedRoute {
  name: string;
  points: { lat: number; lon: number; name?: string }[];
  source: "route" | "track";
}

export interface ParseResult {
  /** Standalone waypoints (GPX <wpt>, KML Point Placemark, CSV row). */
  waypoints: ParsedPoint[];
  /** Multi-point sequences (GPX <rte>/<trk>, KML LineString Placemark). */
  routes: ParsedRoute[];
}

export interface Bounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Detect the file's format from its extension and dispatch to the appropriate
 * parser. Throws a descriptive Error on unsupported extension, malformed
 * content, or zero parseable points.
 */
export async function parseGpsFile(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  let result: ParseResult;
  if (name.endsWith(".gpx")) {
    result = parseGpx(await file.text());
  } else if (name.endsWith(".kml")) {
    result = parseKml(await file.text());
  } else if (name.endsWith(".kmz")) {
    result = await parseKmz(await file.arrayBuffer());
  } else if (name.endsWith(".csv")) {
    result = parseCsv(await file.text());
  } else {
    throw new Error(
      "Unsupported file type. Use .gpx, .kml, .kmz, or .csv.",
    );
  }

  const total = countPoints(result);
  if (total === 0) {
    throw new Error("No parseable coordinates found in this file.");
  }
  if (total > MAX_IMPORT_POINTS) {
    throw new Error(
      `Too many points (${total.toLocaleString()}). The per-import limit is ${MAX_IMPORT_POINTS.toLocaleString()}.`,
    );
  }
  return result;
}

/** Count waypoints + all route/track points across the result. */
export function countPoints(result: ParseResult): number {
  let n = result.waypoints.length;
  for (const r of result.routes) n += r.points.length;
  return n;
}

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

/**
 * Parse a GPX 1.0 / 1.1 XML document. Top-level <wpt> elements become
 * standalone waypoints; each <rte> and <trk> becomes a route entry.
 */
export function parseGpx(xml: string): ParseResult {
  const doc = parseXml(xml, "GPX");
  const waypoints: ParsedPoint[] = [];
  const routes: ParsedRoute[] = [];

  // Waypoints
  const wpts = doc.getElementsByTagName("wpt");
  for (let i = 0; i < wpts.length; i++) {
    const el = wpts[i]!;
    const pt = wptToPoint(el, "waypoint");
    if (pt) waypoints.push(pt);
  }

  // Routes: <rte> containing <rtept>
  const rtes = doc.getElementsByTagName("rte");
  for (let i = 0; i < rtes.length; i++) {
    const rte = rtes[i]!;
    const name = textOf(rte, "name") ?? `Route ${i + 1}`;
    const pts: ParsedRoute["points"] = [];
    const rtepts = rte.getElementsByTagName("rtept");
    for (let j = 0; j < rtepts.length; j++) {
      const p = wptToPoint(rtepts[j]!, "route");
      if (p) pts.push({ lat: p.lat, lon: p.lon, name: p.name });
    }
    if (pts.length) routes.push({ name, points: pts, source: "route" });
  }

  // Tracks: <trk> containing <trkseg><trkpt>; flatten all segments.
  const trks = doc.getElementsByTagName("trk");
  for (let i = 0; i < trks.length; i++) {
    const trk = trks[i]!;
    const name = textOf(trk, "name") ?? `Track ${i + 1}`;
    const pts: ParsedRoute["points"] = [];
    const trkpts = trk.getElementsByTagName("trkpt");
    for (let j = 0; j < trkpts.length; j++) {
      const p = wptToPoint(trkpts[j]!, "track");
      if (p) pts.push({ lat: p.lat, lon: p.lon });
    }
    if (pts.length) routes.push({ name, points: pts, source: "track" });
  }

  return { waypoints, routes };
}

function wptToPoint(el: Element, source: PointSource): ParsedPoint | null {
  const lat = parseFloat(el.getAttribute("lat") ?? "");
  const lon = parseFloat(el.getAttribute("lon") ?? "");
  if (!isFiniteCoord(lat, lon)) return null;
  const name = textOf(el, "name") ?? undefined;
  const notes = textOf(el, "desc") ?? textOf(el, "cmt") ?? undefined;
  const sym = textOf(el, "sym") ?? textOf(el, "type") ?? undefined;
  const eleText = textOf(el, "ele");
  let depth: number | undefined;
  if (eleText !== null) {
    const ele = parseFloat(eleText);
    // GPX <ele> is elevation in metres (positive above sea level). Convert
    // to depth (positive below the surface) so it matches Marker.depth.
    if (Number.isFinite(ele)) depth = -ele;
  }
  return { lat, lon, name, notes, depth, type: sym, source };
}

// ---------------------------------------------------------------------------
// KML / KMZ
// ---------------------------------------------------------------------------

/**
 * Parse a KML document. Each <Placemark> with a <Point> becomes a waypoint;
 * each <Placemark> with a <LineString> becomes a route entry. <MultiGeometry>
 * children are walked recursively.
 */
export function parseKml(xml: string): ParseResult {
  const doc = parseXml(xml, "KML");
  const waypoints: ParsedPoint[] = [];
  const routes: ParsedRoute[] = [];

  const placemarks = doc.getElementsByTagName("Placemark");
  for (let i = 0; i < placemarks.length; i++) {
    const pm = placemarks[i]!;
    const name = textOf(pm, "name") ?? undefined;
    const description = textOf(pm, "description") ?? undefined;

    // Walk Point and LineString descendants (handles MultiGeometry).
    const points = pm.getElementsByTagName("Point");
    for (let j = 0; j < points.length; j++) {
      const coordsText = textOf(points[j]!, "coordinates");
      const coords = parseKmlCoordinates(coordsText ?? "");
      for (const c of coords) {
        waypoints.push({
          lat: c.lat,
          lon: c.lon,
          name,
          notes: description,
          depth: c.alt !== undefined ? -c.alt : undefined,
          source: "waypoint",
        });
      }
    }

    const lines = pm.getElementsByTagName("LineString");
    for (let j = 0; j < lines.length; j++) {
      const coordsText = textOf(lines[j]!, "coordinates");
      const coords = parseKmlCoordinates(coordsText ?? "");
      if (coords.length) {
        routes.push({
          name: name ?? `Line ${routes.length + 1}`,
          points: coords.map((c) => ({ lat: c.lat, lon: c.lon })),
          source: "route",
        });
      }
    }
  }

  return { waypoints, routes };
}

/**
 * KML coordinates are whitespace-separated tuples of `lon,lat[,alt]`. Returns
 * the parsed list, skipping malformed entries silently.
 */
function parseKmlCoordinates(
  text: string,
): { lon: number; lat: number; alt?: number }[] {
  const out: { lon: number; lat: number; alt?: number }[] = [];
  for (const tuple of text.split(/\s+/)) {
    if (!tuple) continue;
    const parts = tuple.split(",");
    const lon = parseFloat(parts[0] ?? "");
    const lat = parseFloat(parts[1] ?? "");
    if (!isFiniteCoord(lat, lon)) continue;
    const altRaw = parts[2];
    const alt = altRaw !== undefined ? parseFloat(altRaw) : NaN;
    out.push({ lon, lat, alt: Number.isFinite(alt) ? alt : undefined });
  }
  return out;
}

/**
 * Parse a KMZ archive (ZIP containing a doc.kml). The first *.kml entry is
 * used.
 */
export async function parseKmz(data: ArrayBuffer): Promise<ParseResult> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(data));
  } catch (err) {
    throw new Error(
      `Couldn't open KMZ archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const kmlName = Object.keys(entries).find((n) => n.toLowerCase().endsWith(".kml"));
  if (!kmlName) {
    throw new Error("KMZ archive contains no .kml file.");
  }
  const xml = strFromU8(entries[kmlName]!);
  return parseKml(xml);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const LAT_KEYS = ["lat", "latitude", "y"];
const LON_KEYS = ["lon", "lng", "long", "longitude", "x"];
const NAME_KEYS = ["name", "label", "title", "waypoint"];
const DEPTH_KEYS = ["depth", "depth_m", "depth(m)"];
const ELEV_KEYS = ["elevation", "ele", "altitude", "alt"];
const TYPE_KEYS = ["type", "symbol", "sym", "category"];
const NOTES_KEYS = ["notes", "note", "description", "desc", "comment"];

/**
 * Parse a CSV with a header row. Detects lat/lon columns by common header
 * aliases (case-insensitive). Optional name, depth/elevation, type, and notes
 * columns are picked up when present.
 */
export function parseCsv(text: string): ParseResult {
  // Strip a UTF-8 BOM if present so the first header field matches cleanly.
  const stripped = text.replace(/^\uFEFF/, "");
  const rows = splitCsv(stripped);
  if (rows.length < 2) {
    return { waypoints: [], routes: [] };
  }
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const latIdx = findHeader(header, LAT_KEYS);
  const lonIdx = findHeader(header, LON_KEYS);
  if (latIdx < 0 || lonIdx < 0) {
    throw new Error(
      "CSV is missing a latitude or longitude column (expected headers like 'lat'/'lon').",
    );
  }
  const nameIdx = findHeader(header, NAME_KEYS);
  const depthIdx = findHeader(header, DEPTH_KEYS);
  const elevIdx = findHeader(header, ELEV_KEYS);
  const typeIdx = findHeader(header, TYPE_KEYS);
  const notesIdx = findHeader(header, NOTES_KEYS);

  const waypoints: ParsedPoint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    // Skip wholly empty rows (trailing newlines, etc.).
    if (row.every((c) => c.trim() === "")) continue;
    const lat = parseFloat(row[latIdx] ?? "");
    const lon = parseFloat(row[lonIdx] ?? "");
    if (!isFiniteCoord(lat, lon)) continue;
    let depth: number | undefined;
    if (depthIdx >= 0) {
      const d = parseFloat(row[depthIdx] ?? "");
      if (Number.isFinite(d)) depth = d;
    } else if (elevIdx >= 0) {
      const e = parseFloat(row[elevIdx] ?? "");
      // Elevation is positive above sea level; flip sign for depth.
      if (Number.isFinite(e)) depth = -e;
    }
    waypoints.push({
      lat,
      lon,
      name: nameIdx >= 0 ? (row[nameIdx] ?? "").trim() || undefined : undefined,
      notes: notesIdx >= 0 ? (row[notesIdx] ?? "").trim() || undefined : undefined,
      type: typeIdx >= 0 ? (row[typeIdx] ?? "").trim() || undefined : undefined,
      depth,
      source: "waypoint",
    });
  }
  return { waypoints, routes: [] };
}

function findHeader(header: string[], keys: readonly string[]): number {
  for (const k of keys) {
    const i = header.indexOf(k);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Minimal CSV splitter supporting double-quoted fields, doubled-quote
 * escapes, and CRLF or LF line endings. Sufficient for chartplotter / GPS
 * exports — not a full RFC 4180 implementation.
 */
function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch === "\r") {
        // ignore; \n will close the row
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Bounds filtering
// ---------------------------------------------------------------------------

export function isInBounds(
  lon: number,
  lat: number,
  b: Bounds,
): boolean {
  return lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat;
}

/**
 * Split a parse result into in-bounds vs out-of-bounds parts relative to the
 * given bounding box.
 *
 * - Waypoints outside the box are dropped (counted in `outsideWaypoints`).
 * - Routes are TRIMMED to their in-bounds points; out-of-bounds points are
 *   dropped (counted in `outsideRoutePoints`) so that off-map coordinates can
 *   never reach the API. A route whose trimmed length is below 2 points is
 *   itself dropped (counted in `outsideRoutes`) because a single point is not
 *   a usable trolling preset.
 *
 * The returned `inside` result is safe to import as-is — every coordinate is
 * guaranteed to fall within `bounds`.
 */
export function partitionByBounds(
  result: ParseResult,
  bounds: Bounds,
): {
  inside: ParseResult;
  outsideWaypoints: number;
  outsideRoutes: number;
  outsideRoutePoints: number;
} {
  const insideWp: ParsedPoint[] = [];
  let outsideWaypoints = 0;
  for (const p of result.waypoints) {
    if (isInBounds(p.lon, p.lat, bounds)) insideWp.push(p);
    else outsideWaypoints++;
  }
  const insideRoutes: ParsedRoute[] = [];
  let outsideRoutes = 0;
  let outsideRoutePoints = 0;
  for (const r of result.routes) {
    const kept: ParsedRoute["points"] = [];
    for (const p of r.points) {
      if (isInBounds(p.lon, p.lat, bounds)) kept.push(p);
      else outsideRoutePoints++;
    }
    if (kept.length >= 2) {
      insideRoutes.push({ name: r.name, points: kept, source: r.source });
    } else {
      // Fewer than 2 surviving points — not a viable route. Account for the
      // dropped route AND its surviving stub point so totals reconcile.
      outsideRoutes++;
      outsideRoutePoints += kept.length;
    }
  }
  return {
    inside: { waypoints: insideWp, routes: insideRoutes },
    outsideWaypoints,
    outsideRoutes,
    outsideRoutePoints,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFiniteCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function textOf(el: Element, tag: string): string | null {
  // Only direct children — many GPX/KML tags repeat the same tag name at
  // nested levels (e.g. <name> inside both <trk> and <trkpt>).
  for (let i = 0; i < el.children.length; i++) {
    const c = el.children[i]!;
    if (c.tagName === tag || c.localName === tag) {
      return (c.textContent ?? "").trim();
    }
  }
  return null;
}

function parseXml(xml: string, label: string): Document {
  if (typeof DOMParser === "undefined") {
    throw new Error("XML parsing requires a DOMParser (browser environment).");
  }
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  // DOMParser surfaces malformed XML as a <parsererror> element inside the
  // returned document rather than throwing.
  const errEl = doc.getElementsByTagName("parsererror")[0];
  if (errEl) {
    throw new Error(
      `Couldn't parse ${label} file: ${(errEl.textContent ?? "malformed XML").trim().split("\n")[0]}`,
    );
  }
  return doc;
}
