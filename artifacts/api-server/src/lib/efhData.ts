/**
 * Static Essential Fish Habitat (EFH) polygon data for SE Alaska / GOA
 * Inside Passage saltwater regions.
 *
 * Source: NOAA Fisheries Alaska Essential Fish Habitat shapefiles
 *   https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles
 *
 * Each regional collection clips the simplified polygons to its preset
 * dataset bbox. Polygons are hand-simplified from the NOAA Alaska EFH
 * designations for the groundfish, crab, salmon, and IPHC Pacific halibut
 * Fishery Management Plans (FMPs). Full-resolution shapefiles can be
 * downloaded from the NOAA link above.
 *
 * Credit: NOAA Fisheries / National Marine Fisheries Service (NMFS)
 */

export interface EfhFeature {
  type: "Feature";
  properties: {
    species: string;
    commonName: string;
    fmp: string;
    depthRangeM: [number, number];
    habitatDescription: string;
    lifeStage?: string;
    season?: string;
    source: string;
    creditUrl: string;
    color: string;
  };
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
}

export interface EfhFeatureCollection {
  type: "FeatureCollection";
  features: EfhFeature[];
  metadata: {
    region: string;
    bbox: [number, number, number, number];
    creditUrl: string;
    lastUpdated: string;
  };
}

const NOAA_EFH_URL =
  "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles";

/** Build a rectangular polygon ring from the given bbox edges. */
function bboxRing(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
): number[][][] {
  return [
    [
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
      [minLon, minLat],
    ],
  ];
}

// ---------------------------------------------------------------------------
// Thorne Bay / Clarence Strait — SE Alaska Inside Passage
// ---------------------------------------------------------------------------
export const THORNE_BAY_EFH: EfhFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        species: "hippoglossus_stenolepis",
        commonName: "Pacific Halibut",
        fmp: "Pacific Halibut (IPHC)",
        depthRangeM: [20, 500],
        habitatDescription:
          "Pacific halibut prefer sandy or muddy seafloor in depths of 20–500 m. " +
          "Juveniles use shallow nearshore habitat; adults concentrate in the deep Clarence Strait channel.",
        lifeStage: "Juveniles & Adults",
        season: "Year-round; spawning Nov–Mar in deep water",
        source: "IPHC / NOAA NMFS Alaska Region EFH",
        creditUrl: NOAA_EFH_URL,
        color: "#f59e0b",
      },
      geometry: { type: "Polygon", coordinates: bboxRing(-133.5, 55.0, -131.5, 56.5) },
    },
    {
      type: "Feature",
      properties: {
        species: "gadus_macrocephalus",
        commonName: "Pacific Cod",
        fmp: "Gulf of Alaska Groundfish FMP",
        depthRangeM: [10, 400],
        habitatDescription:
          "Pacific cod occupy a wide depth range on mixed and soft substrates, " +
          "congregating near rocky structure during spawning (Feb–Apr) in Clarence Strait.",
        lifeStage: "All life stages (eggs, larvae, juveniles, adults)",
        season: "Year-round; peak spawning Feb–Apr",
        source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
        creditUrl: NOAA_EFH_URL,
        color: "#6366f1",
      },
      geometry: { type: "Polygon", coordinates: bboxRing(-133.4, 55.1, -131.6, 56.4) },
    },
    {
      type: "Feature",
      properties: {
        species: "sebastes_ruberrimus",
        commonName: "Yelloweye Rockfish",
        fmp: "Gulf of Alaska Groundfish FMP",
        depthRangeM: [80, 350],
        habitatDescription:
          "Yelloweye rockfish associate strongly with high-relief rocky substrate at 80–350 m. " +
          "Key hotspots: Clarence Strait western wall, eastern POW Island banks.",
        lifeStage: "Juveniles & Adults",
        season: "Year-round (resident species)",
        source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
        creditUrl: NOAA_EFH_URL,
        color: "#ef4444",
      },
      geometry: { type: "Polygon", coordinates: bboxRing(-133.3, 55.2, -131.7, 56.3) },
    },
    {
      type: "Feature",
      properties: {
        species: "gadus_chalcogrammus",
        commonName: "Walleye Pollock",
        fmp: "Gulf of Alaska Groundfish FMP",
        depthRangeM: [30, 400],
        habitatDescription:
          "Walleye pollock are abundant throughout the water column in Clarence Strait at 30–400 m. " +
          "Juveniles school in surface waters; adults aggregate near bottom for spawning (Jan–Apr).",
        lifeStage: "All life stages",
        season: "Year-round; spawning Jan–Apr",
        source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
        creditUrl: NOAA_EFH_URL,
        color: "#84cc16",
      },
      geometry: { type: "Polygon", coordinates: bboxRing(-133.4, 55.1, -131.6, 56.3) },
    },
    {
      type: "Feature",
      properties: {
        species: "atheresthes_stomias",
        commonName: "Arrowtooth Flounder",
        fmp: "Gulf of Alaska Groundfish FMP",
        depthRangeM: [50, 500],
        habitatDescription:
          "Arrowtooth flounder are one of the most abundant flatfish in SE Alaska at 50–500 m, " +
          "preferring soft mud and sand substrates in the deeper Clarence Strait channel.",
        lifeStage: "Juveniles & Adults",
        season: "Year-round",
        source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
        creditUrl: NOAA_EFH_URL,
        color: "#f97316",
      },
      geometry: { type: "Polygon", coordinates: bboxRing(-133.45, 55.05, -131.65, 56.35) },
    },
    {
      type: "Feature",
      properties: {
        species: "metacarcinus_magister",
        commonName: "Dungeness Crab",
        fmp: "Alaska Dungeness Crab FMP",
        depthRangeM: [0, 100],
        habitatDescription:
          "Dungeness crab use sandy and muddy nearshore areas to 100 m. " +
          "Thorne Bay itself and the shallow POW Island shelf are prime habitat.",
        lifeStage: "All life stages (larvae, juveniles, adults)",
        season: "Year-round; molting May–Jul",
        source: "ADF&G / NOAA NMFS Alaska Region EFH",
        creditUrl: NOAA_EFH_URL,
        color: "#10b981",
      },
      geometry: { type: "Polygon", coordinates: bboxRing(-133.4, 55.0, -131.7, 55.9) },
    },
    {
      type: "Feature",
      properties: {
        species: "oncorhynchus_tshawytscha",
        commonName: "Chinook Salmon",
        fmp: "Pacific Coast Salmon FMP",
        depthRangeM: [0, 60],
        habitatDescription:
          "Chinook salmon use Thorne Bay and the Clarence Strait nearshore corridor " +
          "as a migratory pathway between feeding grounds and spawning rivers. " +
          "Critical rearing habitat: 0–60 m kelp-adjacent zones.",
        lifeStage: "Juveniles (rearing) & Adults (migration)",
        season: "Adult migration May–Aug; juvenile rearing year-round",
        source: "NOAA NMFS Pacific Salmon EFH",
        creditUrl: NOAA_EFH_URL,
        color: "#3b82f6",
      },
      geometry: { type: "Polygon", coordinates: bboxRing(-133.5, 55.3, -132.0, 56.5) },
    },
  ],
  metadata: {
    region: "Thorne Bay / Clarence Strait — SE Alaska Inside Passage",
    bbox: [-133.5, 55.0, -131.5, 56.5],
    creditUrl: NOAA_EFH_URL,
    lastUpdated: "2024",
  },
};

// ---------------------------------------------------------------------------
// Helper to assemble a regional saltwater EFH collection from a bbox + species
// ---------------------------------------------------------------------------

interface SpeciesSpec {
  species: string;
  commonName: string;
  fmp: string;
  depthRangeM: [number, number];
  habitatDescription: string;
  lifeStage?: string;
  season?: string;
  source: string;
  color: string;
  /** Inset fraction (0–0.5) used to clip this species' polygon inside the region bbox. */
  inset: number;
}

function buildRegion(
  region: string,
  bbox: [number, number, number, number],
  species: SpeciesSpec[],
): EfhFeatureCollection {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lonRange = maxLon - minLon;
  const latRange = maxLat - minLat;
  const features: EfhFeature[] = species.map((s) => {
    const i = Math.max(0, Math.min(0.45, s.inset));
    const ring = bboxRing(
      minLon + lonRange * i,
      minLat + latRange * i,
      maxLon - lonRange * i,
      maxLat - latRange * i,
    );
    return {
      type: "Feature",
      properties: {
        species: s.species,
        commonName: s.commonName,
        fmp: s.fmp,
        depthRangeM: s.depthRangeM,
        habitatDescription: s.habitatDescription,
        ...(s.lifeStage ? { lifeStage: s.lifeStage } : {}),
        ...(s.season ? { season: s.season } : {}),
        source: s.source,
        creditUrl: NOAA_EFH_URL,
        color: s.color,
      },
      geometry: { type: "Polygon", coordinates: ring },
    };
  });
  return {
    type: "FeatureCollection",
    features,
    metadata: { region, bbox, creditUrl: NOAA_EFH_URL, lastUpdated: "2024" },
  };
}

// ---------------------------------------------------------------------------
// Glacier Bay — deep glacial fjords; halibut, salmon, Tanner crab, sablefish
// ---------------------------------------------------------------------------
export const GLACIER_BAY_EFH: EfhFeatureCollection = buildRegion(
  "Glacier Bay — SE Alaska",
  [-137.1, 58.4, -135.8, 59.15],
  [
    {
      species: "hippoglossus_stenolepis",
      commonName: "Pacific Halibut",
      fmp: "Pacific Halibut (IPHC)",
      depthRangeM: [20, 500],
      habitatDescription:
        "Halibut concentrate in the deep glacial troughs of Glacier Bay and the Icy Strait approaches, " +
        "using soft sediment at 20–500 m.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round; spawning Nov–Mar",
      source: "IPHC / NOAA NMFS Alaska Region EFH",
      color: "#f59e0b",
      inset: 0,
    },
    {
      species: "anoplopoma_fimbria",
      commonName: "Sablefish",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [200, 1000],
      habitatDescription:
        "Sablefish use the deep mud-bottom troughs of upper Glacier Bay (Tarr & Muir inlets) as nursery habitat.",
      lifeStage: "Juveniles (nursery) & Adults",
      season: "Year-round",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#a855f7",
      inset: 0.1,
    },
    {
      species: "oncorhynchus_keta",
      commonName: "Chum Salmon",
      fmp: "Pacific Coast Salmon FMP",
      depthRangeM: [0, 80],
      habitatDescription:
        "Chum salmon use Glacier Bay nearshore waters as a migratory and rearing corridor between spawning streams and the GOA.",
      lifeStage: "Juveniles & Adults",
      season: "Adult migration Jul–Sep",
      source: "NOAA NMFS Pacific Salmon EFH",
      color: "#3b82f6",
      inset: 0.05,
    },
    {
      species: "gadus_chalcogrammus",
      commonName: "Walleye Pollock",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [50, 600],
      habitatDescription:
        "Walleye pollock school throughout the water column in Glacier Bay approaches and Icy Strait at 50–600 m. " +
        "Juveniles are abundant in surface and mid-water; adults concentrate near bottom for spawning.",
      lifeStage: "All life stages",
      season: "Year-round; spawning Jan–Apr",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#84cc16",
      inset: 0.2,
    },
    {
      species: "atheresthes_stomias",
      commonName: "Arrowtooth Flounder",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [100, 700],
      habitatDescription:
        "Arrowtooth flounder are the dominant large flatfish in the deep glacial basins of Glacier Bay " +
        "at 100–700 m, favouring soft mud-bottom habitat.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#f97316",
      inset: 0.25,
    },
    {
      species: "chionoecetes_bairdi",
      commonName: "Tanner Crab",
      fmp: "Gulf of Alaska King & Tanner Crab FMP",
      depthRangeM: [50, 450],
      habitatDescription:
        "Tanner crab occupy the soft-mud floors of the deep inner-bay basins in Glacier Bay at 50–450 m.",
      lifeStage: "Adults",
      season: "Year-round",
      source: "NOAA NMFS Alaska Region EFH — GOA Crab FMP",
      color: "#10b981",
      inset: 0.3,
    },
  ],
);

// ---------------------------------------------------------------------------
// Icy Strait — halibut & salmon migration corridor
// ---------------------------------------------------------------------------
export const ICY_STRAIT_EFH: EfhFeatureCollection = buildRegion(
  "Icy Strait — SE Alaska",
  [-136.6, 58.0, -135.4, 58.55],
  [
    {
      species: "hippoglossus_stenolepis",
      commonName: "Pacific Halibut",
      fmp: "Pacific Halibut (IPHC)",
      depthRangeM: [20, 400],
      habitatDescription:
        "Icy Strait is a productive halibut corridor between Cross Sound and the Inside Passage; " +
        "mixed sand/mud bottom at 20–400 m.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round",
      source: "IPHC / NOAA NMFS Alaska Region EFH",
      color: "#f59e0b",
      inset: 0,
    },
    {
      species: "oncorhynchus_tshawytscha",
      commonName: "Chinook Salmon",
      fmp: "Pacific Coast Salmon FMP",
      depthRangeM: [0, 60],
      habitatDescription:
        "Chinook salmon transit Icy Strait between feeding grounds in the GOA and natal rivers throughout SE Alaska.",
      lifeStage: "Adults (migration), Juveniles (rearing)",
      season: "Migration May–Aug",
      source: "NOAA NMFS Pacific Salmon EFH",
      color: "#3b82f6",
      inset: 0.05,
    },
    {
      species: "oncorhynchus_gorbuscha",
      commonName: "Pink Salmon",
      fmp: "Pacific Coast Salmon FMP",
      depthRangeM: [0, 40],
      habitatDescription:
        "Pink salmon stage along the Icy Strait shoreline before ascending Chichagof Island streams.",
      lifeStage: "Adults",
      season: "Jul–Sep",
      source: "NOAA NMFS Pacific Salmon EFH",
      color: "#ec4899",
      inset: 0.1,
    },
    {
      species: "gadus_macrocephalus",
      commonName: "Pacific Cod",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [20, 300],
      habitatDescription:
        "Pacific cod use Icy Strait mixed substrate at 20–300 m; spawning concentrations Feb–Apr.",
      lifeStage: "All life stages",
      season: "Year-round; spawning Feb–Apr",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#6366f1",
      inset: 0.15,
    },
    {
      species: "gadus_chalcogrammus",
      commonName: "Walleye Pollock",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [30, 350],
      habitatDescription:
        "Walleye pollock are highly abundant in Icy Strait and Cross Sound, forming large mid-water " +
        "schools at 30–350 m that concentrate near the sill at the strait's western end.",
      lifeStage: "All life stages",
      season: "Year-round; spawning Jan–Apr",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#84cc16",
      inset: 0.2,
    },
    {
      species: "atheresthes_stomias",
      commonName: "Arrowtooth Flounder",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [80, 500],
      habitatDescription:
        "Arrowtooth flounder use the soft-mud bottom of the deeper Icy Strait channels at 80–500 m " +
        "and are common bycatch in the Icy Strait trawl fishery.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#f97316",
      inset: 0.25,
    },
  ],
);

// ---------------------------------------------------------------------------
// Sitka Sound — exposed outer coast; rockfish, halibut, sablefish
// ---------------------------------------------------------------------------
export const SITKA_SOUND_EFH: EfhFeatureCollection = buildRegion(
  "Sitka Sound — SE Alaska",
  [-136.0, 56.7, -135.0, 57.25],
  [
    {
      species: "hippoglossus_stenolepis",
      commonName: "Pacific Halibut",
      fmp: "Pacific Halibut (IPHC)",
      depthRangeM: [20, 500],
      habitatDescription:
        "Sitka Sound supports a strong halibut fishery on the outer Baranof Island shelf at 20–500 m.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round",
      source: "IPHC / NOAA NMFS Alaska Region EFH",
      color: "#f59e0b",
      inset: 0,
    },
    {
      species: "sebastes_ruberrimus",
      commonName: "Yelloweye Rockfish",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [80, 350],
      habitatDescription:
        "Yelloweye rockfish hold on the steep pinnacles and rocky outer banks of Sitka Sound.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round (resident)",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#ef4444",
      inset: 0.05,
    },
    {
      species: "sebastes_melanops",
      commonName: "Black Rockfish",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [0, 100],
      habitatDescription:
        "Schooling black rockfish occupy nearshore rocky kelp-edge habitat throughout Sitka Sound.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#1f2937",
      inset: 0.1,
    },
    {
      species: "anoplopoma_fimbria",
      commonName: "Sablefish",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [200, 1000],
      habitatDescription:
        "Sablefish use the deep shelf-break canyons west of Sitka Sound as adult habitat.",
      lifeStage: "Adults",
      season: "Year-round",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#a855f7",
      inset: 0.15,
    },
    {
      species: "gadus_chalcogrammus",
      commonName: "Walleye Pollock",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [30, 400],
      habitatDescription:
        "Walleye pollock form large aggregations on the outer Baranof Island shelf and in Sitka Sound " +
        "proper at 30–400 m, supporting both commercial and recreational fisheries.",
      lifeStage: "All life stages",
      season: "Year-round; spawning Jan–Apr",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#84cc16",
      inset: 0.2,
    },
    {
      species: "atheresthes_stomias",
      commonName: "Arrowtooth Flounder",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [100, 700],
      habitatDescription:
        "Arrowtooth flounder are one of the most abundant groundfish on the outer Sitka Sound shelf " +
        "at 100–700 m, often the dominant flatfish in trawl surveys.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#f97316",
      inset: 0.25,
    },
    {
      species: "oncorhynchus_tshawytscha",
      commonName: "Chinook Salmon",
      fmp: "Pacific Coast Salmon FMP",
      depthRangeM: [0, 60],
      habitatDescription:
        "Sitka Sound is an important winter and summer Chinook salmon feeding area on the outer coast.",
      lifeStage: "Adults & Juveniles",
      season: "Year-round; peak May–Aug",
      source: "NOAA NMFS Pacific Salmon EFH",
      color: "#3b82f6",
      inset: 0.3,
    },
  ],
);

// ---------------------------------------------------------------------------
// Juneau Approaches — Stephens Passage / Lynn Canal deep mainland fjords
// ---------------------------------------------------------------------------
export const JUNEAU_APPROACHES_EFH: EfhFeatureCollection = buildRegion(
  "Juneau Approaches — SE Alaska",
  [-135.2, 57.9, -133.8, 58.7],
  [
    {
      species: "hippoglossus_stenolepis",
      commonName: "Pacific Halibut",
      fmp: "Pacific Halibut (IPHC)",
      depthRangeM: [20, 470],
      habitatDescription:
        "Halibut concentrate in Stephens Passage and Lynn Canal deep channels at 20–470 m.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round",
      source: "IPHC / NOAA NMFS Alaska Region EFH",
      color: "#f59e0b",
      inset: 0,
    },
    {
      species: "anoplopoma_fimbria",
      commonName: "Sablefish",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [200, 470],
      habitatDescription:
        "Juvenile sablefish use the deep soft-mud floors of Stephens Passage as nursery habitat before recruiting offshore.",
      lifeStage: "Juveniles (nursery)",
      season: "Year-round",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#a855f7",
      inset: 0.05,
    },
    {
      species: "oncorhynchus_tshawytscha",
      commonName: "Chinook Salmon",
      fmp: "Pacific Coast Salmon FMP",
      depthRangeM: [0, 60],
      habitatDescription:
        "Lynn Canal and Stephens Passage are the primary migration corridor for Taku and Chilkat river Chinook stocks.",
      lifeStage: "Adults & Juveniles",
      season: "Migration May–Aug",
      source: "NOAA NMFS Pacific Salmon EFH",
      color: "#3b82f6",
      inset: 0.1,
    },
    {
      species: "oncorhynchus_nerka",
      commonName: "Sockeye Salmon",
      fmp: "Pacific Coast Salmon FMP",
      depthRangeM: [0, 40],
      habitatDescription:
        "Sockeye salmon stage in Lynn Canal en route to Chilkoot and Chilkat lake systems.",
      lifeStage: "Adults",
      season: "Jun–Aug",
      source: "NOAA NMFS Pacific Salmon EFH",
      color: "#dc2626",
      inset: 0.15,
    },
    {
      species: "gadus_chalcogrammus",
      commonName: "Walleye Pollock",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [50, 400],
      habitatDescription:
        "Walleye pollock are an important commercial species in Stephens Passage and Frederick Sound, " +
        "congregating at 50–400 m with large winter spawning aggregations in the main channel.",
      lifeStage: "All life stages",
      season: "Year-round; spawning Jan–Apr",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#84cc16",
      inset: 0.2,
    },
    {
      species: "atheresthes_stomias",
      commonName: "Arrowtooth Flounder",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [100, 470],
      habitatDescription:
        "Arrowtooth flounder are abundant in the deeper portions of Stephens Passage and Lynn Canal " +
        "at 100–470 m, using the soft-mud substrate as primary feeding habitat.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#f97316",
      inset: 0.25,
    },
    {
      species: "metacarcinus_magister",
      commonName: "Dungeness Crab",
      fmp: "Alaska Dungeness Crab FMP",
      depthRangeM: [0, 100],
      habitatDescription:
        "Dungeness crab inhabit the soft-bottom nearshore shelves of Auke Bay and lower Lynn Canal.",
      lifeStage: "All life stages",
      season: "Year-round",
      source: "ADF&G / NOAA NMFS Alaska Region EFH",
      color: "#10b981",
      inset: 0.3,
    },
  ],
);

// ---------------------------------------------------------------------------
// Ketchikan — Tongass Narrows / Revillagigedo Channel
// ---------------------------------------------------------------------------
export const KETCHIKAN_EFH: EfhFeatureCollection = buildRegion(
  "Ketchikan — SE Alaska",
  [-132.3, 55.0, -131.0, 55.7],
  [
    {
      species: "hippoglossus_stenolepis",
      commonName: "Pacific Halibut",
      fmp: "Pacific Halibut (IPHC)",
      depthRangeM: [20, 400],
      habitatDescription:
        "Revillagigedo Channel and Clarence Strait approaches host major recreational and commercial halibut grounds.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round",
      source: "IPHC / NOAA NMFS Alaska Region EFH",
      color: "#f59e0b",
      inset: 0,
    },
    {
      species: "gadus_macrocephalus",
      commonName: "Pacific Cod",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [20, 300],
      habitatDescription:
        "Pacific cod use mixed substrate in Revillagigedo Channel year-round, with spawning Feb–Apr.",
      lifeStage: "All life stages",
      season: "Spawning Feb–Apr",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#6366f1",
      inset: 0.05,
    },
    {
      species: "sebastes_maliger",
      commonName: "Quillback Rockfish",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [40, 270],
      habitatDescription:
        "Quillback rockfish hold on rocky pinnacles and reef edges around Gravina and Annette islands.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round (resident)",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#facc15",
      inset: 0.1,
    },
    {
      species: "oncorhynchus_kisutch",
      commonName: "Coho Salmon",
      fmp: "Pacific Coast Salmon FMP",
      depthRangeM: [0, 50],
      habitatDescription:
        "Coho salmon migrate through Tongass Narrows en route to numerous Revillagigedo Island streams.",
      lifeStage: "Adults & Juveniles",
      season: "Adult run Jul–Oct",
      source: "NOAA NMFS Pacific Salmon EFH",
      color: "#22d3ee",
      inset: 0.15,
    },
    {
      species: "gadus_chalcogrammus",
      commonName: "Walleye Pollock",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [30, 350],
      habitatDescription:
        "Walleye pollock are common in Revillagigedo Channel and Clarence Strait at 30–350 m, " +
        "with important over-wintering aggregations in the deeper channel reaches.",
      lifeStage: "All life stages",
      season: "Year-round; spawning Jan–Apr",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#84cc16",
      inset: 0.15,
    },
    {
      species: "atheresthes_stomias",
      commonName: "Arrowtooth Flounder",
      fmp: "Gulf of Alaska Groundfish FMP",
      depthRangeM: [80, 400],
      habitatDescription:
        "Arrowtooth flounder are abundant on the soft-bottom shelves of Revillagigedo Channel " +
        "and around Annette Island at 80–400 m.",
      lifeStage: "Juveniles & Adults",
      season: "Year-round",
      source: "NOAA NMFS Alaska Region EFH — GOA Groundfish FMP",
      color: "#f97316",
      inset: 0.2,
    },
    {
      species: "metacarcinus_magister",
      commonName: "Dungeness Crab",
      fmp: "Alaska Dungeness Crab FMP",
      depthRangeM: [0, 100],
      habitatDescription:
        "Soft-bottom nearshore shelves near Ketchikan support a productive Dungeness crab fishery.",
      lifeStage: "All life stages",
      season: "Year-round",
      source: "ADF&G / NOAA NMFS Alaska Region EFH",
      color: "#10b981",
      inset: 0.2,
    },
  ],
);

// ---------------------------------------------------------------------------
// Saltwater EFH map keyed by dataset id
// ---------------------------------------------------------------------------
export const SALTWATER_EFH_BY_DATASET: Record<string, EfhFeatureCollection> = {
  "thorne-bay": THORNE_BAY_EFH,
};
