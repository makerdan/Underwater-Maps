/**
 * catalog-saves.test.ts — unit tests for the catalog-save materialization
 * decision logic exposed by `buildCatalogGrids`.
 *
 * We don't spin up the DB here; `buildCatalogGrids` is the pure
 * "given a catalog entry, produce terrain + overview (or null)" helper that
 * the materializer wraps with persistence + status updates.
 */

import { describe, it, expect, vi } from "vitest";
import { buildCatalogGrids } from "../routes/catalog-saves.js";
import { ALL_PRESET_DATASETS } from "../lib/terrain.js";
import type { CatalogSeedEntry } from "../lib/catalogSeeder.js";
import { writeArrayBuffer } from "geotiff";

/**
 * Build a minimal float32 GeoTIFF body — the fetchers now consume GeoTIFF
 * via fetchWcsGeoTiffGrid, not ESRI ASCII grids.
 */
function makeGeoTiff(values: number[], ncols = 2, nrows = 2): ArrayBuffer {
  return writeArrayBuffer(new Float32Array(values), {
    width: ncols,
    height: nrows,
    ModelPixelScale: [0.05, 0.05, 0],
    ModelTiepoint: [0, 0, 0, -135.0, 58.0, 0],
  }) as ArrayBuffer;
}

function makeTiffResponse(body: ArrayBuffer): Response {
  return new Response(body.slice(0), {
    status: 200,
    headers: { "content-type": "image/tiff" },
  });
}

function makeEntry(overrides: Partial<CatalogSeedEntry> & { id: string }): CatalogSeedEntry {
  return {
    name: overrides.id,
    sourceAgency: "test",
    dataType: "bathymetry",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -1, minLat: -1, maxLon: 1, maxLat: 1 },
    endpointUrl: null,
    accessNotes: null,
    description: null,
    keywords: null,
    lastUpdated: null,
    waterType: "saltwater",
    ...overrides,
  } as CatalogSeedEntry;
}

describe("buildCatalogGrids", () => {
  it("returns null for non-preset catalog entries with no materializer wired", async () => {
    const entry = makeEntry({
      id: "some-future-source-not-yet-wired",
      dataType: "bathymetry",
      sourceAgency: "Hypothetical Agency",
    });
    const result = await buildCatalogGrids(entry);
    expect(result).toBeNull();
  });

  it("materializes a NOAA EFH habitat catalog entry into a polygon overlay grid", async () => {
    const entry = makeEntry({
      id: "noaa-efh-alaska-rockfish",
      name: "NOAA EFH — Rockfish Complex (SE Alaska)",
      sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
      dataType: "habitat",
      coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
      waterType: "saltwater",
    });

    const result = await buildCatalogGrids(entry);
    expect(result).not.toBeNull();
    expect(result!.terrain.datasetId).toBe(entry.id);
    expect(result!.overview.datasetId).toBe(entry.id);
    expect(result!.terrain.resolution).toBe(256);
    expect(result!.overview.resolution).toBe(64);
    expect(result!.terrain.depths).toHaveLength(256 * 256);
    expect(result!.overview.depths).toHaveLength(64 * 64);
    expect(result!.terrain.waterType).toBe("saltwater");

    // The grid carries the habitat polygons under an extra `habitatPolygons`
    // field so the persisted jsonb retains the overlay. Cast through unknown
    // because TerrainGrid doesn't declare the field.
    const terrainWithHabitat = result!.terrain as unknown as {
      habitatPolygons?: { type: string; features: Array<{ properties: { species: string } }> };
    };
    const collection = terrainWithHabitat.habitatPolygons;
    expect(collection).toBeDefined();
    expect(collection!.type).toBe("FeatureCollection");
    expect(collection!.features.length).toBeGreaterThan(0);
    // Rockfish suffix filters to Sebastes species only.
    for (const f of collection!.features) {
      expect(f.properties.species.startsWith("sebastes_")).toBe(true);
    }
  });

  it("filters EFH polygons to Pacific Cod for the pcod catalog entry", async () => {
    const entry = makeEntry({
      id: "noaa-efh-alaska-pcod",
      name: "NOAA EFH — Pacific Cod (SE Alaska)",
      dataType: "habitat",
      coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    });
    const result = await buildCatalogGrids(entry);
    const collection = (result!.terrain as unknown as {
      habitatPolygons: { features: Array<{ properties: { species: string } }> };
    }).habitatPolygons;
    expect(collection.features.length).toBeGreaterThan(0);
    for (const f of collection.features) {
      expect(f.properties.species).toBe("gadus_macrocephalus");
    }
  });

  it("filters EFH polygons to Pacific Halibut for the halibut catalog entry", async () => {
    const entry = makeEntry({
      id: "noaa-efh-alaska-halibut",
      name: "NOAA EFH — Pacific Halibut (SE Alaska)",
      dataType: "habitat",
      coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    });
    const result = await buildCatalogGrids(entry);
    const collection = (result!.terrain as unknown as {
      habitatPolygons: { features: Array<{ properties: { species: string } }> };
    }).habitatPolygons;
    expect(collection.features.length).toBeGreaterThan(0);
    for (const f of collection.features) {
      expect(f.properties.species).toBe("hippoglossus_stenolepis");
    }
  });

  it("materializes the Walleye Pollock EFH entry and produces a valid overlay grid", async () => {
    const entry = makeEntry({
      id: "noaa-efh-alaska-pollock",
      name: "NOAA EFH — Walleye Pollock (Gulf of Alaska)",
      dataType: "habitat",
      coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    });
    const result = await buildCatalogGrids(entry);
    expect(result).not.toBeNull();
    expect(result!.terrain.datasetId).toBe(entry.id);
    expect(result!.overview.datasetId).toBe(entry.id);
    expect(result!.terrain.depths).toHaveLength(256 * 256);
    expect(result!.overview.depths).toHaveLength(64 * 64);
    // All features in the overlay (if any) must be walleye pollock.
    const terrainWithHabitat = result!.terrain as unknown as {
      habitatPolygons?: { type: string; features: Array<{ properties: { species: string } }> };
    };
    const collection = terrainWithHabitat.habitatPolygons;
    expect(collection).toBeDefined();
    expect(collection!.type).toBe("FeatureCollection");
    for (const f of collection!.features) {
      expect(f.properties.species).toBe("gadus_chalcogrammus");
    }
  });

  it("materializes the Sablefish EFH entry and filters to sablefish-only polygons", async () => {
    const entry = makeEntry({
      id: "noaa-efh-alaska-sablefish",
      name: "NOAA EFH — Sablefish (Gulf of Alaska)",
      dataType: "habitat",
      coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    });
    const result = await buildCatalogGrids(entry);
    expect(result).not.toBeNull();
    expect(result!.terrain.datasetId).toBe(entry.id);
    expect(result!.overview.datasetId).toBe(entry.id);
    expect(result!.terrain.depths).toHaveLength(256 * 256);
    expect(result!.overview.depths).toHaveLength(64 * 64);
    const terrainWithHabitat = result!.terrain as unknown as {
      habitatPolygons?: { type: string; features: Array<{ properties: { species: string } }> };
    };
    const collection = terrainWithHabitat.habitatPolygons;
    expect(collection).toBeDefined();
    expect(collection!.type).toBe("FeatureCollection");
    // Sablefish (anoplopoma_fimbria) is present in the bundled SE Alaska EFH data.
    expect(collection!.features.length).toBeGreaterThan(0);
    for (const f of collection!.features) {
      expect(f.properties.species).toBe("anoplopoma_fimbria");
    }
  });

  it("materializes the Arrowtooth Flounder EFH entry and produces a valid overlay grid", async () => {
    const entry = makeEntry({
      id: "noaa-efh-alaska-arrowtooth",
      name: "NOAA EFH — Arrowtooth Flounder (Gulf of Alaska)",
      dataType: "habitat",
      coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    });
    const result = await buildCatalogGrids(entry);
    expect(result).not.toBeNull();
    expect(result!.terrain.datasetId).toBe(entry.id);
    expect(result!.overview.datasetId).toBe(entry.id);
    expect(result!.terrain.depths).toHaveLength(256 * 256);
    expect(result!.overview.depths).toHaveLength(64 * 64);
    const terrainWithHabitat = result!.terrain as unknown as {
      habitatPolygons?: { type: string; features: Array<{ properties: { species: string } }> };
    };
    const collection = terrainWithHabitat.habitatPolygons;
    expect(collection).toBeDefined();
    expect(collection!.type).toBe("FeatureCollection");
    // All features in the overlay (if any) must be arrowtooth flounder.
    for (const f of collection!.features) {
      expect(f.properties.species).toBe("atheresthes_stomias");
    }
  });

  it("returns no habitat features when the coverage bbox is outside the bundled regions", async () => {
    const entry = makeEntry({
      id: "noaa-efh-alaska-halibut",
      name: "NOAA EFH — Pacific Halibut (out of region)",
      dataType: "habitat",
      // Mid-Pacific bbox far from any SE Alaska region polygon.
      coverageBbox: { minLon: 150, minLat: -10, maxLon: 160, maxLat: 0 },
    });
    const result = await buildCatalogGrids(entry);
    const collection = (result!.terrain as unknown as {
      habitatPolygons: { features: unknown[] };
    }).habitatPolygons;
    expect(collection.features).toHaveLength(0);
  });

  it("materializes the GEBCO 2024 global bathymetry entry via the GEBCO WCS", async () => {
    // Stub fetch so the test doesn't touch the network. The fetcher decodes
    // a GeoTIFF response, so produce a tiny 2x2 float32 grid that exercises
    // the depth/elevation conversion path.
    const tiff = makeGeoTiff([-50, -100, -25, 5]);
    // Return a fresh Response on each call — Response bodies are
    // single-use streams, so reusing one object across two fetches throws
    // "Body has already been read" on the second decode.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => makeTiffResponse(tiff));

    try {
      const entry = makeEntry({
        id: "gebco-2024-global",
        name: "GEBCO 2024 Global Bathymetric Grid",
        sourceAgency: "GEBCO / BODC",
        coverageBbox: { minLon: -10, minLat: -10, maxLon: 10, maxLat: 10 },
      });

      const result = await buildCatalogGrids(entry);
      expect(result).not.toBeNull();
      expect(result!.terrain.datasetId).toBe(entry.id);
      expect(result!.overview.datasetId).toBe(entry.id);
      expect(result!.terrain.resolution).toBe(256);
      expect(result!.overview.resolution).toBe(64);
      expect(result!.terrain.depths).toHaveLength(256 * 256);
      expect(result!.overview.depths).toHaveLength(64 * 64);
      expect(result!.terrain.dataSource).toBe("gebco");
      expect(result!.terrain.bathymetrySource).toBe("gebco");
      // Decoded grid spans 0..100 m depth (with one land cell @ +5 m elev).
      expect(result!.terrain.maxDepth).toBeGreaterThan(0);
      // Both terrain + overview should hit the WCS exactly once each.
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(String(fetchSpy.mock.calls[0]![0])).toContain("DEM_global_mosaic");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("returns null for non-GEBCO global entries that aren't backed by a preset", async () => {
    const entry = makeEntry({
      id: "usgs-coned-lidar-alaska",
      sourceAgency: "USGS",
      dataType: "lidar",
    });
    const result = await buildCatalogGrids(entry);
    expect(result).toBeNull();
  });

  it("materializes the NCEI BAG mosaic Alaska entry via the BAG mosaic WCS", async () => {
    // Tiny GeoTIFF with a usable depth range so fetchNceiGrid doesn't trip
    // the "near-flat grid" coverage check.
    const tiff = makeGeoTiff([-50, -100, -25, 5]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => makeTiffResponse(tiff));

    try {
      const entry = makeEntry({
        id: "ncei-bag-mosaic-alaska",
        name: "NCEI Multibeam Bag Mosaic — SE Alaska",
        sourceAgency: "NOAA/NCEI",
        coverageBbox: { minLon: -170, minLat: 54, maxLon: -130, maxLat: 72 },
      });

      const result = await buildCatalogGrids(entry);
      expect(result).not.toBeNull();
      expect(result!.terrain.datasetId).toBe(entry.id);
      expect(result!.overview.datasetId).toBe(entry.id);
      expect(result!.terrain.resolution).toBe(256);
      expect(result!.overview.resolution).toBe(64);
      expect(result!.terrain.dataSource).toBe("ncei");
      expect(result!.terrain.bathymetrySource).toBe("ncei");
      expect(result!.terrain.bathymetrySourceLabel).toMatch(/multibeam/i);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(String(fetchSpy.mock.calls[0]![0])).toContain("multibeam_mosaic");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("materializes an NCEI Community DEM entry via the DEM Global Mosaic WCS", async () => {
    const tiff = makeGeoTiff([-20, -80, -40, 10]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => makeTiffResponse(tiff));

    try {
      const entry = makeEntry({
        id: "ncei-community-dem-juneau",
        name: "NCEI Community DEM — Juneau, AK",
        sourceAgency: "NOAA/NCEI",
        coverageBbox: { minLon: -135.2, minLat: 57.9, maxLon: -133.8, maxLat: 58.7 },
      });

      const result = await buildCatalogGrids(entry);
      expect(result).not.toBeNull();
      expect(result!.terrain.dataSource).toBe("ncei");
      expect(result!.terrain.bathymetrySourceLabel).toMatch(/DEM/i);
      expect(String(fetchSpy.mock.calls[0]![0])).toContain("DEM_global_mosaic");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("surfaces a clear 'coverage unavailable' error when NCEI returns an XML error doc", async () => {
    const xmlError =
      '<?xml version="1.0"?><ServiceExceptionReport><ServiceException>no coverage</ServiceException></ServiceExceptionReport>';
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        new Response(xmlError, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
      );

    try {
      const entry = makeEntry({
        id: "ncei-community-dem-juneau",
        name: "NCEI Community DEM — Juneau, AK",
        sourceAgency: "NOAA/NCEI",
        coverageBbox: { minLon: -135.2, minLat: 57.9, maxLon: -133.8, maxLat: 58.7 },
      });

      await expect(buildCatalogGrids(entry)).rejects.toThrow(
        /error document|coverage unavailable/i,
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("surfaces a clear 'no coverage' error when NCEI returns a near-flat grid", async () => {
    // All zeros → range == 0, which trips the near-flat sanity check.
    const tiff = makeGeoTiff([0, 0, 0, 0]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => makeTiffResponse(tiff));

    try {
      const entry = makeEntry({
        id: "ncei-bag-mosaic-alaska",
        name: "NCEI Multibeam Bag Mosaic — SE Alaska",
        sourceAgency: "NOAA/NCEI",
        coverageBbox: { minLon: -170, minLat: 54, maxLon: -130, maxLat: 72 },
      });

      await expect(buildCatalogGrids(entry)).rejects.toThrow(/no coverage|near-flat/i);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects preset-* ids that don't map to a known preset dataset", async () => {
    const entry = makeEntry({ id: "preset-does-not-exist" });
    await expect(buildCatalogGrids(entry)).rejects.toThrow(/unknown dataset id/);
  });

  // The preset registry is currently empty (PRESET_DATASETS and
  // FRESHWATER_PRESET_DATASETS were cleared out). `skipIf` lets this
  // test re-enable itself automatically the moment ALL_PRESET_DATASETS
  // is repopulated, without a follow-up code change.
  it.skipIf(ALL_PRESET_DATASETS.length === 0)(
    "materializes a real preset entry into terrain + overview grids tagged with the preset id",
    async () => {
      const preset = ALL_PRESET_DATASETS[0]!;
      const entry = makeEntry({ id: `preset-${preset.id}`, name: preset.name });

      const result = await buildCatalogGrids(entry);
      expect(result).not.toBeNull();
      expect(result!.terrain.datasetId).toBe(preset.id);
      expect(result!.overview.datasetId).toBe(preset.id);
      // Terrain pipeline uses the requested resolution; overview is fixed at 64.
      expect(result!.terrain.resolution).toBe(256);
      expect(result!.overview.resolution).toBe(64);
      expect(typeof result!.terrain.minDepth).toBe("number");
      expect(typeof result!.terrain.maxDepth).toBe("number");
      expect(result!.terrain.maxDepth).toBeGreaterThan(result!.terrain.minDepth);
    },
    30_000,
  );
});
