/**
 * catalog-saves.test.ts — unit tests for the catalog-save materialization
 * decision logic exposed by `buildCatalogGrids`.
 *
 * We don't spin up the DB here; `buildCatalogGrids` is the pure
 * "given a catalog entry, produce terrain + overview (or null)" helper that
 * the materializer wraps with persistence + status updates.
 */

import { describe, it, expect } from "vitest";
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

  it("returns null for global pipeline entries that aren't backed by a preset", async () => {
    const entry = makeEntry({ id: "gebco-2024-global", sourceAgency: "GEBCO" });
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
