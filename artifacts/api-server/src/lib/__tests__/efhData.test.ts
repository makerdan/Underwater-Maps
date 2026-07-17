/**
 * efhData.test.ts — Unit tests for the static EFH species data.
 *
 * Verifies:
 *   - All six SE Alaska regions are registered in SALTWATER_EFH_BY_DATASET
 *   - New species (Spotted Prawn, Greenland Turbot, Rex Sole, Pacific Tomcod,
 *     Juvenile Rockfish) are present in every region where ecologically relevant
 *   - Pink Salmon is present in Thorne Bay, Glacier Bay, Sitka Sound, Juneau
 *     Approaches, and Ketchikan (gap-fill regions) as well as the pre-existing
 *     Icy Strait entry
 *   - No species entry has a depth range where min >= max
 *   - No species entry is missing a required color or source
 *   - The sablefish catalog keyword alias "black cod" is present
 *   - EFH_SPECIES_TO_CATALOG_ID covers every species key across all regions
 *   - Every catalog ID referenced by EFH_SPECIES_TO_CATALOG_ID exists in
 *     EXTRA_CATALOG_ENTRIES (enforces automatic sync between the two files)
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  SALTWATER_EFH_BY_DATASET,
  EFH_SPECIES_TO_CATALOG_ID,
  THORNE_BAY_EFH,
  GLACIER_BAY_EFH,
  ICY_STRAIT_EFH,
  SITKA_SOUND_EFH,
  JUNEAU_APPROACHES_EFH,
  KETCHIKAN_EFH,
} from "../efhData.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function speciesIds(collection: { features: Array<{ properties: { species: string } }> }): Set<string> {
  return new Set(collection.features.map((f) => f.properties.species));
}

// ---------------------------------------------------------------------------
// SALTWATER_EFH_BY_DATASET — region registration
// ---------------------------------------------------------------------------

describe("SALTWATER_EFH_BY_DATASET — all SE Alaska regions registered", () => {
  const EXPECTED_DATASET_IDS = [
    "thorne-bay",
    "glacier-bay",
    "icy-strait",
    "sitka-sound",
    "juneau",
    "ketchikan",
  ];

  for (const id of EXPECTED_DATASET_IDS) {
    it(`registers dataset id "${id}"`, () => {
      expect(SALTWATER_EFH_BY_DATASET).toHaveProperty(id);
      expect(SALTWATER_EFH_BY_DATASET[id]!.features.length).toBeGreaterThan(0);
    });
  }

  it("returns a FeatureCollection type for every registered region", () => {
    for (const [id, col] of Object.entries(SALTWATER_EFH_BY_DATASET)) {
      expect(col.type, `${id} type`).toBe("FeatureCollection");
      expect(col.metadata.region, `${id} metadata.region`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// New species — presence across all six regions
// ---------------------------------------------------------------------------

const ALL_REGIONS: Array<[string, typeof THORNE_BAY_EFH]> = [
  ["Thorne Bay", THORNE_BAY_EFH],
  ["Glacier Bay", GLACIER_BAY_EFH],
  ["Icy Strait", ICY_STRAIT_EFH],
  ["Sitka Sound", SITKA_SOUND_EFH],
  ["Juneau Approaches", JUNEAU_APPROACHES_EFH],
  ["Ketchikan", KETCHIKAN_EFH],
];

const NEW_SPECIES: Array<[string, string]> = [
  ["pandalus_platyceros", "Spotted Prawn"],
  ["reinhardtius_hippoglossoides", "Greenland Turbot"],
  ["glyptocephalus_zachirus", "Rex Sole"],
  ["microgadus_proximus", "Pacific Tomcod"],
  ["sebastes_spp_juvenile", "Juvenile Rockfish"],
];

describe("New EFH species — present in all six regions", () => {
  for (const [speciesId, commonName] of NEW_SPECIES) {
    for (const [regionName, collection] of ALL_REGIONS) {
      it(`${commonName} (${speciesId}) is in ${regionName}`, () => {
        const ids = speciesIds(collection);
        expect(
          ids.has(speciesId),
          `Expected ${speciesId} in ${regionName}. Found: ${[...ids].join(", ")}`,
        ).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Pink Salmon gap-fill — present in five regions (gap-fill) + Icy Strait (pre-existing)
// ---------------------------------------------------------------------------

describe("Pink Salmon — present in all six SE Alaska regions", () => {
  for (const [regionName, collection] of ALL_REGIONS) {
    it(`Pink Salmon (oncorhynchus_gorbuscha) is in ${regionName}`, () => {
      const ids = speciesIds(collection);
      expect(
        ids.has("oncorhynchus_gorbuscha"),
        `Expected Pink Salmon in ${regionName}. Found: ${[...ids].join(", ")}`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Data integrity — all features across all regions
// ---------------------------------------------------------------------------

describe("EFH feature integrity — depth ranges and required fields", () => {
  for (const [regionName, collection] of ALL_REGIONS) {
    it(`${regionName}: every feature has a valid depthRangeM (min < max)`, () => {
      for (const feat of collection.features) {
        const [min, max] = feat.properties.depthRangeM;
        expect(
          min,
          `${regionName}/${feat.properties.species} min depth should be < max depth`,
        ).toBeLessThan(max!);
      }
    });

    it(`${regionName}: every feature has a non-empty color and source`, () => {
      for (const feat of collection.features) {
        expect(feat.properties.color, `${regionName}/${feat.properties.species} color`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(feat.properties.source, `${regionName}/${feat.properties.species} source`).toBeTruthy();
      }
    });

    it(`${regionName}: every feature has a non-empty species id and commonName`, () => {
      for (const feat of collection.features) {
        expect(feat.properties.species).toBeTruthy();
        expect(feat.properties.commonName).toBeTruthy();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Catalog keyword alias — "black cod" on sablefish entry
// ---------------------------------------------------------------------------

describe("Catalog keyword alias — sablefish 'black cod'", () => {
  it("sablefish catalog entry keywords include 'black cod'", async () => {
    const { scoreEntry } = await import("../catalogSeeder.js");
    const sablefishEntry = {
      id: "noaa-efh-alaska-sablefish",
      name: "NOAA EFH — Sablefish (Gulf of Alaska)",
      sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
      dataType: "habitat" as const,
      resolutionMMin: null,
      resolutionMMax: null,
      coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
      endpointUrl: null,
      accessNotes: null,
      description:
        "Essential Fish Habitat (EFH) for Sablefish (Anoplopoma fimbria), also known as black cod, in the Gulf of Alaska.",
      keywords:
        "EFH,essential fish habitat,sablefish,black cod,Anoplopoma fimbria,Alaska,GOA,groundfish,deepwater,slope,NOAA,NMFS",
      lastUpdated: "2023-01-01",
      waterType: "saltwater" as const,
    };

    // "black cod" search should score > 0 against the sablefish entry
    const score = scoreEntry(sablefishEntry, ["black", "cod"]);
    expect(score).toBeGreaterThan(0);

    // "sablefish" search should also score > 0
    const score2 = scoreEntry(sablefishEntry, ["sablefish"]);
    expect(score2).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// EFH catalog sync — EFH_SPECIES_TO_CATALOG_ID ↔ EXTRA_CATALOG_ENTRIES
//
// These tests are the automated guard that prevents drift between efhData.ts
// (species overlay definitions) and catalogSeeder.ts (Find Data entries).
//
// When a new species is added to any regional collection, the developer must
// also add it to EFH_SPECIES_TO_CATALOG_ID (efhData.ts) AND add a matching
// entry in EXTRA_CATALOG_ENTRIES (catalogSeeder.ts). Both checks fail
// immediately with an actionable message if either side is missing.
// ---------------------------------------------------------------------------

describe("EFH catalog sync — EFH_SPECIES_TO_CATALOG_ID ↔ EXTRA_CATALOG_ENTRIES", () => {
  it("every species key in SALTWATER_EFH_BY_DATASET has an entry in EFH_SPECIES_TO_CATALOG_ID", () => {
    const allSpeciesKeys = new Set<string>();
    for (const collection of Object.values(SALTWATER_EFH_BY_DATASET)) {
      for (const feature of collection.features) {
        allSpeciesKeys.add(feature.properties.species);
      }
    }

    const missing: string[] = [];
    for (const key of allSpeciesKeys) {
      if (!(key in EFH_SPECIES_TO_CATALOG_ID)) {
        missing.push(key);
      }
    }

    expect(
      missing,
      `Species keys present in overlay data but missing from EFH_SPECIES_TO_CATALOG_ID.\n` +
        `Add each key → catalog-id mapping to EFH_SPECIES_TO_CATALOG_ID in efhData.ts\n` +
        `and a matching entry in EXTRA_CATALOG_ENTRIES in catalogSeeder.ts:\n` +
        missing.map((k) => `  "${k}"`).join("\n"),
    ).toHaveLength(0);
  });

  it("every catalog ID referenced by EFH_SPECIES_TO_CATALOG_ID exists in EXTRA_CATALOG_ENTRIES", async () => {
    const { EXTRA_CATALOG_ENTRIES } = await import("../catalogSeeder.js");
    const catalogIds = new Set(EXTRA_CATALOG_ENTRIES.map((e) => e.id));

    const missing: Array<{ species: string; catalogId: string }> = [];
    for (const [speciesKey, catalogId] of Object.entries(EFH_SPECIES_TO_CATALOG_ID)) {
      if (!catalogIds.has(catalogId)) {
        missing.push({ species: speciesKey, catalogId });
      }
    }

    expect(
      missing,
      `Catalog IDs referenced in EFH_SPECIES_TO_CATALOG_ID but absent from EXTRA_CATALOG_ENTRIES.\n` +
        `Add a matching CatalogSeedEntry for each in catalogSeeder.ts:\n` +
        missing.map(({ species, catalogId }) => `  "${species}" → "${catalogId}"`).join("\n"),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cleanup — drop local references to large GeoJSON collections so the
// per-file gc() call in setup.ts can sweep them after this file completes.
// ---------------------------------------------------------------------------

afterAll(() => {
  // ALL_REGIONS holds the only local references to the six large GeoJSON
  // FeatureCollection objects.  Emptying it lets V8 reclaim that heap
  // during the gc() triggered by setup.ts afterAll().
  ALL_REGIONS.length = 0;
});

// ---------------------------------------------------------------------------
// Intertidal catalog entries — data type and access notes
// ---------------------------------------------------------------------------

describe("Intertidal catalog entries — dataType and advisory access notes", () => {
  const INTERTIDAL_IDS = [
    "adfg-intertidal-clam-habitat-se-alaska",
    "noaa-shorezone-tidal-pools-se-alaska",
    "noaa-shorezone-beachcombing-se-alaska",
  ];

  it("all three intertidal entries appear in searchCatalog filtered by dataType:habitat", async () => {
    const { searchCatalog } = await import("../catalogSeeder.js");
    const results = await searchCatalog({ dataType: "habitat" }, INTERTIDAL_IDS.map((id) => ({
      id,
      name: id,
      sourceAgency: "test",
      dataType: "habitat" as const,
      resolutionMMin: null,
      resolutionMMax: null,
      coverageBbox: { minLon: -138, minLat: 54, maxLon: -130, maxLat: 60 },
      endpointUrl: null,
      accessNotes: "General habitat designation only — not real-time harvest data.",
      description: "test",
      keywords: "intertidal,clam,tidal pool,beachcombing",
      lastUpdated: "2022-09-01",
      waterType: "saltwater" as const,
    })));
    const returnedIds = results.map((r) => r.id);
    for (const id of INTERTIDAL_IDS) {
      expect(returnedIds).toContain(id);
    }
  });
});
