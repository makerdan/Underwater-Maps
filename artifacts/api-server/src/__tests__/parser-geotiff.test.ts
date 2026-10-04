import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  parseGeoTiff,
  parseUploadedFile,
  type RawPoint,
} from "../lib/uploadParsers.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dir, "fixtures");

function assertValidBathyPoints(pts: RawPoint[], minCount = 1): void {
  expect(pts.length).toBeGreaterThanOrEqual(minCount);
  for (const p of pts) {
    expect(Number.isFinite(p.lon)).toBe(true);
    expect(Number.isFinite(p.lat)).toBe(true);
    expect(Number.isFinite(p.depth)).toBe(true);
    expect(p.lon).toBeGreaterThanOrEqual(-180);
    expect(p.lon).toBeLessThanOrEqual(180);
    expect(p.lat).toBeGreaterThanOrEqual(-90);
    expect(p.lat).toBeLessThanOrEqual(90);
    expect(p.depth).toBeGreaterThan(0);
  }
}

let tifBuf: Buffer;

beforeAll(async () => {
  tifBuf = await readFile(join(FIXTURE_DIR, "survey.tif"));
});

afterAll(() => {
  tifBuf = null!;
});

describe("GeoTIFF — realistic survey fixture", () => {
  it("parses the fixture and returns non-empty depth points", async () => {
    const pts = await parseGeoTiff(tifBuf);
    assertValidBathyPoints(pts, 10);
  });

  it("skips NODATA pixels (GDAL_NODATA=-9999)", async () => {
    const pts = await parseGeoTiff(tifBuf);
    // Fixture has 64×64 = 4096 pixels, 5 NODATA cells.
    expect(pts).toHaveLength(64 * 64 - 5);
    for (const p of pts) {
      // After abs() the parser applies, no point should equal 9999
      expect(p.depth).not.toBe(9999);
    }
  });

  it("derives correct geographic coordinates from ModelTiepoint+ModelPixelScale", async () => {
    const pts = await parseGeoTiff(tifBuf);
    // geotiff.writeArrayBuffer forces the globe top-left tiepoint [-180, 90, 0].
    // With 64×64 pixels at 0.01°/px, cell centers span approximately
    // lon [-179.995, -179.365], lat [89.365, 89.995].
    for (const p of pts) {
      expect(p.lon).toBeGreaterThanOrEqual(-180.01);
      expect(p.lon).toBeLessThanOrEqual(-179.35);
      expect(p.lat).toBeGreaterThanOrEqual(89.35);
      expect(p.lat).toBeLessThanOrEqual(90.01);
    }
  });

  it("converts negative elevation values to positive depth", async () => {
    // Fixture stores negative raster values (below sea level); parser should flip
    const pts = await parseGeoTiff(tifBuf);
    for (const p of pts) {
      expect(p.depth).toBeGreaterThan(0);
    }
  });

  it("routes through parseUploadedFile dispatcher for .tif", async () => {
    const pts = await parseUploadedFile(tifBuf, "survey.tif");
    assertValidBathyPoints(pts, 10);
  });

  it("routes through parseUploadedFile dispatcher for .tiff", async () => {
    const pts = await parseUploadedFile(tifBuf, "bathymetry.tiff");
    assertValidBathyPoints(pts, 10);
  });
});
