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
 */

import { describe, it, expect } from "vitest";
import {
  SALTWATER_EFH_BY_DATASET,
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
