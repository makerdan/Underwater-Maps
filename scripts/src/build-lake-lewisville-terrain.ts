/**
 * build-lake-lewisville-terrain.ts — Build a real, surveyed bathymetry +
 * topography bundle for the Lake Lewisville AOI (Denton County, north
 * of Dallas).
 *
 * Like the other Texas-reservoir builders, this is a thin spec wrapper
 * around the shared `lib/texas-reservoir-terrain.ts` pipeline:
 *
 *   1. TWDB volumetric/sedimentation survey (ArcGIS ImageServer walk).
 *      TWDB has surveyed Lewisville multiple times; when the
 *      underlying raster is exposed on the TWDB ArcGIS catalogue the
 *      next scheduled run will pick it up automatically.
 *   2. USACE Fort Worth District hydrographic surveys (GeoSpatial Hub
 *      items search). Lewisville is operated by the Fort Worth
 *      District (Lewisville Dam on the Elm Fork of the Trinity); any
 *      published USACE survey will be preferred over the 3DEP
 *      fallback below.
 *   3. USGS 3DEP best-available DEM + shore-distance synthesis. The
 *      pre-impoundment Elm Fork valley is captured in 3DEP under
 *      most of the basin, so depth = pool_elevation − DEM. Where the
 *      DEM has been resampled to the current water surface, depth is
 *      synthesised from distance-to-shore so the basin grades
 *      smoothly from 0 m at the bank to the surveyed maximum near
 *      Lewisville Dam.
 *
 * Each generated bundle records honest provenance ("twdb" / "usace" /
 * "usgs-3dep") in the same `LayerProvenance` shape used by Ray
 * Roberts and Texoma, so the API + UI need no special-casing per
 * reservoir.
 *
 * Output:
 *   artifacts/api-server/src/lib/lakeLewisvilleTerrain.gen.json
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run build-lake-lewisville-terrain
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReservoirTerrainBundle,
  type ReservoirSpec,
} from "./lib/texas-reservoir-terrain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const OUT_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/lib/lakeLewisvilleTerrain.gen.json",
);

/**
 * Lake Lewisville normal/conservation pool elevation.
 * USACE Fort Worth District publishes 522.0 ft NGVD29 (= 159.11 m)
 * as the conservation pool at Lewisville Dam. The NGVD29 → NAVD88
 * offset in Denton County is ≈ -0.1 m, well below the viewer's
 * vertical resolution; we treat both datums as a single reference
 * plane here.
 *
 * Surveyed maximum depth near Lewisville Dam is ≈ 21 m at
 * conservation pool, matching published USACE / TPWD lake-survey
 * figures.
 */
const SPEC: ReservoirSpec = {
  datasetId: "lake-lewisville",
  outPath: OUT_PATH,
  // AOI clips the main body of Lewisville — including the Elm Fork
  // and Hickory/Stewart Creek arms — without dragging in the
  // upstream Elm Fork channel above the lake.
  bbox: [-97.10, 33.04, -96.85, 33.22],
  resolution: 256,
  poolElevationM: 159.11,
  maxSurveyedDepthM: 21,
  nameRe: /lewisville/i,
  usaceDistrict: "Fort Worth District",
  usaceDistrictUrl: "https://www.swf.usace.army.mil/",
  // Lewisville's main pool is ≈ 120 km²; a 30 km² floor easily picks
  // the reservoir while filtering nearby ponds and the smaller
  // upstream Ray Roberts tailwater pools.
  minWaterbodyAreaSqkm: 30,
  // Drift-check sources: hash this wrapper + the shared pipeline so
  // any edit to either file invalidates the recorded generatorHash
  // and trips the unit test in api-server.
  builderSrcPaths: [
    fileURLToPath(import.meta.url),
    resolve(__dirname, "lib/texas-reservoir-terrain.ts"),
  ],
};

export const LAKE_LEWISVILLE_TERRAIN_OUT_PATH = OUT_PATH;

export async function main(): Promise<void> {
  await buildReservoirTerrainBundle(SPEC);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");

if (invokedDirectly) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
