import { promises as fsPromises } from "fs";
import path from "path";
import { createHash } from "crypto";
import { registerCache } from "./cacheRegistry.js";
import { logger } from "./logger.js";
import { fetchWcsGeoTiffGrid } from "./terrain.js";

/**
 * A flat land-elevation grid derived from Copernicus DEM 90 m data.
 *
 * Values are metres above sea level (>= 0). Water cells are 0.
 * Row-major, top-to-bottom (north→south), left-to-right (west→east).
 */
export interface LandGrid {
  elevation: number[];
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  /** UTC timestamp when this grid was fetched. */
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Disk cache — keyed by sha256(bbox + gridSize) so the same region at the
// same resolution is served without a round-trip to the upstream service.
// ---------------------------------------------------------------------------

const LAND_CACHE_DIR = "/tmp/land-dem-cache";

const landMemoryCache = new Map<string, LandGrid>();
registerCache(() => landMemoryCache.clear());

function landCacheKey(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  gridSize: number,
): string {
  const payload = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat},${gridSize}`;
  return createHash("sha256").update(payload).digest("hex");
}

async function readLandDiskCache(key: string): Promise<LandGrid | null> {
  try {
    const file = path.join(LAND_CACHE_DIR, `${key}.json`);
    const raw = await fsPromises.readFile(file, "utf8");
    return JSON.parse(raw) as LandGrid;
  } catch {
    return null;
  }
}

async function writeLandDiskCache(key: string, grid: LandGrid): Promise<void> {
  try {
    await fsPromises.mkdir(LAND_CACHE_DIR, { recursive: true });
    const file = path.join(LAND_CACHE_DIR, `${key}.json`);
    await fsPromises.writeFile(file, JSON.stringify(grid), "utf8");
  } catch (err) {
    logger.warn({ err, key }, `[land-dem] Failed to write disk cache for ${key}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Copernicus DEM 90 m fetch via GEBCO WCS
//
// Copernicus DEM 90 m data is integrated into GEBCO 2024 (land elevation uses
// the Copernicus GLO-90 DEM as its primary above-water source). The GEBCO WCS
// exposes this data free of charge at the same endpoint used by the
// bathymetry fetcher, so no additional auth or registration is required.
// Positive elevation values in the GEBCO response are Copernicus-derived land
// terrain; water cells are zero (bathymetry is discarded here).
// ---------------------------------------------------------------------------

/**
 * GEBCO's own WCS no longer serves GetCoverage (MapServer config errors on
 * every coverage/format — verified 2026-07). NCEI's DEM_global_mosaic carries
 * the same GEBCO-based grid (Copernicus land elevation included) and serves
 * GeoTIFF, so land elevation is fetched from it instead.
 */
const GEBCO_WCS =
  "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/DEM_global_mosaic/ImageServer/WCSServer";

const GEBCO_COVERAGE_ID = "DEM_global_mosaic";

/**
 * Fetch land elevation for the given bounding box and grid size.
 *
 * Uses the GEBCO 2024 WCS, which bundles Copernicus GLO-90 as its
 * above-water elevation source. Only positive elevation values (land cells)
 * are preserved — water cells are set to 0 so the mesh waterline stays clean.
 *
 * Throws on network failure; callers should catch and fall back to a flat
 * plane (all-zero elevation array).
 */
async function fetchLandElevationFromGebco(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  gridSize: number,
): Promise<{ elevation: number[]; minElevation: number; maxElevation: number }> {
  const { minLon, minLat, maxLon, maxLat } = bbox;

  const params = new URLSearchParams({
    service: "WCS",
    version: "1.0.0",
    request: "GetCoverage",
    coverage: GEBCO_COVERAGE_ID,
    crs: "EPSG:4326",
    bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
    format: "GeoTIFF",
    width: String(gridSize),
    height: String(gridSize),
  });

  const url = `${GEBCO_WCS}?${params.toString()}`;

  const { ncols, nrows, nodata, values } = await fetchWcsGeoTiffGrid(url, 20_000, "GEBCO WCS (land elevation)");
  if (!ncols || !nrows || values.length === 0) {
    throw new Error("GEBCO WCS returned an empty or invalid grid");
  }

  const N = gridSize;
  const elevation = new Array<number>(N * N).fill(0);
  let minElevation = Infinity;
  let maxElevation = -Infinity;

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const srcRow = Math.min(nrows - 1, Math.floor((row / N) * nrows));
      const srcCol = Math.min(ncols - 1, Math.floor((col / N) * ncols));
      const raw = values[srcRow * ncols + srcCol];

      let elev = 0;
      if (raw !== undefined && raw !== nodata && raw > 0) {
        elev = raw;
        if (elev < minElevation) minElevation = elev;
        if (elev > maxElevation) maxElevation = elev;
      }
      elevation[row * N + col] = elev;
    }
  }

  if (!isFinite(minElevation)) minElevation = 0;
  if (!isFinite(maxElevation)) maxElevation = 0;

  return { elevation, minElevation, maxElevation };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch Copernicus DEM 90 m land elevation for the given bounding box.
 *
 * Results are cached in memory and on disk. Subsequent calls for the same
 * bbox + gridSize return the cached grid without a round-trip to the
 * upstream service.
 *
 * On any upstream failure a flat-plane grid (all zeros) is returned so the
 * scene degrades gracefully — users see no land elevation rather than an
 * error. The failure is logged to console.
 */
export async function fetchCopernicusDem(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  gridSize: number,
): Promise<LandGrid> {
  const key = landCacheKey(bbox, gridSize);

  const inMemory = landMemoryCache.get(key);
  if (inMemory) return inMemory;

  const onDisk = await readLandDiskCache(key);
  if (onDisk) {
    landMemoryCache.set(key, onDisk);
    return onDisk;
  }

  let elevation: number[];
  let minElevation: number;
  let maxElevation: number;

  try {
    logger.info(
      { bbox, gridSize },
      `[land-dem] Fetching Copernicus DEM 90 m for bbox (${bbox.minLon},${bbox.minLat})→(${bbox.maxLon},${bbox.maxLat}) at ${gridSize}×${gridSize}…`,
    );
    const result = await fetchLandElevationFromGebco(bbox, gridSize);
    elevation = result.elevation;
    minElevation = result.minElevation;
    maxElevation = result.maxElevation;
    logger.info({ maxElevation }, `[land-dem] Fetch complete — maxElev=${maxElevation.toFixed(1)} m`);
  } catch (err) {
    logger.warn(
      { err },
      `[land-dem] Upstream fetch failed — falling back to flat plane: ${(err as Error).message}`,
    );
    elevation = new Array<number>(gridSize * gridSize).fill(0);
    minElevation = 0;
    maxElevation = 0;
  }

  const grid: LandGrid = {
    elevation,
    width: gridSize,
    height: gridSize,
    minElevation,
    maxElevation,
    minLon: bbox.minLon,
    maxLon: bbox.maxLon,
    minLat: bbox.minLat,
    maxLat: bbox.maxLat,
    fetchedAt: new Date().toISOString(),
  };

  landMemoryCache.set(key, grid);
  void writeLandDiskCache(key, grid);

  return grid;
}
