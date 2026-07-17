import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  parseLasLaz,
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

let las14Buf: Buffer;

beforeAll(async () => {
  las14Buf = await readFile(join(FIXTURE_DIR, "survey_1_4.las"));
});

afterAll(() => {
  las14Buf = null!;
});

describe("LAS 1.4 (format 6) — 64-bit point count fixture", () => {
  it("parses the fixture and returns non-empty depth points", async () => {
    const pts = await parseLasLaz(las14Buf, "survey_1_4.las");
    assertValidBathyPoints(pts, 10);
  });

  it("reads the 64-bit point count field (offset 247) correctly", async () => {
    const pts = await parseLasLaz(las14Buf, "survey_1_4.las");
    // Fixture has exactly 25 valid points (no zero-depth ones)
    expect(pts.length).toBe(25);
  });

  it("uses non-zero XY offsets and a coarser Z scale (0.001 m)", async () => {
    const pts = await parseLasLaz(las14Buf, "survey_1_4.las");
    // Fixture points: lon near -132.5, lat near 55.2
    for (const p of pts) {
      expect(p.lon).toBeGreaterThanOrEqual(-133.0);
      expect(p.lon).toBeLessThanOrEqual(-132.0);
      expect(p.lat).toBeGreaterThanOrEqual(55.0);
      expect(p.lat).toBeLessThanOrEqual(56.0);
    }
  });

  it("correctly handles format-6 record size (30 bytes)", async () => {
    // Point format 6 records are 30 bytes. The parser uses the LAS_POINT_RECORD_SIZE
    // lookup table. If it silently fell back to the wrong size it would produce
    // garbled coordinates — this test catches that.
    const pts = await parseLasLaz(las14Buf, "survey_1_4.las");
    const depths = pts.map((p) => p.depth);
    // Depths increase monotonically: 1000, 1080, 1160, … 2920
    expect(Math.min(...depths)).toBeCloseTo(1000, 0);
    expect(Math.max(...depths)).toBeCloseTo(2920, 0);
  });

  it("routes through parseUploadedFile dispatcher for .las", async () => {
    const pts = await parseUploadedFile(las14Buf, "survey_1_4.las");
    assertValidBathyPoints(pts, 20);
  });
});
