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
 *   *.sid / *.pdf / *.htm          — unsupported; skipped with a log warning
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
import type { RawPoint } from "./uploadParsers.js";
import { parseGeoTiff } from "./uploadParsers.js";
import { gunzipBounded } from "./gunzipBounded.js";

/** 200 MB cap for inner tif.gz decompression — same as the top-level gz cap. */
const INNER_GZ_MAX_BYTES = 200 * 1024 * 1024;

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
 *   `*.sid` / `*.sid.gz` / `*.pdf` / `*.htm`  → skip (unsupported)
 *   Everything else (metadata, index, etc.)   → skip (unrecognised)
 */
export function classifyTarEntry(relativePath: string): TarParserKey {
  const p = relativePath.toLowerCase().replace(/\\/g, "/");

  // Explicitly unsupported types — log at call site
  if (
    p.endsWith(".sid") ||
    p.endsWith(".sid.gz") ||
    p.endsWith(".pdf") ||
    p.endsWith(".htm") ||
    p.endsWith(".html")
  ) {
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

  // Unrecognised entry (surveys.txt, index HTML, thumbnails, etc.) — skip
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
 * Normalise a combined verbal description string (e.g. "MUD GREEN,SHELLS BROKEN")
 * to a canonical substrate category.  Returns the raw string when no keyword
 * matches so that unrecognised descriptions are preserved rather than silently
 * discarded.
 */
export function normaliseSubstrate(rawLabel: string): string {
  const upper = rawLabel.toUpperCase();
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

// ---------------------------------------------------------------------------
// Parser stubs (depth-bearing parsers)
//
// Each stub throws PARSER_NOT_IMPLEMENTED with a clear, specific message.
// When a recognised NOAA file type is encountered but its parser is not yet
// implemented, the error propagates to the upload job's catch block, which
// sets job.status = "error" and surfaces the message to the caller — giving a
// specific, actionable error rather than a silent empty result that later fails
// with a generic "< 10 data points" validation error.
//
// Downstream tasks only need to replace the body; the router dispatch table
// and function signatures must remain stable.
// ---------------------------------------------------------------------------

function parserNotImplemented(key: TarParserKey, entryPath: string): never {
  throw Object.assign(
    new Error(
      `Parser "${key}" is not yet implemented (entry: ${path.basename(entryPath)}). ` +
        `Support for this file type is planned in a future update.`,
    ),
    { code: "PARSER_NOT_IMPLEMENTED", parserKey: key },
  );
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

/**
 * Parse a GEODAS xyz.gz sounding CSV.
 *
 * File format (CSV with header):
 *   survey_id, lat, lon, depth, quality_code, active
 *
 * Quality filter: rows where quality_code != 1 or active != 1 are excluded.
 * Depth convention: GEODAS depths are positive-downward (matches BathyScan).
 * Negative depths (elevations above datum) are skipped.
 *
 * @param filePath Absolute path to the .xyz.gz file on disk.
 */
export async function parseGeodasXyz(filePath: string): Promise<RawPoint[]> {
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
  const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());

  const idxLat = headers.indexOf("lat");
  const idxLon = headers.indexOf("lon");
  const idxDepth = headers.indexOf("depth");
  const idxQuality = headers.indexOf("quality_code");
  const idxActive = headers.indexOf("active");

  if (idxLat === -1 || idxLon === -1 || idxDepth === -1) {
    throw new Error(
      `GEODAS xyz.gz file "${path.basename(filePath)}" is missing required columns. ` +
        `Found: ${headers.join(", ")}. Expected: lat, lon, depth.`,
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
    const cols = line.split(",");

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

/**
 * Parse a HYD93 a93.gz fixed-width sounding file.
 *
 * Stub — body to be implemented in the "Parse HYD93 a93.gz fixed-width
 * sounding format" task.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function parseHyd93A93(_filePath: string): Promise<RawPoint[]> {
  parserNotImplemented("hyd93-a93", _filePath);
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

  try {
    return await parseGeoTiff(tifBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Older NOAA smooth sheets frequently lack ModelTiepoint / ModelPixelScale
    // tags.  Treat missing georeferencing as a recoverable warning rather than
    // a hard failure — the upload completes using depth points from other
    // entries (e.g. surveys.xyz / GEODAS) while the raster is noted as
    // needing manual georeferencing.
    if (
      msg.includes("ModelPixelScale") ||
      msg.includes("ModelTiepoint") ||
      msg.includes("ModelTransformation") ||
      msg.includes("Cannot derive geographic coordinates")
    ) {
      logger.warn(
        { entry: path.basename(filePath) },
        `[noaa-tar-router] inner GeoTIFF "${path.basename(filePath)}" has no ` +
          `georeferencing tags — raster loaded but needs manual georeferencing; skipping coordinate extraction`,
      );
      return [];
    }

    // All other GeoTIFF parse errors are unexpected; re-throw so the job fails
    // with a clear diagnostic rather than silently dropping data.
    throw new Error(
      `Failed to parse inner GeoTIFF "${path.basename(filePath)}": ${msg}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Parser dispatch table — depth-bearing parsers only
//
// `bottom-samples` is intentionally excluded: it returns SubstratePoint[]
// rather than RawPoint[] and is dispatched separately in routeTarEntries.
//
// Exported so test code can replace individual entries with mocks without
// needing to spy on the ESM live bindings (which bypasses the local closure).
// Do NOT mutate in production code.
// ---------------------------------------------------------------------------

export const parserDispatch: Record<
  Exclude<TarParserKey, "skip" | "bottom-samples">,
  (filePath: string) => Promise<RawPoint[]>
> = {
  "noaa-surveys-xyz": parseNoaaSurveysXyz,
  "geodas-xyz": parseGeodasXyz,
  "hyd93-a93": parseHyd93A93,
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
// Main router entry point
// ---------------------------------------------------------------------------

/**
 * Walk the entries extracted from a NOAA tar.gz archive, dispatch each
 * recognised entry to its parser, and return merged sounding points with a
 * human-readable dataset name and any substrate annotation points.
 *
 * Depth-bearing parsers (surveys.xyz, GEODAS, HYD93, Smooth_Sheets) contribute
 * to `result.points`.  Bottom_Samples substrate files contribute exclusively to
 * `result.substratePoints` and do not add sounding depth data.
 *
 * Skipped entries (`.sid`, `.pdf`, `.htm`, unrecognised metadata files) are
 * logged at WARN level but never cause the upload to fail.
 *
 * @param extractedDir    Directory where the tar was extracted.
 * @param entries         Relative entry paths from extractTarFile / extractTarBuffer.
 * @param archiveFileName Original archive filename used as the name fallback.
 *
 * @throws {Error} code `"NO_PARSEABLE_DATA"` — archive contains no entries
 *   that match a known NOAA format.
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

  // Classify every non-directory entry
  const recognised: Array<{ relativePath: string; key: Exclude<TarParserKey, "skip"> }> = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    // Skip bare directory entries emitted by the tar extractor
    const normalised = entry.replace(/\\/g, "/");
    if (normalised.endsWith("/")) continue;

    const key = classifyTarEntry(entry);
    if (key === "skip") {
      skipped.push(entry);
    } else {
      recognised.push({ relativePath: entry, key });
    }
  }

  // Log each skipped entry.  MrSID gets a specific INFO-level note; everything
  // else is WARN so it stands out in server logs as something unexpected.
  for (const s of skipped) {
    const lp = s.toLowerCase().replace(/\\/g, "/");
    if (lp.endsWith(".sid") || lp.endsWith(".sid.gz")) {
      logger.info(
        { entry: s },
        `[noaa-tar-router] MrSID format not supported; skipping`,
      );
    } else {
      logger.warn(
        { entry: s },
        `[noaa-tar-router] skipping unsupported or unrecognised entry: ${path.basename(s)}`,
      );
    }
  }

  // Fail early with a clear user-facing message when nothing is parseable
  if (recognised.length === 0) {
    throw Object.assign(
      new Error(
        "No parseable data files found in archive. " +
          `The archive contained ${entries.filter((e) => !e.replace(/\\/g, "/").endsWith("/")).length} file(s) ` +
          "but none matched a known NOAA format. " +
          "Expected at least one of: surveys.xyz, GEODAS/*.xyz.gz, GEODAS/*.a93.gz, " +
          "Bottom_Samples/*_BSText.txt, or Smooth_Sheets/*.tif.gz.",
      ),
      { code: "NO_PARSEABLE_DATA" },
    );
  }

  // Dispatch each recognised entry to its parser and accumulate points
  for (const { relativePath, key } of recognised) {
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

  // Derive dataset name — surveys.txt H-number first, archive filename as fallback
  const metaName = await extractSurveyNameFromMetadata(extractedDir, entries);
  const datasetName = metaName ?? nameFromArchiveFilename(archiveFileName);

  return { points: allPoints, datasetName, substratePoints: allSubstratePoints };
}
