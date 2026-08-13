/**
 * bboxCenterLon — dateline-aware bbox center utility.
 *
 * Guards the fix from Task 3550 Bug 2: the arithmetic mean (minLon + maxLon) / 2
 * is wrong for bboxes that cross the antimeridian (e.g. minLon=170, maxLon=-170
 * yields 0° instead of the correct 180°).
 */
import { describe, it, expect } from "vitest";
import { bboxCenterLon } from "../lib/terrain";

describe("bboxCenterLon — dateline-aware bbox center", () => {
  it("returns the correct center for a normal (non-crossing) bbox", () => {
    expect(bboxCenterLon(0, 90)).toBeCloseTo(45, 5);
  });

  it("returns 0 for a bbox centred at the prime meridian", () => {
    expect(bboxCenterLon(-10, 10)).toBeCloseTo(0, 5);
  });

  it("returns 180 for a bbox crossing the antimeridian (minLon=170, maxLon=-170)", () => {
    // Arithmetic mean would give 0 — wrong.  The correct center is 180°/-180°.
    const c = bboxCenterLon(170, -170);
    // normalizeLonDelta brings 180 to exactly 180 (or -180 ≡ same).
    expect(Math.abs(c)).toBeCloseTo(180, 5);
  });

  it("returns -170 for a tight antimeridian-crossing bbox (minLon=170, maxLon=-160)", () => {
    // Shorter arc: 170 → 180 → -160 spans 30°, center at 170 + 15 = -175° (or 185 → 185-360=-175)
    // Actually: (170 + (-160+360))/2 = (170+200)/2 = 185 → normalize → -175
    const c = bboxCenterLon(170, -160);
    expect(c).toBeCloseTo(-175, 5);
  });

  it("returns 0 for a full-globe bbox (-180 to 180)", () => {
    expect(bboxCenterLon(-180, 180)).toBeCloseTo(0, 5);
  });

  it("returns the midpoint for a standard US West Coast bbox", () => {
    // Typical dataset: minLon=-130, maxLon=-120
    expect(bboxCenterLon(-130, -120)).toBeCloseTo(-125, 5);
  });

  it("returns the midpoint for a northern-European bbox", () => {
    expect(bboxCenterLon(10, 30)).toBeCloseTo(20, 5);
  });

  it("handles a single-point bbox (minLon === maxLon)", () => {
    expect(bboxCenterLon(45, 45)).toBeCloseTo(45, 5);
  });

  it("handles minLon === maxLon at the antimeridian", () => {
    expect(bboxCenterLon(180, 180)).toBeCloseTo(180, 5);
  });
});
