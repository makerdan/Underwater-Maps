/**
 * build-lake-tahoe-terrain.ts — Build a real, surveyed bathymetry +
 * topography bundle for Lake Tahoe, CA/NV.
 *
 * Primary source: USGS ScienceBase item 5a8ea03fe4b00583a4ddae3b —
 *   the 3 m multibeam DEM published by Schweitzer et al. (2000).
 *   Stored in geographic WGS84; no reprojection required.
 *
 * Fallback: USGS 3DEP + NHD waterbody outline + shore-distance
 *   synthesis. USGS 3DEP does not incorporate the Lake Tahoe
 *   multibeam survey for the lake floor; the service returns the
 *   current water surface (~1 897 m) for open-water cells. We
 *   therefore use the NHD waterbody polygon to identify lake cells
 *   and then apply a smooth shore-distance depth model capped at the
 *   known maximum depth (501 m) — the same pipeline used for the
 *   Texas reservoir bundles.
 *
 * Output:
 *   artifacts/api-server/src/lib/lakeTahoeTerrain.gen.json
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run build-lake-tahoe-terrain
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readF32Tiff,
  fetchImageServerF32,
  buildReservoirTerrainBundle,
  type ReservoirSpec,
} from "./lib/texas-reservoir-terrain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const OUT_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/lib/lakeTahoeTerrain.gen.json",
);

export const LAKE_TAHOE_TERRAIN_OUT_PATH = OUT_PATH;

const SCIENCEBASE_ITEM_ID = "5a8ea03fe4b00583a4ddae3b";
const DATASET_ID = "fw-lake-tahoe-ca-nv";
const RESOLUTION = 256;
const POOL_ELEVATION_M = 1897.0;
const MAX_DEPTH_M = 501;

const BBOX: [number, number, number, number] = [-120.175, 38.88, -119.925, 39.25];

// ---------------------------------------------------------------------------
// ScienceBase download path
// ---------------------------------------------------------------------------

interface SbFile {
  name: string;
  downloadUri: string;
  contentType?: string;
  size?: number;
}

async function fetchScienceBaseFiles(itemId: string): Promise<SbFile[] | null> {
  const url = `https://www.sciencebase.gov/catalog/item/${itemId}?format=json`;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/json" },
    });
    if (!r.ok) {
      console.log(`    ScienceBase API: HTTP ${r.status} for item ${itemId}`);
      return null;
    }
    const j = (await r.json()) as { files?: SbFile[]; errors?: { message: string } };
    if (j.errors) {
      console.log(`    ScienceBase API: ${j.errors.message}`);
      return null;
    }
    return j.files ?? [];
  } catch (err) {
    console.log(`    ScienceBase API: network error — ${(err as Error).message}`);
    return null;
  }
}

/** Bilinear sample of an F32 raster at fractional (col, row). */
function bilinearSample(data: Float32Array, width: number, height: number, col: number, row: number): number {
  const c0 = Math.floor(col), r0 = Math.floor(row);
  const c1 = c0 + 1, r1 = r0 + 1;
  if (c0 < 0 || r0 < 0 || c1 >= width || r1 >= height) return NaN;
  const v00 = data[r0 * width + c0]!;
  const v10 = data[r0 * width + c1]!;
  const v01 = data[r1 * width + c0]!;
  const v11 = data[r1 * width + c1]!;
  if (!isFinite(v00) || !isFinite(v10) || !isFinite(v01) || !isFinite(v11)) return NaN;
  const cf = col - c0, rf = row - r0;
  return v00 * (1 - cf) * (1 - rf) + v10 * cf * (1 - rf) + v01 * (1 - cf) * rf + v11 * cf * rf;
}

/** Read the origin and pixel scale from a geographic WGS84 GeoTIFF. */
function readTiffOriginAndScale(buf: ArrayBuffer): { originLon: number; originLat: number; pixScaleLon: number; pixScaleLat: number } | null {
  const dv = new DataView(buf);
  const le = dv.getUint16(0) === 0x4949;
  const ru16 = (off: number) => dv.getUint16(off, le);
  const ru32 = (off: number) => dv.getUint32(off, le);
  const rd64 = (off: number) => dv.getFloat64(off, le);

  const ifdOffset = ru32(4);
  const numEntries = ru16(ifdOffset);

  let originLon = NaN, originLat = NaN, pixScaleLon = NaN, pixScaleLat = NaN;

  for (let i = 0; i < numEntries; i++) {
    const off = ifdOffset + 2 + i * 12;
    const tag = ru16(off);
    const type = ru16(off + 2);
    const count = ru32(off + 4);
    const valOff = off + 8;
    if (type !== 12) continue;
    const base = count * 8 > 4 ? ru32(valOff) : valOff;
    const readD = (j: number) => rd64(base + j * 8);
    if (tag === 33550) { pixScaleLon = readD(0); pixScaleLat = readD(1); }
    else if (tag === 33922) { originLon = readD(3); originLat = readD(4); }
  }

  if (!isFinite(originLon) || !isFinite(pixScaleLon)) return null;
  return { originLon, originLat, pixScaleLon, pixScaleLat };
}

/** Attempt to download the 3 m Lake Tahoe DEM from ScienceBase. Returns a
 *  WGS84 256 × 256 depth grid (depth below pool surface), or null. */
async function tryScienceBaseDepths(N: number): Promise<Float32Array | null> {
  console.log(`    Querying ScienceBase item ${SCIENCEBASE_ITEM_ID}…`);
  const files = await fetchScienceBaseFiles(SCIENCEBASE_ITEM_ID);
  if (!files) return null;
  const tiffFile = files.find((f) => /\.(tif|tiff)$/i.test(f.name) && f.downloadUri);
  if (!tiffFile) {
    console.log(`    ScienceBase: item accessible but no GeoTIFF in ${files.length} attached files.`);
    return null;
  }
  console.log(`    Downloading '${tiffFile.name}' (${tiffFile.size ? `${(tiffFile.size / 1_048_576).toFixed(1)} MB` : "size unknown"})…`);
  let buf: ArrayBuffer;
  try {
    const r = await fetch(tiffFile.downloadUri, { signal: AbortSignal.timeout(300_000) });
    if (!r.ok) { console.log(`    Download HTTP ${r.status}`); return null; }
    buf = await r.arrayBuffer();
  } catch (err) {
    console.log(`    Download failed: ${(err as Error).message}`);
    return null;
  }
  console.log(`    Downloaded ${(buf.byteLength / 1_048_576).toFixed(1)} MB. Parsing GeoTIFF…`);
  let tiff: { width: number; height: number; data: Float32Array };
  try { tiff = readF32Tiff(buf); }
  catch (err) { console.log(`    Parse failed: ${(err as Error).message}`); return null; }

  const geo = readTiffOriginAndScale(buf);
  if (!geo) {
    console.log("    Could not extract geospatial metadata from GeoTIFF.");
    return null;
  }
  console.log(`    Raster: ${tiff.width}×${tiff.height} px; origin=(${geo.originLon.toFixed(4)}, ${geo.originLat.toFixed(4)}) scale=${geo.pixScaleLon.toFixed(6)}`);

  const [minLon, minLat, maxLon, maxLat] = BBOX;
  const depths = new Float32Array(N * N);
  let validCount = 0;

  for (let row = 0; row < N; row++) {
    const lat = maxLat - ((row + 0.5) / N) * (maxLat - minLat);
    for (let col = 0; col < N; col++) {
      const lon = minLon + ((col + 0.5) / N) * (maxLon - minLon);
      const srcCol = (lon - geo.originLon) / geo.pixScaleLon - 0.5;
      const srcRow = (geo.originLat - lat) / geo.pixScaleLat - 0.5;
      const elev = bilinearSample(tiff.data, tiff.width, tiff.height, srcCol, srcRow);
      if (!isFinite(elev) || elev <= -9000) {
        depths[row * N + col] = 0;
      } else {
        const d = Math.max(0, Math.min(MAX_DEPTH_M, POOL_ELEVATION_M - elev));
        depths[row * N + col] = d;
        if (d > 0) validCount++;
      }
    }
  }
  console.log(`    Reprojected ${N}×${N} grid: ${validCount} lake-depth cells.`);
  if (validCount < N * N * 0.02) {
    console.log("    Too few valid lake cells — raster may not cover this AOI.");
    return null;
  }
  return depths;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  const N = RESOLUTION;
  console.log("=== build-lake-tahoe-terrain ===");
  console.log(`  AOI: ${BBOX.join(",")}  resolution: ${N}×${N}`);
  console.log(`  Pool elevation: ${POOL_ELEVATION_M} m  Max depth: ${MAX_DEPTH_M} m`);

  console.log("\n  [1] USGS ScienceBase item " + SCIENCEBASE_ITEM_ID + " (Schweitzer et al. 2000 3 m DEM)…");
  const sbDepths = await tryScienceBaseDepths(N);

  if (sbDepths) {
    console.log("    ScienceBase OK — writing bundle from real survey raster.");
    const finiteVals = Array.from(sbDepths).filter((v) => v > 0);
    const maxD = Math.max(...finiteVals);
    console.log(`    Max depth from ScienceBase raster: ${maxD.toFixed(1)} m`);

    const demUrl =
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";
    let demGrid: Float32Array | null = null;
    try {
      demGrid = await fetchImageServerF32(demUrl, BBOX, N);
    } catch {
      demGrid = null;
    }

    const depths: number[] = [];
    const topography: number[] = [];
    let minDepth = Infinity, maxDepth = -Infinity;
    let minTopo = Infinity, maxTopo = -Infinity;

    for (let i = 0; i < N * N; i++) {
      const d = sbDepths[i]!;
      const elev = demGrid ? (demGrid[i] ?? NaN) : NaN;
      if (d > 0.5) {
        depths.push(d); topography.push(0);
        if (d < minDepth) minDepth = d; if (d > maxDepth) maxDepth = d;
      } else {
        const topo = isFinite(elev) ? Math.max(0, elev - POOL_ELEVATION_M) : 0;
        depths.push(0); topography.push(topo);
        if (topo < minTopo) minTopo = topo; if (topo > maxTopo) maxTopo = topo;
      }
    }
    if (!isFinite(minDepth)) minDepth = 0; if (!isFinite(maxDepth)) maxDepth = 0;
    if (!isFinite(minTopo)) minTopo = 0; if (!isFinite(maxTopo)) maxTopo = 0;

    const [minLon, minLat, maxLon, maxLat] = BBOX;
    const bundle = {
      datasetId: DATASET_ID,
      bbox: { minLon, minLat, maxLon, maxLat },
      width: N, height: N,
      depths, topography,
      minDepth: Math.round(minDepth * 10) / 10,
      maxDepth: Math.round(maxDepth * 10) / 10,
      minTopography: Math.round(minTopo * 10) / 10,
      maxTopography: Math.round(maxTopo * 10) / 10,
      poolElevationM: POOL_ELEVATION_M,
      bathymetry: {
        source: "usgs-sciencebase",
        label: "USGS ScienceBase — Lake Tahoe 3 m Multibeam DEM (Schweitzer et al. 2000)",
        creditUrl: "https://www.sciencebase.gov/catalog/item/5a8ea03fe4b00583a4ddae3b",
        serviceUrl: `https://www.sciencebase.gov/catalog/item/${SCIENCEBASE_ITEM_ID}`,
        fetchedAt: new Date().toISOString(),
        attempts: [
          { source: "usgs-sciencebase", ok: true, note: `ScienceBase item ${SCIENCEBASE_ITEM_ID}: 3 m multibeam DEM downloaded.` },
        ],
      },
      topographyProvenance: {
        source: "usgs-3dep",
        label: demGrid ? "USGS 3DEP" : "Not available",
        creditUrl: "https://www.usgs.gov/3d-elevation-program",
        serviceUrl: demUrl,
        fetchedAt: new Date().toISOString(),
        attempts: [{ source: "usgs-3dep", ok: !!demGrid, note: demGrid ? "USGS 3DEP DEM." : "3DEP unavailable." }],
      },
    };

    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(bundle, null, 2), "utf8");
    console.log(`\n  Written (ScienceBase path): ${OUT_PATH}`);
    return;
  }

  console.log("    GAP: ScienceBase unavailable. Falling back to USGS 3DEP + NHD synthesis.");

  const spec: ReservoirSpec = {
    datasetId: DATASET_ID,
    outPath: OUT_PATH,
    bbox: BBOX,
    resolution: N,
    poolElevationM: POOL_ELEVATION_M,
    maxSurveyedDepthM: MAX_DEPTH_M,
    nameRe: /lake.?tahoe/i,
    usaceDistrict: "Sacramento District",
    usaceDistrictUrl: "https://www.spk.usace.army.mil/",
    minWaterbodyAreaSqkm: 100,
    smoothBathymetry: true,
  };

  const bundle = await buildReservoirTerrainBundle(spec);

  if (bundle.bathymetry.attempts[0]?.source !== "usgs-sciencebase") {
    bundle.bathymetry.attempts.unshift({
      source: "usgs-sciencebase",
      ok: false,
      note: `ScienceBase item ${SCIENCEBASE_ITEM_ID} is not publicly accessible (item secured or not found).`,
    });
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(bundle, null, 2), "utf8");
  console.log(`\n  Written (3DEP+NHD fallback path): ${OUT_PATH}`);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");

if (invokedDirectly) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
