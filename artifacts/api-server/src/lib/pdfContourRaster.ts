/**
 * pdfContourRaster.ts — Raster-image lake contour map ingestion.
 *
 * Handles inputs that the vector-PDF pipeline cannot:
 *   • Raster-only PDFs (scanned maps with no vector paths)
 *   • PNG / JPEG images uploaded directly as contour maps
 *
 * Pipeline stages (same stage tags as pdfContour.ts so the upload route
 * can surface consistent stage-specific error messages):
 *
 *   1. parse        — validate the input; for PDFs, render page 1 to a
 *                     greyscale PNG via pdftoppm (poppler).
 *   2. extract      — OCR depth labels + contour line tracing via the
 *                     raster_contour.py Python subprocess.
 *   3. georeference — delegated to pdfContoursToPoints() from pdfContour.ts
 *   4. interpolate  — delegated to pdfContoursToPoints() from pdfContour.ts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { registerCache } from "./cacheRegistry.js";

import type { RawPoint } from "./uploadParsers.js";
import {
  pdfContoursToPoints,
  PdfStageError,
  type PdfContourExtraction,
  type GeoBbox,
  type PdfDepthUnit,
  type PdfPolyline,
  type PdfDepthLabel,
} from "./pdfContour.js";

const execFileP = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));

const RASTER_CONTOUR_PY = join(__dirname, "raster_contour.py");

// ---------------------------------------------------------------------------
// Stage 1: render PDF page to PNG
// ---------------------------------------------------------------------------

/**
 * Renders page 1 of a PDF to a greyscale PNG using pdftoppm (poppler).
 * Writes two temp files and cleans them up before returning.
 */
async function renderPdfToImage(pdfBuffer: Buffer): Promise<Buffer> {
  const token = randomBytes(8).toString("hex");
  const tmpPdf = join(tmpdir(), `bs_pdf_${token}.pdf`);
  const tmpPpm = join(tmpdir(), `bs_ppm_${token}`);
  const tmpPng = `${tmpPpm}.png`;

  try {
    await writeFile(tmpPdf, pdfBuffer);

    // -r 150  — 150 DPI gives ~1500×1000 px for a typical A4/letter scan;
    //           enough for OCR and contour tracing without being huge.
    // -singlefile — write exactly one output file (no -NNN suffix).
    // -png         — output format.
    // -l 1         — only the first page.
    await execFileP("pdftoppm", [
      "-r", "150",
      "-singlefile",
      "-png",
      "-l", "1",
      tmpPdf,
      tmpPpm,
    ]);

    return await readFile(tmpPng);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PdfStageError("parse", `could not render the PDF page to an image (${msg}).`);
  } finally {
    await Promise.all([
      unlink(tmpPdf).catch(() => undefined),
      unlink(tmpPng).catch(() => undefined),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Stage 2: call raster_contour.py subprocess
// ---------------------------------------------------------------------------

interface RasterContourOutput {
  polylines: Array<{ pts: Array<[number, number]> }>;
  labels: Array<{ x: number; y: number; value: number; text: string }>;
  width: number;
  height: number;
}

interface ScriptErrorJson {
  error: string;
  message: string;
}

function _tryParseScriptError(stdout: string): ScriptErrorJson | null {
  if (!stdout.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      "message" in parsed &&
      typeof (parsed as Record<string, unknown>).message === "string"
    ) {
      return parsed as ScriptErrorJson;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

async function callRasterContourScript(imageBuffer: Buffer): Promise<RasterContourOutput> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "python3",
      [RASTER_CONTOUR_PY],
      { maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // The script may emit structured error JSON to stdout (e.g. blank_page)
          // instead of printing to stderr.  Check for that first so we can surface
          // a clean user-readable message rather than a generic "script failed" wrap.
          const scriptErr = _tryParseScriptError(stdout);
          if (scriptErr) {
            return reject(new PdfStageError("extract", scriptErr.message));
          }
          const detail = stderr.trim() || err.message;
          return reject(
            new PdfStageError("extract", `contour extraction script failed: ${detail}`),
          );
        }
        try {
          const parsed = JSON.parse(stdout) as RasterContourOutput;
          resolve(parsed);
        } catch {
          reject(
            new PdfStageError("extract", "contour extraction script returned invalid JSON."),
          );
        }
      },
    );

    child.stdin!.end(imageBuffer);
  });
}

// ---------------------------------------------------------------------------
// Stage 2 (continued): validate script output → PdfContourExtraction
// ---------------------------------------------------------------------------

function scriptOutputToExtraction(out: RasterContourOutput): PdfContourExtraction {
  if (out.polylines.length === 0) {
    throw new PdfStageError(
      "extract",
      "no contour lines were detected in the image. Ensure the map shows clear depth contour lines on a light background.",
    );
  }
  if (out.labels.length === 0) {
    throw new PdfStageError(
      "extract",
      "no numeric depth labels were recognised in the image. Ensure the map has printed depth numbers (e.g. \"10\", \"20 ft\") adjacent to contour lines.",
    );
  }

  const polylines: PdfPolyline[] = out.polylines.map((p) => ({
    pts: p.pts.map(([x, y]) => [x, y] as [number, number]),
  }));
  const labels: PdfDepthLabel[] = out.labels.map((l) => ({
    x: l.x,
    y: l.y,
    value: l.value,
    text: l.text,
  }));

  // pageView is not meaningful for raster inputs; use the image bounds.
  const pageView: [number, number, number, number] = [0, 0, out.width, out.height];

  return { polylines, labels, pageView, hasImages: true };
}

// ---------------------------------------------------------------------------
// Extraction cache (in-memory, 5-minute TTL)
// ---------------------------------------------------------------------------

interface CachedExtraction {
  extraction: PdfContourExtraction;
  expiresAt: number;
}

const extractionCache = new Map<string, CachedExtraction>();
registerCache(() => extractionCache.clear());

const EXTRACTION_TTL_MS = 5 * 60 * 1000;

function pruneExtractionCache(): void {
  const now = Date.now();
  for (const [k, v] of extractionCache) {
    if (v.expiresAt < now) extractionCache.delete(k);
  }
}

function storeExtraction(extraction: PdfContourExtraction): string {
  pruneExtractionCache();
  const token = randomBytes(16).toString("hex");
  extractionCache.set(token, { extraction, expiresAt: Date.now() + EXTRACTION_TTL_MS });
  return token;
}

/**
 * Retrieves a cached extraction by token (single-use: consumed on first call).
 * Returns null when the token is missing or has expired.
 */
export function retrieveCachedExtraction(token: string): PdfContourExtraction | null {
  const entry = extractionCache.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    extractionCache.delete(token);
    return null;
  }
  extractionCache.delete(token);
  return entry.extraction;
}

// ---------------------------------------------------------------------------
// Test helpers (prefix __ signals internal / not part of the public API)
// ---------------------------------------------------------------------------

/**
 * Injects a PdfContourExtraction directly into the in-memory cache and
 * returns its token.  Used by unit tests that need a valid token for
 * commitCachedExtraction without shelling out to the Python subprocess.
 *
 * Do NOT call from production code.
 */
export function __storeExtractionForTest(extraction: PdfContourExtraction): string {
  return storeExtraction(extraction);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts depth contours from a raster image buffer (PNG or JPEG).
 *
 * Returns a PdfContourExtraction compatible with pdfContoursToPoints()
 * so the georeferencing and interpolation stages are fully reused.
 */
export async function extractRasterContours(imageBuffer: Buffer): Promise<PdfContourExtraction> {
  const out = await callRasterContourScript(imageBuffer);
  return scriptOutputToExtraction(out);
}

/**
 * Full raster pipeline for a scanned PDF:
 *   render PDF → extract raster contours → georeference → interpolate.
 */
export async function parseRasterPdfContourFile(
  pdfBuffer: Buffer,
  bbox: GeoBbox,
  unit: PdfDepthUnit,
): Promise<RawPoint[]> {
  const imageBuffer = await renderPdfToImage(pdfBuffer);
  const extraction = await extractRasterContours(imageBuffer);
  return pdfContoursToPoints(extraction, bbox, unit);
}

/**
 * Full raster pipeline for a PNG/JPEG image uploaded directly:
 *   extract raster contours → georeference → interpolate.
 */
export async function parseRasterImageContourFile(
  imageBuffer: Buffer,
  bbox: GeoBbox,
  unit: PdfDepthUnit,
): Promise<RawPoint[]> {
  const extraction = await extractRasterContours(imageBuffer);
  return pdfContoursToPoints(extraction, bbox, unit);
}

// ---------------------------------------------------------------------------
// Two-step API: extract-only (returns token) + commit (applies corrections)
// ---------------------------------------------------------------------------

export interface RasterExtractionResult {
  token: string;
  labels: PdfDepthLabel[];
  polylineCount: number;
  width: number;
  height: number;
}

/**
 * Stage 1 of the two-step raster pipeline for PNG/JPEG images.
 * Runs OCR + contour tracing, caches the result, and returns a token
 * the client can use in the commit step after reviewing/correcting labels.
 */
export async function extractRasterImageContoursOnly(
  imageBuffer: Buffer,
): Promise<RasterExtractionResult> {
  const out = await callRasterContourScript(imageBuffer);
  const extraction = scriptOutputToExtraction(out);
  const token = storeExtraction(extraction);
  return {
    token,
    labels: extraction.labels,
    polylineCount: extraction.polylines.length,
    width: out.width,
    height: out.height,
  };
}

/**
 * Stage 2 of the two-step raster pipeline.
 * Retrieves the cached extraction (consuming the token), substitutes the
 * user-corrected labels, and runs georeference + interpolation.
 *
 * Throws PdfStageError("extract") when the token is expired or unknown.
 */
export function commitCachedExtraction(
  token: string,
  correctedLabels: PdfDepthLabel[],
  bbox: GeoBbox,
  unit: PdfDepthUnit,
): RawPoint[] {
  const extraction = retrieveCachedExtraction(token);
  if (!extraction) {
    throw new PdfStageError(
      "extract",
      "Extraction session has expired — please re-upload the file and try again.",
    );
  }
  const modified: PdfContourExtraction = { ...extraction, labels: correctedLabels };
  return pdfContoursToPoints(modified, bbox, unit);
}
