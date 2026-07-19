/**
 * Unit tests for the catalogSeeder module — MiniSearch scorer (Track C).
 *
 * Tests run against the static EXTRA_CATALOG_ENTRIES catalog (no DB) by
 * passing entries directly to searchCatalog as the optional _entries argument.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { searchCatalog, invalidateMiniSearchIndex } from "./catalogSeeder.js";
import type { CatalogSeedEntry } from "./catalogSeeder.js";

// Pull in the freshwater lake entries we know are seeded. We define a
// minimal catalog that covers the cases we want to test so these tests
// stay fast and don't need the full database.
const LAKE_ENTRIES: CatalogSeedEntry[] = [
  {
    id: "fw-lake-george-ny",
    name: "Lake George, NY",
    sourceAgency: "NYSDEC",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -73.7, minLat: 43.4, maxLon: -73.4, maxLat: 43.8 },
    endpointUrl: null,
    accessNotes: "NYSDEC ArcGIS REST endpoint.",
    description: "Lake George, Warren County, NY — a glacially carved oligotrophic lake in the Adirondacks.",
    keywords: "Lake George,George,New York,NY,Adirondacks,Warren County,freshwater,bathymetry,NYSDEC,trout,lake trout,smallmouth bass,landlocked salmon,clarity",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-superior",
    name: "Lake Superior",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -92.1, minLat: 46.4, maxLon: -76.4, maxLat: 49.0 },
    endpointUrl: null,
    accessNotes: "WCS coverage: superior_lld.",
    description: "Lake Superior — the largest of the Great Lakes by surface area.",
    keywords: "Lake Superior,Superior,Great Lakes,freshwater,Minnesota,Wisconsin,Michigan,Ontario,MN,WI,MI,NOAA,NCEI,bathymetry,Duluth,Marquette",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-michigan",
    name: "Lake Michigan",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -87.6, minLat: 41.6, maxLon: -84.7, maxLat: 46.1 },
    endpointUrl: null,
    accessNotes: "WCS coverage: michigan_lld.",
    description: "Lake Michigan — the only Great Lake entirely within the United States.",
    keywords: "Lake Michigan,Michigan,Great Lakes,freshwater,Illinois,Indiana,Wisconsin,IL,IN,MI,WI,NOAA,NCEI,bathymetry,Chicago,Milwaukee,Green Bay",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-champlain",
    name: "Lake Champlain, NY/VT",
    sourceAgency: "USGS / NYSDEC / Vermont DEC",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -73.45, minLat: 43.6, maxLon: -73.1, maxLat: 45.0 },
    endpointUrl: null,
    accessNotes: "USGS 3DEP WCS.",
    description: "Lake Champlain — a large natural lake on the NY/VT border.",
    keywords: "Lake Champlain,Champlain,New York,Vermont,NY,VT,freshwater,bathymetry,USGS,3DEP,salmon,trout,walleye,Burlington,Plattsburgh",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-tahoe",
    name: "Lake Tahoe, CA/NV",
    sourceAgency: "USGS ScienceBase / USGS 3DEP",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -120.15, minLat: 38.9, maxLon: -119.9, maxLat: 39.25 },
    endpointUrl: null,
    accessNotes: "USGS ScienceBase.",
    description: "Lake Tahoe — a large alpine lake in the Sierra Nevada on the CA/NV border.",
    keywords: "Lake Tahoe,Tahoe,California,Nevada,CA,NV,Sierra Nevada,freshwater,bathymetry,USGS,kokanee,mackinaw,lake trout,rainbow trout,alpine",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-travis-tx",
    name: "Lake Travis, TX",
    sourceAgency: "LCRA / USACE",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -98.15, minLat: 30.28, maxLon: -97.65, maxLat: 30.62 },
    endpointUrl: null,
    accessNotes: "USGS 3DEP WCS.",
    description: "Lake Travis — a large reservoir on the Colorado River near Austin.",
    keywords: "Lake Travis,Travis,Texas,TX,Austin,Highland Lakes,Colorado River,LCRA,freshwater,bathymetry,USGS,largemouth bass,striped bass",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-crater-lake-or",
    name: "Crater Lake, OR",
    sourceAgency: "USGS ScienceBase / NPS",
    dataType: "bathymetry",
    resolutionMMin: 2,
    resolutionMMax: 10,
    coverageBbox: { minLon: -122.22, minLat: 42.84, maxLon: -121.93, maxLat: 43.0 },
    endpointUrl: null,
    accessNotes: "USGS ScienceBase.",
    description: "Crater Lake — the deepest lake in the United States (592 m), formed in a caldera.",
    keywords: "Crater Lake,Oregon,OR,Klamath,caldera,volcano,National Park,West,freshwater,bathymetry,deepest lake US,rainbow trout,kokanee",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "ncei-juneau-dem",
    name: "NCEI Community DEM — Juneau, AK",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 8,
    resolutionMMax: 90,
    coverageBbox: { minLon: -135.1, minLat: 57.8, maxLon: -134.2, maxLat: 58.7 },
    endpointUrl: null,
    accessNotes: "NCEI Community DEM WCS.",
    description: "Juneau, Alaska community DEM covering Gastineau Channel and Lynn Canal.",
    keywords: "Juneau,Alaska,AK,NCEI,DEM,bathymetry,Gastineau Channel,Lynn Canal,saltwater",
    lastUpdated: "2024-01-01",
    waterType: "saltwater",
  },
];

beforeEach(() => {
  invalidateMiniSearchIndex();
});

describe("searchCatalog — MiniSearch scorer", () => {
  it('returns Lake George NY as top result for "lake george, ny"', async () => {
    const results = await searchCatalog({ q: "lake george, ny" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe("fw-lake-george-ny");
  });

  it('returns Lake Superior as top result for "lake superior"', async () => {
    const results = await searchCatalog({ q: "lake superior" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe("fw-lake-superior");
  });

  it('returns Lake Travis as top result for "texas highland lakes" (keyword match)', async () => {
    const results = await searchCatalog({ q: "texas highland lakes" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe("fw-lake-travis-tx");
  });

  it("handles state abbreviation expansion — TX finds Lake Travis", async () => {
    const results = await searchCatalog({ q: "TX lake" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("fw-lake-travis-tx");
  });

  it("handles state full-name expansion — New York finds NY lake entries", async () => {
    const resultsAbbr = await searchCatalog({ q: "lake NY" }, LAKE_ENTRIES);
    const resultsFull = await searchCatalog({ q: "lake New York" }, LAKE_ENTRIES);
    const idsFull = resultsFull.map((r) => r.id);
    const idsAbbr = resultsAbbr.map((r) => r.id);
    // Both should find NY-tagged entries like Lake George and Champlain
    expect(idsFull).toContain("fw-lake-george-ny");
    expect(idsAbbr).toContain("fw-lake-george-ny");
  });

  it("filters by waterType — freshwater query only returns freshwater entries", async () => {
    const results = await searchCatalog({ waterType: "freshwater" }, LAKE_ENTRIES);
    expect(results.every((r) => r.waterType === "freshwater")).toBe(true);
    expect(results.some((r) => r.id === "ncei-juneau-dem")).toBe(false);
  });

  it("filters by bbox — only returns entries whose coverage overlaps", async () => {
    // Bbox centered on northern Lake George area
    const results = await searchCatalog(
      { minLon: -74.0, minLat: 43.3, maxLon: -73.3, maxLat: 43.9 },
      LAKE_ENTRIES,
    );
    const ids = results.map((r) => r.id);
    expect(ids).toContain("fw-lake-george-ny");
    // Lake Tahoe (Sierra Nevada) should NOT be included
    expect(ids).not.toContain("fw-lake-tahoe");
  });

  it("returns all pre-filtered entries with relevanceScore 1 when query is empty", async () => {
    const results = await searchCatalog({ q: "" }, LAKE_ENTRIES);
    expect(results).toHaveLength(LAKE_ENTRIES.length);
    expect(results.every((r) => r.relevanceScore === 1)).toBe(true);
  });
});
