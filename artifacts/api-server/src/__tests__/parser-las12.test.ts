import { describe, it, expect, beforeAll } from "vitest";
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

let las12Buf: Buffer;

beforeAll(async () => {
  las12Buf = await readFile(join(FIXTURE_DIR, "survey_1_2.las"));
});

describe("LAS 1.2 (format 0) — realistic multibeam fixture", () => {
  it("parses the fixture and returns non-empty depth points", async () => {
    const pts = await parseLasLaz(las12Buf, "survey_1_2.las");
    assertValidBathyPoints(pts, 10);
  });

  it("applies non-zero XY and Z offsets from the public header", async () => {
    const pts = await parseLasLaz(las12Buf, "survey_1_2.las");
    // Fixture points are near -132.5°E, 55.2°N
    for (const p of pts) {
      expect(p.lon).toBeGreaterThanOrEqual(-133.0);
      expect(p.lon).toBeLessThanOrEqual(-132.0);
      expect(p.lat).toBeGreaterThanOrEqual(55.0);
      expect(p.lat).toBeLessThanOrEqual(56.0);
    }
  });

  it("skips the depth=0 point injected into the fixture", async () => {
    const pts = await parseLasLaz(las12Buf, "survey_1_2.las");
    // Fixture has 15 points total, 1 with depth=0 → should return 14
    expect(pts.length).toBe(14);
    for (const p of pts) {
      expect(p.depth).toBeGreaterThan(0);
    }
  });

  it("produces depth values matching the fixture's survey range", async () => {
    const pts = await parseLasLaz(las12Buf, "survey_1_2.las");
    const depths = pts.map((p) => p.depth);
    expect(Math.min(...depths)).toBeCloseTo(1250, 0);
    expect(Math.max(...depths)).toBeCloseTo(2400, 0);
  });

  it("routes through parseUploadedFile dispatcher for .las", async () => {
    const pts = await parseUploadedFile(las12Buf, "survey_1_2.las");
    assertValidBathyPoints(pts, 10);
  });
});
