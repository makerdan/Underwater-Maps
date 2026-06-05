import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  parseBag,
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

let bagBuf: Buffer;

beforeAll(async () => {
  bagBuf = await readFile(join(FIXTURE_DIR, "survey.bag"));
});

describe("BAG (HDF5) — realistic NOAA hydrographic survey fixture", () => {
  it("parses the fixture and returns non-empty depth points", async () => {
    const pts = await parseBag(bagBuf);
    // 10×10 = 100 cells, 3 fill cells → at least 97 valid points
    assertValidBathyPoints(pts, 90);
  });

  it("skips BAG fill-value cells (1e6 / 1_000_000)", async () => {
    const pts = await parseBag(bagBuf);
    // Fixture has 3 cells with fill value 1_000_000
    expect(pts.length).toBeLessThanOrEqual(97);
    for (const p of pts) {
      expect(p.depth).not.toBe(1_000_000);
      expect(p.depth).not.toBe(1e6);
    }
  });

  it("derives geolocation from metadata XML bounding box", async () => {
    const pts = await parseBag(bagBuf);
    // Fixture metadata XML: west=142.0, east=142.01, south=11.0, north=11.01
    // extractBagGeolocation computes cols=round(0.01/0.001)=10, rows=10,
    // so valid points fall within the bounding box.
    for (const p of pts) {
      expect(p.lon).toBeGreaterThanOrEqual(141.99);
      expect(p.lon).toBeLessThanOrEqual(142.02);
      expect(p.lat).toBeGreaterThanOrEqual(10.99);
      expect(p.lat).toBeLessThanOrEqual(11.02);
    }
  });

  it("converts negative elevation values to positive depth", async () => {
    // Fixture stores negative values (positive-up seafloor convention);
    // parseBag must flip them to positive-downward depth.
    const pts = await parseBag(bagBuf);
    for (const p of pts) {
      expect(p.depth).toBeGreaterThan(0);
    }
  });

  it("produces depth values within the fixture's survey range", async () => {
    // Fixture depths: -(1000 + idx * 200), idx 1..98 (excluding 3 fill cells).
    // Range: 1200 m (idx=1) to ~20600 m (idx=98), fill-skipped cells excluded.
    const pts = await parseBag(bagBuf);
    const depths = pts.map((p) => p.depth);
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(1000);
    expect(Math.max(...depths)).toBeLessThanOrEqual(25000);
  });

  it("routes through parseUploadedFile dispatcher for .bag", async () => {
    const pts = await parseUploadedFile(bagBuf, "survey.bag");
    assertValidBathyPoints(pts, 90);
  });

  it("throws a descriptive error for a non-HDF5 buffer", async () => {
    // bag_parser.py exits non-zero when h5py cannot open the file; parseBag
    // must surface a human-readable error so the caller can diagnose the issue.
    const junk = Buffer.from("not an hdf5 file at all");
    await expect(parseBag(junk)).rejects.toThrow(/BAG/i);
  });

});
