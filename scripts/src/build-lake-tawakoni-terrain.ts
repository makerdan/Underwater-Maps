/**
 * build-lake-tawakoni-terrain.ts — Build a real, surveyed bathymetry +
 * topography bundle for the Lake Tawakoni AOI (Rains/Van Zandt/Hunt
 * counties, east of Dallas).
 *
 * Like the other Texas-reservoir builders, this is a thin spec wrapper
 * around the shared `lib/texas-reservoir-terrain.ts` pipeline:
 *
 *   1. TWDB volumetric/sedimentation survey (ArcGIS ImageServer walk).
 *      TWDB has surveyed Tawakoni multiple times (most recent reports
 *      ≈2017); when the underlying raster is exposed on the TWDB
 *      ArcGIS catalogue the next scheduled run will pick it up
 *      automatically.
 *   2. USACE Fort Worth District hydrographic surveys (GeoSpatial Hub
 *      items search). Tawakoni itself is operated by the Sabine River
 *      Authority of Texas (SRA), not USACE — Iron Bridge Dam is an
 *      SRA project — but the Fort Worth District covers the
 *      surrounding basin and any cooperating USACE hydrographic
 *      survey that surfaces in the Hub will still be considered.
 *   3. USGS 3DEP best-available DEM + shore-distance synthesis. The
 *      Sabine headwaters under Tawakoni were largely captured pre-
 *      impoundment, so depth = pool_elevation − DEM. Where the DEM
 *      has been resampled to the current water surface, depth is
 *      synthesised from distance-to-shore so the basin grades
 *      smoothly from 0 m at the bank to the surveyed maximum.
 *
 * Each generated bundle records honest provenance ("twdb" / "usace" /
 * "usgs-3dep") in the same `LayerProvenance` shape used by Ray
 * Roberts and Texoma, so the API + UI need no special-casing per
 * reservoir.
 *
 * Output:
 *   artifacts/api-server/src/lib/lakeTawakoniTerrain.gen.json
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run build-lake-tawakoni-terrain
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
  "artifacts/api-server/src/lib/lakeTawakoniTerrain.gen.json",
);

/**
 * Lake Tawakoni normal/conservation pool elevation.
 * SRA publishes 437.5 ft NGVD29 (= 133.35 m) as the normal pool /
 * top of conservation pool at Iron Bridge Dam. The NGVD29 → NAVD88
 * offset in this part of east Texas is well under the viewer's
 * vertical resolution; we treat both datums as a single reference
 * plane here.
 *
 * Surveyed maximum depth near Iron Bridge Dam is ≈ 21 m at
 * conservation pool, matching published TPWD lake-survey figures.
 */
const SPEC: ReservoirSpec = {
  datasetId: "lake-tawakoni",
  outPath: OUT_PATH,
  // AOI clips the main body of Tawakoni — including the Sabine and
  // Caddo Creek arms — without dragging in upstream Sabine River
  // channel above the lake.
  bbox: [-96.07, 32.78, -95.78, 32.97],
  resolution: 256,
  poolElevationM: 133.35,
  maxSurveyedDepthM: 21,
  nameRe: /tawakoni/i,
  usaceDistrict: "Fort Worth District",
  usaceDistrictUrl: "https://www.swf.usace.army.mil/",
  // Tawakoni's main pool is ≈ 150 km²; a 30 km² floor easily picks
  // the reservoir while filtering nearby ponds.
  minWaterbodyAreaSqkm: 30,
  // Drift-check sources: hash this wrapper + the shared pipeline so
  // any edit to either file invalidates the recorded generatorHash
  // and trips the unit test in api-server.
  builderSrcPaths: [
    fileURLToPath(import.meta.url),
    resolve(__dirname, "lib/texas-reservoir-terrain.ts"),
  ],
};

export const LAKE_TAWAKONI_TERRAIN_OUT_PATH = OUT_PATH;

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
