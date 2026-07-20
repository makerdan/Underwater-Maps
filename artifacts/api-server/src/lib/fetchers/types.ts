/**
 * Shared types for the per-source bathymetry fetcher interface.
 *
 * Each catalog preset carries a `fetchStrategy` descriptor that names which
 * fetcher to use and what parameters to pass (item ID, WCS coverage name,
 * ArcGIS service URL, etc.).
 *
 * `probe()` — lightweight availability check (no data download).
 * `fetch()` — full download + parse, returns a processed bundle.
 */

export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

// ---------------------------------------------------------------------------
// Per-fetcher strategy descriptors (discriminated union on `kind`)
// ---------------------------------------------------------------------------

export interface ScienceBaseFetchStrategy {
  kind: "sciencebase";
  /** USGS ScienceBase catalog item ID (hex string). */
  itemId: string;
  /** Water surface / pool elevation in metres above sea level. */
  poolElevationM: number;
  /** Known maximum surveyed depth in metres. */
  maxDepthM: number;
}

export interface Usgs3depFetchStrategy {
  kind: "usgs-3dep";
}

export interface NceiWcsFetchStrategy {
  kind: "ncei-wcs";
  coverageKey: "bagMosaic" | "demGlobalMosaic" | "southAlaskaCrm";
}

export interface ArcGisRestFetchStrategy {
  kind: "arcgis-rest";
  serviceUrl: string;
  sourceLabel: string;
  dataSource: string;
  creditUrl: string;
}

export interface GreatLakesWcsFetchStrategy {
  kind: "great-lakes-wcs";
}

export interface GebcoWcsFetchStrategy {
  kind: "gebco-wcs";
}

/** Dataset is already served from a pre-built static bundle file. */
export interface BundledFetchStrategy {
  kind: "bundled";
}

export type FetchStrategy =
  | ScienceBaseFetchStrategy
  | Usgs3depFetchStrategy
  | NceiWcsFetchStrategy
  | ArcGisRestFetchStrategy
  | GreatLakesWcsFetchStrategy
  | GebcoWcsFetchStrategy
  | BundledFetchStrategy;

export type FetchStrategyKind = FetchStrategy["kind"];

// ---------------------------------------------------------------------------
// Return shapes
// ---------------------------------------------------------------------------

export interface ProbeResult {
  available: boolean;
  title: string;
  /** Human-readable resolution description, e.g. "3 m multibeam". */
  resolution?: string;
  /** Vintage / last-updated date string, if available from metadata. */
  vintage?: string;
  /** Error message when `available` is false. */
  error?: string;
}

/**
 * Processed bundle returned by `BathymetryFetcher.fetch()`.
 * Shape is compatible with `BundledTerrain` from terrain.ts.
 */
export interface BathyFetchBundle {
  depths: number[];
  topography: number[];
  hasTopography: boolean;
  minDepth: number;
  maxDepth: number;
  width: number;
  height: number;
  bbox: Bbox;
  dataSource: string;
  label: string;
  creditUrl?: string;
}

// ---------------------------------------------------------------------------
// Fetcher contract
// ---------------------------------------------------------------------------

export interface BathymetryFetcher {
  /**
   * Lightweight probe — queries metadata without downloading any raster data.
   * Must complete in < 30 s. Throws only on internal errors; return
   * `{ available: false, error: '...' }` for expected service failures.
   */
  probe(strategy: FetchStrategy, bbox: Bbox): Promise<ProbeResult>;

  /**
   * Full download + parse. Returns a processed grid bundle (N×N grid).
   * Throws on irrecoverable failure. May take several minutes for large
   * GeoTIFFs.
   */
  fetch(strategy: FetchStrategy, bbox: Bbox, N: number): Promise<BathyFetchBundle>;
}
