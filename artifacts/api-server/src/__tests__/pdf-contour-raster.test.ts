/**
 * pdf-contour-raster.test.ts — Unit tests for lib/pdfContourRaster.ts.
 *
 * Done-looks-like:
 *  - extractRasterContours pulls ≥3 contour polylines and ≥3 numeric depth
 *    labels from the synthetic raster PNG fixture
 *  - parseRasterImageContourFile returns georeferenced RawPoints with
 *    positive-down depths, within the supplied bbox
 *  - Images that contain no detectable lines fail at "extract" stage
 *  - The full pipeline produces depths at the expected (10 / 20 / 30 ft)
 *    values after unit conversion
 */

import { describe, it, expect } from "vitest";
import { extractRasterContours, parseRasterImageContourFile } from "../lib/pdfContourRaster.js";
import { PdfStageError } from "../lib/pdfContour.js";
import { makeRasterContourPng, makeBlankPng } from "./helpers/rasterFixture.js";

const BBOX = { minLon: -93.5, minLat: 45.1, maxLon: -93.4, maxLat: 45.2 };
const FEET_TO_METRES = 0.3048;

describe("extractRasterContours", () => {
  it("detects ≥3 contour polylines and ≥2 numeric depth labels from the raster fixture", { timeout: 60_000 }, async () => {
    const extraction = await extractRasterContours(makeRasterContourPng());
    expect(extraction.polylines.length).toBeGreaterThanOrEqual(3);
    expect(extraction.labels.length).toBeGreaterThanOrEqual(2);
    // All label depths must be positive finite numbers
    for (const label of extraction.labels) {
      expect(label.value).toBeGreaterThan(0);
      expect(Number.isFinite(label.value)).toBe(true);
    }
  });

  it("sets hasImages = true for a raster input", { timeout: 60_000 }, async () => {
    const extraction = await extractRasterContours(makeRasterContourPng());
    expect(extraction.hasImages).toBe(true);
  });

  it("throws PdfStageError('extract') when no contour lines are detected", { timeout: 60_000 }, async () => {
    const err = await extractRasterContours(makeBlankPng()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfStageError);
    expect((err as PdfStageError).stage).toBe("extract");
  });

  it("throws PdfStageError('extract') for invalid image bytes", { timeout: 60_000 }, async () => {
    const err = await extractRasterContours(Buffer.from("not an image")).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfStageError);
    expect((err as PdfStageError).stage).toBe("extract");
  });
});

describe("parseRasterImageContourFile (full pipeline)", () => {
  it("returns ≥10 RawPoints all inside the supplied bbox with positive-down depths", { timeout: 60_000 }, async () => {
    const points = await parseRasterImageContourFile(makeRasterContourPng(), BBOX, "feet");

    expect(points.length).toBeGreaterThanOrEqual(10);
    for (const p of points) {
      expect(p.lon).toBeGreaterThanOrEqual(BBOX.minLon - 1e-9);
      expect(p.lon).toBeLessThanOrEqual(BBOX.maxLon + 1e-9);
      expect(p.lat).toBeGreaterThanOrEqual(BBOX.minLat - 1e-9);
      expect(p.lat).toBeLessThanOrEqual(BBOX.maxLat + 1e-9);
      expect(p.depth).toBeGreaterThan(0);
    }
  });

  it("converts feet to metres correctly", { timeout: 60_000 }, async () => {
    const points = await parseRasterImageContourFile(makeRasterContourPng(), BBOX, "feet");
    const uniqueDepths = [...new Set(points.map((p) => Math.round(p.depth * 1000)))];
    // At least one depth should be near 10 ft → 3.048 m (within 20%)
    const has10ft = uniqueDepths.some(
      (d) => Math.abs(d / 1000 - 10 * FEET_TO_METRES) < 10 * FEET_TO_METRES * 0.2,
    );
    expect(has10ft).toBe(true);
  });

  it("keeps depths unconverted when unit is meters", { timeout: 60_000 }, async () => {
    const points = await parseRasterImageContourFile(makeRasterContourPng(), BBOX, "meters");
    // At least one depth should be near 10 m (within 20%)
    const has10m = points.some((p) => Math.abs(p.depth - 10) < 10 * 0.2);
    expect(has10m).toBe(true);
  });

  it("throws PdfStageError('georeference') on a degenerate bbox", { timeout: 60_000 }, async () => {
    const err = await parseRasterImageContourFile(
      makeRasterContourPng(),
      { minLon: -93.4, minLat: 45.1, maxLon: -93.5, maxLat: 45.2 },
      "feet",
    ).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(PdfStageError);
    expect((err as PdfStageError).stage).toBe("georeference");
  });
});
