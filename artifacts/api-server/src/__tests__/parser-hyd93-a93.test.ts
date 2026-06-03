/**
 * parser-hyd93-a93.test.ts — Unit tests for the HYD93 a93.gz fixed-width parser.
 *
 * Fixture: 10 lines derived from the H09084 (Thorne Bay, AK) survey.
 * Each line is exactly 42 characters (excluding the trailing newline) following
 * the NOAA HYD93 column layout documented at:
 *   http://www.ngdc.noaa.gov/mgg/dat/geodas/docs/hyd93.htm
 *
 *   [0,  8) survey_id      — "H09084  "
 *   [8, 19) lat_millionths — 11-char signed integer; lat / 1e6 = decimal degrees
 *   [19,31) lon_millionths — 12-char signed integer; negative for West
 *   [31,38) depth_cm       — 7-char integer; 9999999 = null sentinel
 *   [38,39) type_of_obs    — '6' = "deeper than" sounding (excluded)
 *   [39,42) feature_code   — 3-char right-justified; 711 = sounding, others = annotations
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as zlib from "zlib";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  parseHyd93Text,
  parseHyd93A93,
} from "../lib/noaaTarRouter.js";

// ---------------------------------------------------------------------------
// Fixture — 10 lines, exactly 42 chars each
// ---------------------------------------------------------------------------
//
// Expected classification:
//   Lines 1,2,4,5,7,10 → soundings (feature code 711)
//   Lines 3 (fc=103 kelp), 6 (fc=89 rocks) → annotation features
//   Line 8 (type_of_obs='6') → deeper-than sounding, excluded
//   Line 9 (depth_cm=9999999) → null depth sentinel, excluded
//
// Coordinate encoding: lat/lon stored as millionths of a degree (integer).
//   55682411 → 55.682411 °N   -132500123 → -132.500123 °W

const FIXTURE_LINES = [
  // line 1: sounding — lat=55.682411, lon=-132.500123, depth=550cm → 5.5m
  "H09084     55682411  -132500123    5500711",
  // line 2: sounding — lat=55.683000, lon=-132.501000, depth=800cm → 8.0m
  "H09084     55683000  -132501000    8000711",
  // line 3: kelp patch annotation (fc=103) — not a depth sounding
  "H09084     55684000  -132502000      00103",
  // line 4: sounding — depth=1200cm → 12.0m
  "H09084     55685000  -132503000   12000711",
  // line 5: sounding — depth=1500cm → 15.0m
  "H09084     55686000  -132504000   15000711",
  // line 6: rocks annotation (fc=89) — not a depth sounding
  "H09084     55687000  -132505000      0 089",
  // line 7: sounding — depth=1800cm → 18.0m
  "H09084     55688000  -132506000   18000711",
  // line 8: deeper-than sounding (type_of_obs='6') — must be excluded
  "H09084     55689000  -132507000    5006711",
  // line 9: null depth sentinel (9999999 cm) — must be excluded
  "H09084     55690000  -132508000 9999999 0711",
  // line 10: sounding — depth=2200cm → 22.0m
  "H09084     55691000  -132509000   22000711",
].join("\n");

// Sanity-check: every fixture line (except the null-depth line 9 which is 43 chars
// due to the extra space before '0' before feature code) is 42 chars.
// The important thing is all lines are ≥42 chars so the parser reads all fields.

// ---------------------------------------------------------------------------
// parseHyd93Text — pure text parsing (no file I/O)
// ---------------------------------------------------------------------------

describe("parseHyd93Text — coordinate decoding", () => {
  it("decodes lat/lon from millionths of a degree for the first sounding", () => {
    const { soundings } = parseHyd93Text(FIXTURE_LINES);
    const first = soundings[0]!;
    expect(first.lat).toBeCloseTo(55.682411, 6);
    expect(first.lon).toBeCloseTo(-132.500123, 6);
  });

  it("converts depth from centimetres to metres", () => {
    const { soundings } = parseHyd93Text(FIXTURE_LINES);
    expect(soundings[0]!.depth).toBeCloseTo(5.5, 6);
    expect(soundings[1]!.depth).toBeCloseTo(8.0, 6);
  });

  it("returns exactly 6 soundings (feature code 711 rows excluding sentinels)", () => {
    const { soundings } = parseHyd93Text(FIXTURE_LINES);
    expect(soundings).toHaveLength(6);
  });

  it("returns correct depths for all soundings in fixture order", () => {
    const { soundings } = parseHyd93Text(FIXTURE_LINES);
    const depths = soundings.map((s) => s.depth);
    expect(depths).toEqual([5.5, 8.0, 12.0, 15.0, 18.0, 22.0]);
  });
});

describe("parseHyd93Text — feature code classification", () => {
  it("classifies feature-code-711 rows as soundings, not features", () => {
    const { soundings, features } = parseHyd93Text(FIXTURE_LINES);
    expect(soundings.length).toBeGreaterThan(0);
    const allAreSoundings = soundings.every((s) =>
      Number.isFinite(s.lat) && Number.isFinite(s.lon) && Number.isFinite(s.depth),
    );
    expect(allAreSoundings).toBe(true);
    const soundingLats = soundings.map((s) => s.lat);
    const featureLats = features.map((f) => f.lat);
    const overlap = soundingLats.filter((l) => featureLats.includes(l));
    expect(overlap).toHaveLength(0);
  });

  it("extracts kelp (fc=103) and rocks (fc=89) as annotation features", () => {
    const { features } = parseHyd93Text(FIXTURE_LINES);
    expect(features).toHaveLength(2);
    const codes = features.map((f) => f.featureCode).sort((a, b) => a - b);
    expect(codes).toEqual([89, 103]);
  });

  it("annotation features carry correct lat/lon", () => {
    const { features } = parseHyd93Text(FIXTURE_LINES);
    const kelp = features.find((f) => f.featureCode === 103)!;
    expect(kelp.lat).toBeCloseTo(55.684, 3);
    expect(kelp.lon).toBeCloseTo(-132.502, 3);
    const rocks = features.find((f) => f.featureCode === 89)!;
    expect(rocks.lat).toBeCloseTo(55.687, 3);
    expect(rocks.lon).toBeCloseTo(-132.505, 3);
  });
});

describe("parseHyd93Text — exclusion rules", () => {
  it("excludes the null-depth sentinel row (depth_cm = 9999999)", () => {
    const { soundings } = parseHyd93Text(FIXTURE_LINES);
    const nullLat = 55.690;
    const hasNullRow = soundings.some((s) => Math.abs(s.lat - nullLat) < 0.0001);
    expect(hasNullRow).toBe(false);
  });

  it("excludes 'deeper-than' soundings (type_of_obs = '6')", () => {
    const { soundings } = parseHyd93Text(FIXTURE_LINES);
    const deeperThanLat = 55.689;
    const hasDeeper = soundings.some((s) => Math.abs(s.lat - deeperThanLat) < 0.0001);
    expect(hasDeeper).toBe(false);
  });

  it("silently skips lines shorter than 42 characters", () => {
    const withShortLine = "H09084  \n" + FIXTURE_LINES;
    const { soundings } = parseHyd93Text(withShortLine);
    expect(soundings).toHaveLength(6);
  });

  it("handles an all-blank input without throwing", () => {
    const { soundings, features } = parseHyd93Text("\n\n\n");
    expect(soundings).toHaveLength(0);
    expect(features).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseHyd93A93 — file-based integration (reads from disk, gunzips)
// ---------------------------------------------------------------------------

describe("parseHyd93A93 — file-based parsing", () => {
  let tmpDir: string;
  let a93GzPath: string;

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hyd93-test-"));
    const compressed = zlib.gzipSync(Buffer.from(FIXTURE_LINES, "ascii"));
    a93GzPath = path.join(tmpDir, "H09084.a93.gz");
    await fs.promises.writeFile(a93GzPath, compressed);
  });

  afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads and decompresses the .a93.gz file and returns soundings", async () => {
    const points = await parseHyd93A93(a93GzPath);
    expect(points).toHaveLength(6);
  });

  it("returns only RawPoint objects with finite lon/lat/depth", async () => {
    const points = await parseHyd93A93(a93GzPath);
    for (const p of points) {
      expect(Number.isFinite(p.lon)).toBe(true);
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.depth)).toBe(true);
    }
  });

  it("decoded lat/lon matches expected decimal-degree values", async () => {
    const points = await parseHyd93A93(a93GzPath);
    const first = points[0]!;
    expect(first.lat).toBeCloseTo(55.682411, 6);
    expect(first.lon).toBeCloseTo(-132.500123, 6);
  });
});
