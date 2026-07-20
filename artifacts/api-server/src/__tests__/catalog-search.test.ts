/**
 * catalog-search.test.ts — Unit tests for the dataset catalog search logic.
 *
 * Tests scoreEntry() and searchCatalog() from catalogSeeder.ts.
 * searchCatalog() accepts optional injected entries so no DB mocking is needed.
 *
 * All keyword-sensitive tests consume EXTRA_CATALOG_ENTRIES directly so that
 * any change to the real seed data is immediately reflected here — no
 * hand-copied fixtures that can drift.
 *
 * Structural filter tests (waterType, bbox) that need entry shapes not present
 * in EXTRA_CATALOG_ENTRIES (e.g. a freshwater lake) use a single synthetic
 * fixture that does NOT duplicate keyword data from the seeder.
 *
 * Fixture freshness: the final describe block verifies that every id in
 * EXTRA_CATALOG_ENTRIES is referenced at least once in this file. Add a test
 * for any new catalog entry before adding it to catalogSeeder.ts, or the
 * freshness check will fail the build.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { scoreEntry, searchCatalog, EXTRA_CATALOG_ENTRIES } from "../lib/catalogSeeder.js";
import type { CatalogSeedEntry } from "../lib/catalogSeeder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a seed entry by id and fail fast if the id has changed. */
function getEntry(id: string): CatalogSeedEntry {
  const entry = EXTRA_CATALOG_ENTRIES.find((e) => e.id === id);
  if (!entry) {
    throw new Error(
      `Seed entry "${id}" not found in EXTRA_CATALOG_ENTRIES — ` +
        `update this test if the id was renamed in catalogSeeder.ts`,
    );
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Synthetic freshwater fixture
//
// EXTRA_CATALOG_ENTRIES now contains both saltwater and freshwater entries.
// This synthetic fixture still exercises the waterType filter mechanic in
// isolation — the count assertion in the freshwater filter test is computed
// dynamically so it stays correct as new fw-* entries are added.
// ---------------------------------------------------------------------------

const FRESHWATER_FIXTURE: CatalogSeedEntry = {
  id: "test-freshwater-lake",
  name: "Test — Freshwater Lake (synthetic)",
  sourceAgency: "Test / Synthetic",
  dataType: "bathymetry",
  resolutionMMin: 400,
  resolutionMMax: 400,
  coverageBbox: { minLon: 103.7, minLat: 51.5, maxLon: 109.9, maxLat: 55.8 },
  endpointUrl: null,
  accessNotes: null,
  description: "Synthetic freshwater lake entry used only to test waterType filtering.",
  keywords: "freshwater,lake,bathymetry,test",
  lastUpdated: "2024-01-01",
  waterType: "freshwater",
};

/** EXTRA_CATALOG_ENTRIES supplemented with the synthetic freshwater fixture. */
const SEEDED_PLUS_FRESHWATER = [...EXTRA_CATALOG_ENTRIES, FRESHWATER_FIXTURE];

// ---------------------------------------------------------------------------
// scoreEntry tests — pure function, no mocking needed.
// Entries are looked up from the real seed data so keyword changes are caught.
// ---------------------------------------------------------------------------

describe("scoreEntry", () => {
  it("returns 1 for empty terms (show-all mode)", () => {
    expect(scoreEntry(getEntry("gebco-2024-global"), [])).toBe(1);
  });

  it("returns 1 when all terms match", () => {
    const score = scoreEntry(getEntry("gebco-2024-global"), ["gebco", "global"]);
    expect(score).toBe(1);
  });

  it("returns 0 when no terms match", () => {
    const score = scoreEntry(getEntry("gebco-2024-global"), ["mariana", "trench"]);
    expect(score).toBe(0);
  });

  it("returns partial score for partial matches", () => {
    const score = scoreEntry(getEntry("noaa-efh-alaska-rockfish"), ["rockfish", "mariana"]);
    expect(score).toBe(0.5);
  });

  it("is case-insensitive", () => {
    const score = scoreEntry(getEntry("gebco-2024-global"), ["GEBCO", "GLOBAL"]);
    expect(score).toBe(1);
  });

  it("matches keywords field", () => {
    const score = scoreEntry(getEntry("noaa-efh-alaska-rockfish"), ["efh"]);
    expect(score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// searchCatalog tests — injected entries, no DB or mocking needed.
// ---------------------------------------------------------------------------

describe("searchCatalog", () => {
  it("returns all entries when no query given", async () => {
    const results = await searchCatalog({}, EXTRA_CATALOG_ENTRIES);
    expect(results.length).toBe(EXTRA_CATALOG_ENTRIES.length);
    results.forEach((r) => expect(r.relevanceScore).toBe(1));
  });

  it("filters by dataType", async () => {
    const results = await searchCatalog({ dataType: "habitat" }, EXTRA_CATALOG_ENTRIES);
    expect(results.every((r) => r.dataType === "habitat")).toBe(true);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-rockfish");
    expect(ids).toContain("noaa-efh-alaska-pollock");
    expect(ids).toContain("noaa-efh-alaska-sablefish");
    expect(ids).toContain("noaa-efh-alaska-arrowtooth");
  });

  it("filters by waterType freshwater", async () => {
    const results = await searchCatalog({ waterType: "freshwater" }, SEEDED_PLUS_FRESHWATER);
    expect(results.every((r) => r.waterType === "freshwater")).toBe(true);
    const fwCountInSeeded = EXTRA_CATALOG_ENTRIES.filter((e) => e.waterType === "freshwater").length;
    expect(results.length).toBe(fwCountInSeeded + 1);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("test-freshwater-lake");
  });

  it("filters by dataType + waterType together", async () => {
    const results = await searchCatalog(
      { dataType: "bathymetry", waterType: "saltwater" },
      EXTRA_CATALOG_ENTRIES,
    );
    expect(results.every((r) => r.dataType === "bathymetry" && r.waterType === "saltwater")).toBe(true);
  });

  it("returns empty array when no entries match filters", async () => {
    // EXTRA_CATALOG_ENTRIES has no freshwater lidar entries.
    const results = await searchCatalog({ dataType: "lidar", waterType: "freshwater" }, EXTRA_CATALOG_ENTRIES);
    expect(results).toHaveLength(0);
  });

  it("ranks gebco-2024-global highest for 'gebco global' query", async () => {
    const results = await searchCatalog({ q: "gebco global" }, EXTRA_CATALOG_ENTRIES);
    expect(results[0]!.id).toBe("gebco-2024-global");
    expect(results[0]!.relevanceScore).toBe(1);
  });

  it("excludes entries with zero relevance when q is set", async () => {
    const results = await searchCatalog({ q: "rockfish habitat" }, EXTRA_CATALOG_ENTRIES);
    expect(results.every((r) => r.relevanceScore > 0)).toBe(true);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-rockfish");
    // gebco-2024-global has no rockfish or habitat keywords — it must be excluded.
    expect(ids).not.toContain("gebco-2024-global");
  });

  it("filters by bounding box overlap", async () => {
    // Query bbox sits in SE Alaska at roughly (-133, 55.2) → (-132, 56).
    // NCEI bag mosaic covers all of Alaska (-170, 54, -130, 72) — must be included.
    // The synthetic freshwater lake is in central Russia — must be excluded.
    const results = await searchCatalog(
      { minLon: -133, minLat: 55.2, maxLon: -132, maxLat: 56 },
      SEEDED_PLUS_FRESHWATER,
    );
    const ids = results.map((r) => r.id);
    expect(ids).toContain("ncei-bag-mosaic-alaska");
    expect(ids).toContain("gebco-2024-global");
    expect(ids).not.toContain("test-freshwater-lake");
  });

  it("combines query with bbox filter", async () => {
    const results = await searchCatalog(
      { q: "rockfish", minLon: -170, minLat: 50, maxLon: -130, maxLat: 72 },
      EXTRA_CATALOG_ENTRIES,
    );
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-rockfish");
  });

  it("includes relevanceScore between 0 and 1 in every result", async () => {
    const results = await searchCatalog({ q: "alaska" }, EXTRA_CATALOG_ENTRIES);
    results.forEach((r) => {
      expect(typeof r.relevanceScore).toBe("number");
      expect(r.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(r.relevanceScore).toBeLessThanOrEqual(1);
    });
  });

  it("includes lidar dataType results for lidar query", async () => {
    const results = await searchCatalog({ q: "lidar" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("usgs-coned-lidar-alaska");
  });

  it("returns the walleye pollock EFH entry when searching 'pollock'", async () => {
    const results = await searchCatalog({ q: "pollock" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-pollock");
  });

  it("returns the sablefish EFH entry when searching 'sablefish'", async () => {
    const results = await searchCatalog({ q: "sablefish" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-sablefish");
  });

  it("returns the arrowtooth flounder EFH entry when searching 'arrowtooth'", async () => {
    const results = await searchCatalog({ q: "arrowtooth" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-arrowtooth");
  });

  it("returns groundfish entries when searching 'groundfish'", async () => {
    const results = await searchCatalog({ q: "groundfish" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-pollock");
    expect(ids).toContain("noaa-efh-alaska-sablefish");
    expect(ids).toContain("noaa-efh-alaska-arrowtooth");
  });

  it("returns the sablefish entry when searching 'black cod'", async () => {
    const results = await searchCatalog({ q: "black cod" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-sablefish");
  });

  it("filters habitat dataType to include all groundfish EFH entries", async () => {
    const results = await searchCatalog({ dataType: "habitat" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-pollock");
    expect(ids).toContain("noaa-efh-alaska-sablefish");
    expect(ids).toContain("noaa-efh-alaska-arrowtooth");
    expect(results.every((r) => r.dataType === "habitat")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Southern-Alaska location keyword tests — run against the real seed data so
// any regression in EXTRA_CATALOG_ENTRIES is caught immediately.
// ---------------------------------------------------------------------------

describe("searchCatalog — Southern Alaska location keyword coverage", () => {
  it("'halibut Kodiak' returns the noaa-efh-alaska-halibut entry", async () => {
    const results = await searchCatalog({ q: "halibut Kodiak" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-halibut");
  });

  it("'salmon Homer' returns at least one salmon EFH entry", async () => {
    const results = await searchCatalog({ q: "salmon Homer" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    const salmonIds = [
      "noaa-efh-alaska-chinook-salmon",
      "noaa-efh-alaska-pink-salmon",
      "noaa-efh-alaska-chum-salmon",
      "noaa-efh-alaska-sockeye-salmon",
      "noaa-efh-alaska-coho-salmon",
    ];
    const matched = salmonIds.filter((sid) => ids.includes(sid));
    expect(matched.length).toBeGreaterThanOrEqual(1);
  });

  it("'pollock Prince William Sound' returns the noaa-efh-alaska-pollock entry", async () => {
    const results = await searchCatalog({ q: "pollock Prince William Sound" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-pollock");
  });

  it("'halibut Kodiak' does not return unrelated freshwater or non-Alaska entries", async () => {
    const results = await searchCatalog({ q: "halibut Kodiak" }, EXTRA_CATALOG_ENTRIES);
    expect(results.every((r) => r.relevanceScore > 0)).toBe(true);
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain("alaska-shorezone-substrate");
    expect(ids).not.toContain("usgs-coned-lidar-alaska");
  });

  it("'salmon Homer' results all have relevanceScore > 0", async () => {
    const results = await searchCatalog({ q: "salmon Homer" }, EXTRA_CATALOG_ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => expect(r.relevanceScore).toBeGreaterThan(0));
  });
});

// ---------------------------------------------------------------------------
// Coverage tests for catalog entries not exercised in the sections above.
//
// Each test below ensures at least one search query returns the entry so that
// the fixture-freshness check (at the bottom of this file) remains green.
// ---------------------------------------------------------------------------

describe("searchCatalog — additional entry coverage", () => {
  it("returns ncei-dem-global-mosaic for 'DEM global mosaic' query", async () => {
    const results = await searchCatalog({ q: "DEM global mosaic" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("ncei-dem-global-mosaic");
  });

  it("returns noaa-efh-alaska-pcod for 'Pacific cod' query", async () => {
    const results = await searchCatalog({ q: "Pacific cod" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-pcod");
  });

  it("returns noaa-enc-se-alaska for 'navigational chart ENC' query", async () => {
    const results = await searchCatalog({ q: "navigational chart ENC" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-enc-se-alaska");
  });

  it("returns noaa-efh-alaska-spotted-prawn for 'spotted prawn' query", async () => {
    const results = await searchCatalog({ q: "spotted prawn" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-spotted-prawn");
  });

  it("returns noaa-efh-alaska-turbot for 'turbot' query", async () => {
    const results = await searchCatalog({ q: "turbot" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-turbot");
  });

  it("returns noaa-efh-alaska-rex-sole for 'rex sole' query", async () => {
    const results = await searchCatalog({ q: "rex sole" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-rex-sole");
  });

  it("returns noaa-efh-alaska-tomcod for 'tomcod' query", async () => {
    const results = await searchCatalog({ q: "tomcod" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-tomcod");
  });

  it("returns noaa-efh-alaska-juvenile-rockfish for 'juvenile rockfish' query", async () => {
    const results = await searchCatalog({ q: "juvenile rockfish" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-juvenile-rockfish");
  });

  it("returns noaa-efh-alaska-dungeness-crab for 'Dungeness crab' query", async () => {
    const results = await searchCatalog({ q: "Dungeness crab" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-dungeness-crab");
  });

  it("returns noaa-efh-alaska-tanner-crab for 'Tanner crab' query", async () => {
    const results = await searchCatalog({ q: "Tanner crab" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-tanner-crab");
  });

  it("returns noaa-efh-alaska-black-rockfish for 'black rockfish Sitka' query", async () => {
    const results = await searchCatalog({ q: "black rockfish Sitka" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-black-rockfish");
  });

  it("returns noaa-efh-alaska-quillback-rockfish for 'quillback rockfish' query", async () => {
    const results = await searchCatalog({ q: "quillback rockfish" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-efh-alaska-quillback-rockfish");
  });

  it("returns adfg-intertidal-clam-habitat-se-alaska for 'razor clam intertidal' query", async () => {
    const results = await searchCatalog({ q: "razor clam intertidal" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("adfg-intertidal-clam-habitat-se-alaska");
  });

  it("returns noaa-shorezone-tidal-pools-se-alaska for 'tidal pool rocky intertidal' query", async () => {
    const results = await searchCatalog({ q: "tidal pool rocky intertidal" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-shorezone-tidal-pools-se-alaska");
  });

  it("returns noaa-shorezone-beachcombing-se-alaska for 'beachcombing shoreline' query", async () => {
    const results = await searchCatalog({ q: "beachcombing shoreline" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("noaa-shorezone-beachcombing-se-alaska");
  });

  it("returns ncei-crm-s-alaska for 'Coastal Relief Model southern Alaska' query", async () => {
    const results = await searchCatalog({ q: "Coastal Relief Model southern Alaska" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("ncei-crm-s-alaska");
  });

  it("returns ncei-crm-kodiak-island for 'Kodiak Island bathymetry' query", async () => {
    const results = await searchCatalog({ q: "Kodiak Island bathymetry" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("ncei-crm-kodiak-island");
  });

  it("returns ncei-crm-kachemak-bay for 'Kachemak Bay Homer bathymetry' query", async () => {
    const results = await searchCatalog({ q: "Kachemak Bay Homer bathymetry" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("ncei-crm-kachemak-bay");
  });

  it("returns ncei-crm-resurrection-bay for 'Resurrection Bay Seward' query", async () => {
    const results = await searchCatalog({ q: "Resurrection Bay Seward" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("ncei-crm-resurrection-bay");
  });

  it("returns ncei-crm-prince-william-sound for 'Prince William Sound Valdez' query", async () => {
    const results = await searchCatalog({ q: "Prince William Sound Valdez" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("ncei-crm-prince-william-sound");
  });

  it("returns aoos-intertidal-pow for 'Prince of Wales Island intertidal AOOS' query", async () => {
    const results = await searchCatalog({ q: "Prince of Wales Island intertidal AOOS" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("aoos-intertidal-pow");
  });

  it("returns alaska-shorezone-substrate for 'ShoreZone substrate CMECS' query", async () => {
    const results = await searchCatalog({ q: "ShoreZone substrate CMECS" }, EXTRA_CATALOG_ENTRIES);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("alaska-shorezone-substrate");
  });
});

// ---------------------------------------------------------------------------
// Keyword coverage guard
//
// PRIMARY_KEYWORD_QUERIES maps every EXTRA_CATALOG_ENTRIES id to a short
// representative query using the entry's primary species / common-name /
// location terms — NOT the full catalog entry name.  The describe block
// below uses these queries to call searchCatalog() and assert that each
// entry actually surfaces in results.  This goes further than the
// fixture-freshness check: a keyword misspelling or accidental strip inside
// catalogSeeder.ts will fail one of these tests immediately, before the
// broken keyword ever reaches production.
//
// Rules for maintaining this map:
//   • Use species names, common names, or location terms — never the full
//     entry name or a generic word like "Alaska" or "EFH" alone.
//   • One query per entry is sufficient; choose tokens that are distinctive
//     to that entry (or at least to a small subset of entries).
//   • Adding a new id to EXTRA_CATALOG_ENTRIES without updating this map
//     will fail the "coverage completeness" test below.
// ---------------------------------------------------------------------------

const PRIMARY_KEYWORD_QUERIES: Record<string, string> = {
  "gebco-2024-global":                       "GEBCO global ocean",
  "ncei-bag-mosaic-alaska":                  "multibeam inside passage",
  "ncei-dem-global-mosaic":                  "community DEM Juneau",
  "noaa-efh-alaska-pcod":                    "Pacific cod Kodiak",
  "noaa-efh-alaska-halibut":                 "halibut Hippoglossus",
  "noaa-efh-alaska-rockfish":                "yelloweye rockfish kelp",
  "noaa-efh-alaska-pollock":                 "walleye pollock Gadus chalcogrammus",
  "noaa-efh-alaska-sablefish":               "sablefish black cod Anoplopoma",
  "noaa-efh-alaska-arrowtooth":              "arrowtooth flounder Atheresthes",
  "alaska-shorezone-substrate":              "ShoreZone substrate CMECS",
  "usgs-coned-lidar-alaska":                 "lidar CoNED coastal elevation",
  "noaa-enc-se-alaska":                      "navigational ENC soundings nautical",
  "noaa-efh-alaska-spotted-prawn":           "spotted prawn Pandalus platyceros",
  "noaa-efh-alaska-turbot":                  "Greenland turbot Reinhardtius",
  "noaa-efh-alaska-rex-sole":                "rex sole Glyptocephalus",
  "noaa-efh-alaska-tomcod":                  "tomcod Microgadus proximus",
  "noaa-efh-alaska-juvenile-rockfish":       "juvenile rockfish nursery Sebastes",
  "noaa-efh-alaska-chinook-salmon":          "Chinook salmon king Oncorhynchus tshawytscha",
  "noaa-efh-alaska-pink-salmon":             "pink salmon humpback Oncorhynchus gorbuscha",
  "noaa-efh-alaska-chum-salmon":             "chum salmon dog Oncorhynchus keta",
  "noaa-efh-alaska-sockeye-salmon":          "sockeye salmon red Oncorhynchus nerka",
  "noaa-efh-alaska-coho-salmon":             "coho salmon silver Oncorhynchus kisutch",
  "noaa-efh-alaska-dungeness-crab":          "Dungeness crab Metacarcinus magister",
  "noaa-efh-alaska-tanner-crab":             "Tanner crab Chionoecetes bairdi",
  "noaa-efh-alaska-black-rockfish":          "black rockfish Sitka Sebastes melanops",
  "noaa-efh-alaska-quillback-rockfish":      "quillback rockfish Sebastes maliger",
  "adfg-intertidal-clam-habitat-se-alaska":  "razor clam intertidal Siliqua",
  "noaa-shorezone-tidal-pools-se-alaska":    "tidal pool rocky intertidal barnacle",
  "noaa-shorezone-beachcombing-se-alaska":   "beachcombing shoreline cobble wrack",
  "ncei-crm-s-alaska":                       "Coastal Relief Model Gulf Alaska",
  "ncei-crm-kodiak-island":                  "Kodiak Island Chiniak Bay bathymetry",
  "ncei-crm-kachemak-bay":                   "Kachemak Bay Homer Cook Inlet",
  "ncei-crm-resurrection-bay":               "Resurrection Bay Seward Kenai Fjords",
  "ncei-crm-prince-william-sound":           "Prince William Sound Valdez PWS",
  "aoos-intertidal-pow":                     "Prince of Wales Island AOOS intertidal",
  // -------------------------------------------------------------------------
  // Freshwater lake catalog entries
  // -------------------------------------------------------------------------
  "fw-lake-of-the-woods-mn":                 "Lake of the Woods Minnesota walleye sauger",
  "fw-lake-tahoe-ca-nv":                     "Lake Tahoe ScienceBase Sierra Nevada clarity",
  "fw-lake-powell-az-ut":                    "Lake Powell Glen Canyon Arizona Utah",
  "fw-lake-mead-nv-az":                      "Lake Mead Hoover Dam Nevada",
  "fw-flaming-gorge-ut-wy":                  "Flaming Gorge Utah Wyoming Green River",
  "fw-lake-havasu-az-ca":                    "Lake Havasu Arizona Parker Dam",
  "fw-kentucky-lake-ky-tn":                  "Kentucky Lake Tennessee River Kentucky",
  "fw-lake-barkley-ky-tn":                   "Lake Barkley Barkley Dam Cumberland River",
  "fw-clarks-hill-lake-sc-ga":               "Clarks Hill Lake Savannah River Georgia",
  "fw-navajo-lake-nm-co":                    "Navajo Lake San Juan River Colorado New Mexico",
  "fw-lake-superior":                        "Lake Superior Duluth Minnesota Great Lakes",
  "fw-lake-michigan":                        "Lake Michigan Chicago Illinois Great Lakes",
  "fw-lake-huron":                           "Lake Huron Georgian Bay Michigan Great Lakes",
  "fw-lake-erie":                            "Lake Erie Cleveland walleye perch Ohio",
  "fw-lake-ontario":                         "Lake Ontario Rochester New York Great Lakes",
  "fw-lake-george-ny":                       "Lake George Adirondack New York",
  "fw-lake-champlain":                       "Lake Champlain Vermont New York",
  "fw-seneca-lake-ny":                       "Seneca Lake Finger Lakes New York",
  "fw-cayuga-lake-ny":                       "Cayuga Lake Ithaca Finger Lakes New York",
  "fw-oneida-lake-ny":                       "Oneida Lake walleye New York",
  "fw-canandaigua-lake-ny":                  "Canandaigua Lake Finger Lakes New York",
  "fw-keuka-lake-ny":                        "Keuka Lake Y-shaped Finger Lakes New York",
  "fw-lake-placid-ny":                       "Lake Placid Adirondack Olympic New York",
  "fw-saranac-lake-ny":                      "Saranac Lake Adirondack New York",
  "fw-lake-winnipesaukee-nh":                "Lake Winnipesaukee New Hampshire",
  "fw-sebago-lake-me":                       "Sebago Lake Maine landlocked salmon",
  "fw-moosehead-lake-me":                    "Moosehead Lake Maine lake trout",
  "fw-quabbin-reservoir-ma":                 "Quabbin Reservoir Massachusetts",
  "fw-lake-memphremagog-vt":                 "Lake Memphremagog Vermont Quebec",
  "fw-lake-minnetonka-mn":                   "Lake Minnetonka Minneapolis Minnesota",
  "fw-mille-lacs-lake-mn":                   "Mille Lacs Lake Minnesota walleye",
  "fw-leech-lake-mn":                        "Leech Lake Minnesota northern pike",
  "fw-red-lake-mn":                          "Red Lake Minnesota walleye",
  "fw-lake-of-the-woods":                    "Lake of the Woods Ontario Manitoba walleye",
  "fw-lake-winnebago-wi":                    "Lake Winnebago Wisconsin sturgeon",
  "fw-gull-lake-mi":                         "Gull Lake Michigan Kalamazoo",
  "fw-lake-tahoe":                           "Lake Tahoe alpine trout clarity",
  "fw-lake-powell":                          "Lake Powell Colorado Plateau reservoir",
  "fw-lake-mead":                            "Lake Mead Boulder City striped bass",
  "fw-crater-lake-or":                       "Crater Lake Oregon volcanic caldera",
  "fw-flathead-lake-mt":                     "Flathead Lake Montana",
  "fw-shasta-lake-ca":                       "Shasta Lake California Sacramento River",
  "fw-lake-chelan-wa":                       "Lake Chelan Washington fjord",
  "fw-upper-klamath-lake-or":               "Upper Klamath Lake Oregon",
  "fw-flaming-gorge":                        "Flaming Gorge Green River Wyoming reservoir",
  "fw-lake-havasu":                          "Lake Havasu Colorado River Parker",
  "fw-lake-okeechobee-fl":                   "Lake Okeechobee Florida largemouth bass",
  "fw-lake-lanier-ga":                       "Lake Lanier Georgia Chattahoochee",
  "fw-lake-of-the-ozarks-mo":               "Lake of the Ozarks Missouri Bagnell Dam",
  "fw-table-rock-lake-mo":                   "Table Rock Lake Missouri White River",
  "fw-kentucky-lake":                        "Kentucky Lake TVA Tennessee River dam",
  "fw-lake-barkley":                         "Lake Barkley Cumberland River Kentucky",
  "fw-norris-lake-tn":                       "Norris Lake Tennessee Clinch River",
  "fw-fontana-lake-nc":                      "Fontana Lake North Carolina Smoky Mountains",
  "fw-smith-mountain-lake-va":               "Smith Mountain Lake Virginia Roanoke",
  "fw-clarks-hill-reservoir":               "Clarks Hill Reservoir J. Strom Thurmond",
  "fw-lake-travis-tx":                       "Lake Travis Texas Highland Lakes",
  "fw-canyon-lake-tx":                       "Canyon Lake Texas Guadalupe River",
  "fw-lake-lbj-tx":                          "Lake LBJ Lyndon Baines Johnson Texas",
  "fw-inks-lake-tx":                         "Inks Lake Texas Burnet County",
  "fw-lake-buchanan-tx":                     "Lake Buchanan Texas Buchanan Dam LCRA",
  "fw-elephant-butte-nm":                    "Elephant Butte Reservoir New Mexico Rio Grande",
  "fw-cochiti-lake-nm":                      "Cochiti Lake New Mexico earthen dam",
  "fw-navajo-lake-nm":                       "Navajo Lake New Mexico San Juan River",
};

describe("catalog keyword coverage — each entry findable by primary keyword", () => {
  it("PRIMARY_KEYWORD_QUERIES covers every entry in EXTRA_CATALOG_ENTRIES", () => {
    const missing = EXTRA_CATALOG_ENTRIES
      .map((e) => e.id)
      .filter((id) => !(id in PRIMARY_KEYWORD_QUERIES));
    if (missing.length > 0) {
      throw new Error(
        `The following EXTRA_CATALOG_ENTRIES ids are missing from PRIMARY_KEYWORD_QUERIES:\n` +
          missing.map((id) => `  - ${id}`).join("\n") +
          `\n\nAdd a primary keyword query for each new id so that keyword coverage is enforced.`,
      );
    }
  });

  for (const [id, query] of Object.entries(PRIMARY_KEYWORD_QUERIES)) {
    it(`"${id}" appears in searchCatalog results for "${query}"`, async () => {
      getEntry(id); // fail fast if the id was renamed or removed from EXTRA_CATALOG_ENTRIES
      const results = await searchCatalog({ q: query }, EXTRA_CATALOG_ENTRIES);
      const ids = results.map((r) => r.id);
      expect(ids).toContain(id);
    });
  }
});

// ---------------------------------------------------------------------------
// Fixture freshness — every EXTRA_CATALOG_ENTRIES id must appear in this file.
//
// This guard fails the build when someone adds a new catalog entry without
// adding at least one test that references its id. Add a test in the section
// above before adding the entry to catalogSeeder.ts.
// ---------------------------------------------------------------------------

describe("catalog fixture freshness", () => {
  it("every EXTRA_CATALOG_ENTRIES id is referenced at least once in this test file", () => {
    const thisFileSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const missing: string[] = [];
    for (const entry of EXTRA_CATALOG_ENTRIES) {
      if (!thisFileSrc.includes(entry.id)) {
        missing.push(entry.id);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `The following EXTRA_CATALOG_ENTRIES ids have no test coverage in catalog-search.test.ts:\n` +
          missing.map((id) => `  - ${id}`).join("\n") +
          `\n\nAdd at least one searchCatalog() assertion that references each id, ` +
          `then re-run the tests.`,
      );
    }
  });
});
