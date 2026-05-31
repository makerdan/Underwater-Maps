import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  parseNmea,
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

let nmeaBuf: Buffer;

beforeAll(async () => {
  nmeaBuf = await readFile(join(FIXTURE_DIR, "survey.nmea"));
});

describe("NMEA — realistic depth-sounder log fixture", () => {
  it("parses the fixture and returns 11 valid depth+position pairs", () => {
    const pts = parseNmea(nmeaBuf.toString("utf8"));
    // 8 GPGGA+SDDBT + 2 GPRMC+SDDBT + 1 SDDBT (after malformed GPGGA, last valid pos reused)
    // 1 leading SDDBT (no position yet) is skipped.
    expect(pts.length).toBe(11);
    assertValidBathyPoints(pts, 11);
  });

  it("skips the SDDBT sentence that precedes any position fix", () => {
    const pts = parseNmea(nmeaBuf.toString("utf8"));
    // The very first sentence is an SDDBT at depth=5.0m — if it were included,
    // a point near depth=5 would appear; no valid point should have depth≤5.
    for (const p of pts) {
      expect(p.depth).toBeGreaterThan(5);
    }
  });

  it("skips sentences whose NMEA checksum is invalid", () => {
    const pts = parseNmea(nmeaBuf.toString("utf8"));
    // The malformed GPGGA has coords near lat≈55.35, lon≈-132.516.
    // If it were accepted, a point with lat≈55.35 would appear.
    for (const p of pts) {
      expect(p.lat).toBeLessThan(55.35);
    }
  });

  it("accepts GPRMC sentences as a position source alongside GPGGA", () => {
    const pts = parseNmea(nmeaBuf.toString("utf8"));
    // GPRMC pairs produce 2 depth points at depths 2400 and 2600 m.
    const rmc = pts.filter((p) => p.depth === 2400 || p.depth === 2600);
    expect(rmc.length).toBe(2);
  });

  it("reuses the most recent valid position when a malformed sentence is skipped", () => {
    const pts = parseNmea(nmeaBuf.toString("utf8"));
    // The final SDDBT (depth=2700) is emitted after a malformed GPGGA.
    // Parser must use the last valid GPRMC position (lat≈55.209) for that point.
    const finalPt = pts.find((p) => p.depth === 2700);
    expect(finalPt).toBeDefined();
    expect(finalPt!.lat).toBeGreaterThanOrEqual(55.208);
    expect(finalPt!.lat).toBeLessThanOrEqual(55.21);
  });

  it("covers the expected geographic region (US Pacific coast survey area)", () => {
    const pts = parseNmea(nmeaBuf.toString("utf8"));
    for (const p of pts) {
      expect(p.lon).toBeGreaterThanOrEqual(-132.52);
      expect(p.lon).toBeLessThanOrEqual(-132.499);
      expect(p.lat).toBeGreaterThanOrEqual(55.199);
      expect(p.lat).toBeLessThanOrEqual(55.21);
    }
  });

  it("produces depth values spanning the fixture's survey range", () => {
    const pts = parseNmea(nmeaBuf.toString("utf8"));
    const depths = pts.map((p) => p.depth);
    // Range: 1200 m (first GPGGA+SDDBT) to 2700 m (final SDDBT)
    expect(Math.min(...depths)).toBeCloseTo(1200, 0);
    expect(Math.max(...depths)).toBeCloseTo(2700, 0);
  });

  it("routes through parseUploadedFile dispatcher for .nmea", async () => {
    const pts = await parseUploadedFile(nmeaBuf, "survey.nmea");
    assertValidBathyPoints(pts, 10);
    expect(pts.length).toBe(11);
  });
});
