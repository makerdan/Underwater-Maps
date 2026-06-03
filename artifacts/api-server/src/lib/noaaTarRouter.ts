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
 *   4. Derives a human-readable dataset name from the surveys.txt H-number
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
// Parser stubs
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

/**
 * Parse a NOAA surveys.xyz TSV sounding file.
 *
 * Stub — body to be implemented in the "Parse NOAA surveys.xyz TSV sounding
 * files" task.  Signature must remain `(filePath: string) => Promise<RawPoint[]>`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function parseNoaaSurveysXyz(_filePath: string): Promise<RawPoint[]> {
  parserNotImplemented("noaa-surveys-xyz", _filePath);
}

/**
 * Parse a GEODAS xyz.gz sounding CSV.
 *
 * Stub — body to be implemented in the "Parse GEODAS xyz.gz soundings with
 * quality filtering" task.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function parseGeodasXyz(_filePath: string): Promise<RawPoint[]> {
  parserNotImplemented("geodas-xyz", _filePath);
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
 * Parse a NOAA Bottom_Samples substrate annotation file.
 *
 * Substrate annotations do not contribute sounding depth points to the
 * terrain grid.  Stub — body to be implemented in the "Parse NOAA
 * Bottom_Samples substrate annotation files" task.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function parseBottomSamples(_filePath: string): Promise<RawPoint[]> {
  parserNotImplemented("bottom-samples", _filePath);
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
// Parser dispatch table — maps each recognised key to its implementation
//
// Exported so test code can replace individual entries with mocks without
// needing to spy on the ESM live bindings (which bypasses the local closure).
// Do NOT mutate in production code.
// ---------------------------------------------------------------------------

export const parserDispatch: Record<
  Exclude<TarParserKey, "skip">,
  (filePath: string) => Promise<RawPoint[]>
> = {
  "noaa-surveys-xyz": parseNoaaSurveysXyz,
  "geodas-xyz": parseGeodasXyz,
  "hyd93-a93": parseHyd93A93,
  "bottom-samples": parseBottomSamples,
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
 * human-readable dataset name.
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

    const parser = parserDispatch[key];
    const points = await parser(absolutePath);

    logger.info(
      { entry: relativePath, key, pointCount: points.length },
      `[noaa-tar-router] parser "${key}" returned ${points.length} point(s)`,
    );

    allPoints.push(...points);
  }

  // Derive dataset name — surveys.txt H-number first, archive filename as fallback
  const metaName = await extractSurveyNameFromMetadata(extractedDir, entries);
  const datasetName = metaName ?? nameFromArchiveFilename(archiveFileName);

  return { points: allPoints, datasetName };
}
