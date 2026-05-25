import { promises as fsPromises } from "fs";
import path from "path";

/**
 * Which upstream data service produced this grid.
 *   "ncei"      — NCEI Bag Mosaic WCS (high-resolution multibeam survey)
 *   "gebco"     — GEBCO 2024 WCS (~400 m global grid)
 *   "synthetic" — fbm fallback used when all upstream services are unreachable
 */
export type TerrainDataSource = "ncei" | "gebco" | "synthetic";

export interface TerrainGrid {
  datasetId: string;
  name: string;
  waterType: "saltwater" | "freshwater";
  resolution: number;
  width: number;
  height: number;
  depths: number[];
  minDepth: number;
  maxDepth: number;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  centerLon: number;
  centerLat: number;
  /**
   * Row-major NxN array of above-water elevation values (metres above sea
   * level, 0 for water cells). Present when the upstream source includes
   * land coverage (GEBCO/NCEI) and the dataset bbox actually contains
   * above-water terrain. Omitted for open-ocean datasets and synthetic grids.
   */
  topography?: number[];
  /** True when this grid includes a non-empty `topography` array. */
  hasTopography?: boolean;
  /**
   * True when the grid was generated from the synthetic fbm fallback
   * because the upstream bathymetry service (e.g. GEBCO WCS) was
   * unreachable or returned an unusable response. Clients can surface
   * a "synthetic data" badge so users know the terrain is not a real
   * survey.
   * @deprecated Use `dataSource` for a more descriptive indicator.
   */
  synthetic?: boolean;
  /** Which upstream source produced this grid. */
  dataSource?: TerrainDataSource;
  version?: number;
}

/**
 * Terrain cache version. Bump this whenever the grid-generation pipeline
 * changes in a way that makes previously cached grids stale (e.g. new
 * smoothing pass, changed depth conversion, different resolution mapping).
 * Cached entries with a lower version are discarded on read.
 *
 * History:
 *   1 — initial cache format
 *   2 — Task #26: smoothSpikes pass added in buildTerrainGrid
 *   3 — Task #115: topography array (above-water elevation) added
 */
export const TERRAIN_CACHE_VERSION = 3;

export interface DatasetMeta {
  id: string;
  name: string;
  description: string;
  waterType: "saltwater" | "freshwater";
  minDepth: number;
  maxDepth: number;
  centerLon: number;
  centerLat: number;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  /**
   * True when the dataset bbox includes above-water terrain (land/islands)
   * suitable for landmass visualisation. Open-ocean datasets set this to false.
   */
  hasTopography?: boolean;
}

// ---------------------------------------------------------------------------
// Preset dataset definitions
// ---------------------------------------------------------------------------

export const PRESET_DATASETS: DatasetMeta[] = [
  {
    id: "thorne-bay",
    name: "Thorne Bay — SE Alaska",
    description:
      "Clarence Strait and Thorne Bay, Prince of Wales Island — Inside Passage fishing grounds with rocky seafloor, kelp forests, and deep fjord channels (50-mi radius)",
    waterType: "saltwater",
    minDepth: 10,
    maxDepth: 370,
    centerLon: -132.53,
    centerLat: 55.69,
    bbox: { minLon: -133.5, minLat: 55.0, maxLon: -131.5, maxLat: 56.5 },
    hasTopography: true,
  },
  {
    id: "mariana-trench",
    name: "Mariana Trench",
    description: "Deepest oceanic trench on Earth — home of Challenger Deep at ~10,935 m",
    waterType: "saltwater",
    minDepth: 3200,
    maxDepth: 10935,
    centerLon: 142.2,
    centerLat: 11.35,
    bbox: { minLon: 141.0, minLat: 10.5, maxLon: 143.5, maxLat: 12.2 },
  },
  {
    id: "mid-atlantic-ridge",
    name: "Mid-Atlantic Ridge",
    description: "Divergent plate boundary with rift valley — active hydrothermal vents",
    waterType: "saltwater",
    minDepth: 1400,
    maxDepth: 4600,
    centerLon: -30.0,
    centerLat: 52.5,
    bbox: { minLon: -32.5, minLat: 51.0, maxLon: -27.5, maxLat: 54.0 },
  },
  {
    id: "mediterranean-basin",
    name: "Mediterranean Basin",
    description: "Semi-enclosed sea with heterogeneous bathymetry and ancient evaporite layers",
    waterType: "saltwater",
    minDepth: 10,
    maxDepth: 5267,
    centerLon: 18.5,
    centerLat: 35.5,
    bbox: { minLon: 15.0, minLat: 33.0, maxLon: 22.0, maxLat: 38.0 },
    hasTopography: true,
  },
  {
    id: "hawaii-seamount",
    name: "Hawaiian Ridge & Loihi",
    description: "Volcanic hotspot chain — Mauna Kea rises 10,210 m from the ocean floor",
    waterType: "saltwater",
    minDepth: 20,
    maxDepth: 5850,
    centerLon: -155.5,
    centerLat: 18.9,
    bbox: { minLon: -157.5, minLat: 17.5, maxLon: -153.5, maxLat: 20.3 },
    hasTopography: true,
  },
  {
    id: "weddell-sea",
    name: "Weddell Sea",
    description: "Antarctic marginal sea with broad continental shelf and deep abyssal plain beneath drifting ice",
    waterType: "saltwater",
    minDepth: 200,
    maxDepth: 4500,
    centerLon: -40.0,
    centerLat: -72.0,
    bbox: { minLon: -60.0, minLat: -78.0, maxLon: -20.0, maxLat: -66.0 },
    hasTopography: true,
  },
];

export const FRESHWATER_PRESET_DATASETS: DatasetMeta[] = [
  {
    id: "lake-superior",
    name: "Lake Superior",
    description: "World's largest freshwater lake by surface area — max depth 406 m, rocky basalt floor",
    waterType: "freshwater",
    minDepth: 5,
    maxDepth: 406,
    centerLon: -87.0,
    centerLat: 47.5,
    bbox: { minLon: -92.1, minLat: 46.4, maxLon: -84.3, maxLat: 49.0 },
    hasTopography: true,
  },
  {
    id: "lake-baikal",
    name: "Lake Baikal",
    description: "World's deepest lake at 1,642 m — ancient rift lake, Russia, with unique endemic species",
    waterType: "freshwater",
    minDepth: 20,
    maxDepth: 1642,
    centerLon: 107.7,
    centerLat: 53.5,
    bbox: { minLon: 103.7, minLat: 51.5, maxLon: 109.9, maxLat: 55.8 },
    hasTopography: true,
  },
  {
    id: "crater-lake",
    name: "Crater Lake",
    description: "Volcanic caldera lake in Oregon — remarkable clarity, max depth 594 m",
    waterType: "freshwater",
    minDepth: 30,
    maxDepth: 594,
    centerLon: -122.1,
    centerLat: 42.94,
    bbox: { minLon: -122.25, minLat: 42.84, maxLon: -121.95, maxLat: 43.04 },
    hasTopography: true,
  },
  {
    id: "lake-michigan",
    name: "Lake Michigan",
    description: "Third-largest Great Lake — max depth 281 m, gently sloping sandy and silty basin",
    waterType: "freshwater",
    minDepth: 5,
    maxDepth: 281,
    centerLon: -87.0,
    centerLat: 43.5,
    bbox: { minLon: -88.0, minLat: 41.6, maxLon: -85.0, maxLat: 46.1 },
    hasTopography: true,
  },
  {
    id: "lake-geneva",
    name: "Lake Geneva",
    description: "Crescent-shaped alpine lake between Switzerland and France — max depth 310 m",
    waterType: "freshwater",
    minDepth: 5,
    maxDepth: 310,
    centerLon: 6.5,
    centerLat: 46.45,
    bbox: { minLon: 6.15, minLat: 46.35, maxLon: 6.87, maxLat: 46.52 },
    hasTopography: true,
  },
];

export const ALL_PRESET_DATASETS: DatasetMeta[] = [
  ...PRESET_DATASETS,
  ...FRESHWATER_PRESET_DATASETS,
];

// ---------------------------------------------------------------------------
// NCEI Bag Mosaic WCS fetch (high-resolution multibeam, tried first for
// datasets that declare a preferred NCEI source)
// ---------------------------------------------------------------------------

const NCEI_WCS =
  "https://gis.ngdc.noaa.gov/arcgis/services/bag_mosaic/ImageServer/WCSServer";

/**
 * Datasets that should prefer the NCEI Bag Mosaic WCS over GEBCO.
 * NCEI has high-resolution multibeam coverage for surveyed coastal areas.
 */
const NCEI_PREFERRED_DATASETS = new Set(["thorne-bay"]);

/**
 * Fetch bathymetric data from the NCEI Bag Mosaic WCS for a given bounding box.
 *
 * The NCEI Bag Mosaic is a composite of multibeam surveys at 1–50 m resolution
 * for surveyed US coastal and Alaskan waters. Not all areas are covered; an error
 * or empty response means GEBCO should be used as fallback.
 *
 * Returns the same shape as fetchGebcoGrid for a transparent swap-in.
 */
async function fetchNceiGrid(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  resolution: number
): Promise<{ depths: number[]; minDepth: number; maxDepth: number; topography: number[]; hasTopography: boolean }> {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  const params = new URLSearchParams({
    SERVICE: "WCS",
    VERSION: "1.0.0",
    REQUEST: "GetCoverage",
    COVERAGE: "1",
    CRS: "EPSG:4326",
    BBOX: `${minLon},${minLat},${maxLon},${maxLat}`,
    FORMAT: "image/x-aaigrid",
    WIDTH: String(resolution),
    HEIGHT: String(resolution),
  });

  const url = `${NCEI_WCS}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let text: string;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`NCEI WCS returned HTTP ${resp.status}`);
    text = await resp.text();
  } finally {
    clearTimeout(timeout);
  }

  // NCEI may return an XML error document when coverage is unavailable
  if (text.trim().startsWith("<") || text.trim().startsWith("<?")) {
    throw new Error("NCEI WCS returned an XML response (coverage unavailable)");
  }

  const { ncols, nrows, nodata, values } = parseAsciiGrid(text);
  if (!ncols || !nrows || values.length === 0) {
    throw new Error("NCEI WCS returned an empty or invalid ASCII grid");
  }

  // NCEI elevation is negative for ocean depth; convert to positive depth.
  // No-data cells (no coverage) are set to 0 (sea surface).
  // Positive elevation cells are land — captured in the topography array.
  const depths: number[] = new Array(resolution * resolution).fill(0);
  const topography: number[] = new Array(resolution * resolution).fill(0);
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  let landCellCount = 0;

  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      const srcRow = Math.min(nrows - 1, Math.floor((row / resolution) * nrows));
      const srcCol = Math.min(ncols - 1, Math.floor((col / resolution) * ncols));
      const elev = values[srcRow * ncols + srcCol];

      let depth = 0;
      let elevation = 0;
      if (elev !== undefined && elev !== nodata) {
        if (elev < 0) depth = -elev;
        else if (elev > 0) {
          elevation = elev;
          landCellCount++;
        }
      }

      depths[row * resolution + col] = depth;
      topography[row * resolution + col] = elevation;
      if (depth < minDepth) minDepth = depth;
      if (depth > maxDepth) maxDepth = depth;
    }
  }

  if (!isFinite(minDepth)) minDepth = 0;
  if (!isFinite(maxDepth)) maxDepth = 0;

  // Sanity check: a grid with negligible variance is likely a no-data tile
  if (maxDepth - minDepth < 5) {
    throw new Error(`NCEI WCS returned near-flat grid (range ${maxDepth - minDepth} m) — likely no coverage`);
  }

  // Require at least ~0.5% land cells to consider topography meaningful
  const hasTopography = landCellCount > resolution * resolution * 0.005;

  return { depths, minDepth, maxDepth, topography, hasTopography };
}

// ---------------------------------------------------------------------------
// GEBCO WCS fetch
// ---------------------------------------------------------------------------

const GEBCO_WCS =
  "https://www.gebco.net/data_and_products/gebco_web_services/web_map_service/mapserv";

/**
 * Parse an ESRI Arc/Info ASCII Grid (AAIGRID) string.
 * Returns { ncols, nrows, nodata, values } where values is flat row-major array
 * of elevation values in metres (negative = below sea level).
 */
function parseAsciiGrid(text: string): {
  ncols: number;
  nrows: number;
  nodata: number;
  values: number[];
} {
  const lines = text.split(/\r?\n/);
  let ncols = 0;
  let nrows = 0;
  let nodata = -9999;
  let dataStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim().toLowerCase();
    if (!line) continue;
    if (line.startsWith("ncols")) {
      ncols = parseInt(line.split(/\s+/)[1]!, 10);
    } else if (line.startsWith("nrows")) {
      nrows = parseInt(line.split(/\s+/)[1]!, 10);
    } else if (line.startsWith("nodata_value") || line.startsWith("nodata")) {
      nodata = parseFloat(line.split(/\s+/)[1]!);
    } else if (!isNaN(parseFloat(line.split(/\s+/)[0]!))) {
      dataStart = i;
      break;
    }
  }

  const values: number[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const tokens = lines[i]!.trim().split(/\s+/);
    for (const tok of tokens) {
      if (tok) values.push(parseFloat(tok));
    }
  }

  return { ncols, nrows, nodata, values };
}

/**
 * Fetch real bathymetric data from GEBCO WCS for a given bounding box.
 * GEBCO elevation is negative for ocean depth; we convert to positive depth values.
 * Land cells (positive elevation) are replaced with 0.
 */
async function fetchGebcoGrid(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  resolution: number
): Promise<{ depths: number[]; minDepth: number; maxDepth: number; topography: number[]; hasTopography: boolean }> {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  const params = new URLSearchParams({
    service: "WCS",
    version: "1.0.0",
    request: "GetCoverage",
    coverage: "gebco_latest_2",
    crs: "EPSG:4326",
    bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
    format: "image/x-aaigrid",
    width: String(resolution),
    height: String(resolution),
  });

  const url = `${GEBCO_WCS}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let text: string;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`GEBCO WCS returned HTTP ${resp.status}`);
    text = await resp.text();
  } finally {
    clearTimeout(timeout);
  }

  const { ncols, nrows, nodata, values } = parseAsciiGrid(text);

  if (!ncols || !nrows || values.length === 0) {
    throw new Error("GEBCO WCS returned an empty or invalid grid");
  }

  // GEBCO uses row-major, top-to-bottom, left-to-right
  // Convert elevation (negative = ocean) to positive depth.
  // Positive elevations (land) are captured in the topography array so the
  // client can render landmass meshes that meet the bathymetry seamlessly.
  const depths: number[] = new Array(resolution * resolution).fill(0);
  const topography: number[] = new Array(resolution * resolution).fill(0);
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  let landCellCount = 0;

  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      // Map our output grid indices to the raw grid indices
      const srcRow = Math.min(nrows - 1, Math.floor((row / resolution) * nrows));
      const srcCol = Math.min(ncols - 1, Math.floor((col / resolution) * ncols));
      const elev = values[srcRow * ncols + srcCol];

      let depth = 0;
      let elevation = 0;
      if (elev !== undefined && elev !== nodata) {
        if (elev < 0) {
          depth = -elev; // positive depth below sea level
        } else if (elev > 0) {
          elevation = elev; // metres above sea level (land)
          landCellCount++;
        }
      }

      depths[row * resolution + col] = depth;
      topography[row * resolution + col] = elevation;
      if (depth < minDepth) minDepth = depth;
      if (depth > maxDepth) maxDepth = depth;
    }
  }

  if (!isFinite(minDepth)) minDepth = 0;
  if (!isFinite(maxDepth)) maxDepth = 0;

  // Require at least ~0.5% land cells to consider topography meaningful
  const hasTopography = landCellCount > resolution * resolution * 0.005;

  return { depths, minDepth, maxDepth, topography, hasTopography };
}

// ---------------------------------------------------------------------------
// Terrain cache & grid builder (memory + disk)
// ---------------------------------------------------------------------------

const DISK_CACHE_DIR = "/tmp/gebco-cache";
const memoryCache = new Map<string, TerrainGrid>();

async function readDiskCache(key: string): Promise<TerrainGrid | null> {
  try {
    const file = path.join(DISK_CACHE_DIR, `${key}.json`);
    const raw = await fsPromises.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as TerrainGrid;
    const version = parsed.version ?? 1;
    if (version < TERRAIN_CACHE_VERSION) {
      console.info(
        `[terrain] Discarding stale cache ${key} (v${version} < v${TERRAIN_CACHE_VERSION})`
      );
      // Best-effort removal so the stale file doesn't linger on disk.
      fsPromises.unlink(file).catch(() => {});
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeDiskCache(key: string, grid: TerrainGrid): Promise<void> {
  try {
    await fsPromises.mkdir(DISK_CACHE_DIR, { recursive: true });
    const file = path.join(DISK_CACHE_DIR, `${key}.json`);
    const stamped: TerrainGrid = { ...grid, version: TERRAIN_CACHE_VERSION };
    await fsPromises.writeFile(file, JSON.stringify(stamped), "utf8");
  } catch (err) {
    console.warn(`[terrain] Failed to write disk cache for ${key}: ${(err as Error).message}`);
  }
}

export async function buildTerrainGrid(
  datasetId: string,
  resolution = 256,
  options: { smoothing?: boolean } = {}
): Promise<TerrainGrid | null> {
  const smoothing = options.smoothing ?? true;
  const safeId = datasetId.replace(/[^a-z0-9-]/gi, "_");
  const cacheKey = `${safeId}-${resolution}${smoothing ? "" : "-raw"}`;

  // 1. Memory cache (fastest)
  const mem = memoryCache.get(cacheKey);
  if (mem) return mem;

  const meta = ALL_PRESET_DATASETS.find((d) => d.id === datasetId);
  if (!meta) return null;

  const N = Math.max(32, Math.min(512, resolution));

  // 2. Disk cache
  const disk = await readDiskCache(cacheKey);
  if (disk) {
    console.info(`[terrain] Disk cache hit: ${cacheKey}`);
    memoryCache.set(cacheKey, disk);
    return disk;
  }

  // 3. Fetch from upstream source:
  //    NCEI Bag Mosaic WCS → GEBCO WCS → synthetic fallback
  let depths: number[];
  let minDepth: number;
  let maxDepth: number;
  let topography: number[] | undefined;
  let hasTopography = false;
  let synthetic = false;
  let dataSource: TerrainDataSource = "gebco";

  // Try NCEI first for datasets with high-resolution multibeam coverage
  if (NCEI_PREFERRED_DATASETS.has(datasetId)) {
    try {
      console.info(`[terrain] Trying NCEI Bag Mosaic WCS for ${datasetId} at ${N}×${N}…`);
      const ncei = await fetchNceiGrid(meta.bbox, N);
      depths = ncei.depths;
      minDepth = ncei.minDepth;
      maxDepth = ncei.maxDepth;
      topography = ncei.topography;
      hasTopography = ncei.hasTopography;
      dataSource = "ncei";
      console.info(`[terrain] NCEI data fetched successfully for ${datasetId}`);
    } catch (nceiErr) {
      console.info(
        `[terrain] NCEI WCS unavailable for ${datasetId}: ${(nceiErr as Error).message}. Falling back to GEBCO.`
      );
      // Fall through to GEBCO below
      try {
        console.info(`[terrain] Fetching GEBCO WCS for ${datasetId} at ${N}×${N}…`);
        const gebco = await fetchGebcoGrid(meta.bbox, N);
        depths = gebco.depths;
        minDepth = gebco.minDepth;
        maxDepth = gebco.maxDepth;
        topography = gebco.topography;
        hasTopography = gebco.hasTopography;
        dataSource = "gebco";
      } catch (gebcoErr) {
        console.warn(
          `[terrain] GEBCO WCS also unavailable for ${datasetId}: ${(gebcoErr as Error).message}. Using synthetic fallback.`
        );
        const synth = buildSyntheticGrid(datasetId, N, meta);
        depths = synth.depths;
        minDepth = synth.minDepth;
        maxDepth = synth.maxDepth;
        synthetic = true;
        dataSource = "synthetic";
      }
    }
  } else {
    try {
      console.info(`[terrain] Fetching GEBCO WCS for ${datasetId} at ${N}×${N}…`);
      const gebco = await fetchGebcoGrid(meta.bbox, N);
      depths = gebco.depths;
      minDepth = gebco.minDepth;
      maxDepth = gebco.maxDepth;
      topography = gebco.topography;
      hasTopography = gebco.hasTopography;
      dataSource = "gebco";
    } catch (err) {
      // Fallback to synthetic data if GEBCO is unreachable (dev / offline)
      console.warn(
        `[terrain] GEBCO WCS unavailable for ${datasetId}: ${(err as Error).message}. Using synthetic fallback.`
      );
      const synth = buildSyntheticGrid(datasetId, N, meta);
      depths = synth.depths;
      minDepth = synth.minDepth;
      maxDepth = synth.maxDepth;
      synthetic = true;
      dataSource = "synthetic";
    }
  }

  // Smooth spikes before finalising the grid (skipped when the user has
  // disabled "Smooth terrain spikes" in their settings — raw bathymetry).
  if (smoothing) {
    smoothSpikes(depths, N, maxDepth - minDepth);
  }

  // Recompute min/max after smoothing (values may have shifted)
  minDepth = Infinity;
  maxDepth = -Infinity;
  for (let i = 0; i < depths.length; i++) {
    if (depths[i]! < minDepth) minDepth = depths[i]!;
    if (depths[i]! > maxDepth) maxDepth = depths[i]!;
  }

  const grid: TerrainGrid = {
    datasetId,
    name: meta.name,
    waterType: meta.waterType,
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: Math.round(minDepth),
    maxDepth: Math.round(maxDepth),
    minLon: meta.bbox.minLon,
    maxLon: meta.bbox.maxLon,
    minLat: meta.bbox.minLat,
    maxLat: meta.bbox.maxLat,
    centerLon: meta.centerLon,
    centerLat: meta.centerLat,
    synthetic,
    dataSource,
    ...(hasTopography && topography ? { topography, hasTopography: true } : {}),
  };

  memoryCache.set(cacheKey, grid);
  await writeDiskCache(cacheKey, grid);
  return grid;
}

// ---------------------------------------------------------------------------
// Synthetic fallback (value-noise, used when GEBCO WCS is unreachable)
// ---------------------------------------------------------------------------

function hash(n: number): number {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}

function hash2(x: number, y: number): number {
  return hash(x * 127.1 + y * 311.7);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = smoothstep(fx);
  const uy = smoothstep(fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

function fbm(
  x: number,
  y: number,
  octaves: number,
  persistence: number,
  lacunarity: number
): number {
  let value = 0;
  let amplitude = 1.0;
  let frequency = 1.0;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

function buildSyntheticGrid(
  datasetId: string,
  N: number,
  meta: DatasetMeta
): { depths: number[]; minDepth: number; maxDepth: number } {
  const depthFns: Record<string, (nx: number, ny: number) => number> = {
    "lake-superior": (nx, ny) => {
      const noise = fbm(nx * 9 + 3, ny * 9 + 3, 5, 0.5, 2.0);
      const edgeDist = Math.min(nx, 1 - nx, ny, 1 - ny) * 4;
      const shelf = Math.pow(Math.max(0, edgeDist - 0.15), 1.5);
      return 5 + (406 - 5) * (shelf * 0.75 + noise * 0.25);
    },
    "lake-baikal": (nx, ny) => {
      const noise = fbm(nx * 7 + 11, ny * 7 + 11, 6, 0.5, 2.1);
      const riftFactor = Math.pow(Math.max(0, 1 - Math.abs(nx - 0.5) * 3.5), 2.0);
      return 20 + (1642 - 20) * (riftFactor * 0.8 + noise * 0.2);
    },
    "crater-lake": (nx, ny) => {
      const noise = fbm(nx * 11 + 5, ny * 11 + 5, 5, 0.45, 2.0);
      const cx = nx - 0.5;
      const cy = ny - 0.5;
      const r = Math.sqrt(cx * cx + cy * cy);
      const bowl = Math.pow(Math.max(0, 1 - r * 2.2), 1.8);
      return 30 + (594 - 30) * (bowl * 0.82 + noise * 0.18);
    },
    "lake-michigan": (nx, ny) => {
      const noise = fbm(nx * 9 + 4, ny * 9 + 4, 5, 0.5, 2.0);
      // Elongated basin: deeper in the middle along the long N–S axis
      const longAxis = 1 - Math.abs(ny - 0.5) * 1.8;
      const shortAxis = Math.pow(Math.max(0, 1 - Math.abs(nx - 0.5) * 2.2), 1.3);
      const basin = Math.max(0, longAxis) * shortAxis;
      return 5 + (281 - 5) * (basin * 0.75 + noise * 0.25);
    },
    "lake-geneva": (nx, ny) => {
      const noise = fbm(nx * 11 + 9, ny * 11 + 9, 5, 0.5, 2.0);
      // Crescent-shaped: deepest band shifted slightly south
      const cy = ny - 0.55;
      const cx = nx - 0.5;
      const trough = Math.pow(Math.max(0, 1 - (cx * cx * 2.0 + cy * cy * 4.0)), 1.4);
      return 5 + (310 - 5) * (trough * 0.78 + noise * 0.22);
    },
    "mariana-trench": (nx, ny) => {
      const noise = fbm(nx * 8 + 10, ny * 8 + 10, 6, 0.5, 2.1);
      const trenchFactor = Math.pow(Math.max(0, 1 - Math.abs(ny - 0.5) * 3.5), 2.5);
      return 3200 + (10935 - 3200) * (trenchFactor * 0.78 + noise * 0.22);
    },
    "mid-atlantic-ridge": (nx, ny) => {
      const noise = fbm(nx * 6 + 20, ny * 6 + 20, 5, 0.55, 2.0);
      const ridgeFactor = Math.pow(Math.max(0, 1 - Math.abs(nx - 0.5) * 4), 1.8);
      const riftFactor = Math.pow(Math.max(0, 1 - Math.abs(nx - 0.5) * 12), 4);
      return Math.max(1400, 4600 - (4600 - 1400) * ridgeFactor * 0.8 + (3000 - 1400) * riftFactor * 0.3 + noise * 400 - 200);
    },
    "mediterranean-basin": (nx, ny) => {
      const noise = fbm(nx * 10 + 5, ny * 10 + 5, 5, 0.5, 2.0);
      const basins = 0.5 + 0.5 * Math.sin(nx * Math.PI * 3) * Math.sin(ny * Math.PI * 1.5);
      return 100 + (5267 - 100) * (basins * 0.6 + noise * 0.4);
    },
    "hawaii-seamount": (nx, ny) => {
      const noise = fbm(nx * 7 + 3, ny * 7 + 3, 6, 0.5, 2.1);
      const r = Math.sqrt((nx - 0.6) ** 2 + (ny - 0.4) ** 2);
      const seamount = Math.pow(Math.max(0, 1 - r * 2.5), 2.2);
      return Math.max(20, 5850 - (5850 - 20) * seamount * 0.85 + noise * 300 - 150);
    },
    "weddell-sea": (nx, ny) => {
      const noise = fbm(nx * 5 + 12, ny * 5 + 12, 5, 0.5, 2.0);
      // Continental shelf in the south (high ny), deep abyssal plain in the north
      const shelfFactor = Math.max(0, ny - 0.6) / 0.4;
      const shelf = 200 + 400 * noise;
      const deep = 3500 + 1000 * noise;
      return shelfFactor * shelf + (1 - shelfFactor) * deep;
    },
    "thorne-bay": (nx, ny) => {
      // Model: Clarence Strait (N–S oriented, ~10 km wide), with Thorne Bay inlet.
      // The bbox spans ~2° lon × 1.5° lat of SE Alaska Inside Passage.
      const noise = fbm(nx * 12 + 17, ny * 12 + 17, 6, 0.52, 2.1);
      const fineNoise = fbm(nx * 28 + 3, ny * 28 + 3, 4, 0.45, 2.2) * 0.15;

      // Clarence Strait: deep N–S channel offset slightly west of centre
      const straitCx = nx - 0.45;
      const straitWidth = 0.18;
      const straitDepth = Math.pow(Math.max(0, 1 - Math.abs(straitCx) / straitWidth), 1.4);

      // Broad shelf areas on both sides
      const shelf = Math.max(0, 1 - straitDepth * 2.5);

      // Thorne Bay inlet: shallower pocket on the SW at ~(0.25, 0.55)
      const tbDx = nx - 0.25;
      const tbDy = ny - 0.55;
      const thorneBayBowl = Math.pow(Math.max(0, 1 - (tbDx * tbDx * 30 + tbDy * tbDy * 20)), 1.5);

      // Composite depth
      const channelDepth = 180 + 190 * straitDepth;
      const shelfDepth = 15 + 60 * shelf;
      const thorneBayDepth = 10 + 55 * (1 - thorneBayBowl);
      let depth = straitDepth * channelDepth + (1 - straitDepth) * shelfDepth;
      // Blend in Thorne Bay bowl
      depth = depth * (1 - thorneBayBowl * 0.6) + thorneBayDepth * (thorneBayBowl * 0.6);

      return Math.max(10, depth + (noise - 0.5) * 60 + (fineNoise - 0.075) * 40);
    },
  };

  const depthFn = depthFns[datasetId] ?? ((nx, ny) => {
    const noise = fbm(nx * 6 + 7, ny * 6 + 7, 5, 0.5, 2.0);
    return meta.minDepth + (meta.maxDepth - meta.minDepth) * noise;
  });

  const depths: number[] = new Array(N * N);
  let minDepth = Infinity;
  let maxDepth = -Infinity;

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const d = depthFn(col / (N - 1), row / (N - 1));
      depths[row * N + col] = d;
      if (d < minDepth) minDepth = d;
      if (d > maxDepth) maxDepth = d;
    }
  }

  return { depths, minDepth, maxDepth };
}

// ---------------------------------------------------------------------------
// Spike smoothing — 70° angle threshold
// ---------------------------------------------------------------------------

const SPIKE_ANGLE_THRESHOLD = 70 * (Math.PI / 180);
const MAX_SMOOTH_ITERATIONS = 20;

/**
 * Smooth terrain spikes in-place by iteratively blending any vertex whose
 * slope angle to a 4-connected neighbour exceeds 70°.
 *
 * Angles are computed in normalised space so the threshold is
 * resolution-independent:
 *   - horizontal step  = 1 / (N − 1)   (fraction of full grid width)
 *   - vertical step    = |heightDiff| / depthRange   (fraction of full range)
 *
 * Marked cells are replaced with the average of their valid neighbours.
 * The process repeats until no new cells are marked (capped at
 * MAX_SMOOTH_ITERATIONS for safety).
 *
 * Designed so callers only need a single conditional to disable the pass:
 *   if (enableSmoothing) smoothSpikes(depths, N, depthRange);
 *
 * @param depths     - flat row-major depth array (mutated in place)
 * @param N          - grid width/height (square grid)
 * @param depthRange - (maxDepth − minDepth) of the unsmoothed grid
 */
export function smoothSpikes(depths: number[], N: number, depthRange: number): void {
  if (N < 3 || depthRange <= 0) return;

  const cellSpacing = 1 / (N - 1);   // normalised horizontal step
  const invRange    = 1 / depthRange; // scale height diffs to [0,1]

  for (let iter = 0; iter < MAX_SMOOTH_ITERATIONS; iter++) {
    const toSmooth = new Uint8Array(N * N); // 0 = keep, 1 = blend
    let anyMarked = false;

    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const idx   = row * N + col;
        const depth = depths[idx]!;

        // 4-connected neighbour indices (-1 = out of bounds)
        const up    = row > 0       ? (row - 1) * N + col : -1;
        const down  = row < N - 1   ? (row + 1) * N + col : -1;
        const left  = col > 0       ? row * N + (col - 1) : -1;
        const right = col < N - 1   ? row * N + (col + 1) : -1;

        const nbrs = [up, down, left, right];
        for (const nIdx of nbrs) {
          if (nIdx < 0) continue;
          const normDiff = Math.abs(depth - depths[nIdx]!) * invRange;
          if (Math.atan2(normDiff, cellSpacing) > SPIKE_ANGLE_THRESHOLD) {
            toSmooth[idx] = 1;
            anyMarked = true;
            break;
          }
        }
      }
    }

    if (!anyMarked) break;

    // Replace marked cells with the average of their valid neighbours
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const idx = row * N + col;
        if (!toSmooth[idx]) continue;

        let sum   = 0;
        let count = 0;
        if (row > 0)     { sum += depths[(row - 1) * N + col]!; count++; }
        if (row < N - 1) { sum += depths[(row + 1) * N + col]!; count++; }
        if (col > 0)     { sum += depths[row * N + (col - 1)]!; count++; }
        if (col < N - 1) { sum += depths[row * N + (col + 1)]!; count++; }

        if (count > 0) depths[idx] = sum / count;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CSV / XYZ parser and gridder
// ---------------------------------------------------------------------------

interface RawPoint {
  lon: number;
  lat: number;
  depth: number;
}

export function parseXyzCsv(content: string, fileName: string): RawPoint[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const isXyz = fileName.toLowerCase().endsWith(".xyz");
  const sep = isXyz ? /\s+/ : /[,\t\s]+/;

  let lonIdx = 0;
  let latIdx = 1;
  let depthIdx = 2;

  const first = lines[0]?.trim() ?? "";
  const firstNum = parseFloat(first.split(sep)[0] ?? "");
  const hasHeader = Number.isNaN(firstNum);
  const startLine = hasHeader ? 1 : 0;

  if (hasHeader) {
    const headers = first.toLowerCase().split(sep);
    lonIdx = Math.max(0, headers.findIndex((h) => h.includes("lon") || h === "x" || h === "long"));
    latIdx = Math.max(0, headers.findIndex((h) => h.includes("lat") || h === "y"));
    const dIdx = headers.findIndex(
      (h) => h.includes("dep") || h.includes("z") || h.includes("depth") || h.includes("elev")
    );
    depthIdx = dIdx >= 0 ? dIdx : 2;
  }

  const points: RawPoint[] = [];
  for (let i = startLine; i < lines.length; i++) {
    const parts = lines[i]!.trim().split(sep);
    const lon = parseFloat(parts[lonIdx] ?? "");
    const lat = parseFloat(parts[latIdx] ?? "");
    let z = parseFloat(parts[depthIdx] ?? "");
    if (Number.isNaN(lon) || Number.isNaN(lat) || Number.isNaN(z)) continue;
    if (z < 0) z = -z;
    points.push({ lon, lat, depth: z });
  }

  return points;
}

export function gridPoints(
  points: RawPoint[],
  resolution: number,
  datasetId: string,
  name: string,
  options: { smoothing?: boolean } = {}
): TerrainGrid {
  const smoothing = options.smoothing ?? true;
  const N = Math.max(32, Math.min(512, resolution));

  let minLon = Infinity,
    maxLon = -Infinity;
  let minLat = Infinity,
    maxLat = -Infinity;

  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }

  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;

  // Step 1: nearest-neighbour binning — accumulate depths per cell
  const depthSums: number[] = new Array(N * N).fill(0);
  const counts: number[] = new Array(N * N).fill(0);

  for (const p of points) {
    const col = Math.min(N - 1, Math.floor(((p.lon - minLon) / lonRange) * N));
    const row = Math.min(N - 1, Math.floor(((p.lat - minLat) / latRange) * N));
    const idx = row * N + col;
    depthSums[idx]! += p.depth;
    counts[idx]!++;
  }

  // Step 2: average bins that received multiple points
  const depths: number[] = new Array(N * N).fill(0);
  for (let i = 0; i < N * N; i++) {
    if (counts[i]! > 0) {
      depths[i] = depthSums[i]! / counts[i]!;
    }
  }

  // Step 3: inverse-distance-weighted (IDW) fill for sparse (empty) cells.
  // For each empty cell we expand outward in concentric Chebyshev rings until
  // we accumulate at least K weighted samples, then stop. Weight = 1 / dist².
  const K_MIN = 8; // minimum neighbours to find before stopping
  for (let i = 0; i < N * N; i++) {
    if (counts[i]! > 0) continue; // cell already has data

    const row = Math.floor(i / N);
    const col = i % N;
    let weightedSum = 0;
    let weightSum = 0;
    let found = 0;

    for (let r = 1; r < N; r++) {
      // Check only the outer ring at Chebyshev radius r
      for (let dr = -r; dr <= r; dr++) {
        for (let dc = -r; dc <= r; dc++) {
          if (Math.abs(dr) !== r && Math.abs(dc) !== r) continue;
          const r2 = row + dr;
          const c2 = col + dc;
          if (r2 < 0 || r2 >= N || c2 < 0 || c2 >= N) continue;
          const j = r2 * N + c2;
          if (counts[j]! === 0) continue;
          const dist2 = dr * dr + dc * dc;
          const w = 1 / dist2;
          weightedSum += depths[j]! * w;
          weightSum += w;
          found++;
        }
      }
      if (found >= K_MIN) break; // enough neighbours collected
    }

    if (weightSum > 0) {
      depths[i] = weightedSum / weightSum;
    }
  }

  // Step 4: smooth spikes before computing final min/max (skipped when the
  // user has disabled "Smooth terrain spikes" — raw bathymetry).
  if (smoothing) {
    let roughMin = Infinity;
    let roughMax = -Infinity;
    for (let i = 0; i < N * N; i++) {
      if (depths[i]! < roughMin) roughMin = depths[i]!;
      if (depths[i]! > roughMax) roughMax = depths[i]!;
    }
    smoothSpikes(depths, N, roughMax - roughMin);
  }

  // Step 5: compute min/max after fill and smoothing
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (let i = 0; i < N * N; i++) {
    if (depths[i]! < minDepth) minDepth = depths[i]!;
    if (depths[i]! > maxDepth) maxDepth = depths[i]!;
  }

  return {
    datasetId,
    name,
    waterType: "saltwater",
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: Math.round(minDepth),
    maxDepth: Math.round(maxDepth),
    minLon,
    maxLon,
    minLat,
    maxLat,
    centerLon: (minLon + maxLon) / 2,
    centerLat: (minLat + maxLat) / 2,
  };
}
