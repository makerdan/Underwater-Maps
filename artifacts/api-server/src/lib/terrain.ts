import { promises as fsPromises, readFileSync } from "fs";
import path from "path";
import { dirname, resolve as resolvePath } from "path";
import { fileURLToPath } from "url";
import { registerCache } from "./cacheRegistry.js";

/**
 * Which upstream data service produced this grid.
 *   "ncei"          — NCEI Bag Mosaic WCS (high-resolution multibeam survey)
 *   "gebco"         — GEBCO 2024 WCS (~400 m global grid)
 *   "synthetic"     — fbm fallback used when all upstream services are unreachable
 *   "twdb"          — TWDB Reservoir Volumetric & Sedimentation Survey
 *   "usace"         — USACE Fort Worth District hydrographic survey
 *   "usgs-3dep"     — USGS 3DEP best-available DEM (lidar where available,
 *                     1/3" seamless otherwise) — used for inland reservoir
 *                     pre-impoundment bathymetry and surrounding topography.
 */
export type TerrainDataSource =
  | "ncei"
  | "gebco"
  | "synthetic"
  | "twdb"
  | "usace"
  | "usgs-3dep";

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
  /** Which upstream source produced this grid (bathymetry primary). */
  dataSource?: TerrainDataSource;
  /**
   * Per-layer provenance for grids that bundle separately-sourced
   * bathymetry and topography layers (e.g. inland reservoirs where
   * bathymetry comes from a pre-impoundment DEM + shore-distance synthesis
   * and topography comes from a current lidar / DEM).
   */
  bathymetrySource?: TerrainDataSource;
  topographySource?: TerrainDataSource;
  /** Display label for the bathymetry source (overrides default per-source label). */
  bathymetrySourceLabel?: string;
  /** Display label for the topography source (overrides default per-source label). */
  topographySourceLabel?: string;
  /** Credit URL for the bathymetry source. */
  bathymetryCreditUrl?: string;
  /** Credit URL for the topography source. */
  topographyCreditUrl?: string;
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
 *   5 — Task #380: Lake Ray Roberts now short-circuits to a real
 *       USGS-3DEP-derived bathymetry + topography bundle before the
 *       NCEI/GEBCO chain; previously cached synthetic grids must go.
 *   6 — Task #398: ranked bathymetry source resolver. Every AOI now goes
 *       through a unified `BATHYMETRY_SOURCES` registry + per-AOI
 *       `DATASET_SOURCE_PRIORITY` ranked list (local → regional/state →
 *       national → global → synthetic). Source ordering may differ from
 *       the v5 hard-coded chain, so previously cached grids are flushed.
 */
export const TERRAIN_CACHE_VERSION = 6;

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
];

export const FRESHWATER_PRESET_DATASETS: DatasetMeta[] = [
  {
    id: "lake-ray-roberts",
    name: "Lake Ray Roberts (TX)",
    description:
      "Lake Ray Roberts, Denton County, TX. Bathymetry + topography are " +
      "served from a pre-built USGS 3DEP-derived bundle (pool elevation " +
      "192.79 m, surveyed max depth ≈ 28 m) — see " +
      "scripts/src/build-lake-ray-roberts-terrain.ts for the build " +
      "pipeline and lakeRayRobertsTerrain.gen.json for the bundle " +
      "itself. The 'bundled-survey' source is registered first in " +
      "DATASET_SOURCE_PRIORITY so the viewer always gets the real " +
      "surveyed grid instead of falling through to NCEI/GEBCO.",
    waterType: "freshwater",
    minDepth: 0,
    maxDepth: 28,
    centerLon: (-97.15 + -96.92) / 2,
    centerLat: (33.3 + 33.52) / 2,
    bbox: { minLon: -97.15, minLat: 33.3, maxLon: -96.92, maxLat: 33.52 },
    hasTopography: true,
  },
];

export const ALL_PRESET_DATASETS: DatasetMeta[] = [
  ...PRESET_DATASETS,
  ...FRESHWATER_PRESET_DATASETS,
];

// ---------------------------------------------------------------------------
// Bathymetry source registry + ranked resolver (Task #398)
//
// Every AOI flows through a single ranked list of bathymetry sources. The
// resolver tries each source in priority order and the first one that
// returns a usable grid wins; failures are logged and fall through to the
// next source, exactly mirroring the old NCEI→GEBCO loop. Synthetic fbm
// remains the implicit terminal fallback when every ranked source fails.
//
// Ranking rubric (highest priority first):
//   1. **Quality** — native resolution (1–50 m local multibeam beats
//      8–30 m community DEM beats ~400 m global grid), survey recency,
//      and survey type (purpose-built hydro survey > integrated DEM
//      mosaic > satellite-altimetry interpolation).
//   2. **Accessibility** — public WCS / REST / bundled grid, no auth,
//      reasonable response time (<60 s for a 256² tile). A source that
//      requires a manual download / FOIA request never makes the list.
//   3. **Scope** — within a given quality tier we prefer narrower scope
//      (local > regional > state > national > global), since local
//      surveys are usually purpose-built for the AOI.
//
// Recipe to add a new source:
//   1. Add an entry to `BATHYMETRY_SOURCES` with `{id, label, scope,
//      dataSource, creditUrl, fetch(meta, N) -> SourceFetchResult}`.
//      The fetch contract is identical to the legacy `fetchNceiGrid` /
//      `fetchGebcoGrid` helpers: return a usable grid or *throw* (the
//      resolver catches and falls through).
//   2. Add the new source id to the ranked list of every AOI it covers
//      in `DATASET_SOURCE_PRIORITY`, placing it according to the rubric.
//
// Recipe to add a new AOI:
//   1. Append the `DatasetMeta` to `ALL_PRESET_DATASETS` (via the
//      saltwater or freshwater preset list).
//   2. Add a `DATASET_SOURCE_PRIORITY[<id>]` entry with at least the
//      top 3 candidate sources in ranked order. If none is provided
//      the resolver defaults to `["gebco"]` and ultimately synthetic.
// ---------------------------------------------------------------------------

/** Provenance overrides a source can return (lets bundled grids report
 *  separate bathymetry vs topography sources). */
interface LayerProvenance {
  source: TerrainDataSource;
  label: string;
  creditUrl?: string;
}

/** Shape every `BathymetrySource.fetch` must return. Throws on failure;
 *  the resolver catches and tries the next ranked source. */
interface SourceFetchResult {
  depths: number[];
  minDepth: number;
  maxDepth: number;
  topography?: number[];
  hasTopography: boolean;
  /** Override the bathymetry provenance if it differs from the source's
   *  defaults (used by bundled grids whose bath layer comes from a
   *  different upstream than their topo layer). */
  bathymetryProvenance?: LayerProvenance;
  /** Override topography provenance (defaults to the bathymetry source's
   *  provenance when omitted). */
  topographyProvenance?: LayerProvenance;
  /** Source-supplied bbox override (bundled grids may not exactly match
   *  `meta.bbox`). When omitted the resolver uses `meta.bbox`. */
  bbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}

export type BathymetrySourceScope =
  | "local"
  | "regional"
  | "state"
  | "national"
  | "global";

interface BathymetrySource {
  id: string;
  label: string;
  scope: BathymetrySourceScope;
  dataSource: TerrainDataSource;
  creditUrl: string;
  fetch(meta: DatasetMeta, N: number): Promise<SourceFetchResult>;
}

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
 * Concrete bathymetry-source registry. Each entry conforms to the
 * `BathymetrySource` contract above. The resolver looks up entries by id
 * from a dataset's ranked priority list — sources are otherwise
 * independent of any AOI, so new sources can be added once and reused
 * across many AOIs.
 */
export const BATHYMETRY_SOURCES = {
  /** Per-AOI pre-built survey bundles (e.g. Lake Ray Roberts USACE+3DEP).
   *  Throws when the active AOI has no bundle registered. */
  "bundled-survey": {
    id: "bundled-survey",
    label: "Bundled survey",
    scope: "local",
    dataSource: "usgs-3dep",
    creditUrl: "https://www.usgs.gov/3d-elevation-program",
    async fetch(meta: DatasetMeta, N: number): Promise<SourceFetchResult> {
      const bundle = BUNDLED_TERRAIN[meta.id];
      if (!bundle) throw new Error(`no bundled grid registered for ${meta.id}`);
      const rs = resampleBundled(bundle, N);
      return {
        depths: rs.depths,
        minDepth: rs.minDepth,
        maxDepth: rs.maxDepth,
        topography: rs.hasTopography ? rs.topography : undefined,
        hasTopography: rs.hasTopography,
        bathymetryProvenance: {
          source: bundle.bathymetry.source,
          label: bundle.bathymetry.label,
          creditUrl: bundle.bathymetry.creditUrl,
        },
        topographyProvenance: {
          source: bundle.topographyProvenance.source,
          label: bundle.topographyProvenance.label,
          creditUrl: bundle.topographyProvenance.creditUrl,
        },
        bbox: bundle.bbox,
      };
    },
  },
  /** NCEI multibeam BAG composite, 1–50 m where surveyed. Best for
   *  inshore corridors with dedicated multibeam coverage. */
  "ncei-bag-mosaic": {
    id: "ncei-bag-mosaic",
    label: NCEI_COVERAGES.bagMosaic.label,
    scope: "regional",
    dataSource: "ncei",
    creditUrl: "https://www.ncei.noaa.gov/products/bathymetry",
    async fetch(meta: DatasetMeta, N: number): Promise<SourceFetchResult> {
      const r = await fetchNceiGrid(meta.bbox, N, "bagMosaic");
      return { ...r };
    },
  },
  /** NCEI "best-available" DEM mosaic — community/tsunami DEMs at 8–90 m
   *  where they exist, with coarser fallback elsewhere. */
  "ncei-dem-global-mosaic": {
    id: "ncei-dem-global-mosaic",
    label: NCEI_COVERAGES.demGlobalMosaic.label,
    scope: "regional",
    dataSource: "ncei",
    creditUrl: "https://www.ncei.noaa.gov/products/coastal-elevation-models",
    async fetch(meta: DatasetMeta, N: number): Promise<SourceFetchResult> {
      const r = await fetchNceiGrid(meta.bbox, N, "demGlobalMosaic");
      return { ...r };
    },
  },
  /** GEBCO 2024 global grid (~400 m). Last-resort upstream before
   *  synthetic — covers everywhere on the ocean but is too coarse for
   *  most inshore fishing-grade detail. */
  "gebco": {
    id: "gebco",
    label: "GEBCO 2024",
    scope: "global",
    dataSource: "gebco",
    creditUrl: "https://www.gebco.net/data_and_products/gridded_bathymetry_data/",
    async fetch(meta: DatasetMeta, N: number): Promise<SourceFetchResult> {
      const r = await fetchGebcoGrid(meta.bbox, N);
      return { ...r };
    },
  },
} as const satisfies Record<string, BathymetrySource>;

export type BathymetrySourceId = keyof typeof BATHYMETRY_SOURCES;

/**
 * Per-AOI ranked list of bathymetry sources. The resolver tries each
 * entry in order until one returns a usable grid. Datasets not listed
 * here fall through to `DEFAULT_SOURCE_PRIORITY` (gebco → synthetic).
 *
 * Ordering rubric (see header comment above): quality first, then
 * accessibility, then scope. Local/regional sources always precede
 * national/global ones when they cover the AOI.
 */
export const DATASET_SOURCE_PRIORITY: Record<string, BathymetrySourceId[]> = {
  // SE Alaska multibeam-first corridor — Thorne Bay has strong NCEI BAG
  // (multibeam, 1–50 m) coverage. BAG first, global DEM next, GEBCO last.
  "thorne-bay": ["ncei-bag-mosaic", "ncei-dem-global-mosaic", "gebco"],
  // Inland TX reservoir ships with a pre-built TWDB/USACE/3DEP bundle
  // (see scripts/src/build-lake-ray-roberts-terrain.ts). The bundle is the
  // only honest depth source for this AOI — NCEI/GEBCO have no inland
  // freshwater coverage — so it sits at the top of the list and the
  // synthetic terminal fallback handles the (rare) load-failure case.
  "lake-ray-roberts": ["bundled-survey", "gebco"],
};

/** Default ranked list for AOIs without an explicit entry. */
const DEFAULT_SOURCE_PRIORITY: readonly BathymetrySourceId[] = ["gebco"];

export function getDatasetSourcePriority(
  datasetId: string,
): readonly BathymetrySourceId[] {
  return DATASET_SOURCE_PRIORITY[datasetId] ?? DEFAULT_SOURCE_PRIORITY;
}

/**
 * Back-compat shim for the old `NCEI_DATASET_COVERAGES` export used by
 * `catalogSeeder.ts` (and mirrored client-side by `DatasetPanel.tsx`).
 * Derived from `DATASET_SOURCE_PRIORITY` so it always reflects the
 * current ranked lists.
 * @deprecated Use `DATASET_SOURCE_PRIORITY` / `getDatasetSourcePriority`.
 */
export const NCEI_DATASET_COVERAGES: Record<string, NceiCoverageKey[]> =
  Object.fromEntries(
    Object.entries(DATASET_SOURCE_PRIORITY)
      .map(([id, sources]) => {
        const ncei = sources
          .map((s) =>
            s === "ncei-bag-mosaic"
              ? ("bagMosaic" as NceiCoverageKey)
              : s === "ncei-dem-global-mosaic"
                ? ("demGlobalMosaic" as NceiCoverageKey)
                : null,
          )
          .filter((v): v is NceiCoverageKey => v !== null);
        return [id, ncei];
      })
      .filter(([, list]) => (list as NceiCoverageKey[]).length > 0),
  ) as Record<string, NceiCoverageKey[]>;

/**
 * Ranked-fallback resolver. Walks the AOI's `DATASET_SOURCE_PRIORITY` list
 * and returns the first source whose `fetch` succeeds. Each failure is
 * logged with its reason and the loop falls through to the next source —
 * mirroring the legacy NCEI loop. Returns `null` when every ranked source
 * fails; callers fall through to the synthetic fbm terminal.
 *
 * Exported for tests; production callers use it via `buildTerrainGrid`.
 */
export async function resolveBathymetrySource(
  meta: DatasetMeta,
  N: number,
): Promise<{ source: BathymetrySource; result: SourceFetchResult } | null> {
  const ranked = getDatasetSourcePriority(meta.id);
  for (const sourceId of ranked) {
    const source = BATHYMETRY_SOURCES[sourceId];
    if (!source) {
      console.warn(`[terrain] Unknown source '${sourceId}' for ${meta.id}; skipping.`);
      continue;
    }
    try {
      console.info(
        `[terrain] Trying ${source.label} (${source.scope}) for ${meta.id} at ${N}×${N}…`,
      );
      const result = await source.fetch(meta, N);
      console.info(`[terrain] ${source.label} resolved successfully for ${meta.id}.`);
      return { source, result };
    } catch (err) {
      console.info(
        `[terrain] ${source.label} unavailable for ${meta.id}: ${(err as Error).message}.`,
      );
    }
  }
  return null;
}

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
// Bundled per-dataset terrain grids (built at repo build time from
// real surveys/DEMs that the NCEI/GEBCO chain can't supply, e.g. inland
// reservoirs). Loaded synchronously at startup so buildTerrainGrid can
// short-circuit to them before attempting any HTTP fetch.
// ---------------------------------------------------------------------------

interface BundledLayerProvenance {
  source: TerrainDataSource;
  label: string;
  creditUrl: string;
  serviceUrl: string;
  fetchedAt: string;
  attempts: { source: TerrainDataSource | string; ok: boolean; note: string }[];
}

export interface BundledTerrain {
  datasetId: string;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  width: number;
  height: number;
  depths: number[];
  topography: number[];
  minDepth: number;
  maxDepth: number;
  minTopography: number;
  maxTopography: number;
  poolElevationM: number;
  bathymetry: BundledLayerProvenance;
  topographyProvenance: BundledLayerProvenance;
}

const __terrainDir = dirname(fileURLToPath(import.meta.url));

function loadBundledTerrain(fileName: string): BundledTerrain | null {
  try {
    const raw = readFileSync(resolvePath(__terrainDir, fileName), "utf8");
    return JSON.parse(raw) as BundledTerrain;
  } catch (err) {
    console.warn(`[terrain] Bundled terrain '${fileName}' unavailable: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Pre-built bundles keyed by datasetId. When `buildTerrainGrid` is called
 * for one of these ids, the bundled grid is returned immediately (after
 * a nearest-neighbour resample to the requested resolution).
 *
 * Bundles are generated offline by the `@workspace/scripts`
 * `build-*-terrain` builders and committed under
 * `artifacts/api-server/src/lib/*Terrain.gen.json`. Each entry below
 * loads its bundle synchronously at module init so `buildTerrainGrid`
 * and `previewDataset` can short-circuit before attempting any HTTP
 * fetch. A missing/unreadable file logs a warning and leaves the entry
 * null — the ranked resolver then falls through to the next source.
 */
export const BUNDLED_TERRAIN: Record<string, BundledTerrain | null> = {
  "lake-ray-roberts": loadBundledTerrain("lakeRayRobertsTerrain.gen.json"),
};

/** Resample a bundled grid to the requested resolution by nearest neighbour. */
export function resampleBundled(bundle: BundledTerrain, N: number): {
  depths: number[];
  topography: number[];
  minDepth: number;
  maxDepth: number;
  hasTopography: boolean;
} {
  const { width, height, depths: srcD, topography: srcT } = bundle;
  if (width === N && height === N) {
    const hasTopo = srcT.some((v) => v > 0);
    return {
      depths: srcD.slice(),
      topography: srcT.slice(),
      minDepth: bundle.minDepth,
      maxDepth: bundle.maxDepth,
      hasTopography: hasTopo,
    };
  }
  const depths = new Array<number>(N * N).fill(0);
  const topography = new Array<number>(N * N).fill(0);
  let minDepth = Infinity, maxDepth = -Infinity;
  let landCells = 0;
  for (let row = 0; row < N; row++) {
    const srcRow = Math.min(height - 1, Math.floor((row / N) * height));
    for (let col = 0; col < N; col++) {
      const srcCol = Math.min(width - 1, Math.floor((col / N) * width));
      const srcIdx = srcRow * width + srcCol;
      const dstIdx = row * N + col;
      const d = srcD[srcIdx]!;
      const t = srcT[srcIdx]!;
      depths[dstIdx] = d;
      topography[dstIdx] = t;
      if (t > 0) landCells++;
      if (d < minDepth) minDepth = d;
      if (d > maxDepth) maxDepth = d;
    }
  }
  if (!isFinite(minDepth)) minDepth = 0;
  if (!isFinite(maxDepth)) maxDepth = 0;
  return { depths, topography, minDepth, maxDepth, hasTopography: landCells > 0 };
}

// ---------------------------------------------------------------------------
// Terrain cache & grid builder (memory + disk)
// ---------------------------------------------------------------------------

const DISK_CACHE_DIR = "/tmp/gebco-cache";
const memoryCache = new Map<string, TerrainGrid>();
registerCache(() => memoryCache.clear());

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

// ---------------------------------------------------------------------------
// Preflight / preview — resolves the upstream dataSource without transferring
// the full depth grid. Used by the client to warn before loading synthetic
// bathymetry. Cached briefly per dataset id so an immediate confirm does not
// re-probe upstream services.
// ---------------------------------------------------------------------------

export interface DatasetPreview {
  datasetId: string;
  name: string;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  dataSource: TerrainDataSource | "unknown";
  syntheticReason?: string;
}

interface PreviewCacheEntry {
  result: DatasetPreview;
  ts: number;
}

const previewCache = new Map<string, PreviewCacheEntry>();
registerCache(() => previewCache.clear());
const PREVIEW_CACHE_TTL_MS = 60_000;

export function clearPreviewCache(): void {
  previewCache.clear();
}

/**
 * Probe upstream services to determine which dataSource (ncei | gebco |
 * synthetic) would serve this dataset, without transferring the full depth
 * grid. Uses a small N=32 probe and caches the verdict for ~60s so the
 * follow-up terrain fetch doesn't pay for a second round of probing.
 *
 * If the dataset's terrain is already in the memory cache at any resolution,
 * its dataSource is reused directly.
 */
export async function previewDataset(datasetId: string): Promise<DatasetPreview | null> {
  const meta = ALL_PRESET_DATASETS.find((d) => d.id === datasetId);
  if (!meta) return null;

  const now = Date.now();
  const cached = previewCache.get(datasetId);
  if (cached && now - cached.ts < PREVIEW_CACHE_TTL_MS) {
    return cached.result;
  }

  // Reuse any already-built terrain grid (any resolution) for this dataset.
  for (const [key, grid] of memoryCache) {
    if (key.startsWith(meta.id.replace(/[^a-z0-9-]/gi, "_") + "-") && grid.dataSource) {
      const result: DatasetPreview = {
        datasetId: meta.id,
        name: meta.name,
        bbox: meta.bbox,
        dataSource: grid.dataSource,
        ...(grid.dataSource === "synthetic"
          ? { syntheticReason: "upstream bathymetry services unreachable" }
          : {}),
      };
      previewCache.set(datasetId, { result, ts: now });
      return result;
    }
  }

  // Bundled pre-built terrain (real surveys/DEMs for AOIs where NCEI and
  // GEBCO have no usable coverage — e.g. inland TX reservoirs). Mirrors
  // the short-circuit in buildTerrainGrid so preflight never reports
  // "synthetic" for a dataset that will actually load real bundled data.
  const bundle = BUNDLED_TERRAIN[datasetId];
  if (bundle) {
    const result: DatasetPreview = {
      datasetId: meta.id,
      name: meta.name,
      bbox: meta.bbox,
      dataSource: bundle.bathymetry.source,
    };
    previewCache.set(datasetId, { result, ts: now });
    return result;
  }

  // Probe upstream at the smallest resolution (cheap) just to learn the
  // dataSource. Uses the ranked resolver so the preflight always matches
  // what buildTerrainGrid() would produce.
  const resolved = await resolveBathymetrySource(meta, 32);
  const dataSource: DatasetPreview["dataSource"] = resolved ? resolved.source.dataSource : "synthetic";
  const syntheticReason: string | undefined =
    dataSource === "synthetic"
      ? "Bathymetry data unavailable — terrain is procedurally generated"
      : undefined;

  const result: DatasetPreview = {
    datasetId: meta.id,
    name: meta.name,
    bbox: meta.bbox,
    dataSource,
    ...(dataSource === "synthetic" && syntheticReason ? { syntheticReason } : {}),
  };
  previewCache.set(datasetId, { result, ts: now });
  return result;
}

/**
 * Build a TerrainGrid for an arbitrary bbox by fetching directly from the
 * GEBCO 2024 WCS. Unlike `buildTerrainGrid` (which is keyed on the in-tree
 * preset registry), this helper is bbox-driven so the catalog "Save"
 * pipeline can materialize non-preset GEBCO entries.
 *
 * Throws on upstream failure — the caller decides whether to surface a
 * `failed` save row or retry. No memory/disk caching here; catalog saves
 * persist into `custom_datasets`, which is the durable cache.
 */
export async function buildGebcoTerrainForBbox(
  meta: {
    datasetId: string;
    name: string;
    waterType: "saltwater" | "freshwater";
    bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  },
  resolution = 256,
  options: { smoothing?: boolean } = {},
): Promise<TerrainGrid> {
  const N = Math.max(32, Math.min(512, resolution));
  const smoothing = options.smoothing ?? true;

  const { depths, topography, hasTopography } = await fetchGebcoGrid(
    meta.bbox,
    N,
  );

  if (smoothing) {
    let mn = Infinity, mx = -Infinity;
    for (const d of depths) {
      if (d < mn) mn = d;
      if (d > mx) mx = d;
    }
    if (!isFinite(mn)) mn = 0;
    if (!isFinite(mx)) mx = 0;
    smoothSpikes(depths, N, Math.max(1, mx - mn));
  }

  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (const d of depths) {
    if (d < minDepth) minDepth = d;
    if (d > maxDepth) maxDepth = d;
  }
  if (!isFinite(minDepth)) minDepth = 0;
  if (!isFinite(maxDepth)) maxDepth = 0;

  const centerLon = (meta.bbox.minLon + meta.bbox.maxLon) / 2;
  const centerLat = (meta.bbox.minLat + meta.bbox.maxLat) / 2;

  const grid: TerrainGrid = {
    datasetId: meta.datasetId,
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
    centerLon,
    centerLat,
    dataSource: "gebco",
    bathymetrySource: "gebco",
    bathymetrySourceLabel: "GEBCO 2024",
    bathymetryCreditUrl:
      "https://www.gebco.net/data_and_products/gridded_bathymetry_data/",
    version: TERRAIN_CACHE_VERSION,
    ...(hasTopography && topography
      ? {
          topography,
          hasTopography: true,
          topographySource: "gebco" as const,
          topographySourceLabel: "GEBCO 2024",
          topographyCreditUrl:
            "https://www.gebco.net/data_and_products/gridded_bathymetry_data/",
        }
      : {}),
  };

  return grid;
}

/**
 * Build a TerrainGrid for an arbitrary bbox by fetching directly from an
 * NCEI WCS coverage (BAG mosaic or DEM Global Mosaic). Mirrors
 * `buildGebcoTerrainForBbox` so the catalog "Save" pipeline can
 * materialize non-preset NCEI entries (e.g. `ncei-bag-mosaic-alaska`,
 * `ncei-community-dem-*`) end-to-end.
 *
 * Throws on upstream failure — `fetchNceiGrid` already surfaces a clear
 * "coverage unavailable" / "near-flat grid — likely no coverage" message
 * which the catalog materializer then writes into the save row's
 * `errorMessage`. No memory/disk caching here; catalog saves persist
 * into `custom_datasets`, which is the durable cache.
 */
export async function buildNceiTerrainForBbox(
  meta: {
    datasetId: string;
    name: string;
    waterType: "saltwater" | "freshwater";
    bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
    coverageKey: NceiCoverageKey;
  },
  resolution = 256,
  options: { smoothing?: boolean } = {},
): Promise<TerrainGrid> {
  const N = Math.max(32, Math.min(512, resolution));
  const smoothing = options.smoothing ?? true;

  const { depths, topography, hasTopography } = await fetchNceiGrid(
    meta.bbox,
    N,
    meta.coverageKey,
  );

  if (smoothing) {
    let mn = Infinity, mx = -Infinity;
    for (const d of depths) {
      if (d < mn) mn = d;
      if (d > mx) mx = d;
    }
    if (!isFinite(mn)) mn = 0;
    if (!isFinite(mx)) mx = 0;
    smoothSpikes(depths, N, Math.max(1, mx - mn));
  }

  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (const d of depths) {
    if (d < minDepth) minDepth = d;
    if (d > maxDepth) maxDepth = d;
  }
  if (!isFinite(minDepth)) minDepth = 0;
  if (!isFinite(maxDepth)) maxDepth = 0;

  const centerLon = (meta.bbox.minLon + meta.bbox.maxLon) / 2;
  const centerLat = (meta.bbox.minLat + meta.bbox.maxLat) / 2;

  const cov = NCEI_COVERAGES[meta.coverageKey]!;

  const grid: TerrainGrid = {
    datasetId: meta.datasetId,
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
    centerLon,
    centerLat,
    dataSource: "ncei",
    bathymetrySource: "ncei",
    bathymetrySourceLabel: cov.label,
    bathymetryCreditUrl:
      meta.coverageKey === "bagMosaic"
        ? "https://www.ncei.noaa.gov/products/bathymetry"
        : "https://www.ncei.noaa.gov/products/coastal-elevation-models",
    version: TERRAIN_CACHE_VERSION,
    ...(hasTopography && topography
      ? {
          topography,
          hasTopography: true,
          topographySource: "ncei" as const,
          topographySourceLabel: cov.label,
          topographyCreditUrl:
            meta.coverageKey === "bagMosaic"
              ? "https://www.ncei.noaa.gov/products/bathymetry"
              : "https://www.ncei.noaa.gov/products/coastal-elevation-models",
        }
      : {}),
  };

  return grid;
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

  // 3. Resolve the bathymetry grid through the AOI's ranked source list.
  //    Each source is tried in priority order (local → regional/state →
  //    national → global); the first usable grid wins. Synthetic fbm is
  //    the implicit terminal fallback when every ranked source fails.
  const resolved = await resolveBathymetrySource(meta, N);

  let depths: number[];
  let minDepth: number;
  let maxDepth: number;
  let topography: number[] | undefined;
  let hasTopography = false;
  let synthetic = false;
  let dataSource: TerrainDataSource;
  let bathymetrySource: TerrainDataSource;
  let topographySource: TerrainDataSource | undefined;
  let bathymetrySourceLabel: string | undefined;
  let topographySourceLabel: string | undefined;
  let bathymetryCreditUrl: string | undefined;
  let topographyCreditUrl: string | undefined;
  let bbox = meta.bbox;

  if (resolved) {
    const { source, result } = resolved;
    depths = result.depths;
    minDepth = result.minDepth;
    maxDepth = result.maxDepth;
    topography = result.topography;
    hasTopography = result.hasTopography;
    if (result.bbox) bbox = result.bbox;
    const bathProv = result.bathymetryProvenance ?? {
      source: source.dataSource,
      label: source.label,
      creditUrl: source.creditUrl,
    };
    const topoProv = result.topographyProvenance ?? bathProv;
    dataSource = bathProv.source;
    bathymetrySource = bathProv.source;
    bathymetrySourceLabel = bathProv.label;
    bathymetryCreditUrl = bathProv.creditUrl;
    if (hasTopography) {
      topographySource = topoProv.source;
      topographySourceLabel = topoProv.label;
      topographyCreditUrl = topoProv.creditUrl;
    }
  } else {
    console.warn(
      `[terrain] All ranked sources failed for ${datasetId}; using synthetic fallback.`,
    );
    const synth = buildSyntheticGrid(datasetId, N, meta);
    depths = synth.depths;
    minDepth = synth.minDepth;
    maxDepth = synth.maxDepth;
    synthetic = true;
    dataSource = "synthetic";
    bathymetrySource = "synthetic";
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
    minLon: bbox.minLon,
    maxLon: bbox.maxLon,
    minLat: bbox.minLat,
    maxLat: bbox.maxLat,
    centerLon: meta.centerLon,
    centerLat: meta.centerLat,
    synthetic,
    dataSource,
    bathymetrySource,
    ...(bathymetrySourceLabel ? { bathymetrySourceLabel } : {}),
    ...(bathymetryCreditUrl ? { bathymetryCreditUrl } : {}),
    ...(topographySource ? { topographySource } : {}),
    ...(topographySourceLabel ? { topographySourceLabel } : {}),
    ...(topographyCreditUrl ? { topographyCreditUrl } : {}),
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

  const depthFn = depthFns[datasetId] ?? ((nx: number, ny: number) => {
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
// Bbox download helpers — arbitrary-bbox terrain for user CSV exports
// ---------------------------------------------------------------------------

/**
 * Probe an arbitrary bbox to determine which upstream data source would serve
 * it and how many water-depth grid points a download at the chosen resolution
 * would contain.  Uses a cheap N=32 fetch so the preflight is fast.
 */
export async function previewBboxForDownload(
  bbox: { north: number; south: number; east: number; west: number },
): Promise<{
  sourceName: string;
  dataSource: TerrainDataSource;
  nominalResolutionM: number;
  waterFraction: number;
}> {
  const { north, south, east, west } = bbox;
  const gBbox = { minLon: west, minLat: south, maxLon: east, maxLat: north };
  const PROBE_N = 32;

  let dataSource: TerrainDataSource = "gebco";
  let sourceName = "GEBCO 2024 (~400 m)";
  let nominalResolutionM = 400;
  let probeDepths: number[] | null = null;

  // Try NCEI BAG mosaic first — best quality for coastal regions.
  try {
    const r = await fetchNceiGrid(gBbox, PROBE_N, "bagMosaic");
    dataSource = "ncei";
    sourceName = "NCEI BAG Mosaic (~10 m)";
    nominalResolutionM = 10;
    probeDepths = r.depths;
  } catch {
    // Fall through to GEBCO
    try {
      const r = await fetchGebcoGrid(gBbox, PROBE_N);
      dataSource = "gebco";
      sourceName = "GEBCO 2024 (~400 m)";
      nominalResolutionM = 400;
      probeDepths = r.depths;
    } catch {
      dataSource = "synthetic";
      sourceName = "No upstream coverage";
      nominalResolutionM = 0;
    }
  }

  // Compute water-cell fraction from the probe grid. Exposed to the client so
  // it can derive estimatedPoints = resolution² × waterFraction locally
  // without an extra round-trip when the user switches resolution.
  let waterFraction = 1.0;
  if (probeDepths) {
    const waterCells = probeDepths.filter((d) => d > 0).length;
    waterFraction = probeDepths.length > 0 ? waterCells / probeDepths.length : 1.0;
  }

  return { sourceName, dataSource, nominalResolutionM, waterFraction };
}

/**
 * Fetch bathymetric data for an arbitrary bbox and return a flat array of
 * `{ lon, lat, depth }` rows ready for CSV serialisation.  Only water cells
 * (depth > 0) are included — land / topography is excluded.
 *
 * Tries NCEI BAG mosaic first; falls back to GEBCO 2024.  Throws when both
 * upstream sources fail.
 */
export async function buildBboxCsvRows(
  bbox: { north: number; south: number; east: number; west: number },
  resolution: number,
): Promise<{ lon: number; lat: number; depth: number }[]> {
  const { north, south, east, west } = bbox;
  const gBbox = { minLon: west, minLat: south, maxLon: east, maxLat: north };
  const N = Math.max(32, Math.min(512, resolution));

  let depths: number[];

  try {
    const r = await fetchNceiGrid(gBbox, N, "bagMosaic");
    depths = r.depths;
  } catch {
    try {
      const r = await fetchGebcoGrid(gBbox, N);
      depths = r.depths;
    } catch (err) {
      throw new Error(
        `No bathymetric data source available for this area: ${(err as Error).message}`,
      );
    }
  }

  const lonStep = N > 1 ? (east - west) / (N - 1) : 0;
  const latStep = N > 1 ? (north - south) / (N - 1) : 0;

  const rows: { lon: number; lat: number; depth: number }[] = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const depth = depths[row * N + col] ?? 0;
      if (depth <= 0) continue;
      const lon = west + col * lonStep;
      const lat = south + row * latStep;
      rows.push({ lon, lat, depth });
    }
  }
  return rows;
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
