import { describe, it, expect } from "vitest";
import {
  sampleTemperatureProfile,
  estimateWaterTemperature,
  resolveTemperatureProfile,
  type SurfaceAnchor,
} from "@/lib/waterTemp";

const LIVE_ANCHOR: SurfaceAnchor = {
  sstCelsius: 14.5,
  source: "Open-Meteo Marine API",
  sourceUrl: "https://open-meteo.com",
  timestamp: "2026-05-25T12:00:00.000Z",
};

describe("sampleTemperatureProfile", () => {
  it("returns a monotonic curve from surface SST toward the deep asymptote", () => {
    const profile = sampleTemperatureProfile(300, LIVE_ANCHOR, 12);
    expect(profile.samples).toHaveLength(13);
    expect(profile.samples[0]!.depthM).toBe(0);
    expect(profile.samples[0]!.celsius).toBeCloseTo(14.5, 5);
    // Strictly cooling with depth (surface anchor warmer than deep asymptote)
    for (let i = 1; i < profile.samples.length; i++) {
      expect(profile.samples[i]!.celsius).toBeLessThan(profile.samples[i - 1]!.celsius);
    }
    // Deep value approaches the deepC asymptote
    const deepest = profile.samples[profile.samples.length - 1]!;
    expect(deepest.depthM).toBe(300);
    expect(deepest.celsius).toBeGreaterThan(profile.deepC);
    expect(deepest.celsius - profile.deepC).toBeLessThan(0.5);
  });

  it("matches estimateWaterTemperature at the same depths (single anchor)", () => {
    const profile = sampleTemperatureProfile(200, LIVE_ANCHOR, 8);
    for (const s of profile.samples) {
      const expected = estimateWaterTemperature(s.depthM, LIVE_ANCHOR).celsius!;
      expect(s.celsius).toBeCloseTo(expected, 6);
    }
  });

  it("marks the profile as live with attribution when an SST anchor is present", () => {
    const profile = sampleTemperatureProfile(200, LIVE_ANCHOR);
    expect(profile.live).toBe(true);
    expect(profile.source).toMatch(/Open-Meteo/);
    expect(profile.sourceUrl).toBe("https://open-meteo.com");
    expect(profile.timestamp).toBe("2026-05-25T12:00:00.000Z");
  });

  it("falls back to the estimated thermocline when no live anchor is available", () => {
    const profile = sampleTemperatureProfile(150, null);
    expect(profile.live).toBe(false);
    expect(profile.source).toMatch(/[Ee]stimated/);
    expect(profile.sourceUrl).toBeNull();
    expect(profile.timestamp).toBeNull();
    // Surface anchor uses the 15 °C fallback
    expect(profile.samples[0]!.celsius).toBeCloseTo(15, 5);
  });

  it("clamps absurd or non-finite maxDepth inputs", () => {
    expect(sampleTemperatureProfile(5, LIVE_ANCHOR).maxDepthM).toBe(20);
    expect(sampleTemperatureProfile(99999, LIVE_ANCHOR).maxDepthM).toBe(2000);
    expect(sampleTemperatureProfile(NaN, LIVE_ANCHOR).maxDepthM).toBe(200);
    expect(sampleTemperatureProfile(null, LIVE_ANCHOR).maxDepthM).toBe(200);
  });
});

describe("resolveTemperatureProfile", () => {
  it("returns measured samples verbatim when the server has a real cast", () => {
    const real = {
      available: true,
      samples: [
        { depthM: 0, temperatureC: 9.2 },
        { depthM: 50, temperatureC: 6.8 },
        { depthM: 200, temperatureC: 4.1 },
      ],
      source: "NOAA WOA 2023 climatology",
      sourceUrl: "https://www.ncei.noaa.gov/products/world-ocean-atlas",
      timestamp: "2026-05-01T00:00:00.000Z",
      provider: "woa",
    };
    const resolved = resolveTemperatureProfile(real, LIVE_ANCHOR, 300);
    expect(resolved.measured).toBe(true);
    expect(resolved.profile.samples).toEqual([
      { depthM: 0, celsius: 9.2 },
      { depthM: 50, celsius: 6.8 },
      { depthM: 200, celsius: 4.1 },
    ]);
    expect(resolved.profile.surfaceC).toBe(9.2);
    expect(resolved.profile.deepC).toBe(4.1);
    expect(resolved.profile.maxDepthM).toBe(200);
    expect(resolved.profile.source).toMatch(/WOA/);
    expect(resolved.profile.sourceUrl).toContain("ncei.noaa.gov");
    expect(resolved.profile.timestamp).toBe("2026-05-01T00:00:00.000Z");
    expect(resolved.profile.live).toBe(true);
  });

  it("sorts unordered measured samples shallow→deep", () => {
    const real = {
      available: true,
      samples: [
        { depthM: 100, temperatureC: 5 },
        { depthM: 0, temperatureC: 12 },
        { depthM: 50, temperatureC: 8 },
      ],
    };
    const resolved = resolveTemperatureProfile(real, null, 200);
    expect(resolved.measured).toBe(true);
    expect(resolved.profile.samples.map((s) => s.depthM)).toEqual([0, 50, 100]);
  });

  it("falls back to the modeled profile when no real samples are available", () => {
    const resolved = resolveTemperatureProfile(
      { available: false, samples: [] },
      LIVE_ANCHOR,
      150,
    );
    expect(resolved.measured).toBe(false);
    // Curve starts at the live SST anchor — matches estimateWaterTemperature
    expect(resolved.profile.samples[0]!.celsius).toBeCloseTo(14.5, 5);
  });

  it("falls back when the upstream payload is null or malformed", () => {
    expect(resolveTemperatureProfile(null, LIVE_ANCHOR, 100).measured).toBe(false);
    expect(
      resolveTemperatureProfile(
        // Single sample is not enough to draw a line — fall back.
        { available: true, samples: [{ depthM: 0, temperatureC: 10 }] },
        LIVE_ANCHOR,
        100,
      ).measured,
    ).toBe(false);
    expect(
      resolveTemperatureProfile(
        {
          available: true,
          samples: [
            { depthM: 0, temperatureC: Number.NaN },
            { depthM: 50, temperatureC: 6 },
          ],
        },
        LIVE_ANCHOR,
        100,
      ).measured,
    ).toBe(false);
  });
});
