import { describe, it, expect } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import {
  BOAT_DEFAULT_MPH,
  BOAT_MAX_MPH,
  BOAT_MIN_MPH,
  boatMphToWorldUnitsPerSecond,
  computeMetersPerWorldUnit,
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
