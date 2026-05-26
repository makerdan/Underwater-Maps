/**
 * Texas freshwater "EFH-equivalent" priority habitat polygons.
 *
 * Federal Essential Fish Habitat (EFH) is a strictly saltwater concept under
 * the Magnuson-Stevens Act. For the freshwater Texas reservoirs we surface
 * priority spawning / forage / structure zones using real upstream GIS data:
 *
 *   - Brushpile / artificial-habitat clusters are sourced from TPWD's
 *     "Texas Fish Habitat Structures" FeatureServer (per-attractor GPS
 *     points; clustered into convex-hull polygons at build time).
 *   - Shoreline / spawning-flat polygons are the actual reservoir
 *     waterbody outlines from the USGS National Hydrography Dataset (NHD).
 *   - Creek-channel polygons are NHD flowline polylines for the principal
 *     tributaries (Sabine River / Angelina River / etc.), buffered to a
 *     thin polygon for display.
 *
 * Both bundles are generated at build time by
 *   scripts/src/build-tx-freshwater-efh.ts
 * and persisted as plain JSON next to this module (loaded synchronously
 * via fs.readFileSync). The build copies the .gen.json file into dist/
 * alongside the bundled server entrypoint.
 *
 * The `source` property on each feature identifies the upstream layer
 * (TPWD vs NHD) so the UI can attribute polygons honestly.
 *
 * Sources (per-reservoir TPWD lake pages):
 *   - Lake Fork:    https://tpwd.texas.gov/fishboat/fish/recreational/lakes/fork/
 *   - Sam Rayburn:  https://tpwd.texas.gov/fishboat/fish/recreational/lakes/samrayburn/
 *   - Toledo Bend:  https://tpwd.texas.gov/fishboat/fish/recreational/lakes/toledobend/
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { EfhFeature, EfhFeatureCollection } from "./efhData.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface BundledFeatureProps {
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
  sourceLayer?:
    | "tpwd-fish-habitat-structures"
    | "nhd-waterbody"
    | "nhd-flowline";
}

interface BundledFeature {
  type: "Feature";
  properties: BundledFeatureProps;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

interface BundledCollection {
  type: "FeatureCollection";
  features: BundledFeature[];
  metadata: {
    region: string;
    bbox: [number, number, number, number];
    creditUrl: string;
    lastUpdated: string;
    sources: string[];
  };
}

type BundledDatasets = Record<string, BundledCollection>;

interface BundledOut {
  datasets: BundledDatasets;
  metadata: { generatorHash: string };
}

const BUNDLE: BundledDatasets = (
  JSON.parse(
    readFileSync(resolve(__dirname, "txFreshwaterEfhData.gen.json"), "utf8"),
  ) as BundledOut
).datasets;

/**
 * The shared EfhFeature geometry is `{ type: "Polygon"; coordinates: number[][][] }`,
 * but real NHD waterbody / flowline polygons are MultiPolygons. Explode any
 * MultiPolygons into multiple Polygon features so the existing consumer
 * shape stays unchanged.
 */
function explodeToPolygons(fc: BundledCollection): EfhFeatureCollection {
  // Sort so TPWD-sourced features come first. The frontend popover branches
  // on `source.startsWith("TPWD")` to decide whether to show the TPWD-state
  // disclaimer vs the NOAA federal-EFH credit; if the first feature in the
  // collection is the NHD waterbody polygon (USGS, non-TPWD) the e2e
  // attribution check fails even though the dataset is a Texas reservoir.
  // Putting the TPWD-attributed features first preserves the "this dataset
  // is curated by TPWD" framing on the very first hit-test.
  const sorted = [...fc.features].sort((a, b) => {
    const aT = a.properties.source.startsWith("TPWD") ? 0 : 1;
    const bT = b.properties.source.startsWith("TPWD") ? 0 : 1;
    return aT - bT;
  });

  const features: EfhFeature[] = [];
  for (const f of sorted) {
    const { sourceLayer: _ignored, ...props } = f.properties;
    void _ignored;
    if (f.geometry.type === "Polygon") {
      features.push({
        type: "Feature",
        properties: props,
        geometry: { type: "Polygon", coordinates: f.geometry.coordinates },
      });
    } else {
      for (const polyCoords of f.geometry.coordinates) {
        features.push({
          type: "Feature",
          properties: props,
          geometry: { type: "Polygon", coordinates: polyCoords },
        });
      }
    }
  }
  return {
    type: "FeatureCollection",
    features,
    metadata: {
      region: fc.metadata.region,
      bbox: fc.metadata.bbox,
      creditUrl: fc.metadata.creditUrl,
      lastUpdated: fc.metadata.lastUpdated,
    },
  };
}

export const LAKE_FORK_EFH: EfhFeatureCollection = explodeToPolygons(
  BUNDLE["lake-fork"]!,
);

export const SAM_RAYBURN_EFH: EfhFeatureCollection = explodeToPolygons(
  BUNDLE["sam-rayburn"]!,
);

export const TOLEDO_BEND_EFH: EfhFeatureCollection = explodeToPolygons(
  BUNDLE["toledo-bend"]!,
);

export const LAKE_RAY_ROBERTS_EFH: EfhFeatureCollection = explodeToPolygons(
  BUNDLE["lake-ray-roberts"]!,
);

export const TX_FRESHWATER_EFH_BY_DATASET: Record<string, EfhFeatureCollection> = {
  "lake-fork": LAKE_FORK_EFH,
  "sam-rayburn": SAM_RAYBURN_EFH,
  "toledo-bend": TOLEDO_BEND_EFH,
  "lake-ray-roberts": LAKE_RAY_ROBERTS_EFH,
};
