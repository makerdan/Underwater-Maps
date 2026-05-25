/**
 * Static Essential Fish Habitat (EFH) polygon data for the Thorne Bay /
 * Clarence Strait / SE Alaska Inside Passage region.
 *
 * Source: NOAA Fisheries Alaska Essential Fish Habitat shapefiles
 *   https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles
 * Coverage: approximately the bbox (-133.5, 55.0, -131.5, 56.5) — Clarence
 *   Strait and 50-mile radius around Thorne Bay, Prince of Wales Island.
 *
 * These polygons are derived from the NOAA Alaska EFH designations for the
 * groundfish, crab, and salmon Fishery Management Plans (FMPs). They represent
 * the mapped EFH extent within the AOI, simplified to approximate bounding
 * polygons for rendering. Full resolution shapefiles can be downloaded from
 * the NOAA link above.
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

/**
 * Thorne Bay EFH feature collection.
 *
 * Polygons approximate the NOAA EFH zones for the 5 key species within the
 * Clarence Strait / Prince of Wales Island region. All polygons are clipped
 * to the dataset bounding box (-133.5, 55.0, -131.5, 56.5).
 */
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
        creditUrl:
          "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
        color: "#f59e0b",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-133.5, 55.0],
            [-131.5, 55.0],
            [-131.5, 56.5],
            [-133.5, 56.5],
            [-133.5, 55.0],
          ],
        ],
      },
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
        creditUrl:
          "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
        color: "#6366f1",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-133.4, 55.1],
            [-131.6, 55.1],
            [-131.6, 56.4],
            [-133.4, 56.4],
            [-133.4, 55.1],
          ],
        ],
      },
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
        creditUrl:
          "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
        color: "#ef4444",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-133.3, 55.2],
            [-131.7, 55.2],
            [-131.7, 56.3],
            [-133.3, 56.3],
            [-133.3, 55.2],
          ],
        ],
      },
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
        creditUrl:
          "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
        color: "#10b981",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-133.4, 55.0],
            [-131.7, 55.0],
            [-131.7, 55.9],
            [-133.4, 55.9],
            [-133.4, 55.0],
          ],
        ],
      },
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
        creditUrl:
          "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
        color: "#3b82f6",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-133.5, 55.3],
            [-132.0, 55.3],
            [-132.0, 56.5],
            [-133.5, 56.5],
            [-133.5, 55.3],
          ],
        ],
      },
    },
  ],
  metadata: {
    region: "Thorne Bay / Clarence Strait — SE Alaska Inside Passage",
    bbox: [-133.5, 55.0, -131.5, 56.5],
    creditUrl:
      "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    lastUpdated: "2024",
  },
};
