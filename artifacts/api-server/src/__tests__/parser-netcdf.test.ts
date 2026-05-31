import { describe, it, expect, beforeAll } from "vitest";
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

describe("NetCDF — realistic GEBCO-style fixture", () => {
  it("parses the fixture and returns non-empty depth points", () => {
    const pts = parseNetCdf(ncBuf);
    assertValidBathyPoints(pts, 10);
  });

  it("skips cells matching _FillValue=-32767", () => {
    const pts = parseNetCdf(ncBuf);
    // Fixture has 10×10=100 cells with 1 fill cell → at most 99 valid points
    expect(pts.length).toBeLessThanOrEqual(99);
    for (const p of pts) {
      expect(p.depth).not.toBe(32767);
    }
  });

  it("covers the expected geographic region (Mariana Trench area)", () => {
    const pts = parseNetCdf(ncBuf);
    // lon: 142.0–142.9, lat: 11.0–11.9
    for (const p of pts) {
      expect(p.lon).toBeGreaterThanOrEqual(141.9);
      expect(p.lon).toBeLessThanOrEqual(143.0);
      expect(p.lat).toBeGreaterThanOrEqual(10.9);
      expect(p.lat).toBeLessThanOrEqual(12.0);
    }
  });

  it("extracts depth values from a 2D grid layout (lat×lon)", () => {
    const pts = parseNetCdf(ncBuf);
    // Depth values in fixture range from 4050 m (min at [0,1]) to ~8950 m
    const depths = pts.map((p) => p.depth);
    expect(Math.min(...depths)).toBeGreaterThan(0);
    expect(Math.max(...depths)).toBeLessThan(20000);
  });

  it("routes through parseUploadedFile dispatcher for .nc", async () => {
    const pts = await parseUploadedFile(ncBuf, "survey.nc");
    assertValidBathyPoints(pts, 10);
  });
});
