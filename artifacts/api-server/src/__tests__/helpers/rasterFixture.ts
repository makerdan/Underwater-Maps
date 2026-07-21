/**
 * rasterFixture.ts — Test helpers for raster-contour tests.
 *
 * Returns PNG image buffers that are verified to work with the
 * raster_contour.py pipeline (3 concentric rectangles with "10", "20", "30"
 * depth labels printed in large cv2 text to the right of the rings).
 *
 * The fixture PNG is generated once by scripts/gen-raster-fixture.py and
 * committed to src/__tests__/fixtures/raster_contour_fixture.png.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures");

/**
 * Returns the pre-generated raster contour fixture PNG as a Buffer.
 * Contains 3 nested rectangular contours with depth labels 10, 20, 30.
 */
export function makeRasterContourPng(): Buffer {
  return readFileSync(join(FIXTURES_DIR, "raster_contour_fixture.png"));
}

/**
 * A tiny valid PNG that contains no lines and no labels.
 * Exercises the "no contours detected" error path.
 */
export function makeBlankPng(): Buffer {
  const W = 64, H = 64;
  const png = new PNG({ width: W, height: H });
  png.data.fill(255);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  return PNG.sync.write(png);
}
