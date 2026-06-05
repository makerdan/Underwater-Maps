/**
 * noaaTarRouter.ts — Route extracted NOAA tar.gz entries to their parsers.
 *
 * After a NOAA tar.gz is decompressed and extracted, the temp directory may
 * contain a mix of file types:
 *
 *   surveys.xyz                    — sounding TSV (NOAA survey soundings)
 *   GEODAS/<name>.xyz.gz           — GEODAS sounding CSV (compressed)
 *   GEODAS/<name>.a93.gz           — HYD93 fixed-width soundings (compressed)
 *   Bottom_Samples/<n>_BSText.txt  — substrate annotation text files
 *   Smooth_Sheets/<n>.tif.gz       — inner GeoTIFF rasters (compressed)
 *   *.sid / *.pdf / *.htm          — unsupported; skipped with a log info
 *   surveys.txt                    — metadata only; skipped
 *
 * This module:
 *   1. Classifies each extracted entry path against the routing table.
 *   2. Dispatches recognised entries to their parser stubs.
 *   3. Aggregates all sounding points into a single array.
 *   4. Aggregates substrate annotation points into a separate array.
 *   5. Derives a human-readable dataset name from the surveys.txt H-number
 *      metadata file when present, falling back to the archive filename.
 *
 * Individual parser implementations are each their own downstream task.
 * Stubs throw a PARSER_NOT_IMPLEMENTED error with a clear message so that
 * the routing wire-up is complete and each downstream task can fill in one
 * function without touching the router.
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger.js";
import { fromArrayBuffer } from "geotiff";
import type { RawPoint } from "./uploadParsers.js";
import { parseGeoTiff } from "./uploadParsers.js";
import { gunzipBounded } from "./gunzipBounded.js";

/** 200 MB cap for inner tif.gz decompression — same as the top-level gz cap. */
const INNER_GZ_MAX_BYTES = 200 * 1024 * 1024;

/**
 * Maximum compressed size of a smooth-sheet raster we are willing to store
 * in the database for the interactive georeferencing wizard.  Rasters larger
 * than this are not stored and the dataset is still flagged
 * `needsGeoreferencing`; the user will be informed that the image is
 * unavailable but can still submit control points against an external map.
 */
const MAX_RASTER_STORE_BYTES = 20 * 1024 * 1024; // 20 MB compressed

/** 500 MB decompression cap for GEODAS sounding files */
const GEODAS_MAX_DECOMP_BYTES = 500 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface RawPoint_ extends RawPoint {}

/**
 * A single geolocated substrate observation from a NOAA Bottom_Samples file.
 * `substrateType` is a normalised label (mud / rock / sand / gravel / kelp)
 * derived from the raw verbal description.  When no keyword matches,
 * `substrateType` contains the raw label so the data is never silently lost.
 */
export interface SubstratePoint {
  lat: number;
  lon: number;
  /** Normalised category: "mud" | "rock" | "sand" | "gravel" | "kelp" | <raw> */
  substrateType: string;
  /** The unmodified COLOUR+NAT string as it appears in the source file. */
  rawLabel: string;
}

// ---------------------------------------------------------------------------
// HYD93 types (exported for tests)
// ---------------------------------------------------------------------------

/**
 * An annotation point extracted from a HYD93 a93 file.
 * Feature codes 89 (rocks), 103 (kelp), 146, 530 (rocky reefs), 988 carry
 * geographic context but are not depth soundings and must not be gridded.
 */
export interface Hyd93AnnotationPoint {
  lon: number;
  lat: number;
  featureCode: number;
}

/** Combined result from parseHyd93Text — soundings + labelled annotation points. */
export interface Hyd93ParseResult {
  soundings: RawPoint[];
  features: Hyd93AnnotationPoint[];
}

// ---------------------------------------------------------------------------
// Parser key type
// ---------------------------------------------------------------------------

export type TarParserKey =
  | "noaa-surveys-xyz"
  | "geodas-xyz"
  | "hyd93-a93"
  | "bottom-samples"
  | "inner-geotiff"
  | "skip";

// ---------------------------------------------------------------------------
// Skip reason type
// ---------------------------------------------------------------------------

export type SkipReason =
  /** File format is not supported by BathyScan (e.g. .sid.gz, .pdf, .htm). */
  | "unsupported-format"
  /** File contains only metadata, no depth soundings (e.g. surveys.txt). */
  | "metadata-only"
  /** An .xyz.gz quality-coded sibling exists in the same survey folder;
   *  the .a93.gz legacy version is redundant and skipped. */
  | "superseded-by-xyz";

export interface SkippedEntry {
  /** Relative path within the archive. */
  path: string;
  reason: SkipReason;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface TarRouteResult {
  /** Merged sounding points from all depth-bearing parsers in the archive. */
  points: RawPoint[];
  /** Human-readable name derived from surveys.txt H-number or archive filename. */
  datasetName: string;
  /**
   * Substrate annotation points from Bottom_Samples files.  Empty when no
   * BSText file is present in the archive.  Callers that only need sounding
   * depth data can safely ignore this field.
   */
  substratePoints: SubstratePoint[];
  /**
   * HYD93 cartographic annotation points (kelp patches, rocks, rocky reefs,
   * ledges, obstructions) extracted from .a93.gz files.  Empty when no HYD93
   * files were parsed or all contained only sounding rows (feature code 711).
   * Callers that only need depth data can safely ignore this field.
   */
  hyd93Features: Hyd93AnnotationPoint[];
  /** Entries that were intentionally skipped, with their skip reason. */
  skipped: SkippedEntry[];
  /**
   * Compressed .tif.gz bytes from a Smooth_Sheets inner GeoTIFF that lacked
   * georeferencing tags.  Present only when such a raster was encountered AND
   * the compressed size is ≤ MAX_RASTER_STORE_BYTES.  Callers should persist
   * this alongside the dataset and flag it as needing manual georeferencing.
   */
  smoothSheetRasterBuffer?: Buffer;
  /** Original filename (basename) of the ungeoreferenced inner GeoTIFF. */
  smoothSheetRasterFilename?: string;
  /**
   * Human-readable warnings about non-canonical column names that were
   * auto-resolved via synonym matching.  Each entry is a complete sentence
   * describing what was matched and what the canonical name is, e.g.
   * "Column 'long' was interpreted as longitude. Rename it to 'lon' to
   * silence this message."  Empty when all column names were canonical.
   */
  parseWarnings: string[];
}

// ---------------------------------------------------------------------------
// Routing table — path pattern → parser key
// ---------------------------------------------------------------------------

/**
 * Classify a single archive entry path into a parser key.
 *
 * All matching is case-insensitive and forward-slash normalised so that
 * archives extracted on Windows (backslash separators) are handled correctly.
 *
 * Routing table:
 *   Any path ending in `surveys.xyz`           → noaa-surveys-xyz
 *   `.../GEODAS/<name>.xyz.gz`                 → geodas-xyz
 *   `.../GEODAS/<name>.a93.gz`                 → hyd93-a93
 *   `.../Bottom_Samples/<name>_BSText.txt`     → bottom-samples
 *   `.../Smooth_Sheets/<name>.tif.gz`          → inner-geotiff
 *   `*.sid` / `*.sid.gz` / `*.pdf` / `*.htm` / `*.html`
 *                                              → skip (unsupported format)
 *   `surveys.txt` (at any depth)               → skip (metadata-only)
 *   Everything else (index HTML, thumbnails…)  → skip (unrecognised)
 */
export function classifyTarEntry(relativePath: string): TarParserKey {
  const p = relativePath.toLowerCase().replace(/\\/g, "/");

  // Explicitly unsupported formats
  if (
    p.endsWith(".sid") ||
    p.endsWith(".sid.gz") ||
    p.endsWith(".pdf") ||
    p.endsWith(".htm") ||
    p.endsWith(".html")
  ) {
    return "skip";
  }

  // Metadata-only: surveys.txt has survey metadata but no depth soundings
  if (p === "surveys.txt" || p.endsWith("/surveys.txt")) {
    return "skip";
  }

  // NOAA sounding TSV — surveys.xyz at any depth in the archive
  if (p === "surveys.xyz" || p.endsWith("/surveys.xyz")) {
    return "noaa-surveys-xyz";
  }

  // GEODAS .xyz.gz sounding CSV (directory name is GEODAS, case-insensitive)
  // Allow both root-level "GEODAS/foo.xyz.gz" and nested ".../GEODAS/foo.xyz.gz"
  if (/(?:^|\/)geodas\/[^/]+\.xyz\.gz$/.test(p)) {
    return "geodas-xyz";
  }

  // HYD93 fixed-width .a93.gz (also lives under GEODAS/)
  // Note: routeTarEntries may further demote to skip when an .xyz.gz sibling
  // is present in the same survey folder.
  if (/(?:^|\/)geodas\/[^/]+\.a93\.gz$/.test(p)) {
    return "hyd93-a93";
  }

  // Bottom Samples substrate annotation text file
  if (/(?:^|\/)bottom_samples\/[^/]+_bstext\.txt$/.test(p)) {
    return "bottom-samples";
  }

  // Smooth Sheets inner GeoTIFF (compressed .tif.gz)
  if (/(?:^|\/)smooth_sheets\/[^/]+\.tif\.gz$/.test(p)) {
    return "inner-geotiff";
  }

  // Unrecognised entry (index HTML, thumbnails, etc.) — skip
  return "skip";
}

// ---------------------------------------------------------------------------
// Substrate normalisation
// ---------------------------------------------------------------------------

/**
 * Keyword-to-category mapping for NOAA BSText verbal descriptions.
 *
 * The combined COLOUR+NAT string is upper-cased and searched for each keyword
 * in order.  The first match wins.  The order is intentional: more specific
 * terms (BEDROCK, BOULDER) are checked before generic ones (ROCK) to avoid
 * incorrect early matches.
 */
const SUBSTRATE_KEYWORDS: Array<{ keywords: string[]; category: string }> = [
  // Mud family
  { keywords: ["MUD", "SILT", "OOZE", "CLAY"], category: "mud" },
  // Rock family — bedrock/boulder before generic rock.
  // Note: "HARD" is deliberately excluded — it appears as a NAT (consistency)
  // descriptor (e.g. "CORAL HARD") and is not itself a rock-family indicator.
  // "HARD ROCK" is correctly caught by the "ROCK" keyword.
  { keywords: ["BEDROCK", "BOULDER", "ROCK", "SHORE", "STONE"], category: "rock" },
  // Sand
  { keywords: ["SAND"], category: "sand" },
  // Gravel / shell / pebble
  { keywords: ["PEBBLE", "GRAVEL", "SHELL", "COQUINA"], category: "gravel" },
  // Kelp / seaweed
  { keywords: ["KELP", "SEAWEED", "WEED"], category: "kelp" },
];

/**
 * Extract a numerical phi (φ) grain-size value from an upper-cased label
 * string.  Recognises explicit "PHI" unit suffixes (e.g. "-2 PHI", "4PHI")
 * and bare numbers that constitute the entire label (e.g. "-2", "4").
 * Returns `null` when no phi value is present.
 */
function extractPhiValue(upper: string): number | null {
  const withUnit = upper.match(/([+-]?\d+(?:\.\d+)?)\s*PHI\b/);
  if (withUnit) return parseFloat(withUnit[1]!);

  const bareNum = upper.trim().match(/^[+-]?\d+(?:\.\d+)?$/);
  if (bareNum) return parseFloat(bareNum[0]);

  return null;
}

/**
 * Map a Wentworth phi (φ) value to a canonical substrate category.
 *
 *   phi < -1        → gravel  (granules and coarser)
 *   -1 ≤ phi < 4    → sand
 *   phi ≥ 4         → mud     (silt and clay)
 */
function phiToCategory(phi: number): string {
  if (phi < -1) return "gravel";
  if (phi < 4) return "sand";
  return "mud";
}

/**
 * Normalise a combined verbal description string (e.g. "MUD GREEN,SHELLS BROKEN")
 * to a canonical substrate category.  Phi-scale grain-size values are checked
 * first; the keyword table is applied when no phi value is found.  Returns the
 * raw string when neither matches so that unrecognised descriptions are
 * preserved rather than silently discarded.
 */
export function normaliseSubstrate(rawLabel: string): string {
  const upper = rawLabel.toUpperCase();

  const phi = extractPhiValue(upper);
  if (phi !== null) return phiToCategory(phi);

  for (const { keywords, category } of SUBSTRATE_KEYWORDS) {
    for (const kw of keywords) {
      if (upper.includes(kw)) return category;
    }
  }
  return rawLabel.trim() || "unknown";
}

// ---------------------------------------------------------------------------
// parseBottomSamples — NOAA BSText substrate annotation parser
// ---------------------------------------------------------------------------

/**
 * Parse a NOAA `Bottom_Samples/*_BSText.txt` tab-delimited substrate
 * annotation file into an array of geolocated substrate observations.
 *
 * File format (tab-delimited, first row is a header):
 *   SHT_NUM  TRACK_NUM  STA_NUM  LAT  LON  DEPTH  COLOUR  NAT  DESCRIP  …
 *
 * Column semantics:
 *   LAT     — decimal-degrees latitude (positive north)
 *   LON     — decimal-degrees longitude (negative west in the western hemisphere)
 *   COLOUR  — colour/texture description (e.g. "MUD GREEN", "HARD ROCK")
 *   NAT     — nature/consistency (e.g. "SOFT", "FIRM")
 *   DESCRIP — optional free-text description (may be absent)
 *
 * The COLOUR and NAT fields are concatenated (space-separated) to form the
 * `rawLabel` that is passed to `normaliseSubstrate`.  When either field is
 * blank or absent, only the non-blank field is used.
 *
 * Rows with missing or non-finite lat/lon values are silently skipped.
 *
 * @param filePath  Absolute path to the _BSText.txt file.
 * @returns Array of `SubstratePoint` objects — empty when the file has no
 *   parseable rows (e.g. header-only or all rows have missing coordinates).
 */
export async function parseBottomSamples(filePath: string): Promise<SubstratePoint[]> {
  let text: string;
  try {
    text = await fs.promises.readFile(filePath, "utf8");
  } catch (err) {
    throw new Error(
      `parseBottomSamples: failed to read "${path.basename(filePath)}": ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  // Parse header row to discover column indices (case-insensitive)
  const headerLine = lines[0] ?? "";
  const headers = headerLine.split("\t").map((h) => h.trim().toUpperCase());

  const colIdx = (name: string): number => headers.indexOf(name);
  const latCol = colIdx("LAT");
  const lonCol = colIdx("LON");
  const colourCol = colIdx("COLOUR");
  const natCol = colIdx("NAT");

  if (latCol === -1 || lonCol === -1) {
    throw new Error(
      `parseBottomSamples: "${path.basename(filePath)}" has no LAT or LON column. ` +
        `Found headers: ${headers.join(", ")}.`,
    );
  }

  const points: SubstratePoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === "") continue;

    const cols = line.split("\t");

    const latStr = cols[latCol]?.trim() ?? "";
    const lonStr = cols[lonCol]?.trim() ?? "";
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const colour = colourCol !== -1 ? (cols[colourCol]?.trim() ?? "") : "";
    const nat = natCol !== -1 ? (cols[natCol]?.trim() ?? "") : "";

    // Combine COLOUR and NAT into a single raw label for normalisation
    const rawLabel = [colour, nat].filter((s) => s.length > 0).join(" ");
    const substrateType = normaliseSubstrate(rawLabel);

    points.push({ lat, lon, substrateType, rawLabel });
  }

  return points;
}


/** NOAA null-depth sentinel — rows with this exact depth value are discarded. */
const NOAA_NULL_DEPTH = 99999.9;

/**
 * Parse a NOAA `surveys.xyz` TSV sounding file.
 *
 * The file is tab-separated with a mandatory header row in the form:
 *   SURVEY\tLON\tLAT\tDEPTH
 *
 * Note that LON precedes LAT — the opposite of the conventional column order
 * used elsewhere in BathyScan.  This parser detects the header, maps columns
 * by name (case-insensitive, trimmed), and returns correctly ordered
 * `{ lon, lat, depth }` triples.
 *
 * Filtering rules:
 *   - Rows where DEPTH is absent, non-numeric, or non-finite are skipped.
 *   - Rows where DEPTH equals 99999.9 (NOAA null sentinel) are skipped.
 *   - Rows with coordinates outside valid WGS84 bounds are skipped.
 *
 * Depth values are already positive-downward metres; no sign flip is needed.
 *
 * @param filePath Absolute path to the extracted `surveys.xyz` file.
 */
export async function parseNoaaSurveysXyz(filePath: string): Promise<RawPoint[]> {
  let text: string;
  try {
    text = await fs.promises.readFile(filePath, "utf8");
  } catch (err) {
    throw new Error(
      `Failed to read surveys.xyz: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const lines = text.split(/\r?\n/);
  if (lines.length === 0) {
    throw new Error("surveys.xyz is empty.");
  }

  // Locate and parse the header row — the first non-empty, non-comment line.
  let headerLineIdx = -1;
  let lonCol = -1;
  let latCol = -1;
  let depthCol = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const cols = trimmed.split("\t").map((c) => c.trim().toLowerCase());
    const surveyIdx = cols.indexOf("survey");
    const lonIdx = cols.indexOf("lon");
    const latIdx = cols.indexOf("lat");
    const depthIdx = cols.indexOf("depth");

    if (surveyIdx !== -1 && lonIdx !== -1 && latIdx !== -1 && depthIdx !== -1) {
      headerLineIdx = i;
      lonCol = lonIdx;
      latCol = latIdx;
      depthCol = depthIdx;
      break;
    }

    // If the first content line isn't a header, the format is unrecognised.
    throw new Error(
      `surveys.xyz: expected header row with columns SURVEY, LON, LAT, DEPTH ` +
        `(tab-separated, case-insensitive). First content line was: "${trimmed.slice(0, 120)}"`,
    );
  }

  if (headerLineIdx === -1) {
    throw new Error("surveys.xyz: file contains no recognisable header row.");
  }

  const points: RawPoint[] = [];
  let skipped = 0;

  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;

    const cols = line.split("\t");

    const rawLon = cols[lonCol];
    const rawLat = cols[latCol];
    const rawDepth = cols[depthCol];

    if (rawLon === undefined || rawLat === undefined || rawDepth === undefined) {
      skipped++;
      continue;
    }

    const lon = parseFloat(rawLon);
    const lat = parseFloat(rawLat);
    const depth = parseFloat(rawDepth);

    if (!Number.isFinite(depth) || depth === NOAA_NULL_DEPTH) {
      skipped++;
      continue;
    }

    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      skipped++;
      continue;
    }

    points.push({ lon, lat, depth });
  }

  if (skipped > 0) {
    logger.info(
      { filePath: path.basename(filePath), skipped },
      `[noaa-surveys-xyz] skipped ${skipped} invalid/null row(s)`,
    );
  }

  return points;
}

// ---------------------------------------------------------------------------
// Synonym tables for GEODAS xyz column resolution
// ---------------------------------------------------------------------------

const GEODAS_COL_SYNONYMS = {
  lat: ["lat", "latitude", "latitiude", "latitide", "lati", "y_coord", "y"],
  lon: ["lon", "long", "longitude", "longitide", "longitiude", "lng", "x_coord", "x"],
  depth: [
    "depth",
    "dept",
    "deepth",
    "dpth",
    "dep",
    "z",
    "elevation",
    "elev",
    "altitude",
    "alt",
    "height",
    "bathy",
    "bathymetry",
  ],
  quality_code: ["quality_code", "quality", "qualitycode", "qc", "flag", "qual_code", "qual"],
  active: ["active", "status", "valid", "enabled", "use", "include"],
} as const;

/**
 * Return the first index in `headers` that matches any synonym (case-insensitive,
 * already trimmed/lowercased). Returns -1 when no match is found.
 */
function resolveCol(headers: string[], synonyms: readonly string[]): number {
  for (let i = 0; i < headers.length; i++) {
    if (synonyms.includes(headers[i] as (typeof synonyms)[number])) return i;
  }
  return -1;
}

/**
 * Like `resolveCol`, but also returns the matched header name so callers can
 * detect when a non-canonical synonym was used (i.e. the matched name is not
 * the first entry in the synonym list).
 */
function resolveColWithMatch(
  headers: string[],
  synonyms: readonly string[],
): { idx: number; matchedName: string | null } {
  for (let i = 0; i < headers.length; i++) {
    if (synonyms.includes(headers[i] as (typeof synonyms)[number])) {
      return { idx: i, matchedName: headers[i]! };
    }
  }
  return { idx: -1, matchedName: null };
}

/**
 * Parse a GEODAS xyz.gz sounding CSV.
 *
 * Supported delimiters (auto-detected from the header line):
 *   - Comma (CSV): `survey_id,lat,lon,depth,quality_code,active`
 *   - Tab (TSV):   `survey_id\tlat\tlon\tdepth\tquality_code\tactive`
 *   - 2+ spaces:   `survey_id  lat  lon  depth  quality_code  active`
 *
 * Quality filter: rows where quality_code != 1 or active != 1 are excluded.
 * Depth convention: GEODAS depths are positive-downward (matches BathyScan).
 * Negative depths (elevations above datum) are skipped.
 *
 * Column names are matched case-insensitively against the synonym tables in
 * GEODAS_COL_SYNONYMS, so common alternate spellings (e.g. "long", "latitude",
 * "elev") are accepted without renaming the file.
 *
 * @param filePath      Absolute path to the .xyz.gz file on disk.
 * @param parseWarnings Optional array to collect human-readable warnings about
 *   non-canonical column names that were auto-resolved via synonym matching.
 *   When omitted warnings are only logged at INFO level (existing behaviour).
 */
export async function parseGeodasXyz(filePath: string, parseWarnings?: string[]): Promise<RawPoint[]> {
  const compressed = await fs.promises.readFile(filePath);
  let decompressed: Buffer;
  try {
    decompressed = await gunzipBounded(compressed, GEODAS_MAX_DECOMP_BYTES);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "DECOMPRESS_TOO_LARGE") {
      throw new Error(
        `GEODAS xyz.gz file exceeds the ${GEODAS_MAX_DECOMP_BYTES / 1024 / 1024} MB decompression limit: ${path.basename(filePath)}`,
      );
    }
    throw new Error(
      `Failed to decompress GEODAS xyz.gz file "${path.basename(filePath)}": ${e.message}`,
    );
  }

  const text = decompressed.toString("utf8");
  const lines = text.split(/\r?\n/);

  // Parse the header row to find column indices (case-insensitive, whitespace-tolerant)
  const headerLine = lines[0];
  if (!headerLine) {
    throw new Error(`GEODAS xyz.gz file "${path.basename(filePath)}" is empty or has no header.`);
  }

  // Auto-detect delimiter: tab → TSV, 2+ consecutive spaces → fixed-width space, else comma
  const delimiter: "tab" | "spaces" | "comma" = headerLine.includes("\t")
    ? "tab"
    : / {2,}/.test(headerLine)
      ? "spaces"
      : "comma";

  function splitRow(row: string): string[] {
    if (delimiter === "tab") return row.split("\t");
    if (delimiter === "spaces") return row.trim().split(/ {2,}/);
    return row.split(",");
  }

  const headers = splitRow(headerLine).map((h) => h.trim().toLowerCase());

  const { idx: idxLat, matchedName: latName } = resolveColWithMatch(headers, GEODAS_COL_SYNONYMS.lat);
  const { idx: idxLon, matchedName: lonName } = resolveColWithMatch(headers, GEODAS_COL_SYNONYMS.lon);
  const { idx: idxDepth, matchedName: depthName } = resolveColWithMatch(headers, GEODAS_COL_SYNONYMS.depth);
  const idxQuality = resolveCol(headers, GEODAS_COL_SYNONYMS.quality_code);
  const idxActive = resolveCol(headers, GEODAS_COL_SYNONYMS.active);

  // Emit warnings when a required column was matched via a non-canonical synonym.
  // The canonical name is the first entry in each synonym list.
  const canonicalLat = GEODAS_COL_SYNONYMS.lat[0];
  const canonicalLon = GEODAS_COL_SYNONYMS.lon[0];
  const canonicalDepth = GEODAS_COL_SYNONYMS.depth[0];

  if (latName && latName !== canonicalLat) {
    const msg = `Column '${latName}' was interpreted as latitude. Rename it to '${canonicalLat}' to silence this message.`;
    logger.info({ file: path.basename(filePath), column: latName, resolvedTo: canonicalLat }, `[geodas-xyz] column '${latName}' resolved to ${canonicalLat}`);
    parseWarnings?.push(msg);
  }
  if (lonName && lonName !== canonicalLon) {
    const msg = `Column '${lonName}' was interpreted as longitude. Rename it to '${canonicalLon}' to silence this message.`;
    logger.info({ file: path.basename(filePath), column: lonName, resolvedTo: canonicalLon }, `[geodas-xyz] column '${lonName}' resolved to ${canonicalLon}`);
    parseWarnings?.push(msg);
  }
  if (depthName && depthName !== canonicalDepth) {
    const msg = `Column '${depthName}' was interpreted as depth. Rename it to '${canonicalDepth}' to silence this message.`;
    logger.info({ file: path.basename(filePath), column: depthName, resolvedTo: canonicalDepth }, `[geodas-xyz] column '${depthName}' resolved to ${canonicalDepth}`);
    parseWarnings?.push(msg);
  }

  if (idxLat === -1 || idxLon === -1 || idxDepth === -1) {
    const missing: string[] = [];
    if (idxLat === -1)
      missing.push(`lat (accepted: ${GEODAS_COL_SYNONYMS.lat.join(", ")})`);
    if (idxLon === -1)
      missing.push(`lon (accepted: ${GEODAS_COL_SYNONYMS.lon.join(", ")})`);
    if (idxDepth === -1)
      missing.push(`depth (accepted: ${GEODAS_COL_SYNONYMS.depth.join(", ")})`);
    throw new Error(
      `GEODAS xyz.gz file "${path.basename(filePath)}" is missing required columns. ` +
        `Found: ${headers.join(", ")}. Missing: ${missing.join("; ")}.`,
    );
  }

  const points: RawPoint[] = [];
  let totalRows = 0;
  let filteredQuality = 0;
  let filteredNegativeDepth = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    totalRows++;
    const cols = splitRow(line);

    // Quality filter — reject if quality_code or active fields are present and != 1
    if (idxQuality !== -1) {
      const qc = parseInt(cols[idxQuality]?.trim() ?? "", 10);
      if (qc !== 1) {
        filteredQuality++;
        continue;
      }
    }
    if (idxActive !== -1) {
      const active = parseInt(cols[idxActive]?.trim() ?? "", 10);
      if (active !== 1) {
        filteredQuality++;
        continue;
      }
    }

    const lat = parseFloat(cols[idxLat]?.trim() ?? "");
    const lon = parseFloat(cols[idxLon]?.trim() ?? "");
    const depth = parseFloat(cols[idxDepth]?.trim() ?? "");

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(depth)) continue;

    // Negative depths are elevations above datum — skip
    if (depth < 0) {
      filteredNegativeDepth++;
      continue;
    }

    points.push({ lat, lon, depth });
  }

  logger.info(
    {
      file: path.basename(filePath),
      loaded: points.length,
      totalRows,
      filteredQuality,
      filteredNegativeDepth,
    },
    `[geodas-xyz] loaded ${points.length} / ${totalRows} soundings ` +
      `(${filteredQuality} filtered by quality/active, ${filteredNegativeDepth} above-datum skipped)`,
  );

  return points;
}

// ---------------------------------------------------------------------------
// HYD93 fixed-width format constants
// ---------------------------------------------------------------------------

/**
 * HYD93 (.a93) fixed-width column layout (0-based byte offsets, end exclusive).
 *
 * Reference: http://www.ngdc.noaa.gov/mgg/dat/geodas/docs/hyd93.htm
 *
 *   survey_id      [0,  8)  — 8 chars, right-padded survey H-number
 *   lat_millionths [8, 19)  — 11 chars, signed integer; divide by 1e6 → decimal degrees
 *   lon_millionths [19,31)  — 12 chars, signed integer; negative for West
 *   depth_cm       [31,38)  — 7 chars, depth in centimetres; 9999999 = null sentinel
 *   type_of_obs    [38,39)  — 1 char; '6' = "deeper than" sounding → exclude
 *   feature_code   [39,42)  — 3 chars, right-justified; 711 = true sounding
 */
const HYD93_LAT_START = 8;
const HYD93_LON_START = 19;
const HYD93_DEPTH_START = 31;
const HYD93_TYPE_START = 38;
const HYD93_FC_START = 39;
const HYD93_LINE_MIN = 42;

/** Feature code for a true depth sounding — contributes to the bathymetric surface. */
const HYD93_FC_SOUNDING = 711;

/**
 * Feature codes that represent cartographic annotations, not depth soundings.
 * These are extracted as labelled points rather than being gridded.
 *
 *   89  — rocks (above / awash)
 *   103 — kelp patches
 *   146 — ledges
 *   530 — rocky reefs
 *   988 — obstruction / wreck
 */
const HYD93_ANNOTATION_CODES = new Set([89, 103, 146, 530, 988]);

/** Null-depth sentinel value in centimetres (99999.9 m × 100). */
const HYD93_NULL_DEPTH_CM = 9999999;

/** type_of_obs value that flags a "deeper than" sounding — must be excluded. */
const HYD93_TYPE_DEEPER_THAN = "6";

/**
 * Parse the decompressed ASCII text of a HYD93 a93 file.
 *
 * Exported for unit testing without requiring a file on disk.
 *
 * @returns `{ soundings, features }` where:
 *   - `soundings` are feature-code-711 rows decoded to { lon, lat, depth } in
 *     decimal degrees and positive-downward metres.
 *   - `features` are non-depth annotation rows carrying their feature code.
 */
export function parseHyd93Text(text: string): Hyd93ParseResult {
  const soundings: RawPoint[] = [];
  const features: Hyd93AnnotationPoint[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length < HYD93_LINE_MIN) continue;

    const latInt = parseInt(rawLine.slice(HYD93_LAT_START, HYD93_LON_START).trim(), 10);
    const lonInt = parseInt(rawLine.slice(HYD93_LON_START, HYD93_DEPTH_START).trim(), 10);
    const depthInt = parseInt(rawLine.slice(HYD93_DEPTH_START, HYD93_TYPE_START).trim(), 10);
    const typeOfObs = rawLine[HYD93_TYPE_START]!;
    const fcInt = parseInt(rawLine.slice(HYD93_FC_START, HYD93_LINE_MIN).trim(), 10);

    if (!Number.isFinite(latInt) || !Number.isFinite(lonInt) || isNaN(latInt) || isNaN(lonInt)) continue;

    const lat = latInt / 1_000_000;
    const lon = lonInt / 1_000_000;

    if (
      !Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180
    ) continue;

    if (isNaN(fcInt)) continue;

    if (fcInt === HYD93_FC_SOUNDING) {
      if (depthInt >= HYD93_NULL_DEPTH_CM) continue;
      if (typeOfObs === HYD93_TYPE_DEEPER_THAN) continue;
      if (!Number.isFinite(depthInt) || isNaN(depthInt)) continue;
      const depth = depthInt / 100;
      soundings.push({ lon, lat, depth });
    } else if (HYD93_ANNOTATION_CODES.has(fcInt)) {
      features.push({ lon, lat, featureCode: fcInt });
    }
  }

  return { soundings, features };
}

/**
 * Parse a HYD93 a93.gz fixed-width sounding file.
 *
 * Reads and decompresses the .a93.gz file at `filePath`, then delegates to
 * `parseHyd93Text`.  Returns both the depth soundings (feature code 711) and
 * cartographic annotation points (kelp, rocks, rocky reefs, ledges,
 * obstructions).
 *
 * @throws if the file cannot be read or decompressed.
 */
export async function parseHyd93A93(filePath: string): Promise<Hyd93ParseResult> {
  let raw: Buffer;
  try {
    raw = await fs.promises.readFile(filePath);
  } catch (err) {
    const originalCode = (err as NodeJS.ErrnoException).code;
    const wrapped = Object.assign(
      new Error(
        `parseHyd93A93: failed to read "${path.basename(filePath)}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      ),
      originalCode ? { code: originalCode } : {},
    );
    throw wrapped;
  }

  let decompressed: Buffer;
  try {
    decompressed = await gunzipBounded(raw, 500 * 1024 * 1024);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "DECOMPRESS_TOO_LARGE") {
      throw new Error(
        `parseHyd93A93: "${path.basename(filePath)}" exceeds the 500 MB decompression limit.`,
      );
    }
    throw new Error(
      `parseHyd93A93: failed to decompress "${path.basename(filePath)}": ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = decompressed.toString("ascii");

  // Count total non-empty lines for the parse summary
  const totalLines = text.split(/\r?\n/).filter((l) => l.length >= HYD93_LINE_MIN).length;

  const result = parseHyd93Text(text);
  const filtered = totalLines - result.soundings.length - result.features.length;

  logger.info(
    {
      file: path.basename(filePath),
      totalLines,
      soundings: result.soundings.length,
      features: result.features.length,
      filtered,
    },
    `[hyd93-a93] loaded ${result.soundings.length} sounding(s) and ${result.features.length} annotation feature(s) ` +
      `from ${totalLines} line(s) (${filtered} filtered/unrecognised)`,
  );

  return result;
}

/**
 * Parse a Smooth_Sheets inner tif.gz GeoTIFF raster.
 *
 * Decompresses the inner `.tif.gz` entry, then delegates to the existing
 * `parseGeoTiff` function.  If the TIF has no embedded georeferencing tags
 * (ModelTiepoint, ModelPixelScale, or ModelTransformation) — common for older
 * NOAA smooth sheets — the function logs a structured warning and returns an
 * empty array rather than propagating the error.  The upload job will still
 * succeed using whatever sounding points were gathered from other entries.
 */
export async function parseSmoothSheetsGeoTiff(filePath: string): Promise<RawPoint[]> {
  let compressed: Buffer;
  try {
    compressed = await fs.promises.readFile(filePath);
  } catch (err) {
    throw new Error(
      `Failed to read inner tif.gz "${path.basename(filePath)}": ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let tifBuffer: Buffer;
  try {
    tifBuffer = await gunzipBounded(compressed, INNER_GZ_MAX_BYTES);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "DECOMPRESS_TOO_LARGE") {
      throw new Error(
        `Inner GeoTIFF "${path.basename(filePath)}" exceeds the ` +
          `${Math.round(INNER_GZ_MAX_BYTES / 1024 / 1024)} MB decompression limit.`,
      );
    }
    throw new Error(
      `Failed to decompress inner tif.gz "${path.basename(filePath)}": ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Inspect the file-directory tags directly before calling parseGeoTiff so
  // that missing georeferencing is detected via a structural check rather than
  // by matching error-message strings (which would silently break if the
  // geotiff library ever changes its wording).
  let tiff;
  try {
    tiff = await fromArrayBuffer(
      tifBuffer.buffer.slice(
        tifBuffer.byteOffset,
        tifBuffer.byteOffset + tifBuffer.byteLength,
      ) as ArrayBuffer,
    );
  } catch (err) {
    throw new Error(
      `Failed to open inner GeoTIFF "${path.basename(filePath)}": ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const image = await tiff.getImage();

  // geotiff v3 exposes a lazy IFD via getValue(); fall back to direct property
  // access for older versions — same pattern as parseGeoTiff in uploadParsers.ts.
  type IFD = { getValue?: (tag: string) => unknown } & Record<string, unknown>;
  const fd = image.fileDirectory as unknown as IFD;
  const getTag = (tag: string): unknown =>
    typeof fd.getValue === "function" ? fd.getValue(tag) : fd[tag];

  const hasPixelScale = getTag("ModelPixelScale") != null;
  const hasTiepoint = getTag("ModelTiepoint") != null;
  const hasTransformation = getTag("ModelTransformation") != null;
  const hasGeoreferencing = hasTransformation || (hasPixelScale && hasTiepoint);

  if (!hasGeoreferencing) {
    // Older NOAA smooth sheets frequently lack georeferencing tags.  Treat
    // this as a recoverable warning — the upload completes using depth points
    // from other entries (surveys.xyz / GEODAS) while the raster is noted as
    // needing manual georeferencing.
    logger.warn(
      { entry: path.basename(filePath) },
      `[noaa-tar-router] inner GeoTIFF "${path.basename(filePath)}" has no ` +
        `georeferencing tags — raster loaded but needs manual georeferencing; skipping coordinate extraction`,
    );
    return [];
  }

  try {
    return await parseGeoTiff(tifBuffer);
  } catch (err) {
    // Georeferencing tags were present but parsing failed for another reason
    // (e.g. corrupt raster data).  Re-throw with a clear diagnostic.
    throw new Error(
      `Failed to parse inner GeoTIFF "${path.basename(filePath)}": ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Parser dispatch table — depth-bearing parsers only
//
// `bottom-samples` is intentionally excluded: it returns SubstratePoint[]
// rather than RawPoint[] and is dispatched separately in routeTarEntries.
// `hyd93-a93` is also excluded: it returns Hyd93ParseResult (soundings +
// annotation features) and is dispatched separately so both arrays can be
// collected independently without double-reading the compressed file.
//
// Exported so test code can replace individual entries with mocks without
// needing to spy on the ESM live bindings (which bypasses the local closure).
// Do NOT mutate in production code.
// ---------------------------------------------------------------------------

/**
 * Module-level warning sink populated by `routeTarEntries` immediately before
 * the dispatch loop and cleared after it.  The `geodasXyzDispatch` entry reads
 * this sink so that warnings flow into the caller's array without changing the
 * `(filePath: string) => Promise<RawPoint[]>` signature that tests mock.
 *
 * This variable is only written/read on the same microtask tick as the
 * `routeTarEntries` call; because Node.js is single-threaded and
 * `routeTarEntries` awaits each parser in sequence, there is no interleaving
 * risk between concurrent HTTP requests.
 */
let _geodasXyzWarningSink: string[] | undefined;

/**
 * Default `parserDispatch["geodas-xyz"]` entry.  Delegates to `parseGeodasXyz`
 * and passes the current `_geodasXyzWarningSink` so that `routeTarEntries` can
 * collect synonym-match warnings.  When tests replace this entry with a mock,
 * the sink is set but unused — the mock returns fake points as expected.
 */
function geodasXyzDispatch(filePath: string): Promise<RawPoint[]> {
  return parseGeodasXyz(filePath, _geodasXyzWarningSink);
}

export const parserDispatch: Record<
  Exclude<TarParserKey, "skip" | "bottom-samples" | "hyd93-a93">,
  (filePath: string) => Promise<RawPoint[]>
> = {
  "noaa-surveys-xyz": parseNoaaSurveysXyz,
  "geodas-xyz": geodasXyzDispatch,
  "inner-geotiff": parseSmoothSheetsGeoTiff,
};

// ---------------------------------------------------------------------------
// Dataset name extraction
// ---------------------------------------------------------------------------

/**
 * Attempt to extract a human-readable dataset name from the `surveys.txt`
 * metadata file present in many NOAA tar.gz archives.
 *
 * `surveys.txt` typically contains one or more lines of the form:
 *   H09084   THORNE BAY   AK   ...
 * where the first token is an H-number (Hxxxxx or HBxxxxx) and subsequent
 * whitespace-separated tokens describe the survey area.  We emit:
 *   "H09084 — Thorne Bay"
 *
 * Returns null when the file is absent, unreadable, or contains no
 * parseable H-number line.
 */
async function extractSurveyNameFromMetadata(
  extractedDir: string,
  entries: string[],
): Promise<string | null> {
  const metaEntry = entries.find((e) => {
    const lp = e.toLowerCase().replace(/\\/g, "/");
    return lp === "surveys.txt" || lp.endsWith("/surveys.txt");
  });
  if (!metaEntry) return null;

  const filePath = path.join(extractedDir, metaEntry);
  try {
    const text = await fs.promises.readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;

      // Match H-number: H followed by optional alpha suffix and 4–6 digits
      const hMatch = trimmed.match(/^(H[A-Z]?\d{4,6})\s+(.*)/i);
      if (hMatch) {
        const hNumber = hMatch[1]!.toUpperCase();
        // Take the first double-space-delimited field as the area name
        const rest = (hMatch[2]!.trim().split(/\s{2,}/)[0] ?? "").trim();
        // Title-case the area name for display (lowercase all, then uppercase first letter of each word)
        const area = rest.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
        return area ? `${hNumber} — ${area}` : hNumber;
      }
    }
  } catch {
    // Unreadable — fall through to filename fallback
  }
  return null;
}

/**
 * Derive a dataset name from the archive filename when `surveys.txt` is
 * absent or unparseable.  Strips .tar.gz / .gz suffixes, replaces
 * underscores/hyphens with spaces, and trims.
 */
function nameFromArchiveFilename(archiveFileName: string): string {
  return archiveFileName
    .replace(/\.tar\.gz$/i, "")
    .replace(/\.gz$/i, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Sibling detection — .a93.gz superseded by .xyz.gz in the same folder
// ---------------------------------------------------------------------------

/**
 * Build a set of normalised directory prefixes that have at least one
 * `.xyz.gz` entry classified as `geodas-xyz`.  Used to detect when an
 * `.a93.gz` sibling in the same folder should be skipped in favour of
 * the quality-coded XYZ version.
 */
function buildXyzGzDirs(entries: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const entry of entries) {
    const p = entry.toLowerCase().replace(/\\/g, "/");
    if (/(?:^|\/)geodas\/[^/]+\.xyz\.gz$/.test(p)) {
      dirs.add(p.substring(0, p.lastIndexOf("/")));
    }
  }
  return dirs;
}

// ---------------------------------------------------------------------------
// Main router entry point
// ---------------------------------------------------------------------------

const NO_PARSEABLE_DATA_MESSAGE = "No parseable bathymetric data found in this archive.";

/**
 * Walk the entries extracted from a NOAA tar.gz archive, dispatch each
 * recognised entry to its parser, and return merged sounding points with a
 * human-readable dataset name and any substrate annotation points.
 *
 * Depth-bearing parsers (surveys.xyz, GEODAS, HYD93, Smooth_Sheets) contribute
 * to `result.points`.  Bottom_Samples substrate files contribute exclusively to
 * `result.substratePoints` and do not add sounding depth data.
 *
 * Skipped entries (`.sid`, `.pdf`, `.htm`, `surveys.txt`, unrecognised
 * metadata files) are logged at INFO level since skipping is expected
 * behaviour for mixed-content NOAA archives.
 *
 * @param extractedDir    Directory where the tar was extracted.
 * @param entries         Relative entry paths from extractTarFile / extractTarBuffer.
 * @param archiveFileName Original archive filename used as the name fallback.
 *
 * @throws {Error} code `"NO_PARSEABLE_DATA"` — archive contains no entries
 *   that match a known NOAA format, or all matched entries produced zero points.
 * @throws {Error} code `"PARSER_NOT_IMPLEMENTED"` — a recognised entry type
 *   was matched but its parser is not yet implemented.
 */
export async function routeTarEntries(
  extractedDir: string,
  entries: string[],
  archiveFileName: string,
): Promise<TarRouteResult> {
  const allPoints: RawPoint[] = [];
  const allSubstratePoints: SubstratePoint[] = [];
  const allHyd93Features: Hyd93AnnotationPoint[] = [];
  const allParseWarnings: string[] = [];

  // Build the set of GEODAS directories that have at least one .xyz.gz so we
  // can detect .a93.gz files that are superseded by a quality-coded sibling.
  const xyzGzDirs = buildXyzGzDirs(entries);

  // Classify every non-directory entry
  const recognised: Array<{ relativePath: string; key: Exclude<TarParserKey, "skip"> }> = [];
  const skipped: SkippedEntry[] = [];

  for (const entry of entries) {
    // Skip bare directory entries emitted by the tar extractor
    const normalised = entry.replace(/\\/g, "/");
    if (normalised.endsWith("/")) continue;

    const key = classifyTarEntry(entry);

    if (key === "skip") {
      const p = normalised.toLowerCase();
      let reason: SkipReason;
      if (p === "surveys.txt" || p.endsWith("/surveys.txt")) {
        reason = "metadata-only";
      } else if (
        p.endsWith(".sid") ||
        p.endsWith(".sid.gz") ||
        p.endsWith(".pdf") ||
        p.endsWith(".htm") ||
        p.endsWith(".html")
      ) {
        reason = "unsupported-format";
      } else {
        reason = "unsupported-format";
      }
      skipped.push({ path: entry, reason });
    } else if (key === "hyd93-a93") {
      // Prefer the quality-coded .xyz.gz when one exists in the same folder
      const pNorm = normalised.toLowerCase();
      const dir = pNorm.substring(0, pNorm.lastIndexOf("/"));
      if (xyzGzDirs.has(dir)) {
        skipped.push({ path: entry, reason: "superseded-by-xyz" });
      } else {
        recognised.push({ relativePath: entry, key });
      }
    } else {
      recognised.push({ relativePath: entry, key });
    }
  }

  // Log each skipped entry at INFO (skipping is expected in NOAA archives)
  for (const s of skipped) {
    logger.info(
      { entry: s.path, reason: s.reason },
      `[noaa-tar-router] skipping "${path.basename(s.path)}" (${s.reason})`,
    );
  }

  // Fail early with a clear user-facing message when nothing is parseable
  if (recognised.length === 0) {
    throw Object.assign(new Error(NO_PARSEABLE_DATA_MESSAGE), {
      code: "NO_PARSEABLE_DATA",
    });
  }

  // When both geodas-xyz and hyd93-a93 are present, skip hyd93-a93.
  // GEODAS xyz carries quality codes and is the preferred source; the a93
  // file is a fallback for archives that only bundle the HYD93 fixed-width format.
  const hasGeodasXyz = recognised.some((r) => r.key === "geodas-xyz");
  const dispatching = hasGeodasXyz
    ? recognised.filter((r) => r.key !== "hyd93-a93")
    : recognised;

  if (hasGeodasXyz && dispatching.length < recognised.length) {
    const skippedA93 = recognised
      .filter((r) => r.key === "hyd93-a93")
      .map((r) => path.basename(r.relativePath));
    logger.info(
      { skippedA93 },
      `[noaa-tar-router] geodas-xyz present — skipping hyd93-a93 file(s): ${skippedA93.join(", ")}`,
    );
  }

  // Track the first ungeoreferenced smooth-sheet raster encountered.
  // Only one is captured — archives with multiple un-georef'd rasters are rare
  // and capturing all would risk large DB payloads.
  let smoothSheetRasterBuffer: Buffer | undefined;
  let smoothSheetRasterFilename: string | undefined;

  // Set the module-level warning sink so geodasXyzDispatch (the parserDispatch
  // entry for "geodas-xyz") can forward synonym-match warnings into allParseWarnings
  // without changing the (filePath: string) => Promise<RawPoint[]> signature that
  // tests mock.  Cleared in the finally block below.
  _geodasXyzWarningSink = allParseWarnings;

  // Dispatch each recognised entry to its parser and accumulate points
  for (const { relativePath, key } of dispatching) {
    const absolutePath = path.join(extractedDir, relativePath);

    logger.info(
      { entry: relativePath, key },
      `[noaa-tar-router] dispatching "${path.basename(relativePath)}" to parser "${key}"`,
    );

    if (key === "bottom-samples") {
      // Substrate annotations go into a separate collection — they do not
      // contribute to the sounding depth grid.
      const spts = await parseBottomSamples(absolutePath);

      logger.info(
        { entry: relativePath, key, pointCount: spts.length },
        `[noaa-tar-router] parser "${key}" returned ${spts.length} substrate point(s)`,
      );

      allSubstratePoints.push(...spts);
    } else if (key === "hyd93-a93") {
      // HYD93 a93.gz files return both depth soundings AND cartographic
      // annotation features.  Parse once, distribute to both collections.
      const { soundings, features } = await parseHyd93A93(absolutePath);

      logger.info(
        { entry: relativePath, key, soundingCount: soundings.length, featureCount: features.length },
        `[noaa-tar-router] parser "${key}" returned ${soundings.length} sounding(s) and ${features.length} annotation feature(s)`,
      );

      allPoints.push(...soundings);
      allHyd93Features.push(...features);
    } else if (key === "inner-geotiff") {
      // Smooth-sheet GeoTIFFs go through parseSmoothSheetsGeoTiff which already
      // handles the no-georef case by returning [].  When it does return [],
      // capture the raw compressed bytes so the caller can store them for the
      // interactive georeferencing wizard.
      // Use parserDispatch so tests can mock this entry without side-effects.
      const points = await parserDispatch["inner-geotiff"](absolutePath);

      if (points.length === 0) {
        // The raster had no georeferencing tags — capture it for manual pinning.
        // Only store if size is within budget and we haven't captured one yet.
        if (!smoothSheetRasterBuffer) {
          try {
            const gzBytes = await fs.promises.readFile(absolutePath);
            if (gzBytes.length <= MAX_RASTER_STORE_BYTES) {
              smoothSheetRasterBuffer = gzBytes;
              smoothSheetRasterFilename = path.basename(relativePath);
              logger.info(
                { entry: relativePath, sizeBytes: gzBytes.length },
                `[noaa-tar-router] captured ungeoreferenced smooth-sheet raster (${gzBytes.length} bytes) for georef wizard`,
              );
            } else {
              logger.warn(
                { entry: relativePath, sizeBytes: gzBytes.length, limitBytes: MAX_RASTER_STORE_BYTES },
                `[noaa-tar-router] ungeoreferenced smooth-sheet raster exceeds storage cap — georef wizard image unavailable`,
              );
            }
          } catch (readErr) {
            logger.warn(
              { entry: relativePath, err: readErr instanceof Error ? readErr.message : String(readErr) },
              `[noaa-tar-router] could not re-read smooth-sheet gz for georef wizard storage`,
            );
          }
        }
      } else {
        logger.info(
          { entry: relativePath, key, pointCount: points.length },
          `[noaa-tar-router] parser "${key}" returned ${points.length} point(s)`,
        );
        allPoints.push(...points);
      }
    } else {
      const parser = parserDispatch[key];
      const points = await parser(absolutePath);

      logger.info(
        { entry: relativePath, key, pointCount: points.length },
        `[noaa-tar-router] parser "${key}" returned ${points.length} point(s)`,
      );

      allPoints.push(...points);
    }
  }

  // Clear the warning sink now that all geodas-xyz files have been dispatched.
  _geodasXyzWarningSink = undefined;

  // Post-dispatch guard: if every collection is empty and there is no raster
  // buffer, nothing useful came out of parsing — treat it as a failure.
  // Substrate-only archives (allSubstratePoints non-empty) and archives with
  // an ungeoreferenced raster are still valid success paths.
  if (
    allPoints.length === 0 &&
    allSubstratePoints.length === 0 &&
    !smoothSheetRasterBuffer
  ) {
    throw Object.assign(new Error(NO_PARSEABLE_DATA_MESSAGE), {
      code: "NO_PARSEABLE_DATA",
    });
  }

  // Derive dataset name — surveys.txt H-number first, archive filename as fallback
  const metaName = await extractSurveyNameFromMetadata(extractedDir, entries);
  const datasetName = metaName ?? nameFromArchiveFilename(archiveFileName);

  return {
    points: allPoints,
    datasetName,
    substratePoints: allSubstratePoints,
    hyd93Features: allHyd93Features,
    skipped,
    smoothSheetRasterBuffer,
    smoothSheetRasterFilename,
    parseWarnings: allParseWarnings,
  };
}
