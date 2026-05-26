/**
 * texas-reservoir-terrain.ts — Shared bundle-builder for Texas
 * reservoirs whose bathymetry NCEI / GEBCO cannot supply.
 *
 * Why this module exists
 * ----------------------
 * The original Ray Roberts builder (`build-lake-ray-roberts-terrain.ts`)
 * implemented a generic ranked-source discovery pattern:
 *
 *   1. TWDB ArcGIS Server — walk a small set of likely folders looking
 *      for an ImageServer matching the lake name; the response is
 *      machine-readable when published, and reservoir surveys land
 *      there a few years after the field campaign.
 *   2. USACE GeoSpatial Hub — query the standard ArcGIS Hub items API
 *      for ImageServer / MapServer datasets tagged with the lake name
 *      and "hydrographic survey".
 *   3. USGS 3DEP best-available DEM — pulls the highest-resolution
 *      pre-impoundment elevation for the AOI; depth = pool − DEM where
 *      the DEM still has pre-impoundment values, else synthesised from
 *      distance-to-shore so the basin still grades smoothly from 0 m
 *      at the bank to the surveyed maximum near the dam.
 *
 * The pattern is *not* lake-specific. Lifting it into this shared
 * module means any other reservoir in BathyScan can opt in by writing
 * a thin spec file — see `build-lake-texoma-terrain.ts` for the
 * second consumer and `build-lake-ray-roberts-terrain.ts` for the
 * original. The moment TWDB or USACE publishes an ImageServer for any
 * of those reservoirs, the next scheduled run replaces the 3DEP
 * fallback with the real surveyed raster and sets
 * `bathymetry.source = "twdb" | "usace"` in the bundle.
 *
 * Honest provenance
 * -----------------
 * Each generated bundle carries:
 *   - the source that actually supplied the data (`twdb`, `usace`, or
 *     `usgs-3dep`), with a human label + credit URL;
 *   - the service URL the data was pulled from;
 *   - a per-attempt trace so the build log records which ranked
 *     sources were probed and why each one succeeded or failed.
 */

import { writeFileSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

/** SHA-256 hex digest over the concatenated bytes of every builder source
 *  file listed in `paths`. Order matters; pass paths in a stable order
 *  (wrapper first, shared module second) so the digest is reproducible. */
function computeGeneratorHash(paths: string[]): string {
  const h = createHash("sha256");
  for (const p of paths) h.update(readFileSync(p));
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// Public spec / output types
// ---------------------------------------------------------------------------

/** A bundle's bathymetry / topography provenance is one of these. */
export type LayerSource =
  | "twdb"
  | "usace"
  | "usgs-3dep"
  | "tnris-stratmap";

export interface LayerProvenance {
  source: LayerSource;
  label: string;
  creditUrl: string;
  serviceUrl: string;
  fetchedAt: string;
  attempts: { source: LayerSource; ok: boolean; note: string }[];
}

export interface BundledTerrain {
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
  /** Drift-check metadata. `generatorHash` is a SHA-256 of the
   *  concatenated source bytes of the builder script(s) listed in
   *  `ReservoirSpec.builderSrcPaths`. A unit test in api-server
   *  recomputes the hash and fails if the bundle was produced by a
   *  different version of the builder, surfacing stale bundles. */
  metadata?: { generatorHash: string };
}

export interface ReservoirSpec {
  /** Preset datasetId as registered in `terrain.ts`. */
  datasetId: string;
  /** Output JSON path (absolute). */
  outPath: string;
  /** AOI bounding box [minLon, minLat, maxLon, maxLat]. */
  bbox: [number, number, number, number];
  /** Grid resolution (NxN); 256 matches the on-disk preset bundles. */
  resolution: number;
  /** Normal/conservation pool elevation (m, treat NGVD29 == NAVD88
   *  to viewer tolerance). */
  poolElevationM: number;
  /** Surveyed maximum depth (m). Used to scale shore-distance synthesis
   *  in cells where 3DEP DEM has been resampled to the current water
   *  surface (no usable pre-impoundment elevation). */
  maxSurveyedDepthM: number;
  /** Regex matched against TWDB / USACE service names. Use the
   *  reservoir's common name with optional whitespace, e.g. /ray.?roberts/i
   *  or /texoma/i. */
  nameRe: RegExp;
  /** USACE district (for the human-readable label). */
  usaceDistrict: string;
  /** USACE district website URL (used as the credit URL when a USACE
   *  raster is the winning source). */
  usaceDistrictUrl: string;
  /** Minimum reservoir polygon area (km²) required from NHD; guards
   *  against picking small adjacent ponds. Reservoir-class waterbodies
   *  used here are all > 20 km². */
  minWaterbodyAreaSqkm: number;
  /** Absolute paths to the builder source files whose SHA-256 should be
   *  embedded in the bundle's `metadata.generatorHash`. Include the
   *  thin spec wrapper *and* this shared module so an edit to either
   *  invalidates the recorded hash and trips the drift-check unit test
   *  in api-server. Omit to skip embedding (legacy callers). */
  builderSrcPaths?: string[];
}

// ---------------------------------------------------------------------------
// Upstream services (shared across reservoirs)
// ---------------------------------------------------------------------------

const NHD_WATERBODY =
  "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12";
const DEP3 =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";

/** TWDB hosts an ArcGIS Server. Reservoir survey rasters, when
 *  published, land under a folder whose service name contains the
 *  reservoir name. We walk the root + a small set of likely folders. */
const TWDB_INDEX = "https://www.twdb.texas.gov/surfacewater/surveys/index.asp";
const TWDB_ARCGIS_ROOT =
  "https://gis.twdb.texas.gov/arcgis/rest/services";
const TWDB_ARCGIS_FOLDERS = ["", "Reservoirs", "ReservoirSurveys", "Bathymetry"];

/** USACE GeoSpatial Hub exposes a standard ArcGIS Hub items search. */
const USACE_INDEX =
  "https://geospatial-usace.opendata.arcgis.com/search?tags=hydrographic%20survey";
const USACE_HUB_SEARCH =
  "https://geospatial-usace.opendata.arcgis.com/api/search/v1/collections/dataset/items";
const TNRIS_INDEX = "https://data.tnris.org/";

// ---------------------------------------------------------------------------
// Minimal TIFF reader for ArcGIS exportImage output
//
// 3DEP / TWDB / USACE exportImage return uncompressed F32 GeoTIFFs (one
// band), either tiled or stripped. We only need the float32 pixels;
// projection metadata is implied by the request bbox.
// ---------------------------------------------------------------------------

export function readF32Tiff(
  buf: ArrayBuffer,
): { width: number; height: number; data: Float32Array } {
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
  void rowsPerStrip; void tileByteCounts;

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
// Source fetchers (TWDB / USACE discovery + 3DEP)
// ---------------------------------------------------------------------------

interface AttemptResult {
  ok: boolean;
  note: string;
  grid?: Float32Array;
  serviceUrl?: string;
  label?: string;
}

/** Probe an ArcGIS REST folder catalogue for any ImageServer whose
 *  service name matches `nameRe`. Returns the fully-qualified
 *  ImageServer URL of the first match, or null if none are exposed. */
export async function findArcgisImageServer(
  root: string,
  folder: string,
  nameRe: RegExp,
): Promise<string | null> {
  const url = `${root}${folder ? `/${folder}` : ""}?f=json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  const j = (await r.json()) as { services?: { name: string; type: string }[] };
  for (const svc of j.services ?? []) {
    if (svc.type !== "ImageServer") continue;
    if (!nameRe.test(svc.name)) continue;
    const tail = svc.name.includes("/")
      ? svc.name
      : `${folder ? `${folder}/` : ""}${svc.name}`;
    return `${root}/${tail}/ImageServer`;
  }
  return null;
}

/** Download an ArcGIS ImageServer raster as an F32 grid co-registered
 *  with `bbox` at `size`x`size`. Returns null when the service refuses
 *  an F32 export (e.g. only renders styled tiles). NaN marks no-data. */
export async function fetchImageServerF32(
  serviceUrl: string,
  bbox: [number, number, number, number],
  size: number,
): Promise<Float32Array | null> {
  const url =
    `${serviceUrl}/exportImage?` +
    new URLSearchParams({
      bbox: bbox.join(","),
      bboxSR: "4326",
      imageSR: "4326",
      size: `${size},${size}`,
      format: "tiff",
      pixelType: "F32",
      noData: "-9999",
      interpolation: "RSP_BilinearInterpolation",
      f: "image",
    }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!/tiff/i.test(ct)) return null;
  const buf = await r.arrayBuffer();
  const t = readF32Tiff(buf);
  if (t.width !== size || t.height !== size) return null;
  for (let i = 0; i < t.data.length; i++) {
    const v = t.data[i]!;
    if (!isFinite(v) || v <= -9000 || v >= 1e30) t.data[i] = NaN;
  }
  return t.data;
}

/** Convert a surveyed raster into depth-below-pool (positive metres).
 *  Bathymetric rasters published by US agencies use one of:
 *    (a) elevation (m, NAVD88) — depth = poolElev − value;
 *    (b) depth (m, positive down) — value already is the depth.
 *  We pick (a) when the median finite value is below the pool elevation,
 *  else (b) — and clip to a sane reservoir-scale range. */
function normaliseBathyToDepth(
  grid: Float32Array,
  poolElev: number,
  maxSurveyedDepthM: number,
): Float32Array {
  const out = new Float32Array(grid.length);
  const finite: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i]!;
    if (isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) { out.fill(NaN); return out; }
  finite.sort((a, b) => a - b);
  const median = finite[finite.length >> 1]!;
  const elevationMode = median < poolElev;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i]!;
    if (!isFinite(v)) { out[i] = NaN; continue; }
    const d = elevationMode ? poolElev - v : v;
    out[i] = Math.max(0, Math.min(maxSurveyedDepthM * 1.5, d));
  }
  return out;
}

/** Try TWDB volumetric/sedimentation survey for the named reservoir. */
async function tryTwdbBathymetry(
  spec: ReservoirSpec,
): Promise<AttemptResult> {
  for (const folder of TWDB_ARCGIS_FOLDERS) {
    try {
      const svc = await findArcgisImageServer(
        TWDB_ARCGIS_ROOT,
        folder,
        spec.nameRe,
      );
      if (!svc) continue;
      let raw: Float32Array | null = null;
      try {
        raw = await fetchImageServerF32(svc, spec.bbox, spec.resolution);
      } catch {
        continue;
      }
      if (!raw) continue;
      const grid = normaliseBathyToDepth(
        raw,
        spec.poolElevationM,
        spec.maxSurveyedDepthM,
      );
      return {
        ok: true,
        note: `TWDB volumetric survey raster downloaded from ${svc}.`,
        grid,
        serviceUrl: svc,
        label: `TWDB Reservoir Volumetric & Sedimentation Survey (${spec.datasetId})`,
      };
    } catch {
      // Folder doesn't exist or refused JSON — keep walking.
    }
  }
  try {
    const r = await fetch(TWDB_INDEX, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ok: false, note: `TWDB index HTTP ${r.status}` };
    const txt = await r.text();
    const hasMatch = spec.nameRe.test(txt);
    return {
      ok: false,
      note: hasMatch
        ? `TWDB volumetric survey for ${spec.datasetId} is published as a PDF report; no public WCS/ImageServer raster available yet.`
        : `TWDB index reachable but no ${spec.datasetId} entry surfaced in the response.`,
    };
  } catch (err) {
    return { ok: false, note: `TWDB probe failed: ${(err as Error).message}` };
  }
}

/** Try USACE GeoSpatial Hub for a hydrographic survey raster. */
async function tryUsaceBathymetry(
  spec: ReservoirSpec,
): Promise<AttemptResult> {
  try {
    // The Hub's q parameter takes free-text; we add the lake name and
    // the standard "hydrographic survey" tag phrasing.
    const lakeQuery = spec.nameRe.source
      .replace(/[\\^$.*+?()[\]{}|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const q = new URLSearchParams({
      q: `${lakeQuery} hydrographic survey`,
      filter: 'type IN ("Image Service","Map Service")',
      limit: "20",
    });
    const r = await fetch(`${USACE_HUB_SEARCH}?${q.toString()}`, {
      signal: AbortSignal.timeout(20_000),
      headers: { accept: "application/json" },
    });
    if (r.ok) {
      const j = (await r.json()) as {
        features?: { properties?: { url?: string; name?: string; title?: string } }[];
      };
      for (const f of j.features ?? []) {
        const url = f.properties?.url ?? "";
        const title = `${f.properties?.title ?? ""} ${f.properties?.name ?? ""}`;
        if (!spec.nameRe.test(title)) continue;
        if (!/ImageServer\/?$/i.test(url)) continue;
        let raw: Float32Array | null = null;
        try {
          raw = await fetchImageServerF32(url, spec.bbox, spec.resolution);
        } catch {
          continue;
        }
        if (!raw) continue;
        const grid = normaliseBathyToDepth(
          raw,
          spec.poolElevationM,
          spec.maxSurveyedDepthM,
        );
        return {
          ok: true,
          note: `USACE hydrographic survey raster downloaded from ${url}.`,
          grid,
          serviceUrl: url,
          label: `USACE ${spec.usaceDistrict} Hydrographic Survey (${spec.datasetId})`,
        };
      }
    }
  } catch {
    // Hub unreachable — fall through to the static-index gap note.
  }
  try {
    const r = await fetch(USACE_INDEX, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ok: false, note: `USACE GeoSpatial index HTTP ${r.status}` };
    return {
      ok: false,
      note: `USACE ${spec.usaceDistrict} hydrographic surveys for ${spec.datasetId} are distributed as project-page PDFs / FOIA artefacts; no public ImageServer feed yet.`,
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

/** Identify which 3DEP source layer served the AOI centre (lidar vs
 *  1/3" seamless) via getSamples; the service auto-selects per pixel. */
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
  const resM = res * 111_320;
  return { resolutionM: resM, isLidar: resM < 5 };
}

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
// NHD waterbody polygon (used to mask bathymetry vs topography)
// ---------------------------------------------------------------------------

interface EsriPoly { rings: number[][][] }

async function fetchLakeOutline(spec: ReservoirSpec): Promise<EsriPoly> {
  const [minLon, minLat, maxLon, maxLat] = spec.bbox;
  const params = new URLSearchParams({
    geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    where: `FTYPE=390 AND AREASQKM>=${spec.minWaterbodyAreaSqkm}`,
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
  if (feats.length === 0) {
    throw new Error(`NHD: no waterbody polygon for ${spec.datasetId} AOI`);
  }
  feats.sort((a, b) => b.attributes.AREASQKM - a.attributes.AREASQKM);
  return feats[0]!.geometry;
}

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

/** Multi-source BFS returning Chebyshev distance (in cells) to the
 *  nearest shoreline cell, for water cells only. */
function shoreDistance(insideMask: Uint8Array, N: number): Int32Array {
  const dist = new Int32Array(N * N).fill(-1);
  const queue: number[] = [];
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
// Generic builder — orchestrates the ranked sources, writes the JSON
// ---------------------------------------------------------------------------

export async function buildReservoirTerrainBundle(
  spec: ReservoirSpec,
): Promise<BundledTerrain> {
  const N = spec.resolution;
  console.log(`=== build-reservoir-terrain (${spec.datasetId}) ===`);
  console.log(`  AOI: ${spec.bbox.join(",")}  resolution: ${N}x${N}`);

  console.log("  Fetching NHD waterbody outline…");
  const lake = await fetchLakeOutline(spec);
  console.log(
    `    NHD outline: ${lake.rings.length} ring(s), ${lake.rings.reduce((n, r) => n + r.length, 0)} vertices`,
  );

  console.log("  Bathymetry layer (ranked sources):");
  const bathyAttempts: { source: LayerSource; ok: boolean; note: string }[] = [];

  console.log("    [1] TWDB volumetric/sedimentation survey…");
  const twdb = await tryTwdbBathymetry(spec);
  console.log(`        ${twdb.ok ? "OK" : "GAP"}: ${twdb.note}`);
  bathyAttempts.push({ source: "twdb", ok: twdb.ok, note: twdb.note });

  console.log(`    [2] USACE ${spec.usaceDistrict} hydrographic surveys…`);
  const usace = await tryUsaceBathymetry(spec);
  console.log(`        ${usace.ok ? "OK" : "GAP"}: ${usace.note}`);
  bathyAttempts.push({ source: "usace", ok: usace.ok, note: usace.note });

  const surveyed:
    | { source: "twdb" | "usace"; grid: Float32Array; serviceUrl: string; label: string }
    | null =
    twdb.ok && twdb.grid
      ? { source: "twdb", grid: twdb.grid, serviceUrl: twdb.serviceUrl!, label: twdb.label! }
      : usace.ok && usace.grid
        ? { source: "usace", grid: usace.grid, serviceUrl: usace.serviceUrl!, label: usace.label! }
        : null;

  console.log("    [3] USGS 3DEP DEM (pre-impoundment + shore-distance synthesis)…");
  const dem = await fetch3depGrid(spec.bbox, N, N);
  const probe = await probe3depResolution(spec.bbox);
  console.log(
    `        OK: 3DEP returned ${N}x${N} grid; source resolution ≈ ${probe.resolutionM.toFixed(1)} m ` +
      `(${probe.isLidar ? "1-m lidar tile" : "1/3\" seamless DEM"} at AOI centre)`,
  );
  bathyAttempts.push({
    source: "usgs-3dep",
    ok: true,
    note: `USGS 3DEP best-available DEM (${probe.isLidar ? "1-m lidar" : "1/3\" seamless"}; ≈${probe.resolutionM.toFixed(1)} m).`,
  });

  console.log("  Topography layer (ranked sources):");
  const topoAttempts: { source: LayerSource; ok: boolean; note: string }[] = [];
  topoAttempts.push({
    source: "usgs-3dep",
    ok: true,
    note: probe.isLidar
      ? "USGS 3DEP 1-m lidar DEM (StratMap)."
      : "USGS 3DEP 1/3\" seamless DEM (lidar tile unavailable at AOI centre).",
  });
  console.log(`    [1+2] USGS 3DEP (lidar + seamless): OK — using same ${N}x${N} DEM.`);
  console.log("    [3] TNRIS / Texas GeoData StratMap mosaics…");
  const tnris = await tryTnrisTopography();
  console.log(`        ${tnris.ok ? "OK (not used)" : "FAIL"}: ${tnris.note}`);
  topoAttempts.push({ source: "tnris-stratmap", ok: tnris.ok, note: tnris.note });

  const [minLon, minLat, maxLon, maxLat] = spec.bbox;
  const inside = new Uint8Array(N * N);
  for (let row = 0; row < N; row++) {
    const lat = maxLat - ((row + 0.5) / N) * (maxLat - minLat);
    for (let col = 0; col < N; col++) {
      const lon = minLon + ((col + 0.5) / N) * (maxLon - minLon);
      if (pointInRings(lon, lat, lake.rings)) inside[row * N + col] = 1;
    }
  }
  const insideCount = inside.reduce((n, v) => n + v, 0);
  console.log(
    `  Inside-lake cells: ${insideCount} / ${N * N} (${((insideCount / (N * N)) * 100).toFixed(1)}%)`,
  );

  const dist = shoreDistance(inside, N);
  let maxDistCells = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i]! > maxDistCells) maxDistCells = dist[i]!;
  console.log(`  Max distance to shore: ${maxDistCells} cells`);

  const depths = new Array<number>(N * N).fill(0);
  const topography = new Array<number>(N * N).fill(0);
  let minDepth = Infinity, maxDepth = -Infinity;
  let minTopo = Infinity, maxTopo = -Infinity;
  let surveyedDepthCells = 0;
  let demDerivedDepthCells = 0;
  let synthesizedDepthCells = 0;

  for (let i = 0; i < N * N; i++) {
    const elev = dem[i]!;
    if (inside[i]) {
      let depth: number;
      const sv = surveyed?.grid[i];
      if (sv !== undefined && isFinite(sv) && sv > 0) {
        depth = sv;
        surveyedDepthCells++;
      } else {
        const demDepth = spec.poolElevationM - elev;
        if (demDepth > 0.5) {
          depth = Math.min(spec.maxSurveyedDepthM, demDepth);
          demDerivedDepthCells++;
        } else {
          const d = dist[i]!;
          const t = maxDistCells > 0 ? Math.max(0, Math.min(1, d / maxDistCells)) : 0;
          const s = t * t * (3 - 2 * t);
          depth = s * spec.maxSurveyedDepthM;
          synthesizedDepthCells++;
        }
      }
      depths[i] = depth;
      if (depth < minDepth) minDepth = depth;
      if (depth > maxDepth) maxDepth = depth;
    } else {
      const topo = Math.max(0, elev - spec.poolElevationM);
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
    `  Bathymetry: ${surveyedDepthCells} cells from surveyed raster (${surveyed?.source ?? "none"}), ` +
      `${demDerivedDepthCells} cells from 3DEP DEM (pre-impoundment), ` +
      `${synthesizedDepthCells} cells from shore-distance synthesis; range ${minDepth.toFixed(1)}–${maxDepth.toFixed(1)} m`,
  );
  console.log(`  Topography: range ${minTopo.toFixed(1)}–${maxTopo.toFixed(1)} m above pool`);

  const fetchedAt = new Date().toISOString();
  const bathyProvenance: LayerProvenance = surveyed
    ? {
        source: surveyed.source,
        label: surveyedDepthCells === insideCount
          ? surveyed.label
          : `${surveyed.label} (+ USGS 3DEP fill for ${insideCount - surveyedDepthCells} uncovered cell(s))`,
        creditUrl: surveyed.source === "twdb"
          ? "https://www.twdb.texas.gov/surfacewater/surveys/"
          : spec.usaceDistrictUrl,
        serviceUrl: surveyed.serviceUrl,
        fetchedAt,
        attempts: bathyAttempts,
      }
    : {
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
      ? "USGS 3DEP 1-m lidar (StratMap)"
      : "USGS 3DEP 1/3\" seamless DEM",
    creditUrl: "https://www.usgs.gov/3d-elevation-program",
    serviceUrl: DEP3,
    fetchedAt,
    attempts: topoAttempts,
  };

  const bundle: BundledTerrain = {
    datasetId: spec.datasetId,
    bbox: { minLon, minLat, maxLon, maxLat },
    width: N,
    height: N,
    depths,
    topography,
    minDepth,
    maxDepth,
    minTopography: minTopo,
    maxTopography: maxTopo,
    poolElevationM: spec.poolElevationM,
    bathymetry: bathyProvenance,
    topographyProvenance: topoProvenance,
    ...(spec.builderSrcPaths && spec.builderSrcPaths.length > 0
      ? { metadata: { generatorHash: computeGeneratorHash(spec.builderSrcPaths) } }
      : {}),
  };

  mkdirSync(dirname(spec.outPath), { recursive: true });
  writeFileSync(spec.outPath, JSON.stringify(bundle), "utf8");
  const stats = statSync(spec.outPath);
  console.log(`  Wrote ${spec.outPath} (${(stats.size / 1024).toFixed(1)} KB)`);
  console.log("=== done ===");
  return bundle;
}
