/**
 * Unit tests for efhFetcher.ts — expandFeature() normalisation logic.
 *
 * Fixture shapes are derived from a confirmed live query to the NOAA
 * GulfOfAlaska ArcGIS FeatureServer (org C8EMgrsFcRFL6LrL) on 2026-05-26:
 *
 *   GET https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/
 *         GulfOfAlaska/FeatureServer/56/query
 *         ?where=1=1&outFields=EFH_NAME,Link&returnGeometry=true
 *         &resultOffset=0&resultRecordCount=1&f=geojson
 *
 * Confirmed attribute names present in feature.properties:
 *   - EFH_NAME  — e.g. "GOA_adult_Halibut_summer_EFHmap"
 *   - Link      — PDF URL on alaskafisheries.noaa.gov
 *
 * Species identity (commonName, fmp, depthRangeM, etc.) is NOT in the
 * feature properties — it is injected from the GOA_LAYER_SPECS table via
 * the LayerSpec argument passed to expandFeature().
 *
 * Geometry type on layer 56 (Pacific Halibut Adults, Summer): MultiPolygon.
 * The expandFeature() function expands each polygon part into a separate
 * EfhFeature so the full official EFH footprint is preserved.
 */

import { describe, it, expect } from "vitest";
import { expandFeature } from "../efhFetcher.js";

// ---------------------------------------------------------------------------
// Minimal LayerSpec fixture matching layer 56 (Pacific Halibut Adults Summer)
// ---------------------------------------------------------------------------
const HALIBUT_SPEC = {
  layerId: 56,
  species: "hippoglossus_stenolepis",
  commonName: "Pacific Halibut",
  fmp: "Pacific Halibut (IPHC)",
  depthRangeM: [20, 500] as [number, number],
  color: "#f59e0b",
  lifeStage: "Adults",
  season: "Summer",
};

// Minimal polygon ring — a small triangle in SE Alaska waters
const RING_A: number[][] = [
  [-135.849, 57.292],
  [-135.867, 57.287],
  [-135.850, 57.285],
  [-135.849, 57.292],
];
const RING_B: number[][] = [
  [-134.934, 56.114],
  [-134.917, 56.108],
  [-134.917, 56.119],
  [-134.934, 56.114],
];

// ---------------------------------------------------------------------------
// Confirmed attribute names from the live NOAA response
// ---------------------------------------------------------------------------

describe("expandFeature — confirmed NOAA attribute names", () => {
  it("reads EFH_NAME from properties (confirmed field name from live response)", () => {
    const raw = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [RING_A] },
      properties: {
        EFH_NAME: "GOA_adult_Halibut_summer_EFHmap",
        Link: "https://alaskafisheries.noaa.gov/sites/default/files/2015efh_5yearreview.pdf",
      },
    };
    const out = expandFeature(raw, HALIBUT_SPEC);
    expect(out).toHaveLength(1);
    // EFH_NAME is used as the habitat name in the description
    expect(out[0]!.properties.habitatDescription).toContain(
      "GOA_adult_Halibut_summer_EFHmap",
    );
  });

  it("falls back to '<CommonName> EFH' when EFH_NAME is absent", () => {
    const raw = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [RING_A] },
      properties: { Link: "https://alaskafisheries.noaa.gov/2015efh.pdf" },
    };
    const out = expandFeature(raw, HALIBUT_SPEC);
    expect(out).toHaveLength(1);
    expect(out[0]!.properties.habitatDescription).toContain("Pacific Halibut EFH");
  });
});

// ---------------------------------------------------------------------------
// Polygon geometry — single part
// ---------------------------------------------------------------------------

describe("expandFeature — Polygon geometry", () => {
  it("returns one EfhFeature for a Polygon geometry", () => {
    const raw = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [RING_A] },
      properties: { EFH_NAME: "test_polygon" },
    };
    const out = expandFeature(raw, HALIBUT_SPEC);
    expect(out).toHaveLength(1);
    expect(out[0]!.geometry.type).toBe("Polygon");
    expect(out[0]!.geometry.coordinates).toEqual([RING_A]);
  });

  it("injects species metadata from LayerSpec (not from feature properties)", () => {
    const raw = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [RING_A] },
      properties: { EFH_NAME: "GOA_adult_Halibut_summer_EFHmap" },
    };
    const feat = expandFeature(raw, HALIBUT_SPEC)[0]!;
    expect(feat.properties.species).toBe("hippoglossus_stenolepis");
    expect(feat.properties.commonName).toBe("Pacific Halibut");
    expect(feat.properties.fmp).toBe("Pacific Halibut (IPHC)");
    expect(feat.properties.depthRangeM).toEqual([20, 500]);
    expect(feat.properties.lifeStage).toBe("Adults");
    expect(feat.properties.season).toBe("Summer");
    expect(feat.properties.color).toBe("#f59e0b");
  });

  it("always sets source to the confirmed NOAA FeatureServer attribution string", () => {
    const raw = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [RING_A] },
      properties: {},
    };
    const feat = expandFeature(raw, HALIBUT_SPEC)[0]!;
    expect(feat.properties.source).toMatch(/NOAA Fisheries/);
    expect(feat.properties.source).toMatch(/GulfOfAlaska FeatureServer/);
  });
});

// ---------------------------------------------------------------------------
// MultiPolygon geometry — per-part expansion
// ---------------------------------------------------------------------------

describe("expandFeature — MultiPolygon expansion (confirmed geometry type on layer 56)", () => {
  it("expands a MultiPolygon with 2 parts into 2 separate EfhFeatures", () => {
    const raw = {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [[RING_A], [RING_B]],
      },
      properties: { EFH_NAME: "GOA_adult_Halibut_summer_EFHmap" },
    };
    const out = expandFeature(raw, HALIBUT_SPEC);
    expect(out).toHaveLength(2);
    expect(out[0]!.geometry.type).toBe("Polygon");
    expect(out[0]!.geometry.coordinates).toEqual([RING_A]);
    expect(out[1]!.geometry.type).toBe("Polygon");
    expect(out[1]!.geometry.coordinates).toEqual([RING_B]);
  });

  it("all expanded parts share the same injected species metadata", () => {
    const raw = {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [[RING_A], [RING_B]],
      },
      properties: { EFH_NAME: "GOA_adult_Halibut_summer_EFHmap" },
    };
    const out = expandFeature(raw, HALIBUT_SPEC);
    for (const feat of out) {
      expect(feat.properties.commonName).toBe("Pacific Halibut");
      expect(feat.properties.species).toBe("hippoglossus_stenolepis");
    }
  });

  it("skips empty polygon parts within a MultiPolygon without throwing", () => {
    const raw = {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [[RING_A], [], [RING_B]],
      },
      properties: {},
    };
    const out = expandFeature(raw, HALIBUT_SPEC);
    // Empty part (index 1) is skipped; only RING_A and RING_B are yielded
    expect(out).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("expandFeature — edge cases", () => {
  it("returns [] for null geometry", () => {
    const raw = { type: "Feature", geometry: null, properties: {} };
    expect(expandFeature(raw as never, HALIBUT_SPEC)).toEqual([]);
  });

  it("returns [] for an unrecognised geometry type (e.g. Point)", () => {
    const raw = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-135.5, 57.1] },
      properties: { EFH_NAME: "ignored" },
    };
    expect(expandFeature(raw as never, HALIBUT_SPEC)).toEqual([]);
  });
});
