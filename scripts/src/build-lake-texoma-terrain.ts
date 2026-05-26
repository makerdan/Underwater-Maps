/**
 * build-lake-texoma-terrain.ts — Build a real, surveyed bathymetry +
 * topography bundle for the Lake Texoma AOI (TX/OK border).
 *
 * Like the Ray Roberts builder, this is a thin spec wrapper around the
 * shared `lib/texas-reservoir-terrain.ts` pipeline:
 *
 *   1. TWDB volumetric/sedimentation survey (ArcGIS ImageServer walk).
 *      The most recent TWDB Texoma survey (≈2009, refreshed 2020) is
 *      published as a PDF report; the underlying raster is not exposed
 *      via a public ImageServer yet. The probe still walks the TWDB
 *      ArcGIS catalogue so the next scheduled run picks it up
 *      automatically the moment one appears.
 *   2. USACE Tulsa District hydrographic surveys (GeoSpatial Hub
 *      items search). Texoma is operated by the Tulsa District; their
 *      Denison Dam survey deliverables are distributed via project
 *      pages today but the Hub search will surface them if/when they
 *      are exposed as Image/Map Services.
 *   3. USGS 3DEP best-available DEM + shore-distance synthesis. 3DEP
 *      across the Red River valley returns the pre-impoundment
 *      Red/Washita confluence topography under most of the lake basin,
 *      so depth = pool_elevation − DEM. Where the DEM has been
 *      resampled to the current water surface (open water at the
 *      time of collection), depth is synthesised from distance-to-
 *      shore so the basin grades smoothly from 0 m at the bank to the
 *      surveyed maximum near Denison Dam.
 *
 * Each generated bundle records honest provenance ("twdb" / "usace" /
 * "usgs-3dep") in the same `LayerProvenance` shape used by Ray
 * Roberts, so the API + UI need no special-casing per reservoir.
 *
 * Output:
 *   artifacts/api-server/src/lib/lakeTexomaTerrain.gen.json
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run build-lake-texoma-terrain
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReservoirTerrainBundle,
  type ReservoirSpec,
} from "./lib/texas-reservoir-terrain.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/lib/lakeTexomaTerrain.gen.json",
);

/**
 * Lake Texoma normal/conservation pool elevation.
 * USACE Tulsa District publishes 617.0 ft NGVD29 (= 188.06 m) as the
 * normal pool / top of conservation pool at Denison Dam. The NGVD29 →
 * NAVD88 offset in this part of the Red River valley is well under
 * the viewer's vertical resolution; we treat both datums as a single
 * reference plane here.
 *
 * Surveyed maximum depth near Denison Dam is ≈ 30 m at conservation
 * pool, matching published USACE / TPWD lake-survey figures.
 */
const SPEC: ReservoirSpec = {
  datasetId: "lake-texoma",
  outPath: OUT_PATH,
  // AOI clips the main body of Texoma — Big Mineral / Cumberland
  // Cove arms inclusive — without dragging in the upstream Red and
  // Washita inflow channels.
  bbox: [-97.05, 33.78, -96.42, 34.06],
  resolution: 256,
  poolElevationM: 188.06,
  maxSurveyedDepthM: 30,
  nameRe: /texoma/i,
  usaceDistrict: "Tulsa District",
  usaceDistrictUrl: "https://www.swt.usace.army.mil/",
  // Texoma's main pool is ≈ 360 km²; a 50 km² floor easily picks the
  // reservoir while filtering nearby ponds and oxbows.
  minWaterbodyAreaSqkm: 50,
};

export const LAKE_TEXOMA_TERRAIN_OUT_PATH = OUT_PATH;

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
