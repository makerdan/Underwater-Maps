/**
 * pdfContour.ts — Vector-PDF lake contour map ingestion.
 *
 * Pipeline stages (each throws a PdfStageError tagged with its stage so the
 * upload route can surface stage-specific messages in the upload-status UI):
 *
 *   1. parse        — open the PDF with pdfjs-dist and read page 1
 *   2. extract      — pull vector polylines (contour lines) from the operator
 *                     list and numeric depth labels from the text layer;
 *                     raster-only PDFs (images, no vector paths) fail here
 *                     with a clear "not supported yet" message
 *   3. georeference — map PDF page coordinates linearly onto the user-supplied
 *                     lon/lat bounding box; depth unit conversion (feet →
 *                     metres) happens here too
 *   4. interpolate  — densify the labeled contour polylines into RawPoints
 *                     suitable for the existing gridPoints() IDW gridder
 *
 * Out of scope (by design): OCR of scanned maps, automatic georeferencing
 * from embedded geospatial metadata, batch/multi-page processing.
 */

import type { RawPoint } from "./uploadParsers.js";

// ---------------------------------------------------------------------------
// Stage-tagged error
// ---------------------------------------------------------------------------

export type PdfStage = "parse" | "extract" | "georeference" | "interpolate";

export class PdfStageError extends Error {
  readonly stage: PdfStage;
  constructor(stage: PdfStage, message: string) {
    super(message);
    this.name = "PdfStageError";
    this.stage = stage;
  }
}

/**
 * Thrown by extractPdfContours() when the PDF contains only raster images
 * and no vector paths. Callers should route this to the raster pipeline
 * (pdfContourRaster.ts) instead of treating it as a terminal error.
 */
export class PdfRasterOnlyError extends Error {
  constructor() {
    super(
      "this PDF contains only raster images (a scanned map) — routing to the raster contour pipeline.",
    );
    this.name = "PdfRasterOnlyError";
  }
}

const STAGE_PREFIX: Record<PdfStage, string> = {
  parse: "PDF parsing failed",
  extract: "Contour extraction failed",
  georeference: "Georeferencing failed",
  interpolate: "Depth interpolation failed",
};

function stageError(stage: PdfStage, detail: string): PdfStageError {
  return new PdfStageError(stage, `${STAGE_PREFIX[stage]}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Extraction types
// ---------------------------------------------------------------------------

export interface PdfPolyline {
  /** Vertices in PDF user-space coordinates (origin bottom-left, y up). */
  pts: Array<[number, number]>;
}

export interface PdfDepthLabel {
  x: number;
  y: number;
  /** Numeric depth value exactly as printed on the map (unit-agnostic). */
  value: number;
  text: string;
}

export interface PdfContourExtraction {
  polylines: PdfPolyline[];
  labels: PdfDepthLabel[];
  /** Page view box [x0, y0, x1, y1] in PDF user space. */
  pageView: [number, number, number, number];
  /** True when the page paints at least one raster image XObject. */
  hasImages: boolean;
}

export interface GeoBbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export type PdfDepthUnit = "feet" | "meters";

const FEET_TO_METRES = 0.3048;

// Depth labels on printed contour maps: an integer or decimal number,
// optionally followed by a unit hint ("ft", "feet", "m", "meters", "metres").
const DEPTH_LABEL_RE = /^\s*(\d{1,4}(?:\.\d+)?)\s*(?:ft|feet|'|m|meters|metres)?\s*$/i;

/** Minimum vertices for a path to count as a contour polyline. */
const MIN_POLYLINE_VERTICES = 3;

/** Cap on total extracted points after densification (memory guard). */
const MAX_SAMPLED_POINTS = 400_000;

// ---------------------------------------------------------------------------
// Stage 1 + 2: parse the PDF and extract polylines + depth labels
// ---------------------------------------------------------------------------

/**
 * Opens the PDF (first page only) and extracts vector polylines and numeric
 * text labels. Throws PdfStageError("parse") when the document is not a
 * readable PDF, and PdfStageError("extract") when the page has no usable
 * vector contours (e.g. a scanned/raster-only map).
 */
export async function extractPdfContours(buffer: Buffer): Promise<PdfContourExtraction> {
  // pdfjs-dist is ESM-only and moderately heavy; import lazily so server
  // startup cost is unaffected for non-PDF uploads.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let loadingTask;
  let doc;
  try {
    // isEvalSupported hardens against PostScript-function eval; it is a real
    // runtime option in pdfjs v6 but missing from DocumentInitParameters
    // typings, hence the cast.
    const initParams = {
      data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice(),
      isEvalSupported: false,
      disableFontFace: true,
      // Suppress the standard-font warning; we never render glyphs, we only
      // read positioned text strings, so font data files are not needed.
      useSystemFonts: true,
    };
    loadingTask = pdfjs.getDocument(initParams as Parameters<typeof pdfjs.getDocument>[0]);
    doc = await loadingTask.promise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw stageError("parse", `the file could not be read as a PDF (${msg}).`);
  }

  try {
    const page = await doc.getPage(1);
    const pageView = page.view as [number, number, number, number];

    // ── Vector paths from the operator list ───────────────────────────────
    const opList = await page.getOperatorList();
    const OPS = pdfjs.OPS;
    const polylines: PdfPolyline[] = [];
    let hasImages = false;

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintInlineImageXObject ||
        fn === OPS.paintImageMaskXObject
      ) {
        hasImages = true;
        continue;
      }
      if (fn !== OPS.constructPath) continue;

      // pdfjs v6 packs constructPath args as:
      //   [drawOpCode, [subpath, subpath, ...], minMax]
      // where each subpath is a flat numeric array of the form
      //   [cmd, coords..., cmd, coords..., ...]
      // with cmd 0 = moveTo (2 coords), 1 = lineTo (2 coords),
      // 2 = curveTo (6 coords), 3 = closePath (0 coords),
      // 4 = rectangle-ish variants (defensive skip of unknown cmds below).
      const args = opList.argsArray[i] as unknown[];
      const subpaths = args?.[1];
      if (!Array.isArray(subpaths)) continue;

      for (const raw of subpaths) {
        const data: number[] = ArrayBuffer.isView(raw)
          ? Array.from(raw as unknown as ArrayLike<number>)
          : Array.isArray(raw) ? (raw as number[]) : [];
        const pts: Array<[number, number]> = [];
        let k = 0;
        let firstPt: [number, number] | null = null;
        while (k < data.length) {
          const cmd = data[k]!;
          if (cmd === 0 && k + 2 < data.length + 1) {
            // moveTo — start of a subpath. If we already have a polyline in
            // progress, flush it and start a new one.
            if (pts.length >= MIN_POLYLINE_VERTICES) polylines.push({ pts: [...pts] });
            pts.length = 0;
            firstPt = [data[k + 1]!, data[k + 2]!];
            pts.push(firstPt);
            k += 3;
          } else if (cmd === 1) {
            pts.push([data[k + 1]!, data[k + 2]!]);
            k += 3;
          } else if (cmd === 2) {
            // curveTo: approximate with the end point (contour maps drawn as
            // Béziers still yield a usable polyline; densification below
            // fills in intermediate samples along straight segments).
            pts.push([data[k + 5]!, data[k + 6]!]);
            k += 7;
          } else if (cmd === 3) {
            if (firstPt) pts.push([firstPt[0], firstPt[1]]);
            k += 1;
          } else {
            // Unknown command — abandon this subpath defensively.
            break;
          }
        }
        if (pts.length >= MIN_POLYLINE_VERTICES) polylines.push({ pts });
      }
    }

    // ── Numeric depth labels from the text layer ──────────────────────────
    const textContent = await page.getTextContent();
    const labels: PdfDepthLabel[] = [];
    for (const item of textContent.items) {
      if (!("str" in item) || typeof item.str !== "string") continue;
      const m = DEPTH_LABEL_RE.exec(item.str);
      if (!m) continue;
      const value = parseFloat(m[1]!);
      if (!Number.isFinite(value)) continue;
      const t = item.transform as number[];
      labels.push({ x: t[4]!, y: t[5]!, value, text: item.str.trim() });
    }

    if (polylines.length === 0) {
      if (hasImages) {
        // Throw PdfRasterOnlyError so the upload route can redirect to the
        // image-based raster contour pipeline instead of failing outright.
        throw new PdfRasterOnlyError();
      }
      throw stageError(
        "extract",
        "no vector contour lines were found in this PDF. Ensure the map's depth contours are drawn as vector paths, not embedded images.",
      );
    }
    if (labels.length === 0) {
      throw stageError(
        "extract",
        "no numeric depth labels were found in this PDF's text layer. Contour lines need printed depth numbers (e.g. \"10\", \"20 ft\") so depths can be assigned.",
      );
    }

    return { polylines, labels, pageView, hasImages };
  } finally {
    await loadingTask?.destroy().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Stage 3 + 4: georeference + interpolate to RawPoints
// ---------------------------------------------------------------------------

/** Squared distance from point p to segment ab. */
function distSqToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/** Minimum squared distance from a label anchor to any segment of a polyline. */
function distSqToPolyline(x: number, y: number, poly: PdfPolyline): number {
  let best = Infinity;
  const pts = poly.pts;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = distSqToSegment(x, y, pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]);
    if (d < best) best = d;
  }
  return best;
}

export function validateGeoBbox(bbox: GeoBbox): void {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  const finite = [minLon, minLat, maxLon, maxLat].every(Number.isFinite);
  if (!finite) throw stageError("georeference", "bounding box values must be finite numbers.");
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    throw stageError("georeference", "bounding box must be within valid longitude/latitude ranges (±180, ±90).");
  }
  if (!(minLon < maxLon) || !(minLat < maxLat)) {
    throw stageError("georeference", "bounding box is degenerate — min longitude/latitude must be strictly less than max.");
  }
}

/**
 * Associates each contour polyline with the nearest depth label, maps PDF
 * coordinates linearly onto the user-supplied lon/lat bbox, converts depths
 * to metres (positive-down), and densifies each polyline into sample points
 * for the IDW gridder.
 *
 * Coordinate mapping: the bounding box of all extracted contour geometry is
 * mapped onto the geographic bbox. This keeps the mapping independent of
 * page margins/titles because only contour-line geometry defines the frame.
 */
export function pdfContoursToPoints(
  extraction: PdfContourExtraction,
  bbox: GeoBbox,
  unit: PdfDepthUnit,
): RawPoint[] {
  validateGeoBbox(bbox);
  const { polylines, labels } = extraction;

  // ── Label → polyline association ─────────────────────────────────────────
  // Each label attaches to the polyline it is closest to; each polyline takes
  // the depth of its nearest label. Labels sit right next to their contour
  // line on printed maps, so nearest-segment distance is a robust pairing.
  const depthByPolyline = new Map<number, number>();
  const bestDistByPolyline = new Map<number, number>();
  for (const label of labels) {
    let bestIdx = -1;
    let bestD = Infinity;
    for (let p = 0; p < polylines.length; p++) {
      const d = distSqToPolyline(label.x, label.y, polylines[p]!);
      if (d < bestD) {
        bestD = d;
        bestIdx = p;
      }
    }
    if (bestIdx < 0) continue;
    const existing = depthByPolyline.get(bestIdx);
    // If two labels claim the same polyline keep the closer one's value —
    // track via a parallel map of best distances.
    const prevD = bestDistByPolyline.get(bestIdx) ?? Infinity;
    if (existing === undefined || bestD < prevD) {
      depthByPolyline.set(bestIdx, label.value);
      bestDistByPolyline.set(bestIdx, bestD);
    }
  }

  const labeled = [...depthByPolyline.entries()];
  if (labeled.length === 0) {
    throw stageError("extract", "could not associate any depth labels with contour lines.");
  }

  // ── Geometry extent (labeled contours only) ──────────────────────────────
  let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
  for (const [idx] of labeled) {
    for (const [x, y] of polylines[idx]!.pts) {
      if (x < gMinX) gMinX = x;
      if (y < gMinY) gMinY = y;
      if (x > gMaxX) gMaxX = x;
      if (y > gMaxY) gMaxY = y;
    }
  }
  if (!(gMaxX > gMinX) || !(gMaxY > gMinY)) {
    throw stageError("georeference", "contour geometry is degenerate (zero width or height) — cannot map onto the bounding box.");
  }

  const lonSpan = bbox.maxLon - bbox.minLon;
  const latSpan = bbox.maxLat - bbox.minLat;
  const toLon = (x: number): number => bbox.minLon + ((x - gMinX) / (gMaxX - gMinX)) * lonSpan;
  const toLat = (y: number): number => bbox.minLat + ((y - gMinY) / (gMaxY - gMinY)) * latSpan;

  // ── Densified sampling along each labeled contour ────────────────────────
  // Sample interval ≈ 1/512 of the larger geometry dimension so a 256×256
  // grid sees multiple direct samples per crossed cell. This is dense,
  // bounded work (O(total polyline length / step)) — no sparse ring-fill.
  const step = Math.max(gMaxX - gMinX, gMaxY - gMinY) / 512;
  const points: RawPoint[] = [];
  const unitScale = unit === "feet" ? FEET_TO_METRES : 1;

  for (const [idx, rawDepth] of labeled) {
    const depth = rawDepth * unitScale;
    const pts = polylines[idx]!.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[i + 1]!;
      const segLen = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(segLen / step));
      for (let s = 0; s < n; s++) {
        const t = s / n;
        points.push({ lon: toLon(ax + t * (bx - ax)), lat: toLat(ay + t * (by - ay)), depth });
        if (points.length > MAX_SAMPLED_POINTS) {
          throw stageError("interpolate", "contour map is too complex — sampled point budget exceeded. Simplify the PDF or upload a smaller area.");
        }
      }
    }
    // Include the final vertex of the polyline.
    const last = pts[pts.length - 1]!;
    points.push({ lon: toLon(last[0]), lat: toLat(last[1]), depth });
  }

  if (points.length < 10) {
    throw stageError("interpolate", "too few depth samples were produced from the labeled contours (need at least 10).");
  }
  return points;
}

/**
 * Full stage-3+4 pipeline entry point used by the upload route: extract →
 * georeference → interpolate in one call.
 */
export async function parsePdfContourFile(
  buffer: Buffer,
  bbox: GeoBbox,
  unit: PdfDepthUnit,
): Promise<RawPoint[]> {
  const extraction = await extractPdfContours(buffer);
  return pdfContoursToPoints(extraction, bbox, unit);
}
