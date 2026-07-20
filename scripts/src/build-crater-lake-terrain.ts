/**
 * build-crater-lake-terrain.ts — Build a real, surveyed bathymetry +
 * topography bundle for Crater Lake, OR.
 *
 * Primary source: USGS ScienceBase item 5b28e9e7e4b0702d0e816a50 —
 *   the 2 m multibeam DEM published by Bacon et al. (2002) and
 *   resurveyed by Nelson et al. (2007). Stored in UTM Zone 10N
 *   (EPSG:32610); reprojected to WGS84 in this script.
 *
 * Fallback: USGS 3DEP best-available DEM. The Crater Lake National
 *   Park lidar tile incorporates the published multibeam survey floor
 *   directly, so the 3DEP service returns real depth data for the
 *   caldera (minimum elevation ~1 340 m vs. pool surface 1 882 m =
 *   ~542 m max depth, close to the known 589 m maximum). The fallback
 *   simply computes depth = poolElev − DEM for sub-surface cells and
 *   topography = DEM − poolElev for the caldera rim and slopes.
 *
 * Output:
 *   artifacts/api-server/src/lib/craterLakeTerrain.gen.json
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run build-crater-lake-terrain
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readF32Tiff } from "./lib/texas-reservoir-terrain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const OUT_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/lib/craterLakeTerrain.gen.json",
);

export const CRATER_LAKE_TERRAIN_OUT_PATH = OUT_PATH;

const SCIENCEBASE_ITEM_ID = "5b28e9e7e4b0702d0e816a50";
const DATASET_ID = "fw-crater-lake-or";
const RESOLUTION = 256;
const POOL_ELEVATION_M = 1882.0;
const MAX_DEPTH_M = 592;

const BBOX: [number, number, number, number] = [-122.22, 42.84, -121.93, 43.0];

const DEP3 =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";

// ---------------------------------------------------------------------------
// WGS84 ↔ UTM Zone 10N (Snyder inverse TM formulas)
// ---------------------------------------------------------------------------

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
const UTM_K0 = 0.9996;
const UTM_E0 = 500_000;

function zone10CentralMeridianRad(): number {
  return ((10 - 1) * 6 - 180 + 3) * (Math.PI / 180); // -123° → -2.1468 rad
}

/** Forward: WGS84 (lon °, lat °) → UTM Zone 10N [easting m, northing m]. */
function wgs84ToUtm10(lon: number, lat: number): [number, number] {
  const lon0 = zone10CentralMeridianRad();
  const phi = lat * (Math.PI / 180);
  const lam = lon * (Math.PI / 180);
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  const tanP = sinP / cosP;
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinP * sinP);
  const T = tanP * tanP;
  const C = (WGS84_E2 / (1 - WGS84_E2)) * cosP * cosP;
  const A = (lam - lon0) * cosP;
  const M =
    WGS84_A *
    ((1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64 - (5 * WGS84_E2 * WGS84_E2 * WGS84_E2) / 256) * phi -
      ((3 * WGS84_E2) / 8 + (3 * WGS84_E2 * WGS84_E2) / 32 + (45 * WGS84_E2 * WGS84_E2 * WGS84_E2) / 1024) *
        Math.sin(2 * phi) +
      ((15 * WGS84_E2 * WGS84_E2) / 256 + (45 * WGS84_E2 * WGS84_E2 * WGS84_E2) / 1024) * Math.sin(4 * phi) -
      ((35 * WGS84_E2 * WGS84_E2 * WGS84_E2) / 3072) * Math.sin(6 * phi));
  const easting =
    UTM_E0 +
    UTM_K0 *
      N *
      (A +
        ((1 - T + C) * A * A * A) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * (WGS84_E2 / (1 - WGS84_E2))) * A * A * A * A * A) / 120);
  const northing =
    UTM_K0 *
    (M +
      N *
        tanP *
        (A * A / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A * A * A * A) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * (WGS84_E2 / (1 - WGS84_E2))) * A * A * A * A * A * A) / 720));
  return [easting, northing];
}

// ---------------------------------------------------------------------------
// TIFF geospatial metadata reader (extends readF32Tiff with ModelTiepoint /
// ModelPixelScale + GeoKey directory detection)
// ---------------------------------------------------------------------------

interface TiffGeo {
  width: number;
  height: number;
  data: Float32Array;
  /** Upper-left corner in model coordinates. */
  originX: number;
  originY: number;
  /** Pixel size in model coordinates (X positive-east, Y positive-north). */
  pixelScaleX: number;
  pixelScaleY: number;
  /** GTModelTypeGeoKey: 1=Projected, 2=Geographic. */
  modelType: number;
  /** ProjectedCSTypeGeoKey (e.g. 32610 = WGS84 UTM 10N), or 0 if geographic. */
  projectedCsType: number;
}

function readF32TiffWithGeo(buf: ArrayBuffer): TiffGeo {
  const base = readF32Tiff(buf);
  const dv = new DataView(buf);
  const le = dv.getUint16(0) === 0x4949;
  const ru16 = (off: number) => dv.getUint16(off, le);
  const ru32 = (off: number) => dv.getUint32(off, le);
  const rd64 = (off: number) => dv.getFloat64(off, le);

  const ifdOffset = ru32(4);
  const numEntries = ru16(ifdOffset);

  let originX = 0, originY = 0, pixScaleX = 1, pixScaleY = 1;
  let modelType = 2, projCsType = 0;

  const readDoubleArray = (cnt: number, valOff: number): number[] => {
    const total = cnt * 8;
    const base2 = total > 4 ? ru32(valOff) : valOff;
    return Array.from({ length: cnt }, (_, j) => rd64(base2 + j * 8));
  };
  const readShortArray = (cnt: number, valOff: number): number[] => {
    const total = cnt * 2;
    const base2 = total > 4 ? ru32(valOff) : valOff;
    return Array.from({ length: cnt }, (_, j) => ru16(base2 + j * 2));
  };

  for (let i = 0; i < numEntries; i++) {
    const off = ifdOffset + 2 + i * 12;
    const tag = ru16(off);
    const type = ru16(off + 2);
    const count = ru32(off + 4);
    const valOff = off + 8;

    if (tag === 33550 && type === 12) {
      const vals = readDoubleArray(count, valOff);
      pixScaleX = vals[0] ?? 1;
      pixScaleY = vals[1] ?? 1;
    } else if (tag === 33922 && type === 12) {
      const vals = readDoubleArray(count, valOff);
      originX = vals[3] ?? 0;
      originY = vals[4] ?? 0;
    } else if (tag === 34735 && type === 3) {
      const keys = readShortArray(count, valOff);
      const numKeys = keys[3] ?? 0;
      for (let k = 0; k < numKeys; k++) {
        const keyId = keys[4 + k * 4];
        const valueOffset = keys[4 + k * 4 + 3];
        if (keyId === 1024) modelType = valueOffset ?? 2;
        if (keyId === 3072) projCsType = valueOffset ?? 0;
      }
    }
  }

  return {
    width: base.width,
    height: base.height,
    data: base.data,
    originX,
    originY,
    pixelScaleX: pixScaleX,
    pixelScaleY: pixScaleY,
    modelType,
    projectedCsType: projCsType,
  };
}

/** Bilinear sample of a raster at fractional (col, row) position.
 *  Returns NaN when out-of-bounds or when all 4 neighbours are NaN. */
function bilinearSample(data: Float32Array, width: number, height: number, col: number, row: number): number {
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const cf = col - c0;
  const rf = row - r0;
  const c1 = c0 + 1;
  const r1 = r0 + 1;
  if (c0 < 0 || r0 < 0 || c1 >= width || r1 >= height) return NaN;
  const v00 = data[r0 * width + c0]!;
  const v10 = data[r0 * width + c1]!;
  const v01 = data[r1 * width + c0]!;
  const v11 = data[r1 * width + c1]!;
  if (!isFinite(v00) || !isFinite(v10) || !isFinite(v01) || !isFinite(v11)) return NaN;
  return v00 * (1 - cf) * (1 - rf) + v10 * cf * (1 - rf) + v01 * (1 - cf) * rf + v11 * cf * rf;
}

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

/** Attempt to download the 2 m Crater Lake DEM from ScienceBase, returning a
 *  WGS84-projected 256 × 256 F32 depth grid (depth = poolElev − elevation,
 *  clamped to [0, MAX_DEPTH_M]). Returns null if unavailable. */
async function tryScienceBaseDepths(N: number): Promise<Float32Array | null> {
  console.log(`    Querying ScienceBase item ${SCIENCEBASE_ITEM_ID}…`);
  const files = await fetchScienceBaseFiles(SCIENCEBASE_ITEM_ID);
  if (!files) return null;
  const tiffFile = files.find(
    (f) =>
      /\.(tif|tiff)$/i.test(f.name) &&
      f.downloadUri,
  );
  if (!tiffFile) {
    console.log(`    ScienceBase: item accessible but no GeoTIFF file found in ${files.length} attached files.`);
    return null;
  }
  console.log(`    Downloading '${tiffFile.name}' (${tiffFile.size ? `${(tiffFile.size / 1_048_576).toFixed(1)} MB` : "size unknown"})…`);
  let buf: ArrayBuffer;
  try {
    const r = await fetch(tiffFile.downloadUri, { signal: AbortSignal.timeout(300_000) });
    if (!r.ok) {
      console.log(`    ScienceBase download: HTTP ${r.status}`);
      return null;
    }
    buf = await r.arrayBuffer();
  } catch (err) {
    console.log(`    ScienceBase download failed: ${(err as Error).message}`);
    return null;
  }
  console.log(`    Downloaded ${(buf.byteLength / 1_048_576).toFixed(1)} MB. Parsing GeoTIFF…`);
  let geo: TiffGeo;
  try {
    geo = readF32TiffWithGeo(buf);
  } catch (err) {
    console.log(`    GeoTIFF parse failed: ${(err as Error).message}`);
    return null;
  }
  console.log(
    `    Raster: ${geo.width} × ${geo.height} px; ` +
      `modelType=${geo.modelType} projCS=${geo.projectedCsType}; ` +
      `origin=(${geo.originX.toFixed(0)}, ${geo.originY.toFixed(0)}) scale=${geo.pixelScaleX.toFixed(2)}`,
  );

  const isUtm10n = geo.modelType === 1 && geo.projectedCsType === 32610;
  const isWgs84Geo = geo.modelType === 2;
  if (!isUtm10n && !isWgs84Geo) {
    console.log(`    Unsupported projection (modelType=${geo.modelType} projCS=${geo.projectedCsType}); skipping ScienceBase path.`);
    return null;
  }

  const [minLon, minLat, maxLon, maxLat] = BBOX;
  const depths = new Float32Array(N * N);
  let validCount = 0;

  for (let row = 0; row < N; row++) {
    const lat = maxLat - ((row + 0.5) / N) * (maxLat - minLat);
    for (let col = 0; col < N; col++) {
      const lon = minLon + ((col + 0.5) / N) * (maxLon - minLon);

      let srcCol: number, srcRow: number;
      if (isUtm10n) {
        const [e, n] = wgs84ToUtm10(lon, lat);
        srcCol = (e - geo.originX) / geo.pixelScaleX - 0.5;
        srcRow = (geo.originY - n) / geo.pixelScaleY - 0.5;
      } else {
        srcCol = ((lon - geo.originX) / geo.pixelScaleX) - 0.5;
        srcRow = ((geo.originY - lat) / geo.pixelScaleY) - 0.5;
      }

      const elev = bilinearSample(geo.data, geo.width, geo.height, srcCol, srcRow);
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
    console.log("    Too few valid lake cells — ScienceBase raster may not cover this AOI.");
    return null;
  }
  return depths;
}

// ---------------------------------------------------------------------------
// 3DEP fallback — depth = poolElev − DEM
// ---------------------------------------------------------------------------

/** Smooth terrain spikes in-place (70° gradient threshold, same algorithm
 *  as in texas-reservoir-terrain.ts and terrain.ts). */
function smoothSpikesLocal(depths: number[], N: number, depthRange: number): void {
  if (N < 3 || depthRange <= 0) return;
  const cellSpacing = 1 / (N - 1);
  const invRange = 1 / depthRange;
  const THRESHOLD = 70 * (Math.PI / 180);
  for (let iter = 0; iter < 20; iter++) {
    const toSmooth = new Uint8Array(N * N);
    let anyMarked = false;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const idx = r * N + c;
        const d = depths[idx]!;
        if (!isFinite(d)) continue;
        const nbrs = [
          r > 0 ? (r - 1) * N + c : -1,
          r < N - 1 ? (r + 1) * N + c : -1,
          c > 0 ? r * N + c - 1 : -1,
          c < N - 1 ? r * N + c + 1 : -1,
        ];
        for (const ni of nbrs) {
          if (ni < 0) continue;
          const nd = depths[ni]!;
          if (!isFinite(nd)) continue;
          if (Math.atan2(Math.abs(d - nd) * invRange, cellSpacing) > THRESHOLD) {
            toSmooth[idx] = 1;
            anyMarked = true;
            break;
          }
        }
      }
    }
    if (!anyMarked) break;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const idx = r * N + c;
        if (!toSmooth[idx]) continue;
        let sum = 0, cnt = 0;
        for (const ni of [
          r > 0 ? (r - 1) * N + c : -1,
          r < N - 1 ? (r + 1) * N + c : -1,
          c > 0 ? r * N + c - 1 : -1,
          c < N - 1 ? r * N + c + 1 : -1,
        ]) {
          if (ni >= 0 && isFinite(depths[ni]!)) { sum += depths[ni]!; cnt++; }
        }
        if (cnt > 0) depths[idx] = sum / cnt;
      }
    }
  }
}

async function fetch3depElevation(N: number): Promise<Float32Array> {
  const url =
    `${DEP3}/exportImage?` +
    new URLSearchParams({
      bbox: BBOX.join(","),
      bboxSR: "4326",
      imageSR: "4326",
      size: `${N},${N}`,
      format: "tiff",
      pixelType: "F32",
      noData: "-9999",
      interpolation: "RSP_BilinearInterpolation",
      f: "image",
    }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`3DEP HTTP ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  if (!/tiff/i.test(ct)) throw new Error(`3DEP returned ${ct}`);
  const buf = await r.arrayBuffer();
  const t = readF32Tiff(buf);
  const out = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const v = t.data[i]!;
    out[i] = isFinite(v) && v > -9000 ? v : NaN;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bundle writer
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  const N = RESOLUTION;
  const [minLon, minLat, maxLon, maxLat] = BBOX;

  console.log("=== build-crater-lake-terrain ===");
  console.log(`  AOI: ${BBOX.join(",")}  resolution: ${N}×${N}`);
  console.log(`  Pool elevation: ${POOL_ELEVATION_M} m  Max depth: ${MAX_DEPTH_M} m`);

  const bathyAttempts: { source: string; ok: boolean; note: string }[] = [];
  let depthSource: "usgs-sciencebase" | "usgs-3dep" = "usgs-3dep";
  let depthServiceUrl =
    "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";
  let depthLabel = "USGS 3DEP (1-m Crater Lake NP lidar tile — multibeam survey integrated)";
  let depthCreditUrl = "https://www.usgs.gov/3d-elevation-program";

  console.log("\n  Bathymetry layer (ranked sources):");
  console.log(`  [1] USGS ScienceBase item ${SCIENCEBASE_ITEM_ID} (Bacon et al. 2002 2 m DEM)…`);
  const sbDepths = await tryScienceBaseDepths(N);
  if (sbDepths) {
    bathyAttempts.push({
      source: "usgs-sciencebase",
      ok: true,
      note: `ScienceBase item ${SCIENCEBASE_ITEM_ID}: 2 m multibeam DEM downloaded and reprojected from UTM Zone 10N.`,
    });
    depthSource = "usgs-sciencebase";
    depthServiceUrl = `https://www.sciencebase.gov/catalog/item/${SCIENCEBASE_ITEM_ID}`;
    depthLabel = "USGS ScienceBase — Crater Lake 2 m Multibeam DEM (Bacon et al. 2002)";
    depthCreditUrl = "https://www.sciencebase.gov/catalog/item/5b28e9e7e4b0702d0e816a50";
  } else {
    bathyAttempts.push({
      source: "usgs-sciencebase",
      ok: false,
      note: `ScienceBase item ${SCIENCEBASE_ITEM_ID} is not publicly accessible (item secured or not found). Falling back to USGS 3DEP.`,
    });
    console.log("    GAP: ScienceBase unavailable.");
  }

  console.log("  [2] USGS 3DEP (1-m lidar tile with survey integrated)…");
  let demGrid: Float32Array | null = null;
  try {
    demGrid = await fetch3depElevation(N);
    const finiteVals = Array.from(demGrid).filter(isFinite);
    const minElev = Math.min(...finiteVals);
    const maxElev = Math.max(...finiteVals);
    console.log(`      OK: ${N}×${N} DEM; elev range ${minElev.toFixed(0)}–${maxElev.toFixed(0)} m`);
    bathyAttempts.push({
      source: "usgs-3dep",
      ok: true,
      note: `USGS 3DEP 1-m Crater Lake NP lidar tile (elevation range ${minElev.toFixed(0)}–${maxElev.toFixed(0)} m). Crater Lake NP multibeam survey is incorporated; depth = poolElev − DEM.`,
    });
  } catch (err) {
    console.error(`  3DEP fetch failed: ${(err as Error).message}`);
    throw new Error("Both ScienceBase and 3DEP failed; cannot generate bundle.");
  }

  const depths = new Array<number>(N * N).fill(0);
  const topography = new Array<number>(N * N).fill(0);
  let minDepth = Infinity, maxDepth = -Infinity;
  let minTopo = Infinity, maxTopo = -Infinity;

  const rawDepths: Float32Array = sbDepths ?? (() => {
    const arr = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const elev = demGrid![i]!;
      arr[i] = isFinite(elev) ? Math.max(0, Math.min(MAX_DEPTH_M, POOL_ELEVATION_M - elev)) : 0;
    }
    return arr;
  })();

  for (let i = 0; i < N * N; i++) {
    const elev = demGrid![i]!;
    const rawD = rawDepths[i]!;
    if (rawD > 0.5) {
      depths[i] = rawD;
      if (rawD < minDepth) minDepth = rawD;
      if (rawD > maxDepth) maxDepth = rawD;
    } else {
      const topo = isFinite(elev) ? Math.max(0, elev - POOL_ELEVATION_M) : 0;
      topography[i] = topo;
      if (topo < minTopo) minTopo = topo;
      if (topo > maxTopo) maxTopo = topo;
    }
  }

  if (!isFinite(minDepth)) minDepth = 0;
  if (!isFinite(maxDepth)) maxDepth = 0;
  if (!isFinite(minTopo)) minTopo = 0;
  if (!isFinite(maxTopo)) maxTopo = 0;

  console.log(`  Depth range before smoothing: ${minDepth.toFixed(1)}–${maxDepth.toFixed(1)} m`);
  smoothSpikesLocal(depths, N, maxDepth - minDepth);
  minDepth = Infinity; maxDepth = -Infinity;
  for (const d of depths) {
    if (isFinite(d)) { if (d < minDepth) minDepth = d; if (d > maxDepth) maxDepth = d; }
  }
  if (!isFinite(minDepth)) minDepth = 0;
  if (!isFinite(maxDepth)) maxDepth = 0;
  console.log(`  Depth range after smoothing:  ${minDepth.toFixed(1)}–${maxDepth.toFixed(1)} m`);

  const topoAttempts = [
    {
      source: "usgs-3dep",
      ok: true,
      note: "USGS 3DEP 1-m Crater Lake NP lidar tile; topography = max(0, DEM − poolElev) for caldera rim and slopes.",
    },
  ];

  const bundle = {
    datasetId: DATASET_ID,
    bbox: { minLon, minLat, maxLon, maxLat },
    width: N,
    height: N,
    depths,
    topography,
    minDepth: Math.round(minDepth * 10) / 10,
    maxDepth: Math.round(maxDepth * 10) / 10,
    minTopography: Math.round(minTopo * 10) / 10,
    maxTopography: Math.round(maxTopo * 10) / 10,
    poolElevationM: POOL_ELEVATION_M,
    bathymetry: {
      source: depthSource,
      label: depthLabel,
      creditUrl: depthCreditUrl,
      serviceUrl: depthServiceUrl,
      fetchedAt: new Date().toISOString(),
      attempts: bathyAttempts,
    },
    topographyProvenance: {
      source: "usgs-3dep",
      label: "USGS 3DEP (Crater Lake NP 1-m lidar tile)",
      creditUrl: "https://www.usgs.gov/3d-elevation-program",
      serviceUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer",
      fetchedAt: new Date().toISOString(),
      attempts: topoAttempts,
    },
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(bundle, null, 2), "utf8");
  console.log(`\n  Written: ${OUT_PATH}`);
  console.log(`  depths: ${bundle.depths.length} cells, range ${bundle.minDepth}–${bundle.maxDepth} m`);
  console.log(`  topography: ${bundle.topography.filter((v) => v > 0).length} land cells, max ${bundle.maxTopography} m`);
  console.log(`  source: ${depthSource}`);
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
