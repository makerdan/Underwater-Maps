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

import { describe, it, expect, vi, afterEach } from "vitest";
import { expandFeature, readDiskCache, EFH_CACHE_VERSION } from "../efhFetcher.js";
import { promises as fs } from "fs";
import path from "path";

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

// ---------------------------------------------------------------------------
// readDiskCache — TTL expiry, version eviction, and error handling
//
// The cache file lives at /tmp/efh-cache/alaska-efh-species.json.
// TTL is controlled via the EFH_CACHE_MAX_AGE_MS env override so tests do
// not need real clock delays or Date.now() mocking.
// ---------------------------------------------------------------------------

const CACHE_DIR = "/tmp/efh-cache";
const CACHE_FILE = path.join(CACHE_DIR, "alaska-efh-species.json");

const MINIMAL_FEATURE = {
  type: "Feature" as const,
  properties: {
    species: "hippoglossus_stenolepis",
    commonName: "Pacific Halibut",
    fmp: "Pacific Halibut (IPHC)",
    depthRangeM: [20, 500] as [number, number],
    habitatDescription: "test",
    source: "test",
    creditUrl: "test",
    color: "#f59e0b",
  },
  geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
};

async function writeCacheFile(payload: object): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload), "utf8");
}

afterEach(async () => {
  try { await fs.unlink(CACHE_FILE); } catch { /* file may not exist */ }
  vi.unstubAllEnvs();
});

describe("readDiskCache — fresh cache hit", () => {
  it("returns the cached features when version and age are both valid", async () => {
    await writeCacheFile({
      version: EFH_CACHE_VERSION,
      fetchedAt: new Date().toISOString(),
      features: [MINIMAL_FEATURE],
    });

    const result = await readDiskCache();

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0]!.properties.commonName).toBe("Pacific Halibut");
  });
});

describe("readDiskCache — expired cache eviction (EFH_CACHE_MAX_AGE_MS override)", () => {
  it("returns null when the cache is older than MAX_CACHE_AGE_MS", async () => {
    vi.stubEnv("EFH_CACHE_MAX_AGE_MS", "1000");
    vi.resetModules();
    const { readDiskCache: readFresh, EFH_CACHE_VERSION: VERSION } = await import(
      "../efhFetcher.js"
    );

    const TWO_SECONDS_AGO = new Date(Date.now() - 2_000).toISOString();
    await writeCacheFile({
      version: VERSION,
      fetchedAt: TWO_SECONDS_AGO,
      features: [MINIMAL_FEATURE],
    });

    const result = await readFresh();

    expect(result).toBeNull();
  });

  it("returns features when the cache is younger than MAX_CACHE_AGE_MS", async () => {
    vi.stubEnv("EFH_CACHE_MAX_AGE_MS", "60000");
    vi.resetModules();
    const { readDiskCache: readFresh, EFH_CACHE_VERSION: VERSION } = await import(
      "../efhFetcher.js"
    );

    const TEN_SECONDS_AGO = new Date(Date.now() - 10_000).toISOString();
    await writeCacheFile({
      version: VERSION,
      fetchedAt: TEN_SECONDS_AGO,
      features: [MINIMAL_FEATURE],
    });

    const result = await readFresh();

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
  });
});

describe("readDiskCache — version-stale eviction", () => {
  it("returns null and deletes the file when the cached version is below EFH_CACHE_VERSION", async () => {
    await writeCacheFile({
      version: EFH_CACHE_VERSION - 1,
      fetchedAt: new Date().toISOString(),
      features: [MINIMAL_FEATURE],
    });

    const result = await readDiskCache();

    expect(result).toBeNull();
    await expect(fs.access(CACHE_FILE)).rejects.toThrow();
  });
});

describe("readDiskCache — corrupt or missing file", () => {
  it("returns null when the cache file contains invalid JSON", async () => {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, "{ not valid json %%%", "utf8");

    const result = await readDiskCache();

    expect(result).toBeNull();
  });

  it("returns null when the cache file does not exist", async () => {
    try { await fs.unlink(CACHE_FILE); } catch { /* already absent */ }

    const result = await readDiskCache();

    expect(result).toBeNull();
  });
});
