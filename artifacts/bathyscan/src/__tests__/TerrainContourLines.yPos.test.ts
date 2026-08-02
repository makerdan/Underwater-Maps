/**
 * Regression test: contour line Y-position must use the grid's own depth range,
 * not the colormap's absolute domain.
 *
 * Before the fix, TerrainContourLines used the colormap t-value (normalised over
 * the absolute 0–609.6 m ocean domain) for worldY, causing shallow datasets to
 * have all contours squeezed near Y=0 while the terrain mesh stretched to
 * -MAX_DEPTH_WORLD.  The fix introduces a separate tPos computed from the grid's
 * own minDepth/maxDepth, matching buildTerrainGeometry.
 */

import { describe, it, expect } from "vitest";
import { MAX_DEPTH_WORLD } from "../lib/terrain";
import { getColormapDepthDomain, OCEAN_MAX_DEPTH_M } from "../lib/colormap";

// LINE_Y_OFFSET from TerrainContourLines.tsx (kept in sync manually — if this
// test starts failing because the constant changed, update it here too).
const LINE_Y_OFFSET = 0.08;

/**
 * Mirror of the fixed Y-position formula in TerrainContourLines.tsx.
 * tPos uses the grid's own depth range; t01 is for color only (not used here).
 */
function contourWorldY(
  depth: number,
  minDepth: number,
  maxDepth: number,
): number {
  const gridDepthRange = (maxDepth - minDepth) || 1;
  const tPos = Math.max(0, Math.min(1, (depth - minDepth) / gridDepthRange));
  return -tPos * MAX_DEPTH_WORLD + LINE_Y_OFFSET;
}

describe("TerrainContourLines Y-position formula", () => {
  describe("grid-relative tPos (the fix)", () => {
    it("shallow dataset (minDepth=10, maxDepth=60): shallowest contour near Y=0", () => {
      const worldY = contourWorldY(10, 10, 60);
      // tPos = (10-10)/(60-10) = 0 → worldY = 0 + LINE_Y_OFFSET
      expect(worldY).toBeCloseTo(LINE_Y_OFFSET, 5);
    });

    it("shallow dataset (minDepth=10, maxDepth=60): deepest contour near Y=-MAX_DEPTH_WORLD", () => {
      const worldY = contourWorldY(60, 10, 60);
      // tPos = (60-10)/(60-10) = 1 → worldY = -MAX_DEPTH_WORLD + LINE_Y_OFFSET
      expect(worldY).toBeCloseTo(-MAX_DEPTH_WORLD + LINE_Y_OFFSET, 5);
    });

    it("mid-depth contour interpolates linearly", () => {
      const worldY = contourWorldY(35, 10, 60);
      // tPos = (35-10)/(60-10) = 0.5 → worldY = -0.5 * MAX_DEPTH_WORLD + LINE_Y_OFFSET
      expect(worldY).toBeCloseTo(-0.5 * MAX_DEPTH_WORLD + LINE_Y_OFFSET, 5);
    });
  });

  describe("ocean theme absolute domain must NOT affect Y position", () => {
    it("ocean domain is much wider than a shallow dataset", () => {
      // If (incorrectly) using the colormap t01 for Y, a depth of 10 m on
      // the ocean's 609.6 m scale would give t01 ≈ 0.016, worldY ≈ -0.82,
      // while the correct grid-relative tPos gives worldY = LINE_Y_OFFSET.
      const minDepth = 10;
      const maxDepth = 60;
      const depth = 10; // shallowest contour

      const domain = getColormapDepthDomain("ocean", minDepth, maxDepth);
      expect(domain.max).toBeCloseTo(OCEAN_MAX_DEPTH_M, 1); // confirm absolute domain
      const domainRange = (domain.max - domain.min) || 1;
      const t01 = Math.max(0, Math.min(1, (depth - domain.min) / domainRange));

      // old (broken) worldY using colormap t01
      const brokenWorldY = -t01 * MAX_DEPTH_WORLD + LINE_Y_OFFSET;
      // new (fixed) worldY using grid-relative tPos
      const fixedWorldY = contourWorldY(depth, minDepth, maxDepth);

      // The broken formula should be squeezed near the top (close to LINE_Y_OFFSET
      // but via t01 ≈ 0.016, not tPos=0) — still close, but at maxDepth the
      // divergence is dramatic.
      const depthMax = 60; // deepest contour
      const t01max = Math.max(0, Math.min(1, (depthMax - domain.min) / domainRange));
      const brokenWorstY = -t01max * MAX_DEPTH_WORLD + LINE_Y_OFFSET;
      const fixedWorstY = contourWorldY(depthMax, minDepth, maxDepth);

      // Fixed deepest contour should be at -MAX_DEPTH_WORLD + LINE_Y_OFFSET.
      expect(fixedWorstY).toBeCloseTo(-MAX_DEPTH_WORLD + LINE_Y_OFFSET, 5);

      // Broken deepest contour is much shallower (t01max ≈ 0.098).
      // The error is large — at least 40 world units for this dataset.
      expect(Math.abs(fixedWorstY - brokenWorstY)).toBeGreaterThan(40);

      void brokenWorldY; void fixedWorldY; // used for documentation
    });
  });

  describe("edge cases", () => {
    it("flat-bottom grid (minDepth === maxDepth) does not produce NaN or Infinity", () => {
      const worldY = contourWorldY(20, 20, 20);
      expect(Number.isFinite(worldY)).toBe(true);
      // gridDepthRange falls back to 1; tPos = (20-20)/1 = 0 → LINE_Y_OFFSET
      expect(worldY).toBeCloseTo(LINE_Y_OFFSET, 5);
    });

    it("depth below minDepth clamps tPos to 0", () => {
      const worldY = contourWorldY(5, 10, 60);
      expect(worldY).toBeCloseTo(LINE_Y_OFFSET, 5);
    });

    it("depth above maxDepth clamps tPos to 1", () => {
      const worldY = contourWorldY(100, 10, 60);
      expect(worldY).toBeCloseTo(-MAX_DEPTH_WORLD + LINE_Y_OFFSET, 5);
    });

    it("standard deep dataset (minDepth=0, maxDepth=1000) still works correctly", () => {
      expect(contourWorldY(0, 0, 1000)).toBeCloseTo(LINE_Y_OFFSET, 5);
      expect(contourWorldY(1000, 0, 1000)).toBeCloseTo(-MAX_DEPTH_WORLD + LINE_Y_OFFSET, 5);
      expect(contourWorldY(500, 0, 1000)).toBeCloseTo(-MAX_DEPTH_WORLD / 2 + LINE_Y_OFFSET, 5);
    });
  });
});
