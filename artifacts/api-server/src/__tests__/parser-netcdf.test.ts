import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  parseNetCdf,
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

let ncBuf: Buffer;

beforeAll(async () => {
  ncBuf = await readFile(join(FIXTURE_DIR, "survey.nc"));
});

afterAll(() => {
  ncBuf = null!;
});

describe("NetCDF — 64×64 CDF-1 fixture", () => {
  it("parses the fixture and returns non-empty depth points", () => {
    const pts = parseNetCdf(ncBuf);
    assertValidBathyPoints(pts, 10);
  });

  it("skips cells matching _FillValue=-32767", () => {
    const pts = parseNetCdf(ncBuf);
    // Fixture has 64×64=4096 cells with 1 fill cell.
    expect(pts).toHaveLength(64 * 64 - 1);
    for (const p of pts) {
      expect(p.depth).not.toBe(32767);
    }
  });

  it("covers the expected geographic extent", () => {
    const pts = parseNetCdf(ncBuf);
    // The coordinate vectors contain 64 values at 0.1° spacing.
    for (const p of pts) {
      expect(p.lon).toBeGreaterThanOrEqual(141.99);
      expect(p.lon).toBeLessThanOrEqual(148.31);
      expect(p.lat).toBeGreaterThanOrEqual(10.99);
      expect(p.lat).toBeLessThanOrEqual(17.31);
    }
  });

  it("extracts depth values from a 2D grid layout (lat×lon)", () => {
    const pts = parseNetCdf(ncBuf);
    // Valid depth values range from 4050 m (min at [0,1]) to 208750 m.
    const depths = pts.map((p) => p.depth);
    expect(Math.min(...depths)).toBeGreaterThan(0);
    expect(Math.max(...depths)).toBe(208750);
  });

  it("routes through parseUploadedFile dispatcher for .nc", async () => {
    const pts = await parseUploadedFile(ncBuf, "survey.nc");
    assertValidBathyPoints(pts, 10);
  });
});
