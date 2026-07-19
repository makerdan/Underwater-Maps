import { describe, it, expect } from "vitest";
import { TERRAIN_CACHE_VERSION } from "../terrain";

/**
 * Regression guard: TERRAIN_CACHE_VERSION must never be reverted below 9.
 *
 * Version 9 was introduced when smoothSpikes was applied in the LRR build
 * script so the shoreline 0→deep transitions no longer produce vertical dark
 * spike geometry.  A revert would cause previously-cached (unsmoothed) LRR
 * bundles to be served again.
 */
describe("TERRAIN_CACHE_VERSION", () => {
  it("is at least 9 (guards against accidental revert of smoothed LRR bundle)", () => {
    expect(TERRAIN_CACHE_VERSION).toBeGreaterThanOrEqual(9);
  });
});
