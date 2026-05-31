/**
 * ncei-proxy.test.ts — Unit tests for the NCEI Geoportal normalizer and
 * coverage footprint intersection logic.
 *
 * Drives `normalizeNceiHit` and `computeWcsAvailable` directly so we don't
 * need to spin up an HTTP server or mock the global `fetch`. All edge-cases
 * around bbox shape, wcsAvailable, and metadata link selection are exercised.
 */

import { describe, it, expect } from "vitest";
import { normalizeNceiHit, computeWcsAvailable } from "../routes/ncei.js";

// ---------------------------------------------------------------------------
// Helper to build a minimal geoportal hit
// ---------------------------------------------------------------------------

function makeHit(overrides: {
  _id?: string;
  title?: string;
  abstract?: string;
  bbox?: number[];
  extent_bbox?: number[][];
  links?: Array<{ href: string; rel?: string }>;
}) {
  return {
    _id: overrides._id ?? "gov.noaa.ngdc.mgg.dem:703",
    _source: {
      title: overrides.title,
      abstract: overrides.abstract,
      extent:
        overrides.extent_bbox !== undefined
          ? { spatial: { bbox: overrides.extent_bbox } }
          : undefined,
      bbox: overrides.bbox,
      links: overrides.links,
    },
  };
}

// ---------------------------------------------------------------------------
// computeWcsAvailable — coverage footprint intersection tests
// ---------------------------------------------------------------------------

describe("computeWcsAvailable", () => {
  it("returns true for SE Alaska (BAG Mosaic coverage)", () => {
    expect(computeWcsAvailable({ minLon: -136, minLat: 54, maxLon: -130, maxLat: 60 })).toBe(true);
  });

  it("returns true for Hawaii (BAG Mosaic coverage)", () => {
    expect(computeWcsAvailable({ minLon: -161, minLat: 19, maxLon: -155, maxLat: 23 })).toBe(true);
  });

  it("returns true for US East Coast (BAG Mosaic coverage)", () => {
    expect(computeWcsAvailable({ minLon: -80, minLat: 25, maxLon: -70, maxLat: 35 })).toBe(true);
  });

  it("returns true for North Atlantic (DEM Global Mosaic coverage)", () => {
    expect(computeWcsAvailable({ minLon: -50, minLat: 30, maxLon: -20, maxLat: 50 })).toBe(true);
  });

  it("returns true for Indian Ocean (DEM Global Mosaic coverage)", () => {
    expect(computeWcsAvailable({ minLon: 60, minLat: -10, maxLon: 80, maxLat: 10 })).toBe(true);
  });

  it("returns true for Pacific off Japan (West Pacific / DEM Global coverage)", () => {
    expect(computeWcsAvailable({ minLon: 140, minLat: 30, maxLon: 150, maxLat: 40 })).toBe(true);
  });

  it("returns false for central Central Asia (no ocean coverage)", () => {
    // Kazakhstan steppe — completely landlocked
    expect(computeWcsAvailable({ minLon: 55, minLat: 45, maxLon: 75, maxLat: 55 })).toBe(false);
  });

  it("returns false for inner Mongolia / Gobi Desert (no ocean coverage)", () => {
    expect(computeWcsAvailable({ minLon: 95, minLat: 38, maxLon: 110, maxLat: 48 })).toBe(false);
  });

  it("returns false for Sahara interior (no ocean coverage)", () => {
    expect(computeWcsAvailable({ minLon: 5, minLat: 18, maxLon: 20, maxLat: 30 })).toBe(false);
  });

  it("returns false for Kansas / Great Plains (US inland — no ocean coverage)", () => {
    // lon ~-100 to -94, lat 37-40 — well inland, hundreds of miles from any coast
    expect(computeWcsAvailable({ minLon: -100, minLat: 37, maxLon: -94, maxLat: 40 })).toBe(false);
  });

  it("returns false for Ohio (US inland — east of the East Coast shelf box)", () => {
    // Ohio lon -84 to -80, lat 38-42 — land-locked US interior
    expect(computeWcsAvailable({ minLon: -84, minLat: 38, maxLon: -80, maxLat: 42 })).toBe(false);
  });

  it("returns false for Illinois / Indiana (US inland — no ocean coverage)", () => {
    // Midwest lat 36-42, lon -91 to -87
    expect(computeWcsAvailable({ minLon: -91, minLat: 36, maxLon: -87, maxLat: 42 })).toBe(false);
  });

  it("returns true for Gulf of Mexico coastal (Louisiana shelf — BAG Mosaic)", () => {
    // Louisiana offshore shelf — about -93 to -88 lon, 28-30 lat
    expect(computeWcsAvailable({ minLon: -93, minLat: 28, maxLon: -88, maxLat: 30 })).toBe(true);
  });

  it("returns true for a bbox that straddles the boundary between land and ocean", () => {
    // West Coast US — partly coastal, partly ocean
    expect(computeWcsAvailable({ minLon: -130, minLat: 35, maxLon: -115, maxLat: 48 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeNceiHit tests — structural / metadata
// ---------------------------------------------------------------------------

describe("normalizeNceiHit", () => {
  it("returns null when title is missing", () => {
    const hit = makeHit({ bbox: [-135, 55, -130, 60] });
    expect(normalizeNceiHit(hit)).toBeNull();
  });

  it("returns null when bbox is missing", () => {
    const hit = makeHit({ title: "SE Alaska DEM" });
    expect(normalizeNceiHit(hit)).toBeNull();
  });

  it("returns null when bbox array has fewer than 4 elements", () => {
    const hit = makeHit({ title: "Short bbox", bbox: [-135, 55] });
    expect(normalizeNceiHit(hit)).toBeNull();
  });

  it("returns null when maxLon <= minLon (zero-width bbox)", () => {
    const hit = makeHit({ title: "Zero-width", bbox: [-135, 55, -135, 60] });
    expect(normalizeNceiHit(hit)).toBeNull();
  });

  it("returns null when maxLat <= minLat (zero-height bbox)", () => {
    const hit = makeHit({ title: "Zero-height", bbox: [-135, 60, -130, 60] });
    expect(normalizeNceiHit(hit)).toBeNull();
  });

  it("returns null when bbox contains non-finite values", () => {
    const hit = makeHit({ title: "NaN bbox", bbox: [NaN, 55, -130, 60] });
    expect(normalizeNceiHit(hit)).toBeNull();
  });

  it("normalises a valid hit with flat bbox field (coastal Alaska — wcsAvailable true)", () => {
    const hit = makeHit({
      title: "SE Alaska Coastal Relief Model",
      abstract: "High-resolution multibeam DEM.",
      bbox: [-136.0, 54.5, -130.0, 60.0],
      links: [{ href: "https://www.ncei.noaa.gov/metadata/record/123", rel: "describedBy" }],
    });

    const result = normalizeNceiHit(hit);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("gov.noaa.ngdc.mgg.dem:703");
    expect(result!.name).toBe("SE Alaska Coastal Relief Model");
    expect(result!.description).toBe("High-resolution multibeam DEM.");
    expect(result!.sourceAgency).toBe("NOAA/NCEI");
    expect(result!.coverageBbox).toEqual({
      minLon: -136.0,
      minLat: 54.5,
      maxLon: -130.0,
      maxLat: 60.0,
    });
    expect(result!.wcsAvailable).toBe(true);
    expect(result!.resolutionMMin).toBeNull();
    expect(result!.resolutionMMax).toBeNull();
  });

  it("sets wcsAvailable false for a bbox entirely over a landlocked region", () => {
    // Caspian Sea area but mostly landlocked central Asia
    const hit = makeHit({
      title: "Landlocked survey",
      bbox: [60, 46, 74, 54],
    });
    const result = normalizeNceiHit(hit);
    expect(result).not.toBeNull();
    expect(result!.wcsAvailable).toBe(false);
  });

  it("sets wcsAvailable true for a bbox over the Atlantic Ocean", () => {
    const hit = makeHit({
      title: "Mid-Atlantic Ridge Survey",
      bbox: [-40, 30, -20, 50],
    });
    const result = normalizeNceiHit(hit);
    expect(result).not.toBeNull();
    expect(result!.wcsAvailable).toBe(true);
  });

  it("normalises a valid hit with nested extent.spatial.bbox field", () => {
    const hit = makeHit({
      title: "Pacific NW DEM",
      extent_bbox: [[-124.0, 45.0, -117.0, 49.0]],
    });

    const result = normalizeNceiHit(hit);
    expect(result).not.toBeNull();
    expect(result!.coverageBbox).toEqual({
      minLon: -124.0,
      minLat: 45.0,
      maxLon: -117.0,
      maxLat: 49.0,
    });
    expect(result!.wcsAvailable).toBe(true);
  });

  it("prefers extent.spatial.bbox over flat bbox when both present", () => {
    const hit = {
      _id: "test:001",
      _source: {
        title: "Dual bbox test",
        extent: { spatial: { bbox: [[-100.0, 20.0, -80.0, 30.0]] } },
        bbox: [-200.0, -90.0, 200.0, 90.0],
        links: undefined,
      },
    };

    const result = normalizeNceiHit(hit);
    expect(result).not.toBeNull();
    expect(result!.coverageBbox.minLon).toBe(-100.0);
    expect(result!.coverageBbox.maxLon).toBe(-80.0);
  });

  it("picks describedBy link as metadataUrl", () => {
    const hit = makeHit({
      title: "Link test",
      bbox: [-135, 55, -130, 60],
      links: [
        { href: "https://other.example.com/data", rel: "enclosure" },
        { href: "https://ncei.noaa.gov/metadata/record/xyz", rel: "describedBy" },
      ],
    });
    const result = normalizeNceiHit(hit);
    expect(result!.metadataUrl).toBe("https://ncei.noaa.gov/metadata/record/xyz");
  });

  it("falls back to alternate link when no describedBy", () => {
    const hit = makeHit({
      title: "Alternate link test",
      bbox: [-135, 55, -130, 60],
      links: [{ href: "https://ncei.noaa.gov/alt/record/abc", rel: "alternate" }],
    });
    const result = normalizeNceiHit(hit);
    expect(result!.metadataUrl).toBe("https://ncei.noaa.gov/alt/record/abc");
  });

  it("generates a fallback metadataUrl from _id when no links", () => {
    const hit = makeHit({
      _id: "gov.noaa.ngdc.mgg.dem:999",
      title: "No links",
      bbox: [-135, 55, -130, 60],
    });
    const result = normalizeNceiHit(hit);
    expect(result!.metadataUrl).toContain("ncei.noaa.gov/metadata/geoportal");
    expect(result!.metadataUrl).toContain("gov.noaa.ngdc.mgg.dem");
  });

  it("trims whitespace from title and abstract", () => {
    const hit = makeHit({
      title: "   Trimmed Title   ",
      abstract: "  Some abstract.  ",
      bbox: [-135, 55, -130, 60],
    });
    const result = normalizeNceiHit(hit);
    expect(result!.name).toBe("Trimmed Title");
    expect(result!.description).toBe("Some abstract.");
  });

  it("sets description null when abstract is absent", () => {
    const hit = makeHit({ title: "No abstract", bbox: [-135, 55, -130, 60] });
    const result = normalizeNceiHit(hit);
    expect(result!.description).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Resolution extraction tests — extractResolutionM via normalizeNceiHit
// ---------------------------------------------------------------------------

function makeHitWithResolution(overrides: {
  abstract?: string;
  sys_resolution_i?: number;
  spatialResolution?: Array<{ value?: number; denomination?: number; uomName?: string }>;
}) {
  return {
    _id: "gov.noaa.ngdc.mgg.dem:res-test",
    _source: {
      title: "Resolution Test DEM",
      abstract: overrides.abstract,
      bbox: [-135, 55, -130, 60],
      sys_resolution_i: overrides.sys_resolution_i,
      spatialResolution: overrides.spatialResolution,
    },
  };
}

describe("normalizeNceiHit — resolution extraction", () => {
  it("extracts resolution from sys_resolution_i (1 arc-second → ~31 m)", () => {
    const hit = makeHitWithResolution({ sys_resolution_i: 1 });
    const result = normalizeNceiHit(hit);
    expect(result!.resolutionMMin).toBe(31);
    expect(result!.resolutionMMax).toBe(31);
  });

  it("extracts resolution from sys_resolution_i (3 arc-seconds → ~93 m)", () => {
    const hit = makeHitWithResolution({ sys_resolution_i: 3 });
    const result = normalizeNceiHit(hit);
    expect(result!.resolutionMMin).toBe(93);
  });

  it("extracts resolution from spatialResolution with uomName 'm'", () => {
    const hit = makeHitWithResolution({
      spatialResolution: [{ value: 10, uomName: "m" }],
    });
    const result = normalizeNceiHit(hit);
    expect(result!.resolutionMMin).toBe(10);
  });

  it("extracts resolution from spatialResolution with uomName 'meters'", () => {
    const hit = makeHitWithResolution({
      spatialResolution: [{ value: 90, uomName: "meters" }],
    });
    const result = normalizeNceiHit(hit);
    expect(result!.resolutionMMin).toBe(90);
  });

  it("extracts resolution from spatialResolution with uomName 'arc-second'", () => {
    const hit = makeHitWithResolution({
      spatialResolution: [{ value: 1, uomName: "arc-second" }],
    });
    const result = normalizeNceiHit(hit);
    expect(result!.resolutionMMin).toBe(31);
  });

  it("extracts resolution from spatialResolution with uomName 'degree'", () => {
    // 0.0002778 degrees ≈ 1 arc-second ≈ 30.87 m → rounds to 31
    const hit = makeHitWithResolution({
      spatialResolution: [{ value: 0.0002778, uomName: "degree" }],
    });
    const result = normalizeNceiHit(hit);
    // 0.0002778 * 111120 ≈ 30.89 → 31
    expect(result!.resolutionMMin).toBe(31);
  });

  it("extracts resolution from abstract '1/3 arc-second' → ~10 m", () => {
    const hit = makeHitWithResolution({
      abstract: "High-resolution 1/3 arc-second bathymetric DEM for SE Alaska.",
    });
    const result = normalizeNceiHit(hit);
    expect(result!.resolutionMMin).toBe(10);
  });

  it("extracts resolution from abstract '1 arc-second' → ~31 m", () => {
    const hit = makeHitWithResolution({
      abstract: "Coastal Relief Model at 1 arc-second spatial resolution.",
    });
    const result = normalizeNceiHit(hit);
    expect(result!.resolutionMMin).toBe(31);
  });

  it("extracts resolution from abstract '3 arc-second' → ~93 m", () => {
    const hit = makeHitWithResolution({
      abstract: "Global 3 arc-second bathymetric product.",
    });
    const result = normalizeNceiHit(hit);
    expect(result!.resolutionMMin).toBe(93);
  });

  it("extracts resolution from abstract '1 arc-minute' → ~1852 m", () => {
    const hit = makeHitWithResolution({
      abstract: "Global ocean DEM at 1 arc-minute resolution.",
    });
    const result = normalizeNceiHit(hit);
    // 1 * 30.87 * 60 = 1852.2 → 1852
    expect(result!.resolutionMMin).toBe(1852);
  });

  it("extracts resolution from abstract '90 m resolution'", () => {
    const hit = makeHitWithResolution({
      abstract: "Global bathymetric product at 90 m resolution.",
    });
    const result = normalizeNceiHit(hit);
    expect(result!.resolutionMMin).toBe(90);
  });

  it("returns null resolution when no resolution info is present", () => {
    const hit = makeHitWithResolution({
      abstract: "Some dataset with no resolution information.",
    });
    const result = normalizeNceiHit(hit);
    expect(result!.resolutionMMin).toBeNull();
    expect(result!.resolutionMMax).toBeNull();
  });

  it("prefers sys_resolution_i over spatialResolution when both present", () => {
    const hit = makeHitWithResolution({
      sys_resolution_i: 1,
      spatialResolution: [{ value: 90, uomName: "m" }],
    });
    const result = normalizeNceiHit(hit);
    // sys_resolution_i has priority → 1 arc-second → ~31 m
    expect(result!.resolutionMMin).toBe(31);
  });

  it("routes correctly to BAG Mosaic (resolutionMMin ≤ 50): 1/3 arc-second DEM", () => {
    const hit = makeHitWithResolution({
      abstract: "High-resolution 1/3 arc-second DEM from multibeam surveys.",
    });
    const result = normalizeNceiHit(hit);
    // 1/3 arc-second ≈ 10 m → should route to BAG (≤ 50 m)
    expect(result!.resolutionMMin).not.toBeNull();
    expect(result!.resolutionMMin!).toBeLessThanOrEqual(50);
  });

  it("routes correctly to DEM Global Mosaic (resolutionMMin > 50): 3 arc-second product", () => {
    const hit = makeHitWithResolution({
      abstract: "Low-resolution 3 arc-second global ocean coverage.",
    });
    const result = normalizeNceiHit(hit);
    // 3 arc-seconds ≈ 93 m → should route to DEM global (> 50 m)
    expect(result!.resolutionMMin).not.toBeNull();
    expect(result!.resolutionMMin!).toBeGreaterThan(50);
  });
});
