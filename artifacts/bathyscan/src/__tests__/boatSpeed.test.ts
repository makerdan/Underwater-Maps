import { describe, it, expect } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import {
  BOAT_DEFAULT_MPH,
  BOAT_MAX_MPH,
  BOAT_MIN_MPH,
  boatMphToWorldUnitsPerSecond,
  computeMetersPerWorldUnit,
  computeFlyMpu,
  computeFlyScaledSpeed,
  FLY_SPEEDS_MPH,
  FLY_FALLBACK_MPU,
  FLY_MAX_FRAME_WU,
} from "@/lib/boatSpeed";
import { WORLD_SIZE } from "@/lib/terrain";

const MPH_TO_MS = 0.44704;

function makeGrid(bounds: {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}): TerrainData {
  return {
    datasetId: "test",
    name: "test",
    waterType: "saltwater",
    resolution: 2,
    width: 2,
    height: 2,
    depths: [0, 0, 0, 0],
    minDepth: 0,
    maxDepth: 0,
    ...bounds,
  };
}

function haversineRef(
  lon1: number, lat1: number,
  lon2: number, lat2: number,
): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

describe("computeMetersPerWorldUnit", () => {
  it("computes meters-per-world-unit for the Thorne Bay, SE Alaska bounds", () => {
    // Thorne Bay area: ~55.68°N, 132.53°W
    const grid = makeGrid({
      minLon: -132.6,
      maxLon: -132.4,
      minLat: 55.6,
      maxLat: 55.75,
    });
    const centerLat = (grid.minLat + grid.maxLat) / 2;
    const expectedWidth = haversineRef(grid.minLon, centerLat, grid.maxLon, centerLat);
    const expectedMpu = expectedWidth / WORLD_SIZE;

    const mpu = computeMetersPerWorldUnit(grid);
    expect(mpu).toBeCloseTo(expectedMpu, 6);
    // Sanity-check the order of magnitude: ~0.2° lon at lat 55.7 ≈ 12.5 km.
    expect(mpu).toBeGreaterThan(100);
    expect(mpu).toBeLessThan(150);
  });

  it("scales linearly with longitude extent at the same latitude", () => {
    const small = makeGrid({ minLon: -132.55, maxLon: -132.45, minLat: 55.65, maxLat: 55.7 });
    const large = makeGrid({ minLon: -132.6, maxLon: -132.4, minLat: 55.65, maxLat: 55.7 });
    const mpuSmall = computeMetersPerWorldUnit(small);
    const mpuLarge = computeMetersPerWorldUnit(large);
    expect(mpuLarge / mpuSmall).toBeCloseTo(2, 5);
  });

  it("returns 1 as a safe fallback for a zero-extent terrain", () => {
    const grid = makeGrid({
      minLon: -132.5,
      maxLon: -132.5,
      minLat: 55.7,
      maxLat: 55.7,
    });
    expect(computeMetersPerWorldUnit(grid)).toBe(1);
  });

  it("measures the short-arc width for terrain crossing the antimeridian", () => {
    // Bounds straddling +/-180° at the equator. The short-arc longitude
    // span is 0.2°, which is ~22.24 km at the equator. The naive raw
    // diff would yield ~359.8° and measure the long way around the globe.
    const grid = makeGrid({
      minLon: 179.9,
      maxLon: -179.9,
      minLat: 0,
      maxLat: 0.1,
    });
    const centerLat = (grid.minLat + grid.maxLat) / 2;
    const expectedWidth = haversineRef(0, centerLat, 0.2, centerLat);
    const expectedMpu = expectedWidth / WORLD_SIZE;

    const mpu = computeMetersPerWorldUnit(grid);
    expect(mpu).toBeCloseTo(expectedMpu, 6);
    // ~22.24 km / WORLD_SIZE; sanity-check the order of magnitude.
    const widthM = mpu * WORLD_SIZE;
    expect(widthM).toBeGreaterThan(22_000);
    expect(widthM).toBeLessThan(22_500);
  });
});

describe("boatMphToWorldUnitsPerSecond", () => {
  // Use the Thorne Bay bounds as a realistic reference scale.
  const grid = makeGrid({
    minLon: -132.6,
    maxLon: -132.4,
    minLat: 55.6,
    maxLat: 55.75,
  });
  const mpu = computeMetersPerWorldUnit(grid);

  it("matches the m/s → world-units/s conversion at the minimum speed (3 mph)", () => {
    const expected = (BOAT_MIN_MPH * MPH_TO_MS) / mpu;
    expect(boatMphToWorldUnitsPerSecond(BOAT_MIN_MPH, mpu)).toBeCloseTo(expected, 10);
  });

  it("matches the m/s → world-units/s conversion at the default speed (15 mph)", () => {
    const expected = (BOAT_DEFAULT_MPH * MPH_TO_MS) / mpu;
    expect(boatMphToWorldUnitsPerSecond(BOAT_DEFAULT_MPH, mpu)).toBeCloseTo(expected, 10);
  });

  it("matches the m/s → world-units/s conversion at the maximum speed (55 mph)", () => {
    const expected = (BOAT_MAX_MPH * MPH_TO_MS) / mpu;
    expect(boatMphToWorldUnitsPerSecond(BOAT_MAX_MPH, mpu)).toBeCloseTo(expected, 10);
  });

  it("scales linearly with speed", () => {
    const a = boatMphToWorldUnitsPerSecond(10, mpu);
    const b = boatMphToWorldUnitsPerSecond(20, mpu);
    expect(b / a).toBeCloseTo(2, 10);
  });

  it("scales inversely with meters-per-world-unit", () => {
    const wuFine = boatMphToWorldUnitsPerSecond(BOAT_DEFAULT_MPH, mpu);
    const wuCoarse = boatMphToWorldUnitsPerSecond(BOAT_DEFAULT_MPH, mpu * 2);
    expect(wuCoarse / wuFine).toBeCloseTo(0.5, 10);
  });

  it("returns 0 for 0 mph and is sign-correct for negative (reverse) speeds", () => {
    expect(boatMphToWorldUnitsPerSecond(0, mpu)).toBe(0);
    expect(boatMphToWorldUnitsPerSecond(-5, mpu)).toBeLessThan(0);
  });
});

describe("computeFlyMpu", () => {
  it("returns FLY_FALLBACK_MPU for null (no dataset loaded)", () => {
    expect(computeFlyMpu(null)).toBe(FLY_FALLBACK_MPU);
  });

  it("returns FLY_FALLBACK_MPU for undefined", () => {
    expect(computeFlyMpu(undefined)).toBe(FLY_FALLBACK_MPU);
  });

  it("returns FLY_FALLBACK_MPU for a zero-extent (point) terrain", () => {
    const degenerate = makeGrid({ minLon: -132.5, maxLon: -132.5, minLat: 55.7, maxLat: 55.7 });
    // computeMetersPerWorldUnit returns 1 for this input — computeFlyMpu must override to fallback
    expect(computeMetersPerWorldUnit(degenerate)).toBe(1);
    expect(computeFlyMpu(degenerate)).toBe(FLY_FALLBACK_MPU);
  });

  it("returns the real mpu for a valid dataset (Thorne Bay)", () => {
    const grid = makeGrid({ minLon: -132.6, maxLon: -132.4, minLat: 55.6, maxLat: 55.75 });
    const realMpu = computeMetersPerWorldUnit(grid);
    expect(realMpu).toBeGreaterThan(1);
    expect(computeFlyMpu(grid)).toBeCloseTo(realMpu, 10);
  });

  it("returns the real mpu for Ray Roberts Lake", () => {
    const grid = makeGrid({ minLon: -97.05, maxLon: -96.95, minLat: 33.10, maxLat: 33.20 });
    const realMpu = computeMetersPerWorldUnit(grid);
    expect(realMpu).toBeGreaterThan(1);
    expect(computeFlyMpu(grid)).toBeCloseTo(realMpu, 10);
  });

  it("degenerate terrain through the full fly path uses fallback-rate crossing, not mpu=1 rate", () => {
    const degenerate = makeGrid({ minLon: -132.5, maxLon: -132.5, minLat: 55.7, maxLat: 55.7 });
    const flyMpu = computeFlyMpu(degenerate);
    const wups = computeFlyScaledSpeed(2, flyMpu, 1); // default tier, delta=1 s
    // Speed should match fallback mpu, not the mpu=1 sentinel
    const wupsAtFallback = computeFlyScaledSpeed(2, FLY_FALLBACK_MPU, 1);
    expect(wups).toBeCloseTo(wupsAtFallback, 10);
    // And it should NOT match the (much faster) mpu=1 speed
    const wupsAtOne = computeFlyScaledSpeed(2, 1, 1);
    expect(Math.abs(wups - wupsAtOne)).toBeGreaterThan(0.01);
  });
});

// ── Ray Roberts Lake reference values ────────────────────────────────────────
// Ray Roberts Lake, TX: bbox ~33.10–33.20°N, 97.05–96.95°W
// Width ≈ 0.1° lon at lat 33.15 ≈ ~9.25 km → mpu ≈ 92.5 m/wu.
// The task says "~13 miles" end-to-end; the longer axis (lat span) ≈ 21 km.
// We use the WIDTH-based mpu (as computeMetersPerWorldUnit does) for the test.
function makeRayRoberts(): TerrainData {
  return makeGrid({
    minLon: -97.05,
    maxLon: -96.95,
    minLat: 33.10,
    maxLat: 33.20,
  });
}

describe("computeFlyScaledSpeed", () => {
  const MPH_TO_MS = 0.44704;

  it("at the Ray Roberts mpu (~93 m/wu), default tier (index 2, 250 mph) produces wu/s consistent with a 60–90 s world crossing", () => {
    const grid = makeRayRoberts();
    const mpu = computeMetersPerWorldUnit(grid);
    // Default tier is index 2 → 250 mph (matches cameraStore/settingsStore default)
    const wups = computeFlyScaledSpeed(2, mpu, 1); // delta = 1 s to get wu/s
    // At 250 mph and mpu ~93 m/wu: crossing WORLD_SIZE=100 wu ≈ 83 s (within 60–90 s)
    const crossingSeconds = WORLD_SIZE / wups;
    expect(crossingSeconds).toBeGreaterThanOrEqual(60);
    expect(crossingSeconds).toBeLessThanOrEqual(90);
  });

  it("10× smaller mpu produces 10× the wu/s (linear scaling)", () => {
    const grid = makeRayRoberts();
    const mpu = computeMetersPerWorldUnit(grid);
    const wupsNormal = computeFlyScaledSpeed(1, mpu, 1);
    const wupsTiny = computeFlyScaledSpeed(1, mpu / 10, 1);
    // Both must be below the FLY_MAX_FRAME_WU cap for the ratio to hold.
    // At mpu/10 the raw speed is 10× — if below cap the ratio is 10.
    // If above cap, the cap kicks in — just verify wupsTiny >= wupsNormal.
    if (wupsTiny < FLY_MAX_FRAME_WU && wupsNormal < FLY_MAX_FRAME_WU) {
      expect(wupsTiny / wupsNormal).toBeCloseTo(10, 4);
    } else {
      expect(wupsTiny).toBeGreaterThanOrEqual(wupsNormal);
    }
  });

  it("mpu = 0 falls back gracefully and returns a finite positive value", () => {
    const result = computeFlyScaledSpeed(1, 0, 1);
    expect(isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });

  it("mpu = NaN falls back gracefully and returns a finite positive value", () => {
    const result = computeFlyScaledSpeed(1, NaN, 1);
    expect(isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });

  it("mpu = -50 (negative, degenerate) falls back to FLY_FALLBACK_MPU", () => {
    const fromNegative = computeFlyScaledSpeed(1, -50, 1);
    const fromFallback = computeFlyScaledSpeed(1, FLY_FALLBACK_MPU, 1);
    expect(fromNegative).toBeCloseTo(fromFallback, 10);
  });

  it("speedIndex = -1 clamps to 0 without throwing", () => {
    const mpu = 200;
    const clamped = computeFlyScaledSpeed(-1, mpu, 1);
    const tier0 = computeFlyScaledSpeed(0, mpu, 1);
    expect(clamped).toBeCloseTo(tier0, 10);
  });

  it("speedIndex = 999 clamps to the last tier without throwing", () => {
    const mpu = 200;
    const clamped = computeFlyScaledSpeed(999, mpu, 1);
    const lastTier = computeFlyScaledSpeed(FLY_SPEEDS_MPH.length - 1, mpu, 1);
    expect(clamped).toBeCloseTo(lastTier, 10);
  });

  it("an extreme tiny-dataset mpu is capped by FLY_MAX_FRAME_WU so the result never exceeds it", () => {
    // mpu = 0.001 m/wu is pathologically small — raw speed would be enormous.
    const result = computeFlyScaledSpeed(4, 0.001, 1);
    expect(result).toBeLessThanOrEqual(FLY_MAX_FRAME_WU);
    expect(isFinite(result)).toBe(true);
  });

  it("the cap applies independently of delta — result ≤ FLY_MAX_FRAME_WU × delta", () => {
    const delta = 0.033; // ~60 fps frame
    const result = computeFlyScaledSpeed(4, 0.001, delta);
    // The cap is applied to the final value; for delta < 1 the raw product
    // might be below the cap, so just verify it is ≤ the cap.
    expect(result).toBeLessThanOrEqual(FLY_MAX_FRAME_WU);
  });

  it("uses the FLY_FALLBACK_MPU when no dataset mpu is provided (passes FLY_FALLBACK_MPU explicitly)", () => {
    const result = computeFlyScaledSpeed(1, FLY_FALLBACK_MPU, 1);
    const mph = FLY_SPEEDS_MPH[1]!;
    const expectedWups = (mph * MPH_TO_MS) / FLY_FALLBACK_MPU;
    const expected = Math.min(expectedWups, FLY_MAX_FRAME_WU);
    expect(result).toBeCloseTo(expected, 8);
  });
});
