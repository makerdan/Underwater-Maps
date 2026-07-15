import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { bakeWaterTempTexture } from "@/hooks/useWaterTempTexture";

describe("bakeWaterTempTexture", () => {
  it("returns null for null samples", () => {
    expect(bakeWaterTempTexture(null)).toBeNull();
  });

  it("returns null for undefined samples", () => {
    expect(bakeWaterTempTexture(undefined)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(bakeWaterTempTexture([])).toBeNull();
  });

  it("returns null for a single-sample array (too short)", () => {
    expect(bakeWaterTempTexture([{ depthM: 0, celsius: 15 }])).toBeNull();
  });

  it("returns a DataTexture for a valid profile with N≥2 samples", () => {
    const samples = [
      { depthM: 0, celsius: 18 },
      { depthM: 50, celsius: 10 },
      { depthM: 200, celsius: 4 },
    ];
    const tex = bakeWaterTempTexture(samples);
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    tex!.dispose();
  });

  it("produces a texture with width=1 and height=N", () => {
    const samples = [
      { depthM: 0, celsius: 20 },
      { depthM: 100, celsius: 5 },
    ];
    const tex = bakeWaterTempTexture(samples)!;
    expect(tex.image.width).toBe(1);
    expect(tex.image.height).toBe(2);
    tex.dispose();
  });

  it("has RGBA format and UnsignedByte type", () => {
    const samples = [
      { depthM: 0, celsius: 20 },
      { depthM: 100, celsius: 5 },
    ];
    const tex = bakeWaterTempTexture(samples)!;
    expect(tex.format).toBe(THREE.RGBAFormat);
    expect(tex.type).toBe(THREE.UnsignedByteType);
    tex.dispose();
  });

  it("row 0 (surface/warm) has a warmer colour than the last row (deep/cold)", () => {
    const samples = [
      { depthM: 0,   celsius: 20 },
      { depthM: 50,  celsius: 10 },
      { depthM: 200, celsius: 3 },
    ];
    const tex = bakeWaterTempTexture(samples)!;
    const data = tex.image.data as Uint8Array;
    const row0R = data[0]!;
    const lastR = data[(samples.length - 1) * 4]!;
    // Surface (warm) row should have higher red than deep (cold) row
    expect(row0R).toBeGreaterThan(lastR);
    tex.dispose();
  });

  it("increments the texture version when needsUpdate is set (upload flag)", () => {
    const samples = [
      { depthM: 0, celsius: 20 },
      { depthM: 100, celsius: 5 },
    ];
    const tex = bakeWaterTempTexture(samples)!;
    // In THREE.js, setting needsUpdate=true increments .version (write-only setter).
    // version starts at 0; after bakeWaterTempTexture sets needsUpdate it becomes 1.
    expect(tex.version).toBeGreaterThan(0);
    tex.dispose();
  });

  it("handles a large profile (24 samples) without error", () => {
    const samples = Array.from({ length: 25 }, (_, i) => ({
      depthM: i * 10,
      celsius: 20 - i * 0.6,
    }));
    const tex = bakeWaterTempTexture(samples)!;
    expect(tex.image.height).toBe(25);
    tex.dispose();
  });
});
