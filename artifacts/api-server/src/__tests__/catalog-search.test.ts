/**
 * catalog-search.test.ts — Unit tests for the dataset catalog search logic.
 *
 * Tests scoreEntry() and searchCatalog() from catalogSeeder.ts.
 * searchCatalog() accepts optional injected entries so no DB mocking is needed.
 */

import { describe, it, expect } from "vitest";
import { scoreEntry, searchCatalog } from "../lib/catalogSeeder.js";
import type { CatalogSeedEntry } from "../lib/catalogSeeder.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES: CatalogSeedEntry[] = [
  {
    id: "preset-thorne-bay",
    name: "Thorne Bay — SE Alaska",
    sourceAgency: "NOAA/NCEI + GEBCO",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 400,
    coverageBbox: { minLon: -133.5, minLat: 55.0, maxLon: -131.5, maxLat: 56.5 },
    endpointUrl: null,
    accessNotes: null,
    description: "Clarence Strait and Thorne Bay, Prince of Wales Island — Inside Passage fishing grounds",
    keywords: "Thorne Bay,saltwater,bathymetry,terrain,thorne-bay",
    lastUpdated: "2024-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-rockfish",
    name: "NOAA EFH — Rockfish Complex (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download.",
    description: "Essential Fish Habitat for SE Alaska rockfish complex including yelloweye and black rockfish.",
    keywords: "EFH,essential fish habitat,rockfish,Sebastes,Alaska,NOAA,reef,kelp,habitat",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-pollock",
    name: "NOAA EFH — Walleye Pollock (Gulf of Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download.",
    description: "Essential Fish Habitat for Walleye Pollock in the Gulf of Alaska.",
    keywords: "EFH,essential fish habitat,pollock,walleye pollock,Gadus chalcogrammus,Theragra,Alaska,GOA,groundfish,NOAA,NMFS,midwater,demersal",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-sablefish",
    name: "NOAA EFH — Sablefish (Gulf of Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download.",
    description: "Essential Fish Habitat for Sablefish (black cod) in the Gulf of Alaska.",
    keywords: "EFH,essential fish habitat,sablefish,black cod,Anoplopoma fimbria,Alaska,GOA,groundfish,deepwater,slope,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-arrowtooth",
    name: "NOAA EFH — Arrowtooth Flounder (Gulf of Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download.",
    description: "Essential Fish Habitat for Arrowtooth Flounder in the Gulf of Alaska.",
    keywords: "EFH,essential fish habitat,arrowtooth flounder,Atheresthes stomias,Alaska,GOA,flatfish,flounder,groundfish,shelf,slope,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "gebco-2024-global",
    name: "GEBCO 2024 Global Bathymetric Grid",
    sourceAgency: "GEBCO / BODC",
    dataType: "bathymetry",
    resolutionMMin: 400,
    resolutionMMax: 400,
    coverageBbox: { minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 },
    endpointUrl: "https://www.gebco.net/",
    accessNotes: "Freely available via WCS/WMS.",
    description: "The General Bathymetric Chart of the Oceans (GEBCO) 2024 — a continuous global terrain model.",
    keywords: "global,ocean,bathymetry,GEBCO,seabed,depth,terrain",
    lastUpdated: "2024-03-01",
    waterType: "saltwater",
  },
  {
    id: "preset-lake-baikal",
    name: "Lake Baikal",
    sourceAgency: "GEBCO / Synthetic",
    dataType: "bathymetry",
    resolutionMMin: 400,
    resolutionMMax: 400,
    coverageBbox: { minLon: 103.7, minLat: 51.5, maxLon: 109.9, maxLat: 55.8 },
    endpointUrl: null,
    accessNotes: null,
    description: "World's deepest lake at 1,642 m — ancient rift lake, Russia.",
    keywords: "Lake Baikal,freshwater,bathymetry,terrain,lake-baikal",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "usgs-coned-lidar-alaska",
    name: "USGS CoNED — Coastal Lidar (SE Alaska)",
    sourceAgency: "USGS / NOAA Office for Coastal Management",
    dataType: "lidar",
    resolutionMMin: 1,
    resolutionMMax: 5,
    coverageBbox: { minLon: -138, minLat: 55, maxLon: -130, maxLat: 60 },
    endpointUrl: "https://coast.noaa.gov/htdata/lidar1_z/geoid12b/data/",
    accessNotes: "Topographic lidar.",
    description: "USGS Coastal National Elevation Database lidar-derived topography for SE Alaska.",
    keywords: "lidar,LiDAR,topography,coastal,elevation,DEM,USGS,Alaska",
    lastUpdated: "2021-04-01",
    waterType: "saltwater",
  },
];

// ---------------------------------------------------------------------------
// scoreEntry tests — pure function, no mocking needed
// ---------------------------------------------------------------------------

describe("scoreEntry", () => {
  it("returns 1 for empty terms (show-all mode)", () => {
    expect(scoreEntry(FIXTURES[0]!, [])).toBe(1);
  });

  it("returns 1 when all terms match", () => {
    const score = scoreEntry(FIXTURES[0]!, ["thorne", "bay", "bathymetry"]);
    expect(score).toBe(1);
  });

  it("returns 0 when no terms match", () => {
    const score = scoreEntry(FIXTURES[0]!, ["mariana", "trench"]);
    expect(score).toBe(0);
  });

  it("returns partial score for partial matches", () => {
    const score = scoreEntry(FIXTURES[1]!, ["rockfish", "mariana"]);
    expect(score).toBe(0.5);
  });

  it("is case-insensitive", () => {
    const gebco = FIXTURES.find((f) => f.id === "gebco-2024-global")!;
    const score = scoreEntry(gebco, ["GEBCO", "GLOBAL"]);
    expect(score).toBe(1);
  });

  it("matches keywords field", () => {
    const score = scoreEntry(FIXTURES[1]!, ["efh"]);
    expect(score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// searchCatalog tests — injected entries, no DB or mocking needed
// ---------------------------------------------------------------------------

describe("searchCatalog", () => {
  it("returns all entries when no query given", async () => {
    const results = await searchCatalog({}, FIXTURES);
    expect(results.length).toBe(FIXTURES.length);
    results.forEach((r) => expect(r.relevanceScore).toBe(1));
  });

  it("filters by dataType", async () => {
    const results = await searchCatalog({ dataType: "habitat" }, FIXTURES);
    expect(results.every((r) => r.dataType === "habitat")).toBe(true);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-rockfish");
    expect(ids).toContain("noaa-efh-alaska-pollock");
    expect(ids).toContain("noaa-efh-alaska-sablefish");
    expect(ids).toContain("noaa-efh-alaska-arrowtooth");
  });

  it("filters by waterType", async () => {
    const results = await searchCatalog({ waterType: "freshwater" }, FIXTURES);
    expect(results.every((r) => r.waterType === "freshwater")).toBe(true);
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("preset-lake-baikal");
  });

  it("filters by dataType + waterType together", async () => {
    const results = await searchCatalog({ dataType: "bathymetry", waterType: "saltwater" }, FIXTURES);
    expect(results.every((r) => r.dataType === "bathymetry" && r.waterType === "saltwater")).toBe(true);
  });

  it("returns empty array when no entries match filters", async () => {
    const results = await searchCatalog({ dataType: "lidar", waterType: "freshwater" }, FIXTURES);
    expect(results).toHaveLength(0);
  });

  it("ranks thorne-bay highest for 'thorne bay' query", async () => {
    const results = await searchCatalog({ q: "thorne bay" }, FIXTURES);
    expect(results[0]!.id).toBe("preset-thorne-bay");
    expect(results[0]!.relevanceScore).toBe(1);
  });

  it("excludes entries with zero relevance when q is set", async () => {
    const results = await searchCatalog({ q: "rockfish habitat" }, FIXTURES);
    expect(results.every((r) => r.relevanceScore > 0)).toBe(true);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-rockfish");
    expect(ids).not.toContain("gebco-2024-global");
  });

  it("filters by bounding box overlap", async () => {
    const results = await searchCatalog(
      { minLon: -133, minLat: 55.2, maxLon: -132, maxLat: 56 },
      FIXTURES,
    );
    const ids = results.map((r) => r.id);
    expect(ids).toContain("preset-thorne-bay");
    expect(ids).toContain("gebco-2024-global");
    expect(ids).not.toContain("preset-lake-baikal");
  });

  it("combines query with bbox filter", async () => {
    const results = await searchCatalog(
      { q: "rockfish", minLon: -170, minLat: 50, maxLon: -130, maxLat: 72 },
      FIXTURES,
    );
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-rockfish");
  });

  it("includes relevanceScore between 0 and 1 in every result", async () => {
    const results = await searchCatalog({ q: "alaska" }, FIXTURES);
    results.forEach((r) => {
      expect(typeof r.relevanceScore).toBe("number");
      expect(r.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(r.relevanceScore).toBeLessThanOrEqual(1);
    });
  });

  it("includes lidar dataType results for lidar query", async () => {
    const results = await searchCatalog({ q: "lidar" }, FIXTURES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("usgs-coned-lidar-alaska");
  });

  it("returns the walleye pollock EFH entry when searching 'pollock'", async () => {
    const results = await searchCatalog({ q: "pollock" }, FIXTURES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-pollock");
  });

  it("returns the sablefish EFH entry when searching 'sablefish'", async () => {
    const results = await searchCatalog({ q: "sablefish" }, FIXTURES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-sablefish");
  });

  it("returns the arrowtooth flounder EFH entry when searching 'arrowtooth'", async () => {
    const results = await searchCatalog({ q: "arrowtooth" }, FIXTURES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-arrowtooth");
  });

  it("returns new groundfish entries when searching 'groundfish'", async () => {
    const results = await searchCatalog({ q: "groundfish" }, FIXTURES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-pollock");
    expect(ids).toContain("noaa-efh-alaska-sablefish");
    expect(ids).toContain("noaa-efh-alaska-arrowtooth");
  });

  it("returns the sablefish entry when searching 'black cod'", async () => {
    const results = await searchCatalog({ q: "black cod" }, FIXTURES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-sablefish");
  });

  it("filters habitat dataType to include all three new groundfish entries", async () => {
    const results = await searchCatalog({ dataType: "habitat" }, FIXTURES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-pollock");
    expect(ids).toContain("noaa-efh-alaska-sablefish");
    expect(ids).toContain("noaa-efh-alaska-arrowtooth");
    expect(results.every((r) => r.dataType === "habitat")).toBe(true);
  });
});
