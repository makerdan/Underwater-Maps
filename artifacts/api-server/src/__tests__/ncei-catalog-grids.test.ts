/**
 * ncei-catalog-grids.test.ts — Verify that buildCatalogGrids routes
 * `ncei-portal-*` catalog entries through buildNceiTerrainForBbox.
 *
 * Strategy:
 *  - Mock buildNceiTerrainForBbox from terrain.ts so no real WCS calls go out.
 *  - Call buildCatalogGrids with ncei-portal-* entries at various resolutions
 *    and assert the mock received the correct coverageKey and bbox.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CatalogSeedEntry } from "../lib/catalogSeeder.js";

const MOCK_TERRAIN_GRID = {
  datasetId: "test",
  name: "test",
  waterType: "saltwater" as const,
  resolution: 256,
  width: 256,
  height: 256,
  depths: new Array<number>(256 * 256).fill(10),
  minDepth: 10,
  maxDepth: 10,
  minLon: -136.0,
  maxLon: -130.0,
  minLat: 54.5,
  maxLat: 60.0,
  centerLon: -133.0,
  centerLat: 57.25,
  dataSource: "ncei" as const,
  bathymetrySource: "ncei" as const,
  bathymetrySourceLabel: "NCEI BAG Mosaic",
  bathymetryCreditUrl: "https://www.ncei.noaa.gov/products/bathymetry",
  version: 1,
};

const MOCK_OVERVIEW_GRID = { ...MOCK_TERRAIN_GRID, resolution: 64, width: 64, height: 64 };

const buildNceiTerrainForBboxMock = vi
  .fn()
  .mockImplementation((meta: unknown, resolution: number) =>
    Promise.resolve(resolution <= 64 ? MOCK_OVERVIEW_GRID : MOCK_TERRAIN_GRID),
  );

vi.mock("../lib/terrain.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/terrain.js")>();
  return {
    ...orig,
    buildNceiTerrainForBbox: buildNceiTerrainForBboxMock,
  };
});

// Import AFTER mock is registered
const { buildCatalogGrids } = await import("../routes/catalog-saves.js");

function makePortalEntry(
  overrides: Partial<CatalogSeedEntry> & { id: string },
): CatalogSeedEntry {
  return {
    name: overrides.id,
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -136, minLat: 54.5, maxLon: -130, maxLat: 60 },
    endpointUrl: null,
    accessNotes: null,
    description: null,
    keywords: null,
    lastUpdated: null,
    waterType: "saltwater",
    ...overrides,
  } as CatalogSeedEntry;
}

describe("buildCatalogGrids — ncei-portal-* routing", () => {
  beforeEach(() => {
    buildNceiTerrainForBboxMock.mockClear();
  });

  it("routes ncei-portal-* entry with unknown resolution to demGlobalMosaic", async () => {
    const entry = makePortalEntry({ id: "ncei-portal-gov.noaa.ngdc.mgg.dem:703" });
    const result = await buildCatalogGrids(entry);

    expect(result).not.toBeNull();
    expect(buildNceiTerrainForBboxMock).toHaveBeenCalledTimes(2);

    const [firstCall] = buildNceiTerrainForBboxMock.mock.calls;
    const meta = firstCall?.[0] as { coverageKey: string; bbox: object };
    expect(meta.coverageKey).toBe("demGlobalMosaic");
    expect(meta.bbox).toEqual(entry.coverageBbox);
  });

  it("routes ncei-portal-* entry with resolutionMMin > 50 to demGlobalMosaic", async () => {
    const entry = makePortalEntry({
      id: "ncei-portal-gov.noaa.ngdc.mgg.dem:coarse",
      resolutionMMin: 90,
    });
    const result = await buildCatalogGrids(entry);

    expect(result).not.toBeNull();
    const meta = buildNceiTerrainForBboxMock.mock.calls[0]?.[0] as { coverageKey: string };
    expect(meta.coverageKey).toBe("demGlobalMosaic");
  });

  it("routes ncei-portal-* entry with resolutionMMin = 50 to bagMosaic", async () => {
    const entry = makePortalEntry({
      id: "ncei-portal-gov.noaa.ngdc.mgg.dem:highres",
      resolutionMMin: 50,
    });
    const result = await buildCatalogGrids(entry);

    expect(result).not.toBeNull();
    const meta = buildNceiTerrainForBboxMock.mock.calls[0]?.[0] as { coverageKey: string };
    expect(meta.coverageKey).toBe("bagMosaic");
  });

  it("routes ncei-portal-* entry with resolutionMMin < 50 to bagMosaic", async () => {
    const entry = makePortalEntry({
      id: "ncei-portal-gov.noaa.ngdc.mgg.dem:multibeam",
      resolutionMMin: 5,
    });
    const result = await buildCatalogGrids(entry);

    expect(result).not.toBeNull();
    const meta = buildNceiTerrainForBboxMock.mock.calls[0]?.[0] as { coverageKey: string };
    expect(meta.coverageKey).toBe("bagMosaic");
  });

  it("passes correct bbox and datasetId to buildNceiTerrainForBbox", async () => {
    const bbox = { minLon: -135.5, minLat: 56.0, maxLon: -132.0, maxLat: 58.5 };
    const entry = makePortalEntry({
      id: "ncei-portal-test-bbox-check",
      coverageBbox: bbox,
    });
    await buildCatalogGrids(entry);

    const meta = buildNceiTerrainForBboxMock.mock.calls[0]?.[0] as {
      datasetId: string;
      bbox: object;
    };
    expect(meta.datasetId).toBe(entry.id);
    expect(meta.bbox).toEqual(bbox);
  });

  it("calls buildNceiTerrainForBbox twice (terrain 256 + overview 64)", async () => {
    const entry = makePortalEntry({ id: "ncei-portal-double-call-check" });
    await buildCatalogGrids(entry);

    expect(buildNceiTerrainForBboxMock).toHaveBeenCalledTimes(2);
    const resolutions = buildNceiTerrainForBboxMock.mock.calls.map(
      (c) => c[1] as number,
    );
    expect(resolutions).toContain(256);
    expect(resolutions).toContain(64);
  });

  it("returns null for a non-NCEI non-portal entry", async () => {
    const entry = makePortalEntry({
      id: "some-random-source-unknown",
      sourceAgency: "Some Agency",
    });
    const result = await buildCatalogGrids(entry);
    expect(result).toBeNull();
  });
});
