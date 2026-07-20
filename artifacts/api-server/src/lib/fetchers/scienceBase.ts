/**
 * ScienceBase fetcher — wraps the USGS ScienceBase JSON API + GeoTIFF
 * download + GeoTIFF-to-grid parse logic.
 *
 * probe()  — hits the ScienceBase catalog JSON endpoint; no raster download.
 * fetch()  — downloads the GeoTIFF, reprojects to WGS84, returns depth grid.
 */

import type {
  BathymetryFetcher,
  BathyFetchBundle,
  Bbox,
  FetchStrategy,
  ProbeResult,
  ScienceBaseFetchStrategy,
} from "./types.js";

// ---------------------------------------------------------------------------
// Minimal uncompressed F32 TIFF reader (no external deps)
// Handles the baseline TIFF format output by USGS WCS services.
// ---------------------------------------------------------------------------

interface F32Raster {
  width: number;
  height: number;
  data: Float32Array;
}

function readF32Tiff(buf: ArrayBuffer): F32Raster {
  const dv = new DataView(buf);
  const le = dv.getUint16(0) === 0x4949;
  const ru16 = (off: number) => dv.getUint16(off, le);
  const ru32 = (off: number) => dv.getUint32(off, le);

  let ifdOffset = ru32(4);
  const numEntries = ru16(ifdOffset);

  let width = 0, height = 0, bitsPerSample = 0, sampleFormat = 1;
  let stripOffsets: number[] = [], stripByteCounts: number[] = [];
  let planarConfig = 1;

  for (let i = 0; i < numEntries; i++) {
    const off = ifdOffset + 2 + i * 12;
    const tag = ru16(off);
    const type = ru16(off + 2);
    const count = ru32(off + 4);
    const vo = off + 8;
    const readVal = (): number => {
      if (type === 3) return ru16(vo);
      if (type === 4) return ru32(vo);
      return ru32(vo);
    };
    const readArray = (): number[] => {
      const size = type === 3 ? 2 : 4;
      const totalBytes = count * size;
      const base = totalBytes > 4 ? ru32(vo) : vo;
      return Array.from({ length: count }, (_, j) =>
        type === 3 ? ru16(base + j * 2) : ru32(base + j * 4)
      );
    };
    if (tag === 256) width = readVal();
    else if (tag === 257) height = readVal();
    else if (tag === 258) bitsPerSample = readVal();
    else if (tag === 273) stripOffsets = count === 1 ? [readVal()] : readArray();
    else if (tag === 278) { /* rows per strip — ignored */ }
    else if (tag === 279) stripByteCounts = count === 1 ? [readVal()] : readArray();
    else if (tag === 284) planarConfig = readVal();
    else if (tag === 277) { /* samplesPerPixel */ }
    else if (tag === 339) sampleFormat = readVal();
  }

  if (bitsPerSample !== 32) throw new Error(`readF32Tiff: expected 32-bit samples, got ${bitsPerSample}`);
  if (sampleFormat !== 3) throw new Error(`readF32Tiff: expected float32 (sampleFormat=3), got ${sampleFormat}`);
  if (planarConfig !== 1) throw new Error(`readF32Tiff: chunky planar config required`);

  const totalPx = width * height;
  const data = new Float32Array(totalPx);
  let px = 0;
  for (let s = 0; s < stripOffsets.length; s++) {
    const offset = stripOffsets[s]!;
    const bytes = stripByteCounts[s] ?? (totalPx - px) * 4;
    const strip = new Float32Array(buf, offset, bytes / 4);
    data.set(strip, px);
    px += strip.length;
  }
  return { width, height, data };
}

// ---------------------------------------------------------------------------
// TIFF geo-metadata reader (ModelTiepoint / ModelPixelScale + GeoKey)
// ---------------------------------------------------------------------------

interface TiffGeo extends F32Raster {
  originX: number;
  originY: number;
  pixelScaleX: number;
  pixelScaleY: number;
  modelType: number;
  projectedCsType: number;
}

function readTiffWithGeo(buf: ArrayBuffer): TiffGeo {
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

  const readDoubles = (cnt: number, valOff: number): number[] => {
    const base2 = cnt * 8 > 4 ? ru32(valOff) : valOff;
    return Array.from({ length: cnt }, (_, j) => rd64(base2 + j * 8));
  };
  const readShorts = (cnt: number, valOff: number): number[] => {
    const base2 = cnt * 2 > 4 ? ru32(valOff) : valOff;
    return Array.from({ length: cnt }, (_, j) => ru16(base2 + j * 2));
  };

  for (let i = 0; i < numEntries; i++) {
    const off = ifdOffset + 2 + i * 12;
    const tag = ru16(off);
    const type = ru16(off + 2);
    const count = ru32(off + 4);
    const valOff = off + 8;

    if (tag === 33550 && type === 12) {
      const vals = readDoubles(count, valOff);
      pixScaleX = vals[0] ?? 1;
      pixScaleY = vals[1] ?? 1;
    } else if (tag === 33922 && type === 12) {
      const vals = readDoubles(count, valOff);
      originX = vals[3] ?? 0;
      originY = vals[4] ?? 0;
    } else if (tag === 34735 && type === 3) {
      const keys = readShorts(count, valOff);
      const numKeys = keys[3] ?? 0;
      for (let k = 0; k < numKeys; k++) {
        const keyId = keys[4 + k * 4];
        const valueOffset = keys[4 + k * 4 + 3];
        if (keyId === 1024) modelType = valueOffset ?? 2;
        if (keyId === 3072) projCsType = valueOffset ?? 0;
      }
    }
  }

  return { ...base, originX, originY, pixelScaleX: pixScaleX, pixelScaleY: pixScaleY, modelType, projectedCsType: projCsType };
}

// ---------------------------------------------------------------------------
// WGS84 → UTM zone-N (Snyder forward transverse Mercator)
// ---------------------------------------------------------------------------

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
const UTM_K0 = 0.9996;
const UTM_E0 = 500_000;

function wgs84ToUtm(lon: number, lat: number, zone: number): [number, number] {
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const phi = lat * (Math.PI / 180);
  const lam = lon * (Math.PI / 180);
  const sinP = Math.sin(phi), cosP = Math.cos(phi), tanP = sinP / cosP;
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinP * sinP);
  const T = tanP * tanP;
  const C = (WGS84_E2 / (1 - WGS84_E2)) * cosP * cosP;
  const A = (lam - lon0) * cosP;
  const M =
    WGS84_A *
    ((1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64) * phi -
      ((3 * WGS84_E2) / 8 + (3 * WGS84_E2 * WGS84_E2) / 32) * Math.sin(2 * phi) +
      ((15 * WGS84_E2 * WGS84_E2) / 256) * Math.sin(4 * phi));
  const easting =
    UTM_E0 +
    UTM_K0 * N * (A + ((1 - T + C) * A * A * A) / 6 + ((5 - 18 * T + T * T + 72 * C) * A * A * A * A * A) / 120);
  const northing =
    UTM_K0 *
    (M + N * tanP * (A * A / 2 + ((5 - T + 9 * C + 4 * C * C) * A * A * A * A) / 24 + ((61 - 58 * T + T * T + 600 * C) * A * A * A * A * A * A) / 720));
  return [easting, northing];
}

function utmZoneFromEpsg(epsg: number): number | null {
  if (epsg >= 32601 && epsg <= 32660) return epsg - 32600;
  if (epsg >= 32701 && epsg <= 32760) return epsg - 32700;
  return null;
}

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

// ---------------------------------------------------------------------------
// ScienceBase catalog helpers
// ---------------------------------------------------------------------------

interface SbFile {
  name: string;
  downloadUri: string;
  size?: number;
}

interface SbItem {
  title?: string;
  files?: SbFile[];
  dates?: { dateString?: string; label?: string }[];
  errors?: { message: string };
}

async function fetchSbItem(itemId: string): Promise<SbItem | null> {
  const url = `https://www.sciencebase.gov/catalog/item/${itemId}?format=json`;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    return (await r.json()) as SbItem;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core depth-grid extraction from a ScienceBase GeoTIFF
// ---------------------------------------------------------------------------

function extractDepthGrid(
  geo: TiffGeo,
  bbox: Bbox,
  N: number,
  poolElevationM: number,
  maxDepthM: number,
): Float32Array | null {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  const isWgs84 = geo.modelType === 2;
  const utmZone = geo.modelType === 1 ? utmZoneFromEpsg(geo.projectedCsType) : null;
  if (!isWgs84 && utmZone === null) return null;

  const depths = new Float32Array(N * N);
  let validCount = 0;

  for (let row = 0; row < N; row++) {
    const lat = maxLat - ((row + 0.5) / N) * (maxLat - minLat);
    for (let col = 0; col < N; col++) {
      const lon = minLon + ((col + 0.5) / N) * (maxLon - minLon);

      let srcCol: number, srcRow: number;
      if (utmZone !== null) {
        const [e, n] = wgs84ToUtm(lon, lat, utmZone);
        srcCol = (e - geo.originX) / geo.pixelScaleX - 0.5;
        srcRow = (geo.originY - n) / geo.pixelScaleY - 0.5;
      } else {
        srcCol = (lon - geo.originX) / geo.pixelScaleX - 0.5;
        srcRow = (geo.originY - lat) / geo.pixelScaleY - 0.5;
      }

      const elev = bilinearSample(geo.data, geo.width, geo.height, srcCol, srcRow);
      if (!isFinite(elev) || elev <= -9000) {
        depths[row * N + col] = 0;
      } else {
        const d = Math.max(0, Math.min(maxDepthM, poolElevationM - elev));
        depths[row * N + col] = d;
        if (d > 0) validCount++;
      }
    }
  }
  if (validCount < N * N * 0.02) return null;
  return depths;
}

// ---------------------------------------------------------------------------
// ScienceBaseFetcher
// ---------------------------------------------------------------------------

export const scienceBaseFetcher: BathymetryFetcher = {
  async probe(strategy: FetchStrategy, _bbox: Bbox): Promise<ProbeResult> {
    if (strategy.kind !== "sciencebase") {
      return { available: false, title: "", error: "Wrong strategy kind for scienceBaseFetcher" };
    }
    const s = strategy as ScienceBaseFetchStrategy;
    const item = await fetchSbItem(s.itemId);
    if (!item) return { available: false, title: "", error: `ScienceBase item ${s.itemId} unreachable` };
    if (item.errors) return { available: false, title: "", error: item.errors.message };

    const hasTiff = (item.files ?? []).some((f) => /\.(tif|tiff)$/i.test(f.name));
    const title = item.title ?? `ScienceBase item ${s.itemId}`;
    const vintage = item.dates?.find((d) => d.label?.toLowerCase().includes("pub"))?.dateString
      ?? item.dates?.[0]?.dateString;

    if (!hasTiff) return { available: false, title, error: "No GeoTIFF attached to this ScienceBase item" };
    return { available: true, title, vintage, resolution: "2–3 m multibeam DEM" };
  },

  async fetch(strategy: FetchStrategy, bbox: Bbox, N: number): Promise<BathyFetchBundle> {
    if (strategy.kind !== "sciencebase") throw new Error("Wrong strategy kind");
    const s = strategy as ScienceBaseFetchStrategy;

    const item = await fetchSbItem(s.itemId);
    if (!item) throw new Error(`ScienceBase item ${s.itemId} unreachable`);
    if (item.errors) throw new Error(`ScienceBase: ${item.errors.message}`);

    const tiffFile = (item.files ?? []).find((f) => /\.(tif|tiff)$/i.test(f.name) && f.downloadUri);
    if (!tiffFile) throw new Error(`ScienceBase item ${s.itemId}: no GeoTIFF attached`);

    const res = await fetch(tiffFile.downloadUri, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`ScienceBase download HTTP ${res.status}`);
    const buf = await res.arrayBuffer();

    const geo = readTiffWithGeo(buf);
    const rawDepths = extractDepthGrid(geo, bbox, N, s.poolElevationM, s.maxDepthM);
    if (!rawDepths) throw new Error("ScienceBase GeoTIFF does not cover the requested bbox");

    const depths: number[] = new Array(N * N).fill(0);
    const topography: number[] = new Array(N * N).fill(0);
    let minDepth = Infinity, maxDepth = -Infinity;

    for (let i = 0; i < N * N; i++) {
      const d = rawDepths[i]!;
      if (d > 0.5) {
        depths[i] = d;
        if (d < minDepth) minDepth = d;
        if (d > maxDepth) maxDepth = d;
      }
    }
    if (!isFinite(minDepth)) minDepth = 0;
    if (!isFinite(maxDepth)) maxDepth = 0;

    return {
      depths,
      topography,
      hasTopography: false,
      minDepth: Math.round(minDepth * 10) / 10,
      maxDepth: Math.round(maxDepth * 10) / 10,
      width: N,
      height: N,
      bbox,
      dataSource: "usgs-sciencebase",
      label: item.title ?? `ScienceBase item ${s.itemId}`,
      creditUrl: `https://www.sciencebase.gov/catalog/item/${s.itemId}`,
    };
  },
};
