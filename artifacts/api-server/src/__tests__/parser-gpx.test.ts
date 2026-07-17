import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  parseGpxTerrain,
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

let gpxBuf: Buffer;

beforeAll(async () => {
  gpxBuf = await readFile(join(FIXTURE_DIR, "survey.gpx"));
});

afterAll(() => {
  gpxBuf = null!;
});

describe("GPX — realistic survey track fixture", () => {
  it("parses the fixture and returns 16 valid depth points", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    // 10 trkpts with <ele> + 3 trkpts with vendor extension depth tags
    // (<depth>, <gpxx:Depth>, <nmea:depth>) + 2 wpts with <ele>
    //   + 1 wpt with <extensions><depth> = 16.
    // Skipped: 1 trkpt missing <ele>/extensions, 1 trkpt with lat=95, 1 wpt missing <ele>.
    expect(pts.length).toBe(16);
    assertValidBathyPoints(pts, 16);
  });

  it("skips <trkpt> elements that have no <ele> child", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    // Fixture injects one trkpt at lat=55.21, lon=-132.51 without <ele>.
    // If it were parsed its lon would be -132.51 — assert no such point exists.
    const noElePt = pts.find(
      (p) => Math.abs(p.lat - 55.21) < 0.00001 && Math.abs(p.lon - -132.51) < 0.00001,
    );
    expect(noElePt).toBeUndefined();
  });

  it("skips <trkpt> with coordinates outside the valid geographic range", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    // Fixture injects trkpt with lat=95 (invalid) — no point should have lat > 90.
    for (const p of pts) {
      expect(p.lat).toBeLessThanOrEqual(90);
      expect(p.lat).toBeGreaterThanOrEqual(-90);
    }
  });

  it("processes <wpt> waypoint elements in addition to <trkpt> track points", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    // Three valid wpts: WP01 (lat≈55.220, ele), WP02 (lat≈55.221, ele),
    // WP04 (lat≈55.223, extensions depth). WP03 has no <ele>/extensions → skipped.
    const wptPts = pts.filter((p) => p.lat >= 55.219 && p.lat <= 55.224);
    expect(wptPts.length).toBe(3);
  });

  it("converts negative <ele> values to positive depth", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    // All trkpts have ele < 0; parser must flip sign.
    for (const p of pts) {
      expect(p.depth).toBeGreaterThan(0);
    }
  });

  it("also handles positive <ele> values (WP02 has ele=1800.5)", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    // WP02 at lat≈55.221 has ele=1800.5 (positive); depth should be 1800.5.
    const wp2 = pts.find((p) => Math.abs(p.lat - 55.221) < 0.00001);
    expect(wp2).toBeDefined();
    expect(wp2!.depth).toBeCloseTo(1800.5, 1);
  });

  it("derives geographic coordinates directly from lat/lon attributes", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    // All fixture trkpts are near lon=-132.5, lat=55.2; wpts near lon=-132.52.
    for (const p of pts) {
      expect(p.lon).toBeGreaterThanOrEqual(-132.53);
      expect(p.lon).toBeLessThanOrEqual(-132.49);
      expect(p.lat).toBeGreaterThanOrEqual(55.19);
      expect(p.lat).toBeLessThanOrEqual(55.23);
    }
  });

  it("produces depth values spanning the fixture's survey range", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    const depths = pts.map((p) => p.depth);
    // trkpt depths: 1250–2150 m; wpt depths: 1800.5, 2000, 2500 (extension wpt)
    expect(Math.min(...depths)).toBeCloseTo(1250, 0);
    expect(Math.max(...depths)).toBeCloseTo(2500, 0);
  });

  it("reads depth from <extensions><depth> when <ele> is absent (trkpt)", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    // Fixture trkpt at lat=55.211, lon=-132.511 has no <ele> but carries
    // <extensions><depth>1750.0</depth></extensions> (Garmin echoMAP style).
    const extPt = pts.find(
      (p) => Math.abs(p.lat - 55.211) < 0.00001 && Math.abs(p.lon - -132.511) < 0.00001,
    );
    expect(extPt).toBeDefined();
    expect(extPt!.depth).toBeCloseTo(1750.0, 1);
  });

  it("reads depth from <extensions><gpxx:Depth> (Garmin GPX extension)", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    // Fixture trkpt at lat=55.212, lon=-132.512 has no <ele> but carries
    // <extensions><gpxx:Depth>1850.0</gpxx:Depth></extensions>.
    const gpxxPt = pts.find(
      (p) => Math.abs(p.lat - 55.212) < 0.00001 && Math.abs(p.lon - -132.512) < 0.00001,
    );
    expect(gpxxPt).toBeDefined();
    expect(gpxxPt!.depth).toBeCloseTo(1850.0, 1);
  });

  it("reads depth from <extensions><nmea:depth> (NMEA-logger extension)", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    // Fixture trkpt at lat=55.213, lon=-132.513 has no <ele> but carries
    // <extensions><nmea:depth>1950.0</nmea:depth></extensions>.
    const nmeaPt = pts.find(
      (p) => Math.abs(p.lat - 55.213) < 0.00001 && Math.abs(p.lon - -132.513) < 0.00001,
    );
    expect(nmeaPt).toBeDefined();
    expect(nmeaPt!.depth).toBeCloseTo(1950.0, 1);
  });

  it("reads depth from <extensions><depth> on a <wpt> element (no <ele>)", () => {
    const pts = parseGpxTerrain(gpxBuf.toString("utf8"));
    // Fixture wpt WP04 at lat=55.223, lon=-132.523 carries
    // <extensions><depth>2500.0</depth></extensions> with no <ele>.
    const wptExtPt = pts.find(
      (p) => Math.abs(p.lat - 55.223) < 0.00001 && Math.abs(p.lon - -132.523) < 0.00001,
    );
    expect(wptExtPt).toBeDefined();
    expect(wptExtPt!.depth).toBeCloseTo(2500.0, 1);
  });

  it("routes through parseUploadedFile dispatcher for .gpx", async () => {
    const pts = await parseUploadedFile(gpxBuf, "survey.gpx");
    assertValidBathyPoints(pts, 10);
    expect(pts.length).toBe(16);
  });
});
