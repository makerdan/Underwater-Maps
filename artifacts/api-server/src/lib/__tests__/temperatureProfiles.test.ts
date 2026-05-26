import { describe, it, expect } from "vitest";
import {
  bundledCasts,
  findBundledTemperatureProfile,
} from "../temperatureProfiles";

describe("findBundledTemperatureProfile", () => {
  it("seeds the registry with at least one real cast per SE Alaska preset", () => {
    expect(bundledCasts.length).toBeGreaterThanOrEqual(5);
    for (const cast of bundledCasts) {
      expect(cast.samples.length).toBeGreaterThanOrEqual(5);
      // Monotonic depths
      for (let i = 1; i < cast.samples.length; i++) {
        expect(cast.samples[i]!.depthM).toBeGreaterThan(cast.samples[i - 1]!.depthM);
      }
      // Plausible ocean temperatures (-2..30 °C)
      for (const s of cast.samples) {
        expect(s.temperatureC).toBeGreaterThan(-2);
        expect(s.temperatureC).toBeLessThan(30);
      }
      expect(cast.source).toMatch(/WOA/i);
      expect(cast.provider).toBe("bundled-woa");
    }
  });

  it("returns the dataset-matched cast verbatim when datasetId is provided", () => {
    const profile = findBundledTemperatureProfile(0, 0, "thorne-bay");
    expect(profile).not.toBeNull();
    expect(profile!.source).toMatch(/Thorne Bay/);
    expect(profile!.samples[0]!.depthM).toBe(0);
  });

  it("falls back to nearest-by-distance when datasetId does not match", () => {
    // Right on top of the Sitka Sound cast, with an unknown datasetId.
    const profile = findBundledTemperatureProfile(57.05, -135.45, "unknown-id");
    expect(profile).not.toBeNull();
    expect(profile!.source).toMatch(/Sitka/);
  });

  it("returns null when nothing is within the match radius", () => {
    // Mid-Pacific — nowhere near any SE Alaska cast.
    expect(findBundledTemperatureProfile(0, -160, null)).toBeNull();
  });

  it("picks the closer of two nearby casts", () => {
    // Halfway between Juneau (58.30, -134.40) and Glacier Bay (58.65, -136.05)
    // but skewed toward Juneau.
    const profile = findBundledTemperatureProfile(58.35, -134.6, null);
    expect(profile).not.toBeNull();
    expect(profile!.source).toMatch(/Juneau/);
  });
});
