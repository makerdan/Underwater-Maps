/**
 * parseHyd93A93.test.ts — Unit tests for the HYD93 fixed-width sounding parser.
 *
 * Verifies:
 *   - parseHyd93Text: correct lat/lon/depth values (millionths→degrees, cm→metres)
 *   - parseHyd93Text: null-depth sentinel (9999999 cm) is excluded from soundings
 *   - parseHyd93Text: type_of_obs='6' (deeper-than) rows are excluded
 *   - parseHyd93Text: annotation feature codes (89, 103, 146, 530, 988) go to features
 *   - parseHyd93Text: feature code 711 is the only sounding code
 *   - parseHyd93Text: lines shorter than 42 chars are silently skipped
 *   - parseHyd93Text: out-of-range lat/lon are silently skipped
 *   - parseHyd93Text: unrecognised feature codes (not 711 or annotation) are dropped
 *   - parseHyd93Text: CRLF line endings are handled correctly
 *   - parseHyd93A93: decompresses .a93.gz and returns correct soundings + features
 *   - parseHyd93A93: throws descriptively when the file cannot be read
 *   - parseHyd93A93: throws descriptively when the content is not valid gzip
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as zlib from "zlib";
import { parseHyd93Text, parseHyd93A93 } from "../noaaTarRouter.js";

// ---------------------------------------------------------------------------
// HYD93 line builder
//
// Fixed-width column layout (0-based offsets, end exclusive):
//   survey_id      [0,  8) — 8 chars, left-justified, space-padded
//   lat_millionths [8, 19) — 11 chars, right-justified signed integer
//   lon_millionths [19,31) — 12 chars, right-justified signed integer
//   depth_cm       [31,38) — 7 chars, right-justified integer
//   type_of_obs    [38,39) — 1 char ('0' = normal, '6' = deeper-than)
//   feature_code   [39,42) — 3 chars, right-justified integer
// ---------------------------------------------------------------------------

/**
 * Build a single 42-character HYD93 line from semantic field values.
 * `latDeg` and `lonDeg` are decimal degrees; `depthM` is positive-downward metres.
 */
function buildLine(
  surveyId: string,
  latDeg: number,
  lonDeg: number,
  depthM: number,
  typeOfObs: string,
  featureCode: number,
): string {
  const latMil = Math.round(latDeg * 1_000_000);
  const lonMil = Math.round(lonDeg * 1_000_000);
  const depthCm = Math.round(depthM * 100);

  const sid = surveyId.padEnd(8, " ").slice(0, 8);
  const lat = String(latMil).padStart(11, " ");
  const lon = String(lonMil).padStart(12, " ");
  const dep = String(depthCm).padStart(7, " ");
  const fc = String(featureCode).padStart(3, " ");

  return `${sid}${lat}${lon}${dep}${typeOfObs}${fc}`;
}

/** Build a line with the null-depth sentinel (9999999 cm). */
function buildNullDepthLine(surveyId: string, latDeg: number, lonDeg: number): string {
  const latMil = Math.round(latDeg * 1_000_000);
  const lonMil = Math.round(lonDeg * 1_000_000);

  const sid = surveyId.padEnd(8, " ").slice(0, 8);
  const lat = String(latMil).padStart(11, " ");
  const lon = String(lonMil).padStart(12, " ");
  const dep = "9999999";
  return `${sid}${lat}${lon}${dep}0711`;
}

/** Write a gzip-compressed .a93 fixture to tmpDir and return its absolute path. */
async function writeA93Gz(tmpDir: string, name: string, text: string): Promise<string> {
  const gz = zlib.gzipSync(Buffer.from(text, "ascii"));
  const filePath = path.join(tmpDir, name);
  await fs.promises.writeFile(filePath, gz);
  return filePath;
}

// ---------------------------------------------------------------------------
// parseHyd93Text — pure text parsing (no I/O)
// ---------------------------------------------------------------------------

describe("parseHyd93Text", () => {
  // -------------------------------------------------------------------------
  // Basic sounding extraction
  // -------------------------------------------------------------------------

  it("returns one sounding for a single valid line with feature code 711", () => {
    const line = buildLine("H09084", 55.682411, -132.500123, 5.5, "0", 711);
    const { soundings, features } = parseHyd93Text(line + "\n");
    expect(soundings).toHaveLength(1);
    expect(features).toHaveLength(0);
  });

  it("parses lat correctly (millionths of a degree)", () => {
    const line = buildLine("H09084", 55.682411, -132.500123, 5.5, "0", 711);
    const { soundings } = parseHyd93Text(line + "\n");
    expect(soundings[0]!.lat).toBeCloseTo(55.682411, 6);
  });

  it("parses lon correctly (millionths of a degree, negative west)", () => {
    const line = buildLine("H09084", 55.682411, -132.500123, 5.5, "0", 711);
    const { soundings } = parseHyd93Text(line + "\n");
    expect(soundings[0]!.lon).toBeCloseTo(-132.500123, 6);
  });

  it("parses depth correctly (cm → metres)", () => {
    // 550 cm → 5.50 m
    const line = buildLine("H09084", 55.682411, -132.500123, 5.5, "0", 711);
    const { soundings } = parseHyd93Text(line + "\n");
    expect(soundings[0]!.depth).toBeCloseTo(5.5, 6);
  });

  it("converts a large depth value correctly", () => {
    // 250.75 m = 25075 cm
    const line = buildLine("H09084", 55.0, -132.0, 250.75, "0", 711);
    const { soundings } = parseHyd93Text(line + "\n");
    expect(soundings[0]!.depth).toBeCloseTo(250.75, 2);
  });

  it("aggregates multiple sounding lines", () => {
    const lines = [
      buildLine("H09084", 55.0, -132.0, 10.0, "0", 711),
      buildLine("H09084", 55.1, -132.1, 20.0, "0", 711),
      buildLine("H09084", 55.2, -132.2, 30.0, "0", 711),
    ].join("\n");
    const { soundings } = parseHyd93Text(lines + "\n");
    expect(soundings).toHaveLength(3);
    expect(soundings[1]!.lat).toBeCloseTo(55.1, 4);
    expect(soundings[2]!.depth).toBeCloseTo(30.0, 2);
  });

  // -------------------------------------------------------------------------
  // Null-depth sentinel filtering
  // -------------------------------------------------------------------------

  it("excludes soundings with null-depth sentinel (9999999 cm)", () => {
    const nullLine = buildNullDepthLine("H09084", 55.0, -132.0);
    const { soundings } = parseHyd93Text(nullLine + "\n");
    expect(soundings).toHaveLength(0);
  });

  it("keeps valid soundings alongside null-depth rows", () => {
    const nullLine = buildNullDepthLine("H09084", 55.0, -132.0);
    const goodLine = buildLine("H09084", 55.1, -132.1, 15.0, "0", 711);
    const { soundings } = parseHyd93Text([nullLine, goodLine].join("\n") + "\n");
    expect(soundings).toHaveLength(1);
    expect(soundings[0]!.depth).toBeCloseTo(15.0, 2);
  });

  // -------------------------------------------------------------------------
  // type_of_obs='6' (deeper-than) filtering
  // -------------------------------------------------------------------------

  it("excludes rows where type_of_obs is '6' (deeper-than sounding)", () => {
    const line = buildLine("H09084", 55.0, -132.0, 20.0, "6", 711);
    const { soundings } = parseHyd93Text(line + "\n");
    expect(soundings).toHaveLength(0);
  });

  it("keeps rows where type_of_obs is '0' (normal sounding)", () => {
    const line = buildLine("H09084", 55.0, -132.0, 20.0, "0", 711);
    const { soundings } = parseHyd93Text(line + "\n");
    expect(soundings).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Annotation feature codes
  // -------------------------------------------------------------------------

  it("routes feature code 89 (rocks) to annotation features, not soundings", () => {
    const line = buildLine("H09084", 55.0, -132.0, 0.0, "0", 89);
    const { soundings, features } = parseHyd93Text(line + "\n");
    expect(soundings).toHaveLength(0);
    expect(features).toHaveLength(1);
    expect(features[0]!.featureCode).toBe(89);
  });

  it("routes feature code 103 (kelp) to annotation features", () => {
    const line = buildLine("H09084", 55.0, -132.0, 0.0, "0", 103);
    const { features } = parseHyd93Text(line + "\n");
    expect(features).toHaveLength(1);
    expect(features[0]!.featureCode).toBe(103);
  });

  it("routes feature code 146 (ledges) to annotation features", () => {
    const line = buildLine("H09084", 55.0, -132.0, 0.0, "0", 146);
    const { features } = parseHyd93Text(line + "\n");
    expect(features[0]!.featureCode).toBe(146);
  });

  it("routes feature code 530 (rocky reefs) to annotation features", () => {
    const line = buildLine("H09084", 55.0, -132.0, 0.0, "0", 530);
    const { features } = parseHyd93Text(line + "\n");
    expect(features[0]!.featureCode).toBe(530);
  });

  it("routes feature code 988 (obstruction/wreck) to annotation features", () => {
    const line = buildLine("H09084", 55.0, -132.0, 0.0, "0", 988);
    const { features } = parseHyd93Text(line + "\n");
    expect(features[0]!.featureCode).toBe(988);
  });

  it("records correct lat/lon on annotation feature points", () => {
    const line = buildLine("H09084", 55.123456, -132.654321, 0.0, "0", 89);
    const { features } = parseHyd93Text(line + "\n");
    expect(features[0]!.lat).toBeCloseTo(55.123456, 5);
    expect(features[0]!.lon).toBeCloseTo(-132.654321, 5);
  });

  it("mixes soundings and annotation features from the same file", () => {
    const sounding = buildLine("H09084", 55.0, -132.0, 10.0, "0", 711);
    const kelp = buildLine("H09084", 55.1, -132.1, 0.0, "0", 103);
    const rock = buildLine("H09084", 55.2, -132.2, 0.0, "0", 89);
    const { soundings, features } = parseHyd93Text(
      [sounding, kelp, rock].join("\n") + "\n",
    );
    expect(soundings).toHaveLength(1);
    expect(features).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Unrecognised feature codes
  // -------------------------------------------------------------------------

  it("drops rows with unrecognised feature codes (not 711 or annotation set)", () => {
    const line = buildLine("H09084", 55.0, -132.0, 10.0, "0", 999);
    const { soundings, features } = parseHyd93Text(line + "\n");
    expect(soundings).toHaveLength(0);
    expect(features).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Short / malformed lines
  // -------------------------------------------------------------------------

  it("skips lines shorter than 42 characters", () => {
    const shortLine = "H09084  55682411";
    const { soundings, features } = parseHyd93Text(shortLine + "\n");
    expect(soundings).toHaveLength(0);
    expect(features).toHaveLength(0);
  });

  it("skips empty lines silently", () => {
    const text = "\n\n" + buildLine("H09084", 55.0, -132.0, 10.0, "0", 711) + "\n\n";
    const { soundings } = parseHyd93Text(text);
    expect(soundings).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Coordinate range validation
  // -------------------------------------------------------------------------

  it("skips rows with lat > 90", () => {
    const line = buildLine("H09084", 91.0, -132.0, 10.0, "0", 711);
    const { soundings } = parseHyd93Text(line + "\n");
    expect(soundings).toHaveLength(0);
  });

  it("skips rows with lat < -90", () => {
    const line = buildLine("H09084", -91.0, -132.0, 10.0, "0", 711);
    const { soundings } = parseHyd93Text(line + "\n");
    expect(soundings).toHaveLength(0);
  });

  it("skips rows with lon > 180", () => {
    const line = buildLine("H09084", 55.0, 181.0, 10.0, "0", 711);
    const { soundings } = parseHyd93Text(line + "\n");
    expect(soundings).toHaveLength(0);
  });

  it("skips rows with lon < -180", () => {
    const line = buildLine("H09084", 55.0, -181.0, 10.0, "0", 711);
    const { soundings } = parseHyd93Text(line + "\n");
    expect(soundings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Line ending tolerance
  // -------------------------------------------------------------------------

  it("handles CRLF line endings correctly", () => {
    const line = buildLine("H09084", 55.0, -132.0, 10.0, "0", 711);
    const { soundings } = parseHyd93Text(line + "\r\n");
    expect(soundings).toHaveLength(1);
  });

  it("handles a mix of LF and CRLF in the same file", () => {
    const line1 = buildLine("H09084", 55.0, -132.0, 10.0, "0", 711);
    const line2 = buildLine("H09084", 55.1, -132.1, 20.0, "0", 711);
    const { soundings } = parseHyd93Text(line1 + "\r\n" + line2 + "\n");
    expect(soundings).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Empty input
  // -------------------------------------------------------------------------

  it("returns empty arrays for an empty string", () => {
    const { soundings, features } = parseHyd93Text("");
    expect(soundings).toHaveLength(0);
    expect(features).toHaveLength(0);
  });

  it("returns empty arrays for a whitespace-only string", () => {
    const { soundings, features } = parseHyd93Text("   \n   \n");
    expect(soundings).toHaveLength(0);
    expect(features).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseHyd93A93 — full file I/O (gzip decompression + text parsing)
// ---------------------------------------------------------------------------

describe("parseHyd93A93", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hyd93-a93-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("decompresses a .a93.gz file and returns the correct soundings", async () => {
    const line = buildLine("H09084", 55.682411, -132.500123, 5.5, "0", 711);
    const filePath = await writeA93Gz(tmpDir, "h09084.a93.gz", line + "\n");

    const { soundings, features } = await parseHyd93A93(filePath);

    expect(soundings).toHaveLength(1);
    expect(features).toHaveLength(0);
    expect(soundings[0]!.lat).toBeCloseTo(55.682411, 6);
    expect(soundings[0]!.lon).toBeCloseTo(-132.500123, 6);
    expect(soundings[0]!.depth).toBeCloseTo(5.5, 6);
  });

  it("returns annotation features from a .a93.gz file", async () => {
    const sounding = buildLine("H09084", 55.0, -132.0, 10.0, "0", 711);
    const kelp = buildLine("H09084", 55.1, -132.1, 0.0, "0", 103);
    const text = [sounding, kelp].join("\n") + "\n";
    const filePath = await writeA93Gz(tmpDir, "h09084.a93.gz", text);

    const { soundings, features } = await parseHyd93A93(filePath);

    expect(soundings).toHaveLength(1);
    expect(features).toHaveLength(1);
    expect(features[0]!.featureCode).toBe(103);
  });

  it("quality-filters null-depth and deeper-than rows inside a .a93.gz file", async () => {
    const nullLine = buildNullDepthLine("H09084", 55.0, -132.0);
    const deeperThan = buildLine("H09084", 55.1, -132.1, 30.0, "6", 711);
    const valid = buildLine("H09084", 55.2, -132.2, 42.0, "0", 711);
    const text = [nullLine, deeperThan, valid].join("\n") + "\n";
    const filePath = await writeA93Gz(tmpDir, "h09084.a93.gz", text);

    const { soundings } = await parseHyd93A93(filePath);

    expect(soundings).toHaveLength(1);
    expect(soundings[0]!.depth).toBeCloseTo(42.0, 2);
  });

  it("returns empty soundings and features for a file with no valid lines", async () => {
    const text = buildNullDepthLine("H09084", 55.0, -132.0) + "\n";
    const filePath = await writeA93Gz(tmpDir, "h09084.a93.gz", text);

    const { soundings, features } = await parseHyd93A93(filePath);

    expect(soundings).toHaveLength(0);
    expect(features).toHaveLength(0);
  });

  it("throws a descriptive error when the file does not exist", async () => {
    const missing = path.join(tmpDir, "missing.a93.gz");
    await expect(parseHyd93A93(missing)).rejects.toThrow(/failed to read/i);
  });

  it("throws a descriptive error when the content is not valid gzip", async () => {
    const filePath = path.join(tmpDir, "bad.a93.gz");
    await fs.promises.writeFile(filePath, Buffer.from("not gzip data at all"));
    await expect(parseHyd93A93(filePath)).rejects.toThrow(/failed to decompress/i);
  });
});
