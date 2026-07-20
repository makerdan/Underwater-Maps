/**
 * Unit tests for the catalogSeeder module — MiniSearch scorer (Track C).
 *
 * Tests run against the static EXTRA_CATALOG_ENTRIES catalog (no DB) by
 * passing entries directly to searchCatalog as the optional _entries argument.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  searchCatalog,
  invalidateMiniSearchIndex,
  EXTRA_CATALOG_ENTRIES,
  buildPresetCatalogEntries,
} from "./catalogSeeder.js";
import type { CatalogSeedEntry } from "./catalogSeeder.js";

// Pull in a rich catalog that covers all test cases. We define entries
// manually so these tests stay fast and don't need a live database.
// The LAKE_ENTRIES array is intentionally broader than what any single
// describe block needs — this lets multiple suites share a single index.
const LAKE_ENTRIES: CatalogSeedEntry[] = [
  // ---------- Freshwater — Northeast ----------
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
    id: "fw-seneca-lake-ny",
    name: "Seneca Lake, NY",
    sourceAgency: "NYSDEC",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -77.1, minLat: 42.6, maxLon: -76.8, maxLat: 42.9 },
    endpointUrl: null,
    accessNotes: "NYSDEC / USGS 3DEP.",
    description: "Seneca Lake — the largest Finger Lake, Schuyler and Seneca counties.",
    keywords: "Seneca Lake,Seneca,Finger Lakes,New York,NY,NYSDEC,freshwater,bathymetry,lake trout,rainbow trout,Watkins Glen",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-cayuga-lake-ny",
    name: "Cayuga Lake, NY",
    sourceAgency: "NYSDEC",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -76.82, minLat: 42.46, maxLon: -76.52, maxLat: 42.9 },
    endpointUrl: null,
    accessNotes: "NYSDEC / USGS 3DEP.",
    description: "Cayuga Lake — the longest Finger Lake, Tompkins and Seneca counties.",
    keywords: "Cayuga Lake,Cayuga,Finger Lakes,New York,NY,NYSDEC,freshwater,bathymetry,Ithaca,Cornell,trout",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  // ---------- Freshwater — Great Lakes ----------
  {
    id: "fw-lake-superior",
    name: "Lake Superior",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -92.2, minLat: 46.3, maxLon: -84.3, maxLat: 49.0 },
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
  // ---------- Freshwater — West ----------
  {
    id: "fw-lake-tahoe-ca-nv",
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
    id: "fw-lake-mead-nv-az",
    name: "Lake Mead, NV/AZ",
    sourceAgency: "USGS/USBR",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -114.85, minLat: 35.9, maxLon: -114.1, maxLat: 36.5 },
    endpointUrl: null,
    accessNotes: "USGS 3DEP WCS.",
    description: "Lake Mead — the largest reservoir in the US by volume, impounded by Hoover Dam.",
    keywords: "Lake Mead,Mead,Colorado River,Hoover Dam,Nevada,NV,Arizona,AZ,West,reservoir,freshwater,USGS,3DEP,USBR,Boulder City,Las Vegas,water supply",
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
  // ---------- Freshwater — Southeast ----------
  {
    id: "fw-lake-okeechobee-fl",
    name: "Lake Okeechobee, FL",
    sourceAgency: "USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -81.1, minLat: 26.75, maxLon: -80.6, maxLat: 27.2 },
    endpointUrl: null,
    accessNotes: "USACE Jacksonville District.",
    description: "Lake Okeechobee — the largest freshwater lake in the contiguous US.",
    keywords: "Lake Okeechobee,Okeechobee,Florida,FL,Glades County,Southeast,freshwater,largemouth bass,bass,crappie,Everglades,USACE,Herbert Hoover Dike",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  // ---------- Freshwater — Southwest / Texas ----------
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
  // ---------- Saltwater — Alaska EFH (regression guard) ----------
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
    description: "Essential Fish Habitat (EFH) for Sablefish (Anoplopoma fimbria), also known as black cod, in the Gulf of Alaska.",
    keywords: "EFH,essential fish habitat,sablefish,black cod,Anoplopoma fimbria,Alaska,GOA,Gulf of Alaska,Kodiak,Seward,groundfish,deepwater,slope,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-bag-mosaic-alaska",
    name: "NCEI Multibeam Bag Mosaic — SE Alaska",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 50,
    coverageBbox: { minLon: -138, minLat: 54, maxLon: -130, maxLat: 60 },
    endpointUrl: null,
    accessNotes: "WCS endpoint.",
    description: "High-resolution multibeam echosounder survey covering Inside Passage including Thorne Bay, Clarence Strait, Ketchikan, Sitka, Juneau.",
    keywords: "Alaska,NCEI,multibeam,inside passage,Thorne Bay,Clarence Strait,Ketchikan,Sitka,Juneau,SE Alaska,saltwater,bathymetry",
    lastUpdated: "2024-06-01",
    waterType: "saltwater",
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

// ---------------------------------------------------------------------------
// Scorer / MiniSearch tests
// ---------------------------------------------------------------------------

describe("searchCatalog — MiniSearch scorer", () => {
  it('returns Lake George NY as top result for "lake george, ny"', async () => {
    const results = await searchCatalog({ q: "lake george, ny" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe("fw-lake-george-ny");
  });

  it('"lake george" (no state) → Lake George NY still appears in top 3', async () => {
    const results = await searchCatalog({ q: "lake george" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    const top3 = results.slice(0, 3).map((r) => r.id);
    expect(top3).toContain("fw-lake-george-ny");
  });

  it('"champlian" (typo) → Lake Champlain appears via fuzzy tolerance', async () => {
    const results = await searchCatalog({ q: "champlian" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("fw-lake-champlain");
  });

  it('"ny lakes" → NY lake entries appear; Lake Travis (TX) does not', async () => {
    const results = await searchCatalog({ q: "ny lakes" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    expect(ids.some((id) => id === "fw-lake-george-ny" || id === "fw-lake-champlain")).toBe(true);
    expect(ids).not.toContain("fw-lake-travis-tx");
  });

  it('returns Lake Superior as top result for "lake superior"', async () => {
    const results = await searchCatalog({ q: "lake superior" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe("fw-lake-superior");
  });

  it('returns Lake Mead as top result for "lake mead"', async () => {
    const results = await searchCatalog({ q: "lake mead" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe("fw-lake-mead-nv-az");
  });

  it('returns Lake Tahoe as top result for "lake tahoe"', async () => {
    const results = await searchCatalog({ q: "lake tahoe" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe("fw-lake-tahoe-ca-nv");
  });

  it('returns Lake Okeechobee as top result for "lake okeechobee"', async () => {
    const results = await searchCatalog({ q: "lake okeechobee" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe("fw-lake-okeechobee-fl");
  });

  it('"noaa efh sablefish" → EFH Sablefish entry is top result (regression)', async () => {
    const results = await searchCatalog({ q: "noaa efh sablefish" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe("noaa-efh-alaska-sablefish");
  });

  it('"thorne bay" → NCEI Alaska entry appears (saltwater regression)', async () => {
    const results = await searchCatalog({ q: "thorne bay" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("ncei-bag-mosaic-alaska");
  });

  it('"lake" alone → multiple results returned, no crash, no single entry dominates', async () => {
    const results = await searchCatalog({ q: "lake" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(3);
    // Top result should not account for everything; verify at least 4 results
    expect(results.length).toBeGreaterThanOrEqual(4);
    // All results should be defined
    results.forEach((r) => {
      expect(r.id).toBeTruthy();
      expect(r.relevanceScore).toBeGreaterThan(0);
    });
  });

  it('"ny" alone → NY lake entries appear; "canyon" entries do not (tokenizer guard)', async () => {
    // Seed a fake "canyon" entry to confirm it is excluded
    const extendedEntries: CatalogSeedEntry[] = [
      ...LAKE_ENTRIES,
      {
        id: "fake-canyon-company",
        name: "Big Canyon Survey Company",
        sourceAgency: "Canyon Co.",
        dataType: "bathymetry",
        resolutionMMin: null,
        resolutionMMax: null,
        coverageBbox: { minLon: -100, minLat: 35, maxLon: -90, maxLat: 40 },
        endpointUrl: null,
        accessNotes: null,
        description: "A canyon survey company with no New York connection.",
        keywords: "canyon,survey,company,flatlands",
        lastUpdated: null,
        waterType: "freshwater",
      },
    ];
    invalidateMiniSearchIndex();
    const results = await searchCatalog({ q: "ny" }, extendedEntries);
    const ids = results.map((r) => r.id);
    expect(ids.some((id) => id === "fw-lake-george-ny" || id === "fw-lake-champlain")).toBe(true);
    expect(ids).not.toContain("fake-canyon-company");
  });

  it('waterType: "saltwater" filter → no freshwater entries returned', async () => {
    const results = await searchCatalog({ waterType: "saltwater" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.waterType === "saltwater")).toBe(true);
    const freshIds = results.filter((r) => r.waterType === "freshwater").map((r) => r.id);
    expect(freshIds).toHaveLength(0);
  });

  it('waterType: "freshwater" filter → no saltwater entries returned', async () => {
    const results = await searchCatalog({ waterType: "freshwater" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.waterType === "freshwater")).toBe(true);
    expect(results.some((r) => r.id === "ncei-juneau-dem")).toBe(false);
    expect(results.some((r) => r.id === "noaa-efh-alaska-sablefish")).toBe(false);
  });

  it("filters by bbox — only returns entries whose coverage overlaps", async () => {
    const results = await searchCatalog(
      { minLon: -74.0, minLat: 43.3, maxLon: -73.3, maxLat: 43.9 },
      LAKE_ENTRIES,
    );
    const ids = results.map((r) => r.id);
    expect(ids).toContain("fw-lake-george-ny");
    // Lake Tahoe (Sierra Nevada) should NOT be included
    expect(ids).not.toContain("fw-lake-tahoe-ca-nv");
    // Lake Mead (Nevada) should NOT be included
    expect(ids).not.toContain("fw-lake-mead-nv-az");
  });

  it("returns all pre-filtered entries with relevanceScore 1 when query is empty", async () => {
    const results = await searchCatalog({ q: "" }, LAKE_ENTRIES);
    expect(results).toHaveLength(LAKE_ENTRIES.length);
    expect(results.every((r) => r.relevanceScore === 1)).toBe(true);
  });

  it('"texas highland lakes" → Lake Travis appears (keyword match)', async () => {
    const results = await searchCatalog({ q: "texas highland lakes" }, LAKE_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("fw-lake-travis-tx");
  });
});

// ---------------------------------------------------------------------------
// Abbreviation normalization tests
// ---------------------------------------------------------------------------

describe("searchCatalog — state abbreviation normalization", () => {
  it('"ny" query matches "New York" in entry keywords', async () => {
    const results = await searchCatalog({ q: "lake ny" }, LAKE_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids.some((id) => id === "fw-lake-george-ny" || id === "fw-lake-champlain")).toBe(true);
  });

  it('"new york" query matches "NY" abbreviation in entry keywords', async () => {
    const results = await searchCatalog({ q: "lake new york" }, LAKE_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids.some((id) => id === "fw-lake-george-ny" || id === "fw-lake-champlain")).toBe(true);
  });

  it('"mn" abbreviation matches Minnesota lake entries via expansion', async () => {
    const mnEntries: CatalogSeedEntry[] = [
      ...LAKE_ENTRIES,
      {
        id: "fw-lake-minnetonka-mn",
        name: "Lake Minnetonka, MN",
        sourceAgency: "MN DNR",
        dataType: "bathymetry",
        resolutionMMin: null,
        resolutionMMax: null,
        coverageBbox: { minLon: -93.65, minLat: 44.88, maxLon: -93.43, maxLat: 44.97 },
        endpointUrl: null,
        accessNotes: "MN DNR ArcGIS REST.",
        description: "Lake Minnetonka — recreational lake in Hennepin County, Minnesota.",
        keywords: "Lake Minnetonka,Minnesota,MN,Hennepin County,Midwest,freshwater,walleye,bass,MN DNR",
        lastUpdated: null,
        waterType: "freshwater",
      },
    ];
    invalidateMiniSearchIndex();
    const results = await searchCatalog({ q: "mn lake" }, mnEntries);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("fw-lake-minnetonka-mn");
  });

  it('"ca" abbreviation matches California lake entries via expansion', async () => {
    const results = await searchCatalog({ q: "ca lake" }, LAKE_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("fw-lake-tahoe-ca-nv");
  });

  it('"minnesota" full name matches "MN" abbreviation in keywords', async () => {
    const mnEntries: CatalogSeedEntry[] = [
      ...LAKE_ENTRIES,
      {
        id: "fw-mille-lacs-mn",
        name: "Mille Lacs Lake, MN",
        sourceAgency: "MN DNR",
        dataType: "bathymetry",
        resolutionMMin: null,
        resolutionMMax: null,
        coverageBbox: { minLon: -93.83, minLat: 46.21, maxLon: -93.44, maxLat: 46.45 },
        endpointUrl: null,
        accessNotes: null,
        description: "Mille Lacs Lake — second-largest lake entirely within Minnesota.",
        keywords: "Mille Lacs,Minnesota,MN,walleye,freshwater,MN DNR",
        lastUpdated: null,
        waterType: "freshwater",
      },
    ];
    invalidateMiniSearchIndex();
    const results = await searchCatalog({ q: "minnesota lake" }, mnEntries);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("fw-mille-lacs-mn");
  });
});

// ---------------------------------------------------------------------------
// Catalog entry presence sentinel (EXTRA_CATALOG_ENTRIES)
// ---------------------------------------------------------------------------

describe("EXTRA_CATALOG_ENTRIES — catalog presence sentinel", () => {
  const REQUIRED_FRESHWATER_IDS = [
    // Great Lakes
    "fw-lake-superior",
    "fw-lake-michigan",
    "fw-lake-huron",
    "fw-lake-erie",
    "fw-lake-ontario",
    // Northeast
    "fw-lake-george-ny",
    "fw-lake-champlain",
    "fw-seneca-lake-ny",
    "fw-cayuga-lake-ny",
    "fw-oneida-lake-ny",
    "fw-lake-placid-ny",
    "fw-saranac-lake-ny",
    "fw-lake-winnipesaukee-nh",
    "fw-sebago-lake-me",
    "fw-moosehead-lake-me",
    "fw-quabbin-reservoir-ma",
    "fw-lake-memphremagog-vt",
    // Midwest
    "fw-lake-minnetonka-mn",
    "fw-mille-lacs-lake-mn",
    "fw-leech-lake-mn",
    "fw-red-lake-mn",
    "fw-lake-of-the-woods-mn",
    "fw-lake-winnebago-wi",
    "fw-gull-lake-mi",
    // Western
    "fw-lake-tahoe-ca-nv",
    "fw-lake-powell-az-ut",
    "fw-lake-mead-nv-az",
    "fw-crater-lake-or",
    "fw-flathead-lake-mt",
    "fw-shasta-lake-ca",
    "fw-lake-chelan-wa",
    "fw-upper-klamath-lake-or",
    "fw-flaming-gorge-ut-wy",
    "fw-lake-havasu-az-ca",
    // Southeast
    "fw-lake-okeechobee-fl",
    "fw-lake-lanier-ga",
    "fw-lake-of-the-ozarks-mo",
    "fw-table-rock-lake-mo",
    "fw-kentucky-lake-ky-tn",
    "fw-lake-barkley-ky-tn",
    "fw-norris-lake-tn",
    "fw-fontana-lake-nc",
    "fw-smith-mountain-lake-va",
    "fw-clarks-hill-lake-sc-ga",
    // Texas / Southwest
    "fw-lake-travis-tx",
    "fw-canyon-lake-tx",
    "fw-lake-lbj-tx",
    "fw-inks-lake-tx",
    "fw-lake-buchanan-tx",
    "fw-elephant-butte-nm",
    "fw-cochiti-lake-nm",
    "fw-navajo-lake-nm-co",
  ] as const;

  const REQUIRED_SALTWATER_IDS = [
    "noaa-efh-alaska-sablefish",
    "noaa-efh-alaska-pollock",
    "noaa-efh-alaska-halibut",
    "noaa-efh-alaska-pcod",
    "noaa-efh-alaska-rockfish",
    "noaa-efh-alaska-chinook-salmon",
    "noaa-efh-alaska-pink-salmon",
    "ncei-bag-mosaic-alaska",
    "gebco-2024-global",
  ] as const;

  const entryMap = new Map(EXTRA_CATALOG_ENTRIES.map((e) => [e.id, e]));

  it("contains all required freshwater lake IDs", () => {
    const missing = REQUIRED_FRESHWATER_IDS.filter((id) => !entryMap.has(id));
    expect(missing, `Missing freshwater catalog entries: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("contains all required saltwater IDs (regression)", () => {
    const missing = REQUIRED_SALTWATER_IDS.filter((id) => !entryMap.has(id));
    expect(missing, `Missing saltwater catalog entries: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("every freshwater entry has waterType: freshwater, dataType: bathymetry, non-empty coverageBbox, and non-empty keywords", () => {
    const freshwaterEntries = EXTRA_CATALOG_ENTRIES.filter((e) =>
      REQUIRED_FRESHWATER_IDS.includes(e.id as typeof REQUIRED_FRESHWATER_IDS[number]),
    );
    for (const entry of freshwaterEntries) {
      expect(entry.waterType, `${entry.id} waterType`).toBe("freshwater");
      expect(entry.dataType, `${entry.id} dataType`).toBe("bathymetry");
      expect(entry.coverageBbox, `${entry.id} coverageBbox`).toBeTruthy();
      expect(typeof entry.coverageBbox.minLon, `${entry.id} coverageBbox.minLon`).toBe("number");
      expect(typeof entry.coverageBbox.maxLon, `${entry.id} coverageBbox.maxLon`).toBe("number");
      expect(typeof entry.coverageBbox.minLat, `${entry.id} coverageBbox.minLat`).toBe("number");
      expect(typeof entry.coverageBbox.maxLat, `${entry.id} coverageBbox.maxLat`).toBe("number");
      expect(entry.keywords, `${entry.id} keywords`).toBeTruthy();
      expect((entry.keywords ?? "").length, `${entry.id} keywords non-empty`).toBeGreaterThan(0);
    }
  });

  it("no freshwater ID accidentally has waterType: saltwater", () => {
    for (const id of REQUIRED_FRESHWATER_IDS) {
      const entry = entryMap.get(id);
      if (entry) {
        expect(entry.waterType, `${id} should be freshwater`).toBe("freshwater");
      }
    }
  });

  it("coverageBbox coordinates are geographically plausible for each entry", () => {
    for (const entry of EXTRA_CATALOG_ENTRIES) {
      const { minLon, maxLon, minLat, maxLat } = entry.coverageBbox;
      expect(minLon, `${entry.id}: minLon >= -180`).toBeGreaterThanOrEqual(-180);
      expect(maxLon, `${entry.id}: maxLon <= 180`).toBeLessThanOrEqual(180);
      expect(minLat, `${entry.id}: minLat >= -90`).toBeGreaterThanOrEqual(-90);
      expect(maxLat, `${entry.id}: maxLat <= 90`).toBeLessThanOrEqual(90);
      expect(minLon, `${entry.id}: minLon < maxLon`).toBeLessThan(maxLon);
      expect(minLat, `${entry.id}: minLat < maxLat`).toBeLessThan(maxLat);
    }
  });

  it("all IDs in EXTRA_CATALOG_ENTRIES are unique (no duplicates)", () => {
    const ids = EXTRA_CATALOG_ENTRIES.map((e) => e.id);
    const unique = new Set(ids);
    expect(unique.size, "Duplicate IDs found in EXTRA_CATALOG_ENTRIES").toBe(ids.length);
  });

  it("contains more than 50 total entries (scale sentinel)", () => {
    expect(EXTRA_CATALOG_ENTRIES.length).toBeGreaterThan(50);
  });

  it("freshwater entries total exceeds 45 (coverage scale sentinel)", () => {
    const freshwaterCount = EXTRA_CATALOG_ENTRIES.filter((e) => e.waterType === "freshwater").length;
    expect(freshwaterCount).toBeGreaterThan(45);
  });
});

// ---------------------------------------------------------------------------
// buildPresetCatalogEntries — duplicate-ID guard
// ---------------------------------------------------------------------------

describe("buildPresetCatalogEntries — duplicate-ID guard", () => {
  it("returns entries without throwing (ALL_PRESET_DATASETS has no duplicate IDs)", () => {
    expect(() => buildPresetCatalogEntries()).not.toThrow();
  });

  it("all preset catalog IDs are unique (no duplicates in ALL_PRESET_DATASETS)", () => {
    const entries = buildPresetCatalogEntries();
    const ids = entries.map((e) => e.id);
    const unique = new Set(ids);
    expect(unique.size, "Duplicate IDs found in buildPresetCatalogEntries()").toBe(ids.length);
  });

  it("all preset catalog IDs have the 'preset-' prefix", () => {
    const entries = buildPresetCatalogEntries();
    for (const entry of entries) {
      expect(entry.id, `Entry '${entry.id}' is missing the 'preset-' prefix`).toMatch(/^preset-/);
    }
  });

  it("combined EXTRA_CATALOG_ENTRIES + preset catalog has no duplicate IDs", () => {
    const presetEntries = buildPresetCatalogEntries();
    const allIds = [
      ...EXTRA_CATALOG_ENTRIES.map((e) => e.id),
      ...presetEntries.map((e) => e.id),
    ];
    const unique = new Set(allIds);
    expect(
      unique.size,
      "Duplicate IDs found across EXTRA_CATALOG_ENTRIES and buildPresetCatalogEntries()",
    ).toBe(allIds.length);
  });
});
