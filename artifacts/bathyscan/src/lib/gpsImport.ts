/**
 * gpsImport.ts — parsers for GPS waypoint / route / track files.
 *
 * Supports GPX (waypoints + routes + tracks), KML / KMZ (Placemark Point and
 * LineString), CSV (header-detected lat/lon plus optional name, depth, type,
 * notes), and Excel .xlsx / .xls (same header detection as CSV). All formats
 * are normalised into a common shape so the rest of the import flow can treat
 * them uniformly.
 *
 * Pure utility module — no React, no DOM mutations, no network. Parsers
 * accept already-decoded strings (XML/CSV text) or, for KMZ / Excel, an
 * ArrayBuffer / File.
 * `parseGpsFile(file)` is the convenience entry point used by the UI.
 */
import { unzipSync, strFromU8 } from "fflate";
import { read as xlsxRead, utils as xlsxUtils } from "xlsx";

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
  /** Standalone waypoints (GPX <wpt>, KML Point Placemark, CSV / Excel row). */
  waypoints: ParsedPoint[];
  /** Multi-point sequences (GPX <rte>/<trk>, KML LineString Placemark). */
  routes: ParsedRoute[];
}

/**
 * User-supplied mapping from canonical field names to the raw header string
 * they have assigned. `null` means the field is intentionally skipped.
 */
export interface ColumnAssignment {
  lat: string | null;
  lon: string | null;
  name: string | null;
  depth: string | null;
  type: string | null;
  notes: string | null;
}

/**
 * Column metadata emitted alongside ParseResult.
 *
 * Consumed by the column-mapping UI step that follows. Callers that do not
 * need column-level information can ignore this value.
 */
export interface RawColumnMeta {
  /**
   * One entry per column detected in the file (or empty for self-describing
   * formats such as GPX / KML / KMZ). `mappedAlias` is the canonical field
   * name it was matched to ("lat", "lon", "name", "depth", "elevation",
   * "type", "notes") or `null` when the column had no recognised alias.
   */
  columns: { header: string; mappedAlias: string | null }[];
  /** Up to the first 5 data rows, keyed by the original header string. */
  sampleRows: Record<string, string>[];
  /**
   * All data rows (keyed by original header string). Used by
   * `applyColumnAssignment` so the dialog can re-parse without re-reading
   * the file after the user adjusts the column mapping.
   */
  allRows: Record<string, string>[];
  /** "csv" | "excel" | "self-describing" — determines localStorage behaviour. */
  fileType: "csv" | "excel" | "self-describing";
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
 * parser. Returns a `ParseResult` together with `RawColumnMeta` for the
 * column-mapping UI.
 *
 * Unlike the individual parsers, this function does NOT throw when lat/lon
 * columns are absent in a CSV/Excel file — instead it returns an empty
 * ParseResult so the dialog can show the column-mapping step.
 *
 * Throws a descriptive Error on unsupported extension, malformed content, or
 * zero parseable points when the format is self-describing (GPX/KML/KMZ).
 */
export async function parseGpsFile(
  file: File,
): Promise<{ result: ParseResult; meta: RawColumnMeta }> {
  const name = file.name.toLowerCase();
  let result: ParseResult;
  let meta: RawColumnMeta;
  if (name.endsWith(".gpx")) {
    result = parseGpx(await file.text());
    meta = EMPTY_META;
  } else if (name.endsWith(".kml")) {
    result = parseKml(await file.text());
    meta = EMPTY_META;
  } else if (name.endsWith(".kmz")) {
    result = await parseKmz(await file.arrayBuffer());
    meta = EMPTY_META;
  } else if (name.endsWith(".csv")) {
    ({ result, meta } = parseCsv(await file.text()));
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    ({ result, meta } = await parseExcel(file));
  } else {
    throw new Error(
      "Unsupported file type. Use .gpx, .kml, .kmz, .csv, .xlsx, or .xls.",
    );
  }

  const total = countPoints(result);

  // For column-based formats (CSV / Excel) with no recognised lat/lon columns
  // the result will have zero points — that is not an error; the dialog will
  // show the column-mapping step so the user can assign columns manually.
  const hasLatCol = meta.columns.some((c) => c.mappedAlias === "lat");
  const hasLonCol = meta.columns.some((c) => c.mappedAlias === "lon");
  const needsMapping = meta.columns.length > 0 && (!hasLatCol || !hasLonCol);

  if (total === 0 && !needsMapping) {
    throw new Error("No parseable coordinates found in this file.");
  }
  if (total > MAX_IMPORT_POINTS) {
    throw new Error(
      `Too many points (${total.toLocaleString()}). The per-import limit is ${MAX_IMPORT_POINTS.toLocaleString()}.`,
    );
  }
  return { result, meta };
}

/** Count waypoints + all route/track points across the result. */
export function countPoints(result: ParseResult): number {
  let n = result.waypoints.length;
  for (const r of result.routes) n += r.points.length;
  return n;
}

// ---------------------------------------------------------------------------
// applyColumnAssignment
// ---------------------------------------------------------------------------

/**
 * Re-parse all raw rows from a previous CSV / Excel parse using a user-supplied
 * column assignment. Produces a new `ParseResult` driven by the assignment
 * instead of auto-detection.
 *
 * Depth semantics: the assigned "depth" column is treated as depth in metres
 * (positive below surface), consistent with how `ParsedPoint.depth` is
 * stored elsewhere.
 *
 * Rows that produce non-finite or out-of-range lat/lon are skipped silently.
 */
export function applyColumnAssignment(
  meta: RawColumnMeta,
  assignment: ColumnAssignment,
): ParseResult {
  const waypoints: ParsedPoint[] = [];

  for (const row of meta.allRows) {
    if (!assignment.lat || !assignment.lon) break;

    const latRaw = row[assignment.lat] ?? "";
    const lonRaw = row[assignment.lon] ?? "";
    const lat = parseFloat(latRaw);
    const lon = parseFloat(lonRaw);
    if (!isFiniteCoord(lat, lon)) continue;

    let depth: number | undefined;
    if (assignment.depth) {
      const d = parseFloat(row[assignment.depth] ?? "");
      if (Number.isFinite(d)) depth = d;
    }

    const name = assignment.name ? (row[assignment.name] ?? "").trim() || undefined : undefined;
    const notes = assignment.notes ? (row[assignment.notes] ?? "").trim() || undefined : undefined;
    const type = assignment.type ? (row[assignment.type] ?? "").trim() || undefined : undefined;

    waypoints.push({ lat, lon, name, notes, depth, type, source: "waypoint" });
  }

  return { waypoints, routes: [] };
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
// Column alias tables (shared by CSV and Excel)
// ---------------------------------------------------------------------------

const LAT_KEYS = ["lat", "latitude", "y"];
const LON_KEYS = ["lon", "lng", "long", "longitude", "x"];
const NAME_KEYS = ["name", "label", "title", "waypoint"];
const DEPTH_KEYS = ["depth", "depth_m", "depth(m)"];
const ELEV_KEYS = ["elevation", "ele", "altitude", "alt"];
const TYPE_KEYS = ["type", "symbol", "sym", "category"];
const NOTES_KEYS = ["notes", "note", "description", "desc", "comment"];

/** Maps a canonical field name to its recognised header aliases. */
const ALIAS_GROUPS: Record<string, readonly string[]> = {
  lat: LAT_KEYS,
  lon: LON_KEYS,
  name: NAME_KEYS,
  depth: DEPTH_KEYS,
  elevation: ELEV_KEYS,
  type: TYPE_KEYS,
  notes: NOTES_KEYS,
};

/**
 * Resolve each header string to a canonical alias name, or `null` when the
 * header has no recognised alias. Returns one entry per input header,
 * preserving order.
 */
function resolveAliases(
  headers: string[],
): { header: string; mappedAlias: string | null }[] {
  return headers.map((h) => {
    const low = h.trim().toLowerCase();
    for (const [alias, keys] of Object.entries(ALIAS_GROUPS)) {
      if ((keys as string[]).includes(low)) {
        return { header: h, mappedAlias: alias };
      }
    }
    return { header: h, mappedAlias: null };
  });
}

/** Sentinel empty meta used for self-describing formats (GPX, KML, KMZ). */
const EMPTY_META: RawColumnMeta = {
  columns: [],
  sampleRows: [],
  allRows: [],
  fileType: "self-describing",
};

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Parse a CSV with a header row. Detects lat/lon columns by common header
 * aliases (case-insensitive). Optional name, depth/elevation, type, and notes
 * columns are picked up when present.
 *
 * Does NOT throw when lat/lon columns are missing — returns empty waypoints
 * so the caller (GpsImportDialog) can show the column-mapping step instead.
 */
export function parseCsv(text: string): { result: ParseResult; meta: RawColumnMeta } {
  // Strip a UTF-8 BOM if present so the first header field matches cleanly.
  const stripped = text.replace(/^\uFEFF/, "");
  const rows = splitCsv(stripped);
  if (rows.length < 2) {
    return {
      result: { waypoints: [], routes: [] },
      meta: EMPTY_META,
    };
  }
  const rawHeaders = rows[0]!.map((h) => h.trim());
  const header = rawHeaders.map((h) => h.toLowerCase());
  const latIdx = findHeader(header, LAT_KEYS);
  const lonIdx = findHeader(header, LON_KEYS);
  const nameIdx = findHeader(header, NAME_KEYS);
  const depthIdx = findHeader(header, DEPTH_KEYS);
  const elevIdx = findHeader(header, ELEV_KEYS);
  const typeIdx = findHeader(header, TYPE_KEYS);
  const notesIdx = findHeader(header, NOTES_KEYS);

  const sampleRows: Record<string, string>[] = [];
  const allRows: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.every((c) => c.trim() === "")) continue;
    const entry: Record<string, string> = {};
    for (let j = 0; j < rawHeaders.length; j++) {
      entry[rawHeaders[j]!] = row[j] ?? "";
    }
    allRows.push(entry);
    if (sampleRows.length < 5) sampleRows.push(entry);
  }

  const meta: RawColumnMeta = {
    columns: resolveAliases(rawHeaders),
    sampleRows,
    allRows,
    fileType: "csv",
  };

  // If lat/lon columns are missing, return empty result so the dialog can
  // show the column-mapping step.
  if (latIdx < 0 || lonIdx < 0) {
    return { result: { waypoints: [], routes: [] }, meta };
  }

  const waypoints: ParsedPoint[] = [];
  for (const row of allRows) {
    const lat = parseFloat(row[rawHeaders[latIdx]!] ?? "");
    const lon = parseFloat(row[rawHeaders[lonIdx]!] ?? "");
    if (!isFiniteCoord(lat, lon)) continue;
    let depth: number | undefined;
    if (depthIdx >= 0) {
      const d = parseFloat(row[rawHeaders[depthIdx]!] ?? "");
      if (Number.isFinite(d)) depth = d;
    } else if (elevIdx >= 0) {
      const e = parseFloat(row[rawHeaders[elevIdx]!] ?? "");
      // Elevation is positive above sea level; flip sign for depth.
      if (Number.isFinite(e)) depth = -e;
    }
    waypoints.push({
      lat,
      lon,
      name: nameIdx >= 0 ? (row[rawHeaders[nameIdx]!] ?? "").trim() || undefined : undefined,
      notes: notesIdx >= 0 ? (row[rawHeaders[notesIdx]!] ?? "").trim() || undefined : undefined,
      type: typeIdx >= 0 ? (row[rawHeaders[typeIdx]!] ?? "").trim() || undefined : undefined,
      depth,
      source: "waypoint",
    });
  }

  const result: ParseResult = { waypoints, routes: [] };
  return { result, meta };
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
// Excel (.xlsx / .xls)
// ---------------------------------------------------------------------------

/**
 * Parse an Excel file (.xlsx or .xls). Reads the first non-empty worksheet,
 * detects lat/lon and optional columns by the same alias table used for CSV,
 * and returns waypoints in the same shape as `parseCsv`.
 *
 * Does NOT throw when lat/lon columns are missing — returns empty waypoints
 * so the caller (GpsImportDialog) can show the column-mapping step instead.
 */
export async function parseExcel(
  file: File,
): Promise<{ result: ParseResult; meta: RawColumnMeta }> {
  const data = await file.arrayBuffer();
  let workbook: ReturnType<typeof xlsxRead>;
  try {
    workbook = xlsxRead(data, { type: "array" });
  } catch (err) {
    throw new Error(
      `Couldn't open Excel file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!workbook.SheetNames.length) {
    throw new Error("Excel file contains no worksheets.");
  }

  // Find first non-empty sheet (has a !ref range).
  let sheet: ReturnType<typeof xlsxRead>["Sheets"][string] | undefined;
  for (const sName of workbook.SheetNames) {
    const ws = workbook.Sheets[sName];
    if (ws && ws["!ref"]) {
      sheet = ws;
      break;
    }
  }

  if (!sheet) {
    throw new Error("Excel file contains no worksheet with data.");
  }

  // Convert to array-of-arrays; raw:false gives formatted string values for
  // every cell type, which is consistent with how we handle CSV.
  const rows = xlsxUtils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  if (rows.length < 2) {
    throw new Error("Excel worksheet has no data rows (only a header or nothing).");
  }

  const rawHeaders = (rows[0] as string[]).map((h) => String(h ?? "").trim());
  const header = rawHeaders.map((h) => h.toLowerCase());

  const latIdx = findHeader(header, LAT_KEYS);
  const lonIdx = findHeader(header, LON_KEYS);
  const nameIdx = findHeader(header, NAME_KEYS);
  const depthIdx = findHeader(header, DEPTH_KEYS);
  const elevIdx = findHeader(header, ELEV_KEYS);
  const typeIdx = findHeader(header, TYPE_KEYS);
  const notesIdx = findHeader(header, NOTES_KEYS);

  const sampleRows: Record<string, string>[] = [];
  const allRows: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as string[];
    if (row.every((c) => String(c ?? "").trim() === "")) continue;
    const entry: Record<string, string> = {};
    for (let j = 0; j < rawHeaders.length; j++) {
      entry[rawHeaders[j]!] = String(row[j] ?? "");
    }
    allRows.push(entry);
    if (sampleRows.length < 5) sampleRows.push(entry);
  }

  const meta: RawColumnMeta = {
    columns: resolveAliases(rawHeaders),
    sampleRows,
    allRows,
    fileType: "excel",
  };

  // If lat/lon columns are missing, return empty result so the dialog can
  // show the column-mapping step.
  if (latIdx < 0 || lonIdx < 0) {
    return { result: { waypoints: [], routes: [] }, meta };
  }

  const waypoints: ParsedPoint[] = [];

  for (const row of allRows) {
    const lat = parseFloat(String(row[rawHeaders[latIdx]!] ?? ""));
    const lon = parseFloat(String(row[rawHeaders[lonIdx]!] ?? ""));
    if (!isFiniteCoord(lat, lon)) continue;
    let depth: number | undefined;
    if (depthIdx >= 0) {
      const d = parseFloat(String(row[rawHeaders[depthIdx]!] ?? ""));
      if (Number.isFinite(d)) depth = d;
    } else if (elevIdx >= 0) {
      const e = parseFloat(String(row[rawHeaders[elevIdx]!] ?? ""));
      if (Number.isFinite(e)) depth = -e;
    }
    waypoints.push({
      lat,
      lon,
      name: nameIdx >= 0 ? String(row[rawHeaders[nameIdx]!] ?? "").trim() || undefined : undefined,
      notes: notesIdx >= 0 ? String(row[rawHeaders[notesIdx]!] ?? "").trim() || undefined : undefined,
      type: typeIdx >= 0 ? String(row[rawHeaders[typeIdx]!] ?? "").trim() || undefined : undefined,
      depth,
      source: "waypoint",
    });
  }

  const result: ParseResult = { waypoints, routes: [] };
  return { result, meta };
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
