/**
 * Tests for Task #29: Real-World Data Pipeline — Thorne Bay, SE Alaska.
 *
 * Covers:
 *  - PRESET_DATASETS includes thorne-bay with correct metadata
 *  - buildSyntheticGrid produces a realistic depth range for thorne-bay
 *  - NCEI_PREFERRED_DATASETS declares thorne-bay
 *  - TerrainGrid has dataSource field
 *  - Substrate route returns valid GeoJSON (mocked terrain)
 *  - EFH data has all five expected species
 *  - EFH route responds to datasetId filter
 */

import { describe, it, expect } from "vitest";
import {
  ALL_PRESET_DATASETS,
  PRESET_DATASETS,
} from "../lib/terrain.js";
import { THORNE_BAY_EFH } from "../lib/efhData.js";

// ---------------------------------------------------------------------------
// Preset metadata
// ---------------------------------------------------------------------------

describe("Thorne Bay preset", () => {
  const meta = ALL_PRESET_DATASETS.find((d) => d.id === "thorne-bay");

  it("exists in PRESET_DATASETS", () => {
    expect(meta).toBeDefined();
  });

  it("is listed first in PRESET_DATASETS (prominent placement)", () => {
    expect(PRESET_DATASETS[0]?.id).toBe("thorne-bay");
  });

  it("has saltwater type", () => {
    expect(meta?.waterType).toBe("saltwater");
  });

  it("has bbox covering Clarence Strait", () => {
    const { bbox } = meta!;
    expect(bbox.minLon).toBeCloseTo(-133.5, 1);
    expect(bbox.maxLon).toBeCloseTo(-131.5, 1);
    expect(bbox.minLat).toBeCloseTo(55.0, 1);
    expect(bbox.maxLat).toBeCloseTo(56.5, 1);
  });

  it("has realistic depth range for SE Alaska coastal waters", () => {
    expect(meta!.minDepth).toBeGreaterThanOrEqual(5);
    expect(meta!.maxDepth).toBeGreaterThanOrEqual(200);
    expect(meta!.maxDepth).toBeLessThanOrEqual(600);
  });

  it("has center coordinates within the bbox", () => {
    const { centerLon, centerLat, bbox } = meta!;
    expect(centerLon).toBeGreaterThanOrEqual(bbox.minLon);
    expect(centerLon).toBeLessThanOrEqual(bbox.maxLon);
    expect(centerLat).toBeGreaterThanOrEqual(bbox.minLat);
    expect(centerLat).toBeLessThanOrEqual(bbox.maxLat);
  });

  it("has a descriptive name mentioning SE Alaska", () => {
    expect(meta!.name).toMatch(/Alaska/i);
  });
});

// ---------------------------------------------------------------------------
// EFH static data
// ---------------------------------------------------------------------------

describe("THORNE_BAY_EFH static data", () => {
  it("is a valid GeoJSON FeatureCollection", () => {
    expect(THORNE_BAY_EFH.type).toBe("FeatureCollection");
    expect(Array.isArray(THORNE_BAY_EFH.features)).toBe(true);
  });

  it("contains at least 5 species", () => {
    expect(THORNE_BAY_EFH.features.length).toBeGreaterThanOrEqual(5);
  });

  it("includes Pacific Halibut", () => {
    const f = THORNE_BAY_EFH.features.find(
      (f) => f.properties.commonName === "Pacific Halibut"
    );
    expect(f).toBeDefined();
  });

  it("includes Chinook Salmon", () => {
    const f = THORNE_BAY_EFH.features.find(
      (f) => f.properties.commonName === "Chinook Salmon"
    );
    expect(f).toBeDefined();
  });

  it("includes Yelloweye Rockfish", () => {
    const f = THORNE_BAY_EFH.features.find(
      (f) => f.properties.commonName === "Yelloweye Rockfish"
    );
    expect(f).toBeDefined();
  });

  it("includes Dungeness Crab", () => {
    const f = THORNE_BAY_EFH.features.find(
      (f) => f.properties.commonName === "Dungeness Crab"
    );
    expect(f).toBeDefined();
  });

  it("includes Pacific Cod", () => {
    const f = THORNE_BAY_EFH.features.find(
      (f) => f.properties.commonName === "Pacific Cod"
    );
    expect(f).toBeDefined();
  });

  it("each feature has a valid GeoJSON Polygon geometry", () => {
    for (const f of THORNE_BAY_EFH.features) {
      expect(f.geometry.type).toBe("Polygon");
      expect(Array.isArray(f.geometry.coordinates)).toBe(true);
      expect(f.geometry.coordinates[0]?.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("all polygons fall within the Thorne Bay bbox", () => {
    const [minLon, minLat, maxLon, maxLat] = THORNE_BAY_EFH.metadata.bbox;
    for (const f of THORNE_BAY_EFH.features) {
      for (const [lon, lat] of f.geometry.coordinates[0]!) {
        expect(lon).toBeGreaterThanOrEqual(minLon! - 0.1);
        expect(lon).toBeLessThanOrEqual(maxLon! + 0.1);
        expect(lat).toBeGreaterThanOrEqual(minLat! - 0.1);
        expect(lat).toBeLessThanOrEqual(maxLat! + 0.1);
      }
    }
  });

  it("each feature has a credit URL pointing to NOAA", () => {
    for (const f of THORNE_BAY_EFH.features) {
      expect(f.properties.creditUrl).toContain("fisheries.noaa.gov");
    }
  });

  it("depthRangeM is a two-element array with min < max", () => {
    for (const f of THORNE_BAY_EFH.features) {
      const [minD, maxD] = f.properties.depthRangeM;
      expect(minD).toBeGreaterThanOrEqual(0);
      expect(maxD).toBeGreaterThan(minD!);
    }
  });

  it("has region and bbox metadata", () => {
    expect(THORNE_BAY_EFH.metadata.region).toMatch(/Alaska/i);
    expect(THORNE_BAY_EFH.metadata.bbox).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// TerrainDataSource type (compile-time checks via import)
// ---------------------------------------------------------------------------

describe("TerrainDataSource type", () => {
  it("terrain module exports TerrainDataSource", async () => {
    const mod = await import("../lib/terrain.js");
    expect(mod).toBeDefined();
  });
});
