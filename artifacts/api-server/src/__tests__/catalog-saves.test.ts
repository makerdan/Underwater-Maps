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
  it("returns null for non-preset catalog entries (no materializer wired yet)", async () => {
    const entry = makeEntry({
      id: "noaa-efh-alaska-rockfish",
      dataType: "habitat",
      sourceAgency: "NOAA/NMFS",
    });
    const result = await buildCatalogGrids(entry);
    expect(result).toBeNull();
  });

  it("materializes the GEBCO 2024 global bathymetry entry via the GEBCO WCS", async () => {
    // Stub fetch so the test doesn't touch the network. The fetcher decodes
    // an AAIGRID-formatted response, so produce a tiny 2x2 grid (header +
    // values) that exercises the depth/elevation conversion path.
    const aaigrid = [
      "ncols 2",
      "nrows 2",
      "xllcorner 0",
      "yllcorner 0",
      "cellsize 1",
      "nodata_value -9999",
      "-50 -100",
      "-25 5",
    ].join("\n");
    // Return a fresh Response on each call — Response bodies are
    // single-use streams, so reusing one object across two fetches throws
    // "Body has already been read" on the second decode.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        new Response(aaigrid, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );

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
      expect(String(fetchSpy.mock.calls[0]![0])).toContain("gebco");
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

  it("rejects preset-* ids that don't map to a known preset dataset", async () => {
    const entry = makeEntry({ id: "preset-does-not-exist" });
    await expect(buildCatalogGrids(entry)).rejects.toThrow(/unknown dataset id/);
  });

  it(
    "materializes a real preset entry into terrain + overview grids tagged with the preset id",
    async () => {
      const preset = ALL_PRESET_DATASETS[0];
      expect(preset).toBeDefined();
      const entry = makeEntry({ id: `preset-${preset!.id}`, name: preset!.name });

      const result = await buildCatalogGrids(entry);
      expect(result).not.toBeNull();
      expect(result!.terrain.datasetId).toBe(preset!.id);
      expect(result!.overview.datasetId).toBe(preset!.id);
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
