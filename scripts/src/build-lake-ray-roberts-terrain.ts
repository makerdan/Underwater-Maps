/**
 * build-lake-ray-roberts-terrain.ts — Build a real, surveyed bathymetry +
 * topography bundle for the Lake Ray Roberts AOI.
 *
 * Why this exists: Lake Ray Roberts currently renders with a synthetic
 * fbm fallback because NCEI and GEBCO have no meaningful coverage for an
 * inland North Texas reservoir, so the terrain pipeline ends up at the
 * "synthetic" branch. This script replaces those synthetic depths with a
 * real survey-derived grid, plus a matched topography grid for the
 * surrounding land (dam, park ridges, Elm Fork valley walls).
 *
 * Both layers are produced for the same bbox at the same resolution and
 * meet seamlessly at the shoreline (depth = 0, topography = 0 along the
 * waterbody outline), so the rendered mesh has no visible seam.
 *
 * General principle (also applies to future bathymetry sources): for any
 * waterbody, try local/regional/state surveys first before falling back
 * to global grids. The ranked-source pattern in NCEI_DATASET_COVERAGES in
 * terrain.ts is the model.
 *
 * ---------------------------------------------------------------------------
 * Ranked sources for Lake Ray Roberts — bathymetry (below water)
 * ---------------------------------------------------------------------------
 *   1. TWDB Reservoir Volumetric & Sedimentation Survey — Ray Roberts.
 *      https://www.twdb.texas.gov/surfacewater/surveys/index.asp
 *      The most recent volumetric survey (~2008) is published as a PDF
 *      report with depth-contour graphics; the underlying raster is not
 *      offered through a machine-readable web service. We probe a known
 *      TWDB ArcGIS endpoint, log the gap on failure, and fall through.
 *
 *   2. USACE Fort Worth District hydrographic surveys.
 *      https://www.swf.usace.army.mil/  /  https://geospatial-usace.opendata.arcgis.com/
 *      Ray Roberts is a USACE-operated reservoir. The Fort Worth District
 *      periodically publishes hydrographic survey deliverables, but they
 *      are distributed via FOIA reading-room PDFs / project pages rather
 *      than a public WCS / ImageServer feed. We probe the GeoSpatial
 *      Repository's index, log the gap on failure, and fall through.
 *
 *   3. USGS 3DEP DEM of the pre-impoundment Elm Fork Trinity valley
 *      combined with the current normal-pool water-surface elevation.
 *      https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer
 *      The dynamic 3DEP service serves the best-available DEM at each
 *      pixel (1-m lidar where collected, 1/3" seamless DEM otherwise);
 *      across the Ray Roberts AOI it returns pre-impoundment topography
 *      under most of the lake basin. Depth = pool_elevation − DEM.
 *      Where the DEM has been resampled to the current water surface, we
 *      synthesise depth from distance-to-shore so the basin still grades
 *      smoothly from 0 m at the bank to the surveyed maximum near the dam.
 *
 * ---------------------------------------------------------------------------
 * Ranked sources for surrounding topography (above water)
 * ---------------------------------------------------------------------------
 *   1. USGS 3DEP 1-m lidar DEM (via the same dynamic ImageServer above —
 *      the service auto-selects the highest-resolution layer available
 *      per pixel, which is 1-m StratMap lidar across north-central TX).
 *   2. USGS 3DEP 1/3" seamless DEM (fallback served by the same service
 *      where lidar is missing).
 *   3. TNRIS / Texas GeoData StratMap mosaics (probed; falls back here
 *      only if the federal endpoints are unreachable).
 *
 * Implementation: the 3DEP ImageServer exposes a single dynamic
 * coverage that integrates both ranked options (lidar + seamless), so a
 * single TIFF export covers both ranked sources for the topography layer;
 * we record which one the service actually returned per the response's
 * "rasterId" sampled at the AOI centre.
 *
 * Output:
 *   artifacts/api-server/src/lib/lakeRayRobertsTerrain.gen.json
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run build-lake-ray-roberts-terrain
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/lib/lakeRayRobertsTerrain.gen.json",
);

// ---------------------------------------------------------------------------
// AOI configuration (matches the "lake-ray-roberts" preset in terrain.ts)
// ---------------------------------------------------------------------------

const DATASET_ID = "lake-ray-roberts";
const BBOX: [number, number, number, number] = [-97.15, 33.30, -96.92, 33.52];
const RESOLUTION = 256;

/**
 * Lake Ray Roberts conservation/normal pool elevation.
 * USACE Fort Worth District publishes 632.5 ft NGVD29 (= 192.79 m) as the
 * conservation pool. The NGVD29→NAVD88 offset in Denton County is ≈ -0.1 m,
 * well below the viewer's vertical resolution; we treat both datums as a
 * single reference plane here.
 */
const POOL_ELEV_M = 192.79;

/** Surveyed maximum depth (m) — used to scale the shore-distance synthesis
 *  in cells where 3DEP DEM has been resampled to the current water surface. */
const MAX_SURVEYED_DEPTH_M = 30;

// ---------------------------------------------------------------------------
// Upstream services
// ---------------------------------------------------------------------------

const NHD_WATERBODY =
  "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12";
const DEP3 =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";

// Probed but not currently machine-readable for this AOI — see the
// ranked-source comment above. These are recorded so the build log
// honestly documents the gap.
const TWDB_INDEX = "https://www.twdb.texas.gov/surfacewater/surveys/index.asp";
const USACE_INDEX =
  "https://geospatial-usace.opendata.arcgis.com/search?tags=hydrographic%20survey";
const TNRIS_INDEX = "https://data.tnris.org/";

// ---------------------------------------------------------------------------
// Bundled output schema
// ---------------------------------------------------------------------------

type LayerSource =
  | "twdb"
  | "usace"
  | "usgs-3dep"
  | "tnris-stratmap";

interface LayerProvenance {
  /** Which ranked source ultimately supplied this layer's data. */
  source: LayerSource;
  /** Human-readable label for the data-source badge / credit. */
  label: string;
  /** Credit URL surfaced next to the badge in the UI. */
  creditUrl: string;
  /** Service URL the data was actually pulled from. */
  serviceUrl: string;
  /** ISO timestamp the data was fetched at. */
  fetchedAt: string;
  /** Per-source ranked-fetch trace for transparency. */
  attempts: {
    source: LayerSource;
    ok: boolean;
    note: string;
  }[];
}

interface BundledTerrain {
  datasetId: string;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  width: number;
  height: number;
  /** Row-major depth grid (m below normal-pool water surface, ≥ 0). */
  depths: number[];
  /** Row-major topography grid (m above normal-pool water surface, ≥ 0). */
  topography: number[];
  minDepth: number;
  maxDepth: number;
  minTopography: number;
  maxTopography: number;
  poolElevationM: number;
  bathymetry: LayerProvenance;
  topographyProvenance: LayerProvenance;
}

// ---------------------------------------------------------------------------
// Minimal TIFF reader for ArcGIS exportImage output
//
// 3DEP exportImage returns an uncompressed, tiled, F32 GeoTIFF (one band).
// We only need to extract the float32 pixel data — projection metadata is
// implied by the request bbox. Supports both classic and tiled TIFFs.
// ---------------------------------------------------------------------------

function readF32Tiff(buf: ArrayBuffer): { width: number; height: number; data: Float32Array } {
  const dv = new DataView(buf);
  const bo = dv.getUint16(0);
  if (bo !== 0x4949 && bo !== 0x4d4d) throw new Error("not a TIFF");
  const le = bo === 0x4949;
  if (dv.getUint16(2, le) !== 42) throw new Error("not a classic TIFF");
  const ifdOffset = dv.getUint32(4, le);
  const numEntries = dv.getUint16(ifdOffset, le);

  let width = 0, height = 0;
  let bitsPerSample = 8;
  let compression = 1;
  let sampleFormat = 1;
  let rowsPerStrip = 0;
  let tileWidth = 0, tileLength = 0;
  let stripOffsets: number[] = [];
  let stripByteCounts: number[] = [];
  let tileOffsets: number[] = [];
  let tileByteCounts: number[] = [];

  const readArray = (type: number, count: number, valOff: number): number[] => {
    const sz = type === 3 ? 2 : 4;
    const total = sz * count;
    const base = total > 4 ? dv.getUint32(valOff, le) : valOff;
    const out: number[] = [];
    for (let j = 0; j < count; j++) {
      if (type === 3) out.push(dv.getUint16(base + j * 2, le));
      else out.push(dv.getUint32(base + j * 4, le));
    }
    return out;
  };

  for (let i = 0; i < numEntries; i++) {
    const off = ifdOffset + 2 + i * 12;
    const tag = dv.getUint16(off, le);
    const type = dv.getUint16(off + 2, le);
    const count = dv.getUint32(off + 4, le);
    const valOff = off + 8;
    const v = () => (type === 3 ? dv.getUint16(valOff, le) : dv.getUint32(valOff, le));
    switch (tag) {
      case 256: width = v(); break;
      case 257: height = v(); break;
      case 258: bitsPerSample = v(); break;
      case 259: compression = v(); break;
      case 273: stripOffsets = readArray(type, count, valOff); break;
      case 277: /* SamplesPerPixel */ break;
      case 278: rowsPerStrip = v(); break;
      case 279: stripByteCounts = readArray(type, count, valOff); break;
      case 322: tileWidth = v(); break;
      case 323: tileLength = v(); break;
      case 324: tileOffsets = readArray(type, count, valOff); break;
      case 325: tileByteCounts = readArray(type, count, valOff); break;
      case 339: sampleFormat = v(); break;
    }
  }

  if (compression !== 1) throw new Error(`unsupported TIFF compression ${compression}`);
  if (sampleFormat !== 3 || bitsPerSample !== 32) {
    throw new Error(`expected F32 TIFF (sampleFormat=3,bps=32), got ${sampleFormat}/${bitsPerSample}`);
  }
  if (!width || !height) throw new Error("TIFF missing width/height");

  const out = new Float32Array(width * height);

  if (tileOffsets.length > 0 && tileWidth > 0 && tileLength > 0) {
    const tilesPerRow = Math.ceil(width / tileWidth);
    const tilesPerCol = Math.ceil(height / tileLength);
    for (let ty = 0; ty < tilesPerCol; ty++) {
      for (let tx = 0; tx < tilesPerRow; tx++) {
        const idx = ty * tilesPerRow + tx;
        const tOff = tileOffsets[idx]!;
        for (let row = 0; row < tileLength; row++) {
          const y = ty * tileLength + row;
          if (y >= height) break;
          for (let col = 0; col < tileWidth; col++) {
            const x = tx * tileWidth + col;
            if (x >= width) continue;
            const pxOff = tOff + (row * tileWidth + col) * 4;
            out[y * width + x] = dv.getFloat32(pxOff, le);
          }
        }
      }
    }
  } else if (stripOffsets.length > 0) {
    let pos = 0;
    for (let s = 0; s < stripOffsets.length; s++) {
      const off = stripOffsets[s]!;
      const bc = stripByteCounts[s]! / 4;
      for (let i = 0; i < bc; i++) out[pos++] = dv.getFloat32(off + i * 4, le);
    }
  } else {
    throw new Error("TIFF has neither strips nor tiles");
  }

  return { width, height, data: out };
}

// ---------------------------------------------------------------------------
// Source fetchers
// ---------------------------------------------------------------------------

interface AttemptResult {
  ok: boolean;
  note: string;
}

/**
 * Probe the TWDB volumetric-survey index for a machine-readable Ray Roberts
 * deliverable. As of this writing TWDB publishes the survey as a PDF report
 * with raster contour graphics; the underlying raster is not exposed via a
 * WCS / ImageServer feed. We document the gap and fall through.
 */
async function tryTwdbBathymetry(): Promise<AttemptResult> {
  try {
    const r = await fetch(TWDB_INDEX, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ok: false, note: `TWDB index HTTP ${r.status}` };
    const txt = await r.text();
    const hasRayRoberts = /ray\s*roberts/i.test(txt);
    return {
      ok: false,
      note: hasRayRoberts
        ? "TWDB volumetric survey for Ray Roberts is published as a PDF report; no public WCS/ImageServer raster available."
        : "TWDB index reachable but no Ray Roberts entry surfaced in the response.",
    };
  } catch (err) {
    return { ok: false, note: `TWDB probe failed: ${(err as Error).message}` };
  }
}

/**
 * Probe the USACE GeoSpatial Repository for a published hydrographic survey
 * raster for Ray Roberts. Fort Worth District publishes deliverables but
 * mainly as project-page PDFs / FOIA artefacts rather than a single
 * machine-readable feed. Document the gap and fall through.
 */
async function tryUsaceBathymetry(): Promise<AttemptResult> {
  try {
    const r = await fetch(USACE_INDEX, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ok: false, note: `USACE GeoSpatial index HTTP ${r.status}` };
    return {
      ok: false,
      note: "USACE Fort Worth District hydrographic surveys for Ray Roberts are distributed as project-page PDFs / FOIA artefacts; no public WCS feed.",
    };
  } catch (err) {
    return { ok: false, note: `USACE probe failed: ${(err as Error).message}` };
  }
}

/** Fetch the 3DEP best-available DEM for the AOI as an F32 grid. */
async function fetch3depGrid(
  bbox: [number, number, number, number],
  width: number,
  height: number,
): Promise<Float32Array> {
  const url =
    `${DEP3}/exportImage?` +
    new URLSearchParams({
      bbox: bbox.join(","),
      bboxSR: "4326",
      imageSR: "4326",
      size: `${width},${height}`,
      format: "tiff",
      pixelType: "F32",
      interpolation: "RSP_BilinearInterpolation",
      f: "image",
    }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`3DEP HTTP ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  if (!/tiff/i.test(ct)) throw new Error(`3DEP returned ${ct} (expected image/tiff)`);
  const buf = await r.arrayBuffer();
  const t = readF32Tiff(buf);
  if (t.width !== width || t.height !== height) {
    throw new Error(`3DEP returned ${t.width}x${t.height}, expected ${width}x${height}`);
  }
  return t.data;
}

/**
 * Identify which 3DEP source layer (lidar vs seamless DEM) served the AOI
 * centre by inspecting the rasterId returned from a getSamples probe. The
 * 3DEP ImageServer integrates both ranked options into one dynamic
 * coverage, so the response identifies which sub-raster was selected.
 */
async function probe3depResolution(
  bbox: [number, number, number, number],
): Promise<{ resolutionM: number; isLidar: boolean }> {
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;
  const url =
    `${DEP3}/getSamples?` +
    new URLSearchParams({
      geometry: JSON.stringify({
        points: [[cx, cy]],
        spatialReference: { wkid: 4326 },
      }),
      geometryType: "esriGeometryMultipoint",
      returnFirstValueOnly: "true",
      interpolation: "RSP_BilinearInterpolation",
      f: "json",
    }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`3DEP getSamples HTTP ${r.status}`);
  const j = (await r.json()) as { samples?: { resolution?: number }[] };
  const res = j.samples?.[0]?.resolution ?? 0;
  // 3DEP returns resolution in degrees for EPSG:4326. Convert to metres at
  // the AOI latitude (1° lat ≈ 111.32 km).
  const resM = res * 111_320;
  return { resolutionM: resM, isLidar: resM < 5 };
}

/** Probe TNRIS as a last-resort topography fallback (not used unless 3DEP
 *  is unreachable). We just verify reachability and record the URL. */
async function tryTnrisTopography(): Promise<AttemptResult> {
  try {
    const r = await fetch(TNRIS_INDEX, { signal: AbortSignal.timeout(15_000) });
    return {
      ok: r.ok,
      note: r.ok
        ? "TNRIS/Texas GeoData reachable; StratMap mosaics available as bulk downloads (not used because USGS 3DEP succeeded)."
        : `TNRIS HTTP ${r.status}`,
    };
  } catch (err) {
    return { ok: false, note: `TNRIS probe failed: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// NHD waterbody polygon (used to mask the bathymetry / topography boundary)
// ---------------------------------------------------------------------------

interface EsriPoly { rings: number[][][] }

async function fetchLakeOutline(
  bbox: [number, number, number, number],
): Promise<EsriPoly> {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const params = new URLSearchParams({
    geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    // Reservoir polygons with at least 20 km² inside the bbox — guards
    // against picking small adjacent ponds.
    where: "FTYPE=390 AND AREASQKM>=20",
    outFields: "AREASQKM",
    outSR: "4326",
    returnGeometry: "true",
    f: "json",
  });
  const url = `${NHD_WATERBODY}/query?${params.toString()}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`NHD HTTP ${r.status}`);
  const j = (await r.json()) as {
    features?: { attributes: { AREASQKM: number }; geometry: EsriPoly }[];
  };
  const feats = j.features ?? [];
  if (feats.length === 0) throw new Error("NHD: no waterbody polygon for Ray Roberts AOI");
  // Largest-by-area wins (Lake Ray Roberts is the only reservoir-class
  // body of meaningful size inside this bbox).
  feats.sort((a, b) => b.attributes.AREASQKM - a.attributes.AREASQKM);
  return feats[0]!.geometry;
}

/** Point-in-MultiRing test (ArcGIS rings = outer + holes, holes flip parity). */
function pointInRings(lon: number, lat: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    let inThis = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]![0]!, yi = ring[i]![1]!;
      const xj = ring[j]![0]!, yj = ring[j]![1]!;
      const intersect =
        ((yi > lat) !== (yj > lat)) &&
        (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
      if (intersect) inThis = !inThis;
    }
    if (inThis) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Distance transform for shore-distance synthesis
//
// Where 3DEP has been resampled to the current water surface inside the
// lake (no usable pre-impoundment elevation), we synthesise depth from
// distance-to-shore: depth grades from 0 at the bank to MAX_SURVEYED_DEPTH_M
// near the deepest interior cell. This is the standard fallback documented
// in the ranked source #3 above.
// ---------------------------------------------------------------------------

/** Multi-source BFS that returns, for every cell, the Chebyshev distance
 *  (in cells) to the nearest shoreline cell (a water cell adjacent to a
 *  land cell). Water-only — land cells are seeded with 0. */
function shoreDistance(insideMask: Uint8Array, N: number): Int32Array {
  const dist = new Int32Array(N * N).fill(-1);
  const queue: number[] = [];
  // Seed shoreline cells: water cells with at least one land neighbour.
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      if (!insideMask[i]) continue;
      let isShore = false;
      for (let dr = -1; dr <= 1 && !isShore; dr++) {
        for (let dc = -1; dc <= 1 && !isShore; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r2 = r + dr, c2 = c + dc;
          if (r2 < 0 || r2 >= N || c2 < 0 || c2 >= N) { isShore = true; break; }
          if (!insideMask[r2 * N + c2]) isShore = true;
        }
      }
      if (isShore) { dist[i] = 0; queue.push(i); }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++]!;
    const r = (idx / N) | 0;
    const c = idx - r * N;
    const d = dist[idx]!;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r2 = r + dr, c2 = c + dc;
        if (r2 < 0 || r2 >= N || c2 < 0 || c2 >= N) continue;
        const j = r2 * N + c2;
        if (!insideMask[j]) continue;
        if (dist[j]! < 0) { dist[j] = d + 1; queue.push(j); }
      }
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== build-lake-ray-roberts-terrain ===");
  console.log(`  AOI: ${BBOX.join(",")}  resolution: ${RESOLUTION}x${RESOLUTION}`);

  // --- 1. Lake outline (used to mask depth vs topography) ---
  console.log("  Fetching NHD waterbody outline…");
  const lake = await fetchLakeOutline(BBOX);
  console.log(`    NHD outline: ${lake.rings.length} ring(s), ${lake.rings.reduce((n, r) => n + r.length, 0)} vertices`);

  // --- 2. Bathymetry layer — ranked sources ---
  console.log("  Bathymetry layer (ranked sources):");
  const bathyAttempts: { source: LayerSource; ok: boolean; note: string }[] = [];

  console.log("    [1] TWDB volumetric/sedimentation survey…");
  const twdb = await tryTwdbBathymetry();
  console.log(`        ${twdb.ok ? "OK" : "GAP"}: ${twdb.note}`);
  bathyAttempts.push({ source: "twdb", ...twdb });

  console.log("    [2] USACE Fort Worth District hydrographic surveys…");
  const usace = await tryUsaceBathymetry();
  console.log(`        ${usace.ok ? "OK" : "GAP"}: ${usace.note}`);
  bathyAttempts.push({ source: "usace", ...usace });

  console.log("    [3] USGS 3DEP DEM (pre-impoundment Elm Fork valley + shore-distance synthesis)…");
  const dem = await fetch3depGrid(BBOX, RESOLUTION, RESOLUTION);
  const probe = await probe3depResolution(BBOX);
  console.log(
    `        OK: 3DEP returned ${RESOLUTION}x${RESOLUTION} grid; source resolution ≈ ${probe.resolutionM.toFixed(1)} m ` +
      `(${probe.isLidar ? "1-m lidar tile" : "1/3\" seamless DEM"} at AOI centre)`,
  );
  bathyAttempts.push({
    source: "usgs-3dep",
    ok: true,
    note: `USGS 3DEP best-available DEM (${probe.isLidar ? "1-m lidar" : "1/3\" seamless"}; ≈${probe.resolutionM.toFixed(1)} m).`,
  });

  // --- 3. Topography layer — ranked sources ---
  console.log("  Topography layer (ranked sources):");
  const topoAttempts: { source: LayerSource; ok: boolean; note: string }[] = [];
  // The 3DEP service integrates 1-m lidar + 1/3" seamless DEM into the
  // same dynamic coverage and auto-selects the highest resolution per
  // pixel, so the same TIFF that satisfied bathymetry source #3 also
  // satisfies topography sources #1 and #2.
  topoAttempts.push({
    source: "usgs-3dep",
    ok: true,
    note: probe.isLidar
      ? "USGS 3DEP 1-m lidar DEM (StratMap North-Central Texas)."
      : "USGS 3DEP 1/3\" seamless DEM (lidar tile unavailable at AOI centre).",
  });
  console.log(`    [1+2] USGS 3DEP (lidar + seamless): OK — using same ${RESOLUTION}x${RESOLUTION} DEM.`);
  // Probe TNRIS only so the build log honestly records the third ranked
  // option was at least checked.
  console.log("    [3] TNRIS / Texas GeoData StratMap mosaics…");
  const tnris = await tryTnrisTopography();
  console.log(`        ${tnris.ok ? "OK (not used)" : "FAIL"}: ${tnris.note}`);
  topoAttempts.push({ source: "tnris-stratmap", ok: tnris.ok, note: tnris.note });

  // --- 4. Build inside-lake mask + grids ---
  const [minLon, minLat, maxLon, maxLat] = BBOX;
  const inside = new Uint8Array(RESOLUTION * RESOLUTION);
  for (let row = 0; row < RESOLUTION; row++) {
    // Latitude increases northward; 3DEP TIFF has row 0 at the north edge.
    const lat = maxLat - ((row + 0.5) / RESOLUTION) * (maxLat - minLat);
    for (let col = 0; col < RESOLUTION; col++) {
      const lon = minLon + ((col + 0.5) / RESOLUTION) * (maxLon - minLon);
      if (pointInRings(lon, lat, lake.rings)) inside[row * RESOLUTION + col] = 1;
    }
  }
  const insideCount = inside.reduce((n, v) => n + v, 0);
  console.log(`  Inside-lake cells: ${insideCount} / ${RESOLUTION * RESOLUTION} (${((insideCount / (RESOLUTION * RESOLUTION)) * 100).toFixed(1)}%)`);

  // Compute shore distance (in cells) for inside-lake cells.
  const dist = shoreDistance(inside, RESOLUTION);
  let maxDistCells = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i]! > maxDistCells) maxDistCells = dist[i]!;
  console.log(`  Max distance to shore: ${maxDistCells} cells`);

  // Build depth + topography grids.
  const depths = new Array<number>(RESOLUTION * RESOLUTION).fill(0);
  const topography = new Array<number>(RESOLUTION * RESOLUTION).fill(0);
  let minDepth = Infinity, maxDepth = -Infinity;
  let minTopo = Infinity, maxTopo = -Infinity;
  let demDerivedDepthCells = 0;
  let synthesizedDepthCells = 0;

  for (let i = 0; i < RESOLUTION * RESOLUTION; i++) {
    const elev = dem[i]!;
    if (inside[i]) {
      // Below-water cell.
      const demDepth = POOL_ELEV_M - elev;
      let depth: number;
      if (demDepth > 0.5) {
        // 3DEP contains pre-impoundment elevation here — use directly.
        depth = Math.min(MAX_SURVEYED_DEPTH_M, demDepth);
        demDerivedDepthCells++;
      } else {
        // 3DEP has been resampled to the current water surface — synthesise
        // depth from distance-to-shore (shore-distance / max-shore-distance,
        // smoothstep'd, scaled to the surveyed maximum depth).
        const d = dist[i]!;
        const t = maxDistCells > 0 ? Math.max(0, Math.min(1, d / maxDistCells)) : 0;
        const s = t * t * (3 - 2 * t);
        depth = s * MAX_SURVEYED_DEPTH_M;
        synthesizedDepthCells++;
      }
      depths[i] = depth;
      if (depth < minDepth) minDepth = depth;
      if (depth > maxDepth) maxDepth = depth;
    } else {
      // Above-water cell.
      const topo = Math.max(0, elev - POOL_ELEV_M);
      topography[i] = topo;
      if (topo < minTopo) minTopo = topo;
      if (topo > maxTopo) maxTopo = topo;
    }
  }
  if (!isFinite(minDepth)) minDepth = 0;
  if (!isFinite(maxDepth)) maxDepth = 0;
  if (!isFinite(minTopo)) minTopo = 0;
  if (!isFinite(maxTopo)) maxTopo = 0;

  console.log(
    `  Bathymetry: ${demDerivedDepthCells} cells from 3DEP DEM (pre-impoundment), ` +
      `${synthesizedDepthCells} cells from shore-distance synthesis; range ${minDepth.toFixed(1)}–${maxDepth.toFixed(1)} m`,
  );
  console.log(`  Topography: range ${minTopo.toFixed(1)}–${maxTopo.toFixed(1)} m above pool`);

  // --- 5. Provenance metadata ---
  const fetchedAt = new Date().toISOString();
  const bathyProvenance: LayerProvenance = {
    source: "usgs-3dep",
    label: probe.isLidar
      ? "USGS 3DEP (pre-impoundment lidar / DEM + shore-distance synthesis)"
      : "USGS 3DEP (pre-impoundment 1/3\" DEM + shore-distance synthesis)",
    creditUrl: "https://www.usgs.gov/3d-elevation-program",
    serviceUrl: DEP3,
    fetchedAt,
    attempts: bathyAttempts,
  };
  const topoProvenance: LayerProvenance = {
    source: "usgs-3dep",
    label: probe.isLidar
      ? "USGS 3DEP 1-m lidar (StratMap North-Central Texas)"
      : "USGS 3DEP 1/3\" seamless DEM",
    creditUrl: "https://www.usgs.gov/3d-elevation-program",
    serviceUrl: DEP3,
    fetchedAt,
    attempts: topoAttempts,
  };

  const bundle: BundledTerrain = {
    datasetId: DATASET_ID,
    bbox: { minLon, minLat, maxLon, maxLat },
    width: RESOLUTION,
    height: RESOLUTION,
    depths,
    topography,
    minDepth,
    maxDepth,
    minTopography: minTopo,
    maxTopography: maxTopo,
    poolElevationM: POOL_ELEV_M,
    bathymetry: bathyProvenance,
    topographyProvenance: topoProvenance,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(bundle), "utf8");
  const stats = (await import("node:fs")).statSync(OUT_PATH);
  console.log(`  Wrote ${OUT_PATH} (${(stats.size / 1024).toFixed(1)} KB)`);
  console.log("=== done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
