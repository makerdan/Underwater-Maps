/**
 * pdf-contour.test.ts — Unit tests for lib/pdfContour.ts.
 *
 * Done-looks-like (task-3037):
 *  - extractPdfContours pulls 3 nested contour polylines and 3 numeric depth
 *    labels from the in-memory vector fixture PDF
 *  - pdfContoursToPoints associates each label with its nearest ring,
 *    maps geometry onto the supplied bbox, converts feet → metres, and
 *    densifies to ≥ 10 RawPoints with positive-down depths
 *  - raster-only PDFs fail at the "extract" stage with a clear
 *    "not supported yet" message
 *  - unlabeled vector PDFs fail at the "extract" stage
 *  - corrupt files fail at the "parse" stage
 *  - degenerate bboxes fail at the "georeference" stage
 */

import { describe, it, expect } from "vitest";
import {
  extractPdfContours,
  pdfContoursToPoints,
  parsePdfContourFile,
  PdfStageError,
  PdfRasterOnlyError,
} from "../lib/pdfContour.js";
import {
  makeContourPdf,
  makeRasterOnlyPdf,
  makeUnlabeledContourPdf,
  makeCorruptPdf,
} from "./helpers/pdfFixture.js";

const BBOX = { minLon: -93.5, minLat: 45.1, maxLon: -93.4, maxLat: 45.2 };
const FEET_TO_METRES = 0.3048;

describe("extractPdfContours", () => {
  it("extracts 3 contour polylines and 3 numeric depth labels from the vector fixture", async () => {
    const extraction = await extractPdfContours(makeContourPdf());
    expect(extraction.polylines.length).toBe(3);
    expect(extraction.labels.length).toBe(3);
    expect(extraction.labels.map((l) => l.value).sort((a, b) => a - b)).toEqual([10, 20, 30]);
    // "30 ft" must parse to 30 despite the unit suffix.
    expect(extraction.labels.some((l) => l.text === "30 ft" && l.value === 30)).toBe(true);
    expect(extraction.pageView).toEqual([0, 0, 300, 300]);
  });

  it("throws PdfRasterOnlyError for raster-only PDFs (raster path now supported)", async () => {
    const err = await extractPdfContours(makeRasterOnlyPdf()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfRasterOnlyError);
    // Should NOT be a PdfStageError — the raster pipeline handles it now
    expect(err).not.toBeInstanceOf(PdfStageError);
  });

  it("rejects vector PDFs with no numeric depth labels at the extract stage", async () => {
    const err = await extractPdfContours(makeUnlabeledContourPdf()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfStageError);
    expect((err as PdfStageError).stage).toBe("extract");
    expect((err as PdfStageError).message).toMatch(/depth label/i);
  });

  it("rejects non-PDF bytes at the parse stage", async () => {
    const err = await extractPdfContours(makeCorruptPdf()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfStageError);
    expect((err as PdfStageError).stage).toBe("parse");
  });
});

describe("pdfContoursToPoints", () => {
  it("associates labels with rings, converts feet to metres, and densifies", async () => {
    const extraction = await extractPdfContours(makeContourPdf());
    const points = pdfContoursToPoints(extraction, BBOX, "feet");

    expect(points.length).toBeGreaterThanOrEqual(10);
    // All samples inside the bbox.
    for (const p of points) {
      expect(p.lon).toBeGreaterThanOrEqual(BBOX.minLon - 1e-9);
      expect(p.lon).toBeLessThanOrEqual(BBOX.maxLon + 1e-9);
      expect(p.lat).toBeGreaterThanOrEqual(BBOX.minLat - 1e-9);
      expect(p.lat).toBeLessThanOrEqual(BBOX.maxLat + 1e-9);
      expect(p.depth).toBeGreaterThan(0); // positive-down
    }

    // Exactly three distinct depths: 10/20/30 ft in metres.
    const depths = [...new Set(points.map((p) => p.depth))].sort((a, b) => a - b);
    expect(depths.length).toBe(3);
    expect(depths[0]).toBeCloseTo(10 * FEET_TO_METRES, 6);
    expect(depths[1]).toBeCloseTo(20 * FEET_TO_METRES, 6);
    expect(depths[2]).toBeCloseTo(30 * FEET_TO_METRES, 6);

    // Monotonic nesting: the deepest contour's samples sit strictly inside
    // the shallowest contour's extent (inner ring maps to the bbox interior).
    const deep = points.filter((p) => Math.abs(p.depth - 30 * FEET_TO_METRES) < 1e-9);
    const shallow = points.filter((p) => Math.abs(p.depth - 10 * FEET_TO_METRES) < 1e-9);
    const extent = (arr: typeof points): [number, number, number, number] => [
      Math.min(...arr.map((p) => p.lon)),
      Math.min(...arr.map((p) => p.lat)),
      Math.max(...arr.map((p) => p.lon)),
      Math.max(...arr.map((p) => p.lat)),
    ];
    const [dMinLon, dMinLat, dMaxLon, dMaxLat] = extent(deep);
    const [sMinLon, sMinLat, sMaxLon, sMaxLat] = extent(shallow);
    expect(dMinLon).toBeGreaterThan(sMinLon);
    expect(dMinLat).toBeGreaterThan(sMinLat);
    expect(dMaxLon).toBeLessThan(sMaxLon);
    expect(dMaxLat).toBeLessThan(sMaxLat);
  });

  it("keeps depths unconverted when unit is meters", async () => {
    const extraction = await extractPdfContours(makeContourPdf());
    const points = pdfContoursToPoints(extraction, BBOX, "meters");
    const depths = [...new Set(points.map((p) => p.depth))].sort((a, b) => a - b);
    expect(depths).toEqual([10, 20, 30]);
  });

  it("rejects a degenerate bbox at the georeference stage", async () => {
    const extraction = await extractPdfContours(makeContourPdf());
    expect(() =>
      pdfContoursToPoints(extraction, { minLon: -93.4, minLat: 45.1, maxLon: -93.5, maxLat: 45.2 }, "feet"),
    ).toThrowError(PdfStageError);
    try {
      pdfContoursToPoints(extraction, { minLon: -93.4, minLat: 45.1, maxLon: -93.5, maxLat: 45.2 }, "feet");
    } catch (e) {
      expect((e as PdfStageError).stage).toBe("georeference");
    }
  });
});

describe("parsePdfContourFile (full pipeline)", () => {
  it("returns gridder-ready points from a vector contour PDF", async () => {
    const points = await parsePdfContourFile(makeContourPdf(), BBOX, "feet");
    expect(points.length).toBeGreaterThanOrEqual(10);
    const maxDepth = Math.max(...points.map((p) => p.depth));
    // Deepest printed contour is 30 ft ⇒ 9.144 m (within 10%).
    expect(maxDepth).toBeGreaterThan(9.144 * 0.9);
    expect(maxDepth).toBeLessThan(9.144 * 1.1);
  });
});
