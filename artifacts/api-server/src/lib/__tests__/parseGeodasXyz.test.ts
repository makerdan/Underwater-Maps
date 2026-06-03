/**
 * parseGeodasXyz.test.ts — Unit tests for the GEODAS xyz.gz sounding parser.
 *
 * Verifies:
 *   - Valid rows (quality_code=1, active=1) are returned as RawPoint[]
 *   - Rows with quality_code=0 are excluded
 *   - Rows with active=0 are excluded
 *   - Rows with negative depth (above-datum elevations) are skipped
 *   - lat/lon/depth values are parsed with correct column mapping
 *   - Missing required columns throw a descriptive error
 *   - Invalid (non-gzip) content throws a descriptive error
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as zlib from "zlib";
import { parseGeodasXyz } from "../noaaTarRouter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Synchronously gzip a CSV string and return the compressed Buffer. */
function makeGeodasGz(csv: string): Buffer {
  return zlib.gzipSync(Buffer.from(csv, "utf8"));
}

/** Write a gzipped GEODAS fixture to a temp file and return its path. */
async function writeTmp(dir: string, name: string, content: Buffer): Promise<string> {
  const filePath = path.join(dir, name);
  await fs.promises.writeFile(filePath, content);
  return filePath;
}

// ---------------------------------------------------------------------------
// Fixture CSV data
// ---------------------------------------------------------------------------

/**
 * Standard GEODAS xyz CSV with six rows:
 *   row1: quality_code=1, active=1  → KEEP (depth 15.2)
 *   row2: quality_code=0, active=1  → REJECT (quality bad)
 *   row3: quality_code=1, active=0  → REJECT (inactive)
 *   row4: quality_code=0, active=0  → REJECT (both bad)
 *   row5: quality_code=1, active=1  → KEEP (depth 42.7)
 *   row6: quality_code=1, active=1, depth=-3.0  → SKIP (above datum)
 */
const FIXTURE_CSV = `survey_id,lat,lon,depth,quality_code,active
H09084,55.700,-132.530,15.2,1,1
H09084,55.701,-132.531,20.0,0,1
H09084,55.702,-132.532,18.5,1,0
H09084,55.703,-132.533,25.0,0,0
H09084,55.704,-132.534,42.7,1,1
H09084,55.705,-132.535,-3.0,1,1
`;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("parseGeodasXyz", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "geodas-xyz-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Quality filtering
  // -------------------------------------------------------------------------

  it("returns only rows with quality_code=1 AND active=1", async () => {
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(FIXTURE_CSV));
    const pts = await parseGeodasXyz(filePath);
    // Only rows 1 and 5 pass quality; row 6 is filtered by negative depth
    expect(pts).toHaveLength(2);
  });

  it("returns correct lat/lon/depth for the first passing row", async () => {
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(FIXTURE_CSV));
    const pts = await parseGeodasXyz(filePath);
    expect(pts[0]).toMatchObject({ lat: 55.7, lon: -132.53, depth: 15.2 });
  });

  it("returns correct lat/lon/depth for the second passing row", async () => {
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(FIXTURE_CSV));
    const pts = await parseGeodasXyz(filePath);
    expect(pts[1]).toMatchObject({ lat: 55.704, lon: -132.534, depth: 42.7 });
  });

  it("excludes rows with quality_code=0", async () => {
    const csv = `survey_id,lat,lon,depth,quality_code,active\nH09084,55.7,-132.5,10.0,0,1\n`;
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(csv));
    const pts = await parseGeodasXyz(filePath);
    expect(pts).toHaveLength(0);
  });

  it("excludes rows with active=0", async () => {
    const csv = `survey_id,lat,lon,depth,quality_code,active\nH09084,55.7,-132.5,10.0,1,0\n`;
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(csv));
    const pts = await parseGeodasXyz(filePath);
    expect(pts).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Depth sign convention
  // -------------------------------------------------------------------------

  it("skips rows with negative depth (elevations above datum)", async () => {
    const csv = `survey_id,lat,lon,depth,quality_code,active\nH09084,55.7,-132.5,-5.0,1,1\n`;
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(csv));
    const pts = await parseGeodasXyz(filePath);
    expect(pts).toHaveLength(0);
  });

  it("passes through zero depth without error", async () => {
    const csv = `survey_id,lat,lon,depth,quality_code,active\nH09084,55.7,-132.5,0.0,1,1\n`;
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(csv));
    const pts = await parseGeodasXyz(filePath);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.depth).toBe(0);
  });

  it("preserves positive depth values as-is (positive-downward convention)", async () => {
    const csv = `survey_id,lat,lon,depth,quality_code,active\nH09084,55.7,-132.5,123.456,1,1\n`;
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(csv));
    const pts = await parseGeodasXyz(filePath);
    expect(pts[0]!.depth).toBeCloseTo(123.456, 3);
  });

  // -------------------------------------------------------------------------
  // Column handling
  // -------------------------------------------------------------------------

  it("works when quality_code and active columns are absent (no filtering applied)", async () => {
    const csv = `survey_id,lat,lon,depth\nH09084,55.7,-132.5,10.0\n`;
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(csv));
    const pts = await parseGeodasXyz(filePath);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ lat: 55.7, lon: -132.5, depth: 10.0 });
  });

  it("handles extra whitespace around CSV values", async () => {
    const csv = `survey_id, lat, lon, depth, quality_code, active\nH09084, 55.7 , -132.5 , 10.0 , 1 , 1\n`;
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(csv));
    const pts = await parseGeodasXyz(filePath);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.lat).toBeCloseTo(55.7, 4);
  });

  it("handles CRLF line endings", async () => {
    const csv = `survey_id,lat,lon,depth,quality_code,active\r\nH09084,55.7,-132.5,10.0,1,1\r\n`;
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(csv));
    const pts = await parseGeodasXyz(filePath);
    expect(pts).toHaveLength(1);
  });

  it("skips blank lines in the data section", async () => {
    const csv = `survey_id,lat,lon,depth,quality_code,active\n\nH09084,55.7,-132.5,10.0,1,1\n\n`;
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(csv));
    const pts = await parseGeodasXyz(filePath);
    expect(pts).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it("throws a descriptive error when lat column is missing", async () => {
    const csv = `survey_id,lon,depth,quality_code,active\nH09084,-132.5,10.0,1,1\n`;
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(csv));
    await expect(parseGeodasXyz(filePath)).rejects.toThrow(/missing required columns/i);
  });

  it("throws a descriptive error when given invalid gzip content", async () => {
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", Buffer.from("not gzip data"));
    await expect(parseGeodasXyz(filePath)).rejects.toThrow(/Failed to decompress/i);
  });

  // -------------------------------------------------------------------------
  // Parse summary (regression: all-bad-quality produces 0 points, no crash)
  // -------------------------------------------------------------------------

  it("returns an empty array when all rows fail quality filtering", async () => {
    const csv = `survey_id,lat,lon,depth,quality_code,active
H09084,55.7,-132.5,10.0,0,1
H09084,55.8,-132.6,12.0,1,0
H09084,55.9,-132.7,14.0,0,0
`;
    const filePath = await writeTmp(tmpDir, "h09084.xyz.gz", makeGeodasGz(csv));
    const pts = await parseGeodasXyz(filePath);
    expect(pts).toHaveLength(0);
  });
});
