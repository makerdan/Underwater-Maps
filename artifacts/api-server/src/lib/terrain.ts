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
 *   4 — Task #336: multi-coverage NCEI fetcher (BAG + DEM Global Mosaic);
 *       SE Alaska presets now route through NCEI first, so previously
 *       cached GEBCO-only grids must be invalidated.
 */
export const TERRAIN_CACHE_VERSION = 4;

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
  /**
   * True when the dataset has bundled Essential Fish Habitat (EFH) zone data
   * available via the /efh endpoint.
   */
  hasEfh?: boolean;
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
    hasEfh: true,
  },
  {
    id: "glacier-bay",
    name: "Glacier Bay — SE Alaska",
    description:
      "Glacier Bay National Park, SE Alaska — deep glacial fjords, tidewater glacier termini, and ~60 km of Alaska ShoreZone substrate coverage",
    waterType: "saltwater",
    minDepth: 5,
    maxDepth: 460,
    centerLon: -136.3,
    centerLat: 58.75,
    bbox: { minLon: -137.1, minLat: 58.4, maxLon: -135.8, maxLat: 59.15 },
    hasTopography: true,
    hasEfh: true,
  },
  {
    id: "icy-strait",
    name: "Icy Strait — SE Alaska",
    description:
      "Icy Strait and Cross Sound between Chichagof Island and Glacier Bay — Alaska ShoreZone substrate coverage and halibut/salmon fishing grounds",
    waterType: "saltwater",
    minDepth: 10,
    maxDepth: 400,
    centerLon: -136.0,
    centerLat: 58.3,
    bbox: { minLon: -136.6, minLat: 58.0, maxLon: -135.4, maxLat: 58.55 },
    hasTopography: true,
    hasEfh: true,
  },
  {
    id: "sitka-sound",
    name: "Sitka Sound — SE Alaska",
    description:
      "Sitka Sound off western Baranof Island — exposed outer-coast fishing grounds, kelp forests, and seamount-style pinnacles",
    waterType: "saltwater",
    minDepth: 10,
    maxDepth: 600,
    centerLon: -135.5,
    centerLat: 57.0,
    bbox: { minLon: -136.0, minLat: 56.7, maxLon: -135.0, maxLat: 57.25 },
    hasTopography: true,
    hasEfh: true,
  },
  {
    id: "juneau-approaches",
    name: "Juneau Approaches — SE Alaska",
    description:
      "Stephens Passage and Lynn Canal approaches to Juneau — deep mainland fjords, steep bedrock walls, and protected Inside Passage waters",
    waterType: "saltwater",
    minDepth: 10,
    maxDepth: 470,
    centerLon: -134.5,
    centerLat: 58.3,
    bbox: { minLon: -135.2, minLat: 57.9, maxLon: -133.8, maxLat: 58.7 },
    hasTopography: true,
    hasEfh: true,
  },
  {
    id: "ketchikan",
    name: "Ketchikan — SE Alaska",
    description:
      "Tongass Narrows and Revillagigedo Channel near Ketchikan — the southernmost Inside Passage fishing grounds, mixed rocky and silty seafloor",
    waterType: "saltwater",
    minDepth: 10,
    maxDepth: 400,
    centerLon: -131.65,
    centerLat: 55.35,
    bbox: { minLon: -132.3, minLat: 55.0, maxLon: -131.0, maxLat: 55.7 },
    hasTopography: true,
    hasEfh: true,
  },
  {
    id: "craig-klawock",
    name: "Craig & Klawock — SE Alaska",
    description:
      "Craig, Klawock, and Bucareli Bay on the west side of Prince of Wales Island — outer-coast salmon and halibut grounds with NCEI 1/3 arc-second DEM coverage",
    waterType: "saltwater",
    minDepth: 10,
    maxDepth: 450,
    centerLon: -133.15,
    centerLat: 55.5,
    bbox: { minLon: -133.7, minLat: 55.2, maxLon: -132.6, maxLat: 55.8 },
    hasTopography: true,
    hasEfh: true,
  },
  {
    id: "wrangell-petersburg",
    name: "Wrangell & Petersburg — SE Alaska",
    description:
      "Wrangell Narrows, Frederick Sound, and the central Inside Passage between Wrangell and Petersburg — protected mainland fjord fishing with high-res NCEI community DEM coverage",
    waterType: "saltwater",
    minDepth: 10,
    maxDepth: 480,
    centerLon: -132.85,
    centerLat: 56.6,
    bbox: { minLon: -133.5, minLat: 56.2, maxLon: -132.0, maxLat: 57.0 },
    hasTopography: true,
    hasEfh: true,
  },
  {
    id: "skagway-haines",
    name: "Skagway & Haines — Upper Lynn Canal",
    description:
      "Upper Lynn Canal between Haines and Skagway — deep glacial fjord at the head of the Inside Passage with NCEI 1/3 arc-second DEM coverage",
    waterType: "saltwater",
    minDepth: 5,
    maxDepth: 350,
    centerLon: -135.35,
    centerLat: 59.25,
    bbox: { minLon: -135.85, minLat: 58.95, maxLon: -134.85, maxLat: 59.55 },
    hasTopography: true,
    hasEfh: true,
  },
];

export const FRESHWATER_PRESET_DATASETS: DatasetMeta[] = [
  {
    id: "lake-fork",
    name: "Lake Fork Reservoir — East Texas",
    description:
      "TPWD-managed trophy largemouth bass reservoir on the Sabine River — shallow timber flats, hydrilla mats, and abundant crappie brushpiles",
    waterType: "freshwater",
    minDepth: 1,
    maxDepth: 21,
    centerLon: -95.535,
    centerLat: 32.865,
    bbox: { minLon: -95.65, minLat: 32.78, maxLon: -95.42, maxLat: 32.95 },
    hasTopography: true,
    hasEfh: true,
  },
  {
    id: "sam-rayburn",
    name: "Sam Rayburn Reservoir — East Texas",
    description:
      "Largest lake wholly in Texas, on the Angelina River — premier largemouth, white bass, crappie, and blue catfish fishery",
    waterType: "freshwater",
    minDepth: 1,
    maxDepth: 24,
    centerLon: -94.125,
    centerLat: 31.325,
    bbox: { minLon: -94.30, minLat: 31.05, maxLon: -93.95, maxLat: 31.60 },
    hasTopography: true,
    hasEfh: true,
  },
  {
    id: "lake-ray-roberts",
    name: "Lake Ray Roberts — North Texas",
    description:
      "USACE reservoir on the Elm Fork Trinity River near Denton — known for striped bass, largemouth, white bass, crappie, and channel/blue catfish",
    waterType: "freshwater",
    minDepth: 1,
    maxDepth: 30,
    centerLon: -97.03,
    centerLat: 33.40,
    bbox: { minLon: -97.15, minLat: 33.30, maxLon: -96.92, maxLat: 33.52 },
    hasTopography: true,
    hasEfh: true,
  },
  {
    id: "toledo-bend",
    name: "Toledo Bend Reservoir — Texas / Louisiana",
    description:
      "Sabine River reservoir on the Texas/Louisiana border — Top-10 nationally ranked largemouth fishery with cypress timber and a stocked hybrid striper population",
    waterType: "freshwater",
    minDepth: 1,
    maxDepth: 33,
    centerLon: -93.75,
    centerLat: 31.675,
    bbox: { minLon: -93.95, minLat: 31.15, maxLon: -93.55, maxLat: 32.20 },
    hasTopography: true,
    hasEfh: true,
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

/**
 * NCEI WCS coverage specs.
 *
 *   bagMosaic        — NCEI multibeam BAG composite, 1–50 m where surveyed.
 *                      Best for inshore corridors that have multibeam survey
 *                      coverage (Thorne Bay, Ketchikan, Sitka Sound, Juneau).
 *   demGlobalMosaic  — NCEI "best-available" DEM mosaic that integrates
 *                      community/tsunami DEMs (Juneau, Sitka, Ketchikan,
 *                      Craig, Skagway, Wrangell, etc.) at 8–90 m where they
 *                      exist, and falls back to coarser global grids
 *                      otherwise. Used as the secondary high-res source.
 */
interface NceiCoverage {
  url: string;
  coverage: string;
  label: string;
}

const NCEI_COVERAGES = {
  bagMosaic: {
    url: "https://gis.ngdc.noaa.gov/arcgis/services/bag_mosaic/ImageServer/WCSServer",
    coverage: "1",
    label: "NCEI BAG Mosaic",
  },
  demGlobalMosaic: {
    url: "https://gis.ngdc.noaa.gov/arcgis/services/DEM_global_mosaic/ImageServer/WCSServer",
    coverage: "1",
    label: "NCEI DEM Global Mosaic",
  },
} as const satisfies Record<string, NceiCoverage>;

type NceiCoverageKey = keyof typeof NCEI_COVERAGES;

/**
 * Per-dataset ordered list of NCEI coverages to try before falling back to
 * GEBCO. The first coverage that returns a usable grid wins; if all NCEI
 * attempts fail or return out-of-coverage data, GEBCO is used (and finally
 * a synthetic fbm fallback if GEBCO is also unreachable).
 *
 * Datasets not listed here skip NCEI entirely and go straight to GEBCO.
 */
export const NCEI_DATASET_COVERAGES: Record<string, NceiCoverageKey[]> = {
  "thorne-bay":         ["bagMosaic", "demGlobalMosaic"],
  "ketchikan":          ["bagMosaic", "demGlobalMosaic"],
  "sitka-sound":        ["bagMosaic", "demGlobalMosaic"],
  "juneau-approaches":  ["bagMosaic", "demGlobalMosaic"],
  "glacier-bay":        ["demGlobalMosaic", "bagMosaic"],
  "icy-strait":         ["demGlobalMosaic", "bagMosaic"],
  "craig-klawock":      ["demGlobalMosaic", "bagMosaic"],
  "wrangell-petersburg":["demGlobalMosaic", "bagMosaic"],
  "skagway-haines":     ["demGlobalMosaic", "bagMosaic"],
};

/**
 * Fetch bathymetric data from an NCEI WCS coverage for a given bounding box.
 *
 * NCEI elevation values are metres relative to MHW/MLLW (positive up, land > 0,
 * seafloor < 0). For BathyScan's TerrainGrid contract we convert to positive-down
 * depth and capture positive elevations in the topography array. The MLLW vs MSL
 * offset across SE Alaska is < 2 m and well below the viewer's vertical
 * resolution, so no per-source datum shift is applied.
 *
 * Returns the same shape as fetchGebcoGrid for a transparent swap-in. Throws
 * when the coverage returns an XML error, an empty grid, or a near-flat grid
 * (indicating no real survey coverage for the requested bbox) — callers should
 * catch and fall through to the next coverage / GEBCO.
 */
async function fetchNceiGrid(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  resolution: number,
  coverageKey: NceiCoverageKey = "bagMosaic"
): Promise<{ depths: number[]; minDepth: number; maxDepth: number; topography: number[]; hasTopography: boolean }> {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  const cov = NCEI_COVERAGES[coverageKey]!;
  const params = new URLSearchParams({
    SERVICE: "WCS",
    VERSION: "1.0.0",
    REQUEST: "GetCoverage",
    COVERAGE: cov.coverage,
    CRS: "EPSG:4326",
    BBOX: `${minLon},${minLat},${maxLon},${maxLat}`,
    FORMAT: "image/x-aaigrid",
    WIDTH: String(resolution),
    HEIGHT: String(resolution),
  });

  const url = `${cov.url}?${params.toString()}`;

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
  //    NCEI WCS (per-dataset coverage list) → GEBCO WCS → synthetic fallback
  let depths: number[] = [];
  let minDepth = 0;
  let maxDepth = 0;
  let topography: number[] | undefined;
  let hasTopography = false;
  let synthetic = false;
  let dataSource: TerrainDataSource = "gebco";
  let resolved = false;

  const nceiCoverages = NCEI_DATASET_COVERAGES[datasetId];

  if (nceiCoverages && nceiCoverages.length > 0) {
    for (const coverageKey of nceiCoverages) {
      const cov = NCEI_COVERAGES[coverageKey]!;
      try {
        console.info(`[terrain] Trying ${cov.label} for ${datasetId} at ${N}×${N}…`);
        const ncei = await fetchNceiGrid(meta.bbox, N, coverageKey);
        depths = ncei.depths;
        minDepth = ncei.minDepth;
        maxDepth = ncei.maxDepth;
        topography = ncei.topography;
        hasTopography = ncei.hasTopography;
        dataSource = "ncei";
        resolved = true;
        console.info(`[terrain] ${cov.label} fetched successfully for ${datasetId}`);
        break;
      } catch (nceiErr) {
        console.info(
          `[terrain] ${cov.label} unavailable for ${datasetId}: ${(nceiErr as Error).message}.`
        );
      }
    }
  }

  if (!resolved) {
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
