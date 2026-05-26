/**
 * build-lake-ray-roberts-terrain.ts — Build a real, surveyed bathymetry +
 * topography bundle for the Lake Ray Roberts AOI.
 *
 * This is a thin spec wrapper around the generic Texas-reservoir
 * builder in `lib/texas-reservoir-terrain.ts`. The shared module
 * implements the ranked-source discovery pattern:
 *
 *   1. TWDB volumetric/sedimentation survey (ArcGIS ImageServer walk).
 *   2. USACE district hydrographic surveys (GeoSpatial Hub items API).
 *   3. USGS 3DEP best-available DEM + shore-distance synthesis.
 *
 * The same pipeline now drives every other Texas reservoir bundle —
 * see e.g. `build-lake-texoma-terrain.ts`. As soon as TWDB or USACE
 * publishes a Ray Roberts ImageServer, the next scheduled run will
 * replace the 3DEP-derived depths and set bathymetry.source to "twdb"
 * or "usace".
 *
 * Output:
 *   artifacts/api-server/src/lib/lakeRayRobertsTerrain.gen.json
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run build-lake-ray-roberts-terrain
 *
 * Scheduled refresh — see scripts/SCHEDULED-RAY-ROBERTS-REFRESH.md.
 *
 * ---------------------------------------------------------------------------
 * Generator-hash drift check
 * ---------------------------------------------------------------------------
 * The bundle's `metadata.generatorHash` is a SHA-256 over the
 * concatenated source bytes of this wrapper *and* the shared module in
 * `lib/texas-reservoir-terrain.ts`. A unit test in `artifacts/api-server`
 * recomputes the hash on every test run and fails — with a clear
 * "re-run the builder" message — whenever the committed JSON was
 * produced by a different version of either file. That flags stale
 * bundles whenever the wrapper's spec, the shared pipeline, or any
 * upstream service URL changes without the JSON being regenerated. If
 * the test fails, refresh the bundle with:
 *
 *   pnpm --filter @workspace/scripts run build-lake-ray-roberts-terrain
 *
 * and commit the regenerated JSON alongside the builder-source change.
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
  "artifacts/api-server/src/lib/lakeRayRobertsTerrain.gen.json",
);

/**
 * Lake Ray Roberts conservation/normal pool elevation.
 * USACE Fort Worth District publishes 632.5 ft NGVD29 (= 192.79 m) as
 * the conservation pool. The NGVD29→NAVD88 offset in Denton County is
 * ≈ -0.1 m, well below the viewer's vertical resolution; we treat both
 * datums as a single reference plane here.
 */
const SPEC: ReservoirSpec = {
  datasetId: "lake-ray-roberts",
  outPath: OUT_PATH,
  bbox: [-97.15, 33.30, -96.92, 33.52],
  resolution: 256,
  poolElevationM: 192.79,
  maxSurveyedDepthM: 30,
  nameRe: /ray.?roberts/i,
  usaceDistrict: "Fort Worth District",
  usaceDistrictUrl: "https://www.swf.usace.army.mil/",
  minWaterbodyAreaSqkm: 20,
  // Drift-check sources: hash this wrapper + the shared pipeline so any
  // edit to either file invalidates the recorded generatorHash and trips
  // the unit test in api-server.
  builderSrcPaths: [
    fileURLToPath(import.meta.url),
    resolve(__dirname, "lib/texas-reservoir-terrain.ts"),
  ],
};

export const RAY_ROBERTS_TERRAIN_OUT_PATH = OUT_PATH;

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
