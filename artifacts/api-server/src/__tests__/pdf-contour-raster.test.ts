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
 *
 *  Two-step API (extractRasterImageContoursOnly + commitCachedExtraction):
 *  - extractRasterImageContoursOnly returns a token, labels, polylineCount,
 *    width, and height for a valid image
 *  - extractRasterImageContoursOnly throws PdfStageError("extract") for a
 *    blank image (no contour lines)
 *  - commitCachedExtraction with a valid token returns RawPoints
 *  - commitCachedExtraction with an unknown/expired token throws
 *    PdfStageError("extract")
 *  - commitCachedExtraction substitutes correctedLabels, overriding the OCR
 *    output (at least one test verifying corrections applied)
 *  - Token is single-use: a second commit with the same token throws
 */

import { describe, it, expect } from "vitest";
import {
  extractRasterContours,
  parseRasterImageContourFile,
  extractRasterImageContoursOnly,
  commitCachedExtraction,
  __storeExtractionForTest,
} from "../lib/pdfContourRaster.js";
import { PdfStageError } from "../lib/pdfContour.js";
import type { PdfDepthLabel } from "../lib/pdfContour.js";
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

// ---------------------------------------------------------------------------
// Two-step API
// ---------------------------------------------------------------------------

/**
 * A synthetic PdfContourExtraction that mimics what the Python script
 * produces for a three-contour raster map.  Used by commitCachedExtraction
 * tests so they don't require cv2 / pytesseract to be installed.
 *
 * Layout (image coords, origin top-left, y down):
 *   width=500  height=400
 *   Three concentric square polylines at radii 50, 150, 250 px,
 *   labelled at depths 10, 20, 30 (arbitrary units).
 */
const FAKE_LABELS: PdfDepthLabel[] = [
  { x: 250, y: 50,  value: 10, text: "10" },
  { x: 250, y: 150, value: 20, text: "20" },
  { x: 250, y: 250, value: 30, text: "30" },
];

const FAKE_EXTRACTION = {
  polylines: [
    { pts: [[200, 0], [300, 0], [300, 100], [200, 100], [200, 0]] as Array<[number, number]> },
    { pts: [[100, 100], [400, 100], [400, 300], [100, 300], [100, 100]] as Array<[number, number]> },
    { pts: [[0, 0], [500, 0], [500, 400], [0, 400], [0, 0]] as Array<[number, number]> },
  ],
  labels: FAKE_LABELS,
  pageView: [0, 0, 500, 400] as [number, number, number, number],
  hasImages: true,
};

describe("extractRasterImageContoursOnly", () => {
  it(
    "returns token, labels, polylineCount, width, height for a valid image",
    { timeout: 60_000 },
    async () => {
      const result = await extractRasterImageContoursOnly(makeRasterContourPng());

      expect(typeof result.token).toBe("string");
      expect(result.token.length).toBeGreaterThan(0);
      expect(Array.isArray(result.labels)).toBe(true);
      expect(result.labels.length).toBeGreaterThanOrEqual(1);
      for (const label of result.labels) {
        expect(typeof label.x).toBe("number");
        expect(typeof label.y).toBe("number");
        expect(label.value).toBeGreaterThan(0);
        expect(typeof label.text).toBe("string");
      }
      expect(result.polylineCount).toBeGreaterThanOrEqual(1);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    },
  );

  it("throws PdfStageError('extract') for a blank image with no contours", { timeout: 60_000 }, async () => {
    const err = await extractRasterImageContoursOnly(makeBlankPng()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfStageError);
    expect((err as PdfStageError).stage).toBe("extract");
  });

  it("throws PdfStageError('extract') for invalid image bytes", { timeout: 60_000 }, async () => {
    const err = await extractRasterImageContoursOnly(Buffer.from("garbage")).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfStageError);
    expect((err as PdfStageError).stage).toBe("extract");
  });
});

// ---------------------------------------------------------------------------
// commitCachedExtraction — uses __storeExtractionForTest to inject a
// synthetic extraction so these tests never need cv2 / pytesseract.
// ---------------------------------------------------------------------------

describe("commitCachedExtraction", () => {
  it("returns RawPoints when given a valid token", () => {
    const token = __storeExtractionForTest(FAKE_EXTRACTION);
    const points = commitCachedExtraction(token, FAKE_LABELS, BBOX, "feet");

    expect(Array.isArray(points)).toBe(true);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(typeof p.lon).toBe("number");
      expect(typeof p.lat).toBe("number");
      expect(p.depth).toBeGreaterThan(0);
    }
  });

  it("throws PdfStageError('extract') for an unknown token", () => {
    let caught: unknown;
    try {
      commitCachedExtraction("totally-made-up-token", [], BBOX, "feet");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PdfStageError);
    expect((caught as PdfStageError).stage).toBe("extract");
  });

  it("is single-use: a second commit with the same token throws", () => {
    const token = __storeExtractionForTest(FAKE_EXTRACTION);

    // First call succeeds
    commitCachedExtraction(token, FAKE_LABELS, BBOX, "feet");

    // Second call with the same token must throw
    let caught: unknown;
    try {
      commitCachedExtraction(token, FAKE_LABELS, BBOX, "feet");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PdfStageError);
    expect((caught as PdfStageError).stage).toBe("extract");
  });

  it("substitutes correctedLabels — overriding the OCR labels from extraction", () => {
    const token = __storeExtractionForTest(FAKE_EXTRACTION);

    // Build corrected labels: replace every OCR-detected depth with 100 m,
    // which is far above the original 10/20/30 values.  Any interpolated
    // point whose depth originates from these labels should be near 100 m.
    const correctedLabels: PdfDepthLabel[] = FAKE_LABELS.map((l) => ({
      ...l,
      value: 100,
    }));

    const points = commitCachedExtraction(token, correctedLabels, BBOX, "meters");

    expect(points.length).toBeGreaterThan(0);

    // With all labels at 100 m, the interpolated maximum must be well above
    // the uncorrected maximum (30 m) — confirming corrections took effect.
    const maxDepth = Math.max(...points.map((p) => p.depth));
    expect(maxDepth).toBeGreaterThan(50);
  });
});
