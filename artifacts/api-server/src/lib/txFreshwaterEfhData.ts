/**
 * Hand-authored Texas freshwater "EFH-equivalent" priority habitat polygons.
 *
 * Federal Essential Fish Habitat (EFH) is a strictly saltwater concept under
 * the Magnuson-Stevens Act. For the freshwater Texas reservoirs we surface
 * priority spawning / forage / structure zones designated by the Texas Parks
 * & Wildlife Department (TPWD). All polygons here are approximate, drawn by
 * hand inside each reservoir's bbox; the `source` string starts with "TPWD"
 * so the UI can label them honestly as priority habitat — NOT federal EFH.
 *
 * Sources (per-reservoir TPWD lake pages):
 *   - Lake Fork:    https://tpwd.texas.gov/fishboat/fish/recreational/lakes/fork/
 *   - Sam Rayburn:  https://tpwd.texas.gov/fishboat/fish/recreational/lakes/samrayburn/
 *   - Toledo Bend:  https://tpwd.texas.gov/fishboat/fish/recreational/lakes/toledobend/
 */

import type { EfhFeature, EfhFeatureCollection } from "./efhData.js";

const TPWD_SRC = "TPWD — Texas Parks & Wildlife priority habitat (approximate)";

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

interface TxHabitatSpec {
  species: string;
  commonName: string;
  fmp: string;
  depthRangeM: [number, number];
  habitatDescription: string;
  lifeStage?: string;
  season?: string;
  color: string;
  creditUrl: string;
  /** Inset fraction (0–0.45) used to clip this habitat inside the bbox. */
  inset: number;
}

function buildLake(
  region: string,
  bbox: [number, number, number, number],
  creditUrl: string,
  specs: TxHabitatSpec[],
): EfhFeatureCollection {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lonRange = maxLon - minLon;
  const latRange = maxLat - minLat;
  const features: EfhFeature[] = specs.map((s) => {
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
        source: TPWD_SRC,
        creditUrl: s.creditUrl,
        color: s.color,
      },
      geometry: { type: "Polygon", coordinates: ring },
    };
  });
  return {
    type: "FeatureCollection",
    features,
    metadata: { region, bbox, creditUrl, lastUpdated: "2024" },
  };
}

// ---------------------------------------------------------------------------
// Lake Fork Reservoir — premier trophy largemouth bass fishery
// ---------------------------------------------------------------------------
const LAKE_FORK_URL =
  "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/fork/";

export const LAKE_FORK_EFH: EfhFeatureCollection = buildLake(
  "Lake Fork Reservoir — East Texas",
  [-95.65, 32.78, -95.42, 32.95],
  LAKE_FORK_URL,
  [
    {
      species: "micropterus_salmoides",
      commonName: "Largemouth Bass (spawning flats)",
      fmp: "TPWD Priority Spawning Habitat",
      depthRangeM: [1, 4],
      habitatDescription:
        "Shallow standing-timber flats and shoreline coves on Lake Fork hold the trophy " +
        "Florida-strain largemouth spawn from late February through April.",
      lifeStage: "Adults (spawning)",
      season: "Late Feb–Apr",
      color: "#22c55e",
      creditUrl: LAKE_FORK_URL,
      inset: 0,
    },
    {
      species: "pomoxis_nigromaculatus",
      commonName: "Black Crappie (brushpiles)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [3, 9],
      habitatDescription:
        "Submerged timber, bridge pilings, and TPWD-maintained brushpiles in Lake Fork's mid-depth flats hold crappie year-round.",
      lifeStage: "All life stages",
      season: "Year-round; peak Mar–Apr & Oct–Nov",
      color: "#a855f7",
      creditUrl: LAKE_FORK_URL,
      inset: 0.08,
    },
    {
      species: "ictalurus_punctatus",
      commonName: "Channel Catfish (creek channels)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [4, 12],
      habitatDescription:
        "Old creek channels and the inundated Sabine River bed are the primary channel-catfish habitat in Lake Fork.",
      lifeStage: "Adults",
      season: "Year-round",
      color: "#0ea5e9",
      creditUrl: LAKE_FORK_URL,
      inset: 0.15,
    },
    {
      species: "lepomis_macrochirus",
      commonName: "Bluegill (weedlines)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [0.5, 3],
      habitatDescription:
        "Hydrilla and pondweed weedlines along Lake Fork shorelines provide critical bluegill spawning and rearing habitat.",
      lifeStage: "All life stages",
      season: "Spawning May–Aug",
      color: "#fb923c",
      creditUrl: LAKE_FORK_URL,
      inset: 0.22,
    },
  ],
);

// ---------------------------------------------------------------------------
// Sam Rayburn Reservoir — largest lake wholly in Texas
// ---------------------------------------------------------------------------
const SAM_RAYBURN_URL =
  "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/samrayburn/";

export const SAM_RAYBURN_EFH: EfhFeatureCollection = buildLake(
  "Sam Rayburn Reservoir — East Texas",
  [-94.30, 31.05, -93.95, 31.60],
  SAM_RAYBURN_URL,
  [
    {
      species: "micropterus_salmoides",
      commonName: "Largemouth Bass (spawning flats)",
      fmp: "TPWD Priority Spawning Habitat",
      depthRangeM: [1, 5],
      habitatDescription:
        "Hydrilla mats on the broad northern flats of Sam Rayburn host nationally renowned largemouth spawning.",
      lifeStage: "Adults (spawning)",
      season: "Mar–May",
      color: "#22c55e",
      creditUrl: SAM_RAYBURN_URL,
      inset: 0,
    },
    {
      species: "morone_chrysops",
      commonName: "White Bass (spawning run)",
      fmp: "TPWD Priority Spawning Habitat",
      depthRangeM: [0.5, 6],
      habitatDescription:
        "White bass run up the Angelina River arm of Sam Rayburn in late winter to spawn over gravel and sand bars.",
      lifeStage: "Adults (spawning)",
      season: "Feb–Apr",
      color: "#f59e0b",
      creditUrl: SAM_RAYBURN_URL,
      inset: 0.08,
    },
    {
      species: "pomoxis_annularis",
      commonName: "White Crappie (brushpiles)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [3, 10],
      habitatDescription:
        "TPWD-maintained brushpiles and inundated timber on Sam Rayburn's main lake hold prolific crappie populations.",
      lifeStage: "All life stages",
      season: "Year-round; peak spring & fall",
      color: "#a855f7",
      creditUrl: SAM_RAYBURN_URL,
      inset: 0.15,
    },
    {
      species: "ictalurus_furcatus",
      commonName: "Blue Catfish (river channels)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [5, 18],
      habitatDescription:
        "The submerged Angelina River channel through Sam Rayburn is the principal blue catfish corridor.",
      lifeStage: "Adults",
      season: "Year-round",
      color: "#0ea5e9",
      creditUrl: SAM_RAYBURN_URL,
      inset: 0.22,
    },
  ],
);

// ---------------------------------------------------------------------------
// Toledo Bend Reservoir — Texas/Louisiana border
// ---------------------------------------------------------------------------
const TOLEDO_BEND_URL =
  "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/toledobend/";

export const TOLEDO_BEND_EFH: EfhFeatureCollection = buildLake(
  "Toledo Bend Reservoir — Texas / Louisiana",
  [-93.95, 31.15, -93.55, 32.20],
  TOLEDO_BEND_URL,
  [
    {
      species: "micropterus_salmoides",
      commonName: "Largemouth Bass (spawning flats)",
      fmp: "TPWD Priority Spawning Habitat",
      depthRangeM: [1, 5],
      habitatDescription:
        "Shallow vegetated shoreline pockets and timber-covered flats throughout Toledo Bend support a Top-10 nationally ranked largemouth fishery.",
      lifeStage: "Adults (spawning)",
      season: "Feb–May",
      color: "#22c55e",
      creditUrl: TOLEDO_BEND_URL,
      inset: 0,
    },
    {
      species: "morone_saxatilis_x_chrysops",
      commonName: "Hybrid Striped Bass (open water)",
      fmp: "TPWD Stocked Sportfish Priority Habitat",
      depthRangeM: [3, 15],
      habitatDescription:
        "Toledo Bend is TPWD-stocked with hybrid striped bass that school over the deep main-lake river channel.",
      lifeStage: "Adults",
      season: "Year-round; surface schooling Jun–Sep",
      color: "#f59e0b",
      creditUrl: TOLEDO_BEND_URL,
      inset: 0.08,
    },
    {
      species: "pomoxis_nigromaculatus",
      commonName: "Black Crappie (brushpiles)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [3, 10],
      habitatDescription:
        "Submerged cypress and TPWD brushpiles in Toledo Bend's mid-lake creeks hold black and white crappie year-round.",
      lifeStage: "All life stages",
      season: "Year-round",
      color: "#a855f7",
      creditUrl: TOLEDO_BEND_URL,
      inset: 0.15,
    },
    {
      species: "ictalurus_punctatus",
      commonName: "Channel Catfish (creek channels)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [4, 14],
      habitatDescription:
        "The submerged Sabine River channel and feeder-creek mouths are the dominant catfish habitat in Toledo Bend.",
      lifeStage: "Adults",
      season: "Year-round",
      color: "#0ea5e9",
      creditUrl: TOLEDO_BEND_URL,
      inset: 0.22,
    },
  ],
);

// ---------------------------------------------------------------------------
// Texas freshwater habitat map keyed by dataset id
// ---------------------------------------------------------------------------
export const TX_FRESHWATER_EFH_BY_DATASET: Record<string, EfhFeatureCollection> = {
  "lake-fork": LAKE_FORK_EFH,
  "sam-rayburn": SAM_RAYBURN_EFH,
  "toledo-bend": TOLEDO_BEND_EFH,
};
